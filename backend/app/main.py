import asyncio
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import copy
import re
import time
from collections import deque
from threading import Lock
import urllib.parse
import urllib.request
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Header, Request
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, List, Callable, Literal
from fastapi.middleware.cors import CORSMiddleware

import stripe

from .db import (
    ACTIVE_BACKEND,
    IS_PRODUCTION,
    db,
    fetch_postgres_latest_sensor_readings,
    ping_database,
)
from .models import UserReportCreate
from .sensor_ingest import (
    build_sensor_readings,
    fetch_selangor_readings,
    fetch_selangor_water_level_history_for_sensor,
)
from .weather_context import (
    OPEN_METEO_DEFAULT_BATCH_LIMIT,
    get_forecast_summaries,
    get_location_forecast_context,
)

app = FastAPI()
logger = logging.getLogger("sensor-ingest")

SENSOR_INGEST_INTERVAL_SECONDS = int(os.getenv("SENSOR_INGEST_INTERVAL_SECONDS", "600"))
SENSOR_INGEST_ENABLED = os.getenv("SENSOR_INGEST_ENABLED", "1").lower() in {"1", "true", "yes"}
_sensor_ingest_task: asyncio.Task | None = None
HOME_PREVIEW_CACHE_TTL_SECONDS = 15
_home_preview_cache: dict[str, Any] | None = None
_home_preview_cache_expires_at = 0.0
_home_preview_cache_lock: asyncio.Lock | None = None
WEATHER_RATE_LIMIT_WINDOW_SECONDS = 5 * 60
WEATHER_RATE_LIMITS: dict[str, int] = {
    "forecast-summaries": 60,
    "location-context": 30,
}
_weather_rate_limit_lock: asyncio.Lock | None = None
_weather_rate_limit_hits: dict[str, deque[float]] = {}
LOCATION_CONTEXT_MAX_RADIUS_KM = float(
    os.getenv("LOCATION_CONTEXT_MAX_RADIUS_KM", "100")
)
LOCATION_CONTEXT_REVERSE_GEOCODE_URL = os.getenv(
    "LOCATION_CONTEXT_REVERSE_GEOCODE_URL",
    "https://nominatim.openstreetmap.org/reverse",
)
LOCATION_CONTEXT_REVERSE_GEOCODE_TIMEOUT_SECONDS = float(
    os.getenv("LOCATION_CONTEXT_REVERSE_GEOCODE_TIMEOUT_SECONDS", "6")
)
LOCATION_CONTEXT_REVERSE_GEOCODE_USER_AGENT = os.getenv(
    "LOCATION_CONTEXT_REVERSE_GEOCODE_USER_AGENT",
    "WaterStatus/1.0 (location-context)",
)
LOCATION_CONTEXT_REVERSE_GEOCODE_ACCEPT_LANGUAGE = os.getenv(
    "LOCATION_CONTEXT_REVERSE_GEOCODE_ACCEPT_LANGUAGE",
    "en",
)
LOCATION_CONTEXT_REVERSE_GEOCODE_CACHE_TTL_SECONDS = int(
    os.getenv("LOCATION_CONTEXT_REVERSE_GEOCODE_CACHE_TTL_SECONDS", "1800")
)
LOCATION_CONTEXT_REVERSE_GEOCODE_ERROR_CACHE_TTL_SECONDS = int(
    os.getenv("LOCATION_CONTEXT_REVERSE_GEOCODE_ERROR_CACHE_TTL_SECONDS", "180")
)
LOCATION_CONTEXT_REVERSE_GEOCODE_COORD_PRECISION = int(
    os.getenv("LOCATION_CONTEXT_REVERSE_GEOCODE_COORD_PRECISION", "4")
)
_reverse_geocode_label_cache: dict[str, tuple[float, str | None]] = {}
_reverse_geocode_label_cache_lock = Lock()
_DEFAULT_DEV_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _get_home_preview_cache_lock() -> asyncio.Lock:
    global _home_preview_cache_lock
    if _home_preview_cache_lock is None:
        _home_preview_cache_lock = asyncio.Lock()
    return _home_preview_cache_lock


def _get_weather_rate_limit_lock() -> asyncio.Lock:
    global _weather_rate_limit_lock
    if _weather_rate_limit_lock is None:
        _weather_rate_limit_lock = asyncio.Lock()
    return _weather_rate_limit_lock


def _extract_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        forwarded_ip = forwarded_for.split(",")[0].strip()
        if forwarded_ip:
            return forwarded_ip

    client_host = getattr(request.client, "host", None)
    return client_host or "unknown"


async def _enforce_weather_rate_limit(
    request: Request,
    scope: Literal["forecast-summaries", "location-context"],
) -> None:
    now = time.monotonic()
    cutoff = now - WEATHER_RATE_LIMIT_WINDOW_SECONDS
    request_limit = WEATHER_RATE_LIMITS[scope]
    request_key = f"{scope}:{_extract_client_ip(request)}"

    # Keep the in-memory limiter bounded by evicting expired request timestamps.
    async with _get_weather_rate_limit_lock():
        expired_keys: list[str] = []
        for key, timestamps in _weather_rate_limit_hits.items():
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if not timestamps:
                expired_keys.append(key)

        for key in expired_keys:
            _weather_rate_limit_hits.pop(key, None)

        timestamps = _weather_rate_limit_hits.setdefault(request_key, deque())
        if len(timestamps) >= request_limit:
            retry_after_seconds = max(
                1,
                math.ceil(WEATHER_RATE_LIMIT_WINDOW_SECONDS - (now - timestamps[0])),
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "Forecast is temporarily rate-limited. Try again shortly.",
                    "retry_after_seconds": retry_after_seconds,
                    "scope": scope,
                },
                headers={"Retry-After": str(retry_after_seconds)},
            )

        timestamps.append(now)


def _reset_weather_rate_limit_state() -> None:
    _weather_rate_limit_hits.clear()


def _reset_location_reverse_geocode_cache() -> None:
    with _reverse_geocode_label_cache_lock:
        _reverse_geocode_label_cache.clear()


def _normalize_origin(raw: str) -> str:
    return raw.strip().rstrip("/")


def _parse_origin_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [
        _normalize_origin(item)
        for item in raw.split(",")
        if _normalize_origin(item)
    ]


def _build_allowed_origins() -> list[str]:
    origins = set(_DEFAULT_DEV_ORIGINS)
    origins.update(_parse_origin_list(os.getenv("ALLOWED_ORIGINS")))

    frontend_origin = _normalize_origin(os.getenv("FRONTEND_ORIGIN", ""))
    if frontend_origin:
        origins.add(frontend_origin)

    if "*" in origins:
        if IS_PRODUCTION:
            raise RuntimeError("Wildcard CORS origins are not allowed in production.")
        origins.remove("*")

    if IS_PRODUCTION:
        non_local = [
            origin
            for origin in origins
            if origin not in _DEFAULT_DEV_ORIGINS
        ]
        if not non_local:
            raise RuntimeError(
                "Production mode requires at least one non-local CORS origin. "
                "Set FRONTEND_ORIGIN or ALLOWED_ORIGINS."
            )

    return sorted(origins)


ALLOWED_CORS_ORIGINS = _build_allowed_origins()

# Fallback sample sensors (used when persistent DB is unavailable)
FALLBACK_SENSORS = [
    {
        "name": "KLCC 0001",
        "type": "rain",
        "location": "KLCC",
        "unit": "mm/h",
        "latitude": 3.1562544,
        "longitude": 101.7117189,
        "is_active": True,
    },
    {
        "name": "Batu Caves 0001",
        "type": "rain",
        "location": "Batu Caves",
        "unit": "mm/h",
        "latitude": 3.2378937,
        "longitude": 101.6843203,
        "is_active": True,
    },
    {
        "name": "Genting Highlands 0001",
        "type": "rain",
        "location": "Genting Highlands",
        "unit": "mm/h",
        "latitude": 3.4210163,
        "longitude": 101.7976389,
        "is_active": True,
    },
    {
        "name": "Masjid Putra 0001",
        "type": "rain",
        "location": "Masjid Putra",
        "unit": "mm/h",
        "latitude": 2.9358969,
        "longitude": 101.6894364,
        "is_active": True,
    },
    {
        "name": "Sungai Gombak 0001",
        "type": "water_level",
        "location": "Sungai Gombak",
        "unit": "m",
        "latitude": 3.166,
        "longitude": 101.695,
        "is_active": True,
    },
    {
        "name": "Sungai Klang 0001",
        "type": "water_level",
        "location": "Sungai Klang",
        "unit": "m",
        "latitude": 3.148,
        "longitude": 101.694,
        "is_active": True,
    },
    {
        "name": "Kampung Baru 0001",
        "type": "temperature",
        "location": "Kampung Baru",
        "unit": "°C",
        "latitude": 3.159,
        "longitude": 101.7,
        "is_active": True,
    },
    {
        "name": "Cheras 0001",
        "type": "temperature",
        "location": "Cheras",
        "unit": "°C",
        "latitude": 3.084,
        "longitude": 101.743,
        "is_active": True,
    },
    {
        "name": "Putrajaya 0001",
        "type": "rain",
        "location": "Putrajaya",
        "unit": "mm/h",
        "latitude": 2.926,
        "longitude": 101.696,
        "is_active": True,
    },
    {
        "name": "Subang Jaya 0001",
        "type": "rain",
        "location": "Subang Jaya",
        "unit": "mm/h",
        "latitude": 3.081,
        "longitude": 101.585,
        "is_active": True,
    },
]


def get_fallback_sensors_with_ids():
    global _fallback_cached
    if "_fallback_cached" not in globals() or _fallback_cached is None:
        sensors = copy.deepcopy(FALLBACK_SENSORS)
        for s in sensors:
            s["_id"] = str(uuid4())
        _fallback_cached = sensors
    return copy.deepcopy(_fallback_cached)

_fallback_cached = None
DEFAULT_TEMPERATURE_SENSORS = [
    copy.deepcopy(sensor)
    for sensor in FALLBACK_SENSORS
    if sensor.get("type") == "temperature"
]


async def _ensure_default_temperature_sensors() -> int:
    if not DEFAULT_TEMPERATURE_SENSORS:
        return 0

    existing_temperature = await db.sensors.find({"type": "temperature"}).to_list(length=1)
    if existing_temperature:
        return 0

    inserted = 0
    for sensor in DEFAULT_TEMPERATURE_SENSORS:
        await db.sensors.insert_one(copy.deepcopy(sensor))
        inserted += 1

    if inserted:
        logger.info("Inserted %s default temperature sensors", inserted)

    return inserted


async def _load_sensor_docs_or_fallback(query: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    try:
        sensors: list[dict[str, Any]] = []
        cursor = db.sensors.find(query or {})
        async for sensor in cursor:
            sensors.append(sensor)

        if sensors and not any(sensor.get("type") == "temperature" for sensor in sensors):
            inserted = await _ensure_default_temperature_sensors()
            if inserted:
                sensors = []
                cursor = db.sensors.find(query or {})
                async for sensor in cursor:
                    sensors.append(sensor)
    except Exception:
        sensors = get_fallback_sensors_with_ids()
    else:
        if not sensors:
            sensors = get_fallback_sensors_with_ids()

    return sensors


# --- Fallback user store when DB is unavailable ----------------------------
_fallback_users: list[dict] = []

def _fallback_user_dict(user: dict) -> dict:
    cleaned = {k: v for k, v in user.items() if k != "_id"}
    cleaned["id"] = str(user["_id"])
    return cleaned

def _get_fallback_user(user_id: str) -> dict | None:
    for u in _fallback_users:
        if str(u["_id"]) == user_id:
            return u
    return None

class CheckoutItem(BaseModel):
    name: str
    price: float
    quantity: int

class CheckoutPayload(BaseModel):
    items: List[CheckoutItem]

@app.post("/create-checkout-session")
async def create_checkout_session(payload: CheckoutPayload):
    # For now: just log and return a fake URL
    print("CHECKOUT PAYLOAD:", payload)

    # Later you plug Stripe here. For now this must be valid JSON:
    return {"url": "https://example.com"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "River & Farm Guardian backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/healthz")
def healthz():
    return {"status": "ok", "backend": ACTIVE_BACKEND}


@app.get("/readyz")
async def readyz():
    try:
        await ping_database()
    except Exception as exc:
        logger.exception("Readiness check failed")
        if IS_PRODUCTION:
            raise HTTPException(
                status_code=503,
                detail={"status": "not_ready"},
            ) from exc
        raise HTTPException(
            status_code=503,
            detail={"status": "not_ready", "backend": ACTIVE_BACKEND, "reason": str(exc)},
        ) from exc

    if IS_PRODUCTION:
        return {"status": "ready"}
    return {"status": "ready", "backend": ACTIVE_BACKEND}


async def ingest_sensor_readings_once(trigger: str = "manual") -> dict:
    persist = True
    try:
        await _ensure_default_temperature_sensors()
        sensors = await db.sensors.find({"is_active": True}).to_list(length=None)
    except Exception:
        sensors = get_fallback_sensors_with_ids()
        persist = False

    generated: list[dict] = []

    # 1) First try Selangor official API (returns real stations with lat/lon)
    try:
        generated.extend(await fetch_selangor_readings(db))
    except Exception as e:
        logger.warning("Selangor ingest failed: %s", e)

    if not sensors and not generated:
        return {
            "trigger": trigger,
            "inserted_or_updated": 0,
            "total_sensors": 0,
            "message": "No active sensors found",
            "persisted": False,
        }

    # 2) Backfill sensors not covered by the Selangor feed, including temperature.
    official_sensor_ids = {
        str(reading.get("sensor_id"))
        for reading in generated
        if reading.get("sensor_id") is not None
    }
    missing_sensors = [
        sensor
        for sensor in sensors
        if sensor.get("_id") is not None and str(sensor.get("_id")) not in official_sensor_ids
    ]
    if missing_sensors:
        generated.extend(await asyncio.to_thread(build_sensor_readings, missing_sensors))

    updated_count = 0

    if persist:
        for reading in generated:
            await db.sensor_readings.update_one(
                {
                    "sensor_id": reading["sensor_id"],
                    "timestamp": reading["timestamp"],
                },
                {"$set": reading},
                upsert=True,
            )
            updated_count += 1
    else:
        updated_count = len(generated)

    return {
        "trigger": trigger,
        "inserted_or_updated": updated_count,
        "total_sensors": len(sensors),
        "persisted": persist,
    }


async def _sensor_ingest_loop() -> None:
    await asyncio.sleep(3)
    while True:
        try:
            result = await ingest_sensor_readings_once(trigger="scheduler")
            logger.info("Sensor ingest cycle finished: %s", result)
        except Exception:
            logger.exception("Sensor ingest cycle failed")

        await asyncio.sleep(SENSOR_INGEST_INTERVAL_SECONDS)


@app.on_event("startup")
async def _startup_security_guardrails() -> None:
    _validate_production_security_config()


@app.on_event("startup")
async def _startup_backend_status() -> None:
    ready = False
    error_text = ""
    try:
        await ping_database()
        ready = True
    except Exception as exc:
        error_text = str(exc)

    logger.info("ACTIVE_BACKEND=%s", ACTIVE_BACKEND.upper())
    logger.info("DB_READINESS_ON_STARTUP=%s", "ready" if ready else "not_ready")
    if error_text:
        logger.warning("DB readiness check failed on startup: %s", error_text)


@app.on_event("startup")
async def _startup_sensor_ingest() -> None:
    global _sensor_ingest_task
    if not SENSOR_INGEST_ENABLED:
        logger.info("Sensor ingest scheduler disabled by env")
        return

    if _sensor_ingest_task is None or _sensor_ingest_task.done():
        _sensor_ingest_task = asyncio.create_task(_sensor_ingest_loop())
        logger.info(
            "Sensor ingest scheduler started (interval=%ss)",
            SENSOR_INGEST_INTERVAL_SECONDS,
        )


@app.on_event("shutdown")
async def _shutdown_sensor_ingest() -> None:
    global _sensor_ingest_task
    if _sensor_ingest_task is None:
        return

    _sensor_ingest_task.cancel()
    try:
        await _sensor_ingest_task
    except asyncio.CancelledError:
        pass
    _sensor_ingest_task = None

# ---- Fake sensor data (for now) ----

# fake_sensors = [
#     {
#         "id": 1,
#         "name": "River Level Sensor - Sungai Gombak",
#         "type": "Water_Level",
#         "location": "Sungai Gombak",
#         "unit": "m",
#     },
#     {
#         "id": 2,
#         "name": "Rain Gauge - Kampung Baru",
#         "type": "rainfall",
#         "location": "Kampung Baru",
#         "unit": "mm/h",
#     },
#     {
#         "id": 3,
#         "name": "Temperature Sensor - Kampung Baru",
#         "type": "temperature",
#         "location": "Kampung Baru",
#         "unit": "°C / %RH",
#     },
# ]

ALLOWED_PLANS = ["free", "plus", "ultra"]

USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]{3,32}$")
EMAIL_PATTERN = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_HASH_SCHEME = "pbkdf2_sha256"
PBKDF2_ITERATIONS = int(os.getenv("PASSWORD_HASH_ITERATIONS", "260000"))
AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "28800"))
DEFAULT_AUTH_TOKEN_SECRET = "water-status-dev-secret"
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "adminwaterstatus"
AUTH_TOKEN_SECRET = os.getenv("AUTH_TOKEN_SECRET", DEFAULT_AUTH_TOKEN_SECRET)
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", DEFAULT_ADMIN_USERNAME).strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
SENSITIVE_USER_FIELDS = {"password_hash", "password"}


def _validate_production_security_config() -> None:
    if not IS_PRODUCTION:
        return

    issues: list[str] = []

    if (
        not AUTH_TOKEN_SECRET
        or AUTH_TOKEN_SECRET == DEFAULT_AUTH_TOKEN_SECRET
        or len(AUTH_TOKEN_SECRET.strip()) < 32
    ):
        issues.append("AUTH_TOKEN_SECRET must be set to a strong non-default value")

    if (
        not ADMIN_USERNAME
        or ADMIN_USERNAME == DEFAULT_ADMIN_USERNAME
        or len(ADMIN_USERNAME) < 3
    ):
        issues.append("ADMIN_USERNAME must be set to a non-default value")

    if (
        not ADMIN_PASSWORD
        or ADMIN_PASSWORD == DEFAULT_ADMIN_PASSWORD
        or len(ADMIN_PASSWORD) < 12
    ):
        issues.append("ADMIN_PASSWORD must be set to a strong non-default value")

    if issues:
        logger.error("Unsafe production security configuration: %s", "; ".join(issues))
        raise RuntimeError(
            "Unsafe production security configuration. "
            "Set required auth/admin environment variables."
        )


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * ((4 - len(raw) % 4) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def sanitize_username(raw: str) -> str:
    cleaned = "".join(ch for ch in (raw or "").strip().lower() if ch.isalnum() or ch in "._-")
    if not USERNAME_PATTERN.fullmatch(cleaned):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-32 chars and use only letters, numbers, dot, underscore, or hyphen.",
        )
    return cleaned


def sanitize_email(raw: str) -> str:
    cleaned = (raw or "").strip().lower()
    if not EMAIL_PATTERN.fullmatch(cleaned):
        raise HTTPException(status_code=400, detail="Invalid email format.")
    return cleaned


def sanitize_name(raw: str) -> str:
    cleaned = re.sub(r"\s+", " ", (raw or "").strip())
    cleaned = "".join(ch for ch in cleaned if ch.isprintable())
    if len(cleaned) < 2:
        raise HTTPException(status_code=400, detail="Name must be at least 2 characters.")
    return cleaned[:64]


def sanitize_password(raw: str) -> str:
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="Password is required.")
    if len(raw) < PASSWORD_MIN_LENGTH or len(raw) > PASSWORD_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters.",
        )
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        raise HTTPException(status_code=400, detail="Password contains invalid characters.")
    return raw


def validate_plan_confirmation(plan: str, plan_confirmation: str | None) -> None:
    normalized = (plan or "").strip().lower()
    if normalized == "free":
        return

    expected_map = {
        "plus": "Plus",
        "ultra": "Ultra",
    }
    expected = expected_map.get(normalized)
    if not expected:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}")

    provided = (plan_confirmation or "").strip()
    if provided != expected:
        raise HTTPException(
            status_code=400,
            detail="Invalid plan access key.",
        )


def _derive_username(name: str, user_id: str | None = None) -> str:
    base = "".join(ch for ch in (name or "").strip().lower() if ch.isalnum() or ch in "._-")
    if len(base) >= 3:
        return base[:32]

    suffix = (user_id or str(int(time.time() * 1000)))[-6:]
    return f"user{suffix}"


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return (
        f"{PASSWORD_HASH_SCHEME}${PBKDF2_ITERATIONS}$"
        f"{_b64url_encode(salt)}${_b64url_encode(digest)}"
    )


def _verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False

    try:
        scheme, iter_raw, salt_raw, digest_raw = stored.split("$", 3)
        if scheme != PASSWORD_HASH_SCHEME:
            return False
        iterations = int(iter_raw)
        salt = _b64url_decode(salt_raw)
        expected = _b64url_decode(digest_raw)
        current = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            iterations,
        )
        return hmac.compare_digest(current, expected)
    except Exception:
        return False


def _create_token(payload: dict) -> str:
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    signature = hmac.new(
        AUTH_TOKEN_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{payload_b64}.{_b64url_encode(signature)}"


def _decode_token(token: str) -> dict:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token.")

    expected_sig = hmac.new(
        AUTH_TOKEN_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    actual_sig = _b64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise HTTPException(status_code=401, detail="Invalid token signature.")

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token payload.")

    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expired.")

    return payload


def _read_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    return token


def _require_admin(authorization: str | None) -> dict:
    token = _read_bearer_token(authorization)
    payload = _decode_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload


def _safe_user_response(doc: dict) -> dict:
    user = {k: v for k, v in doc.items() if k not in SENSITIVE_USER_FIELDS}
    if "_id" in user:
        user["id"] = str(user["_id"])
        del user["_id"]

    user_id = str(user.get("id") or "")
    username = str(user.get("username") or "").strip().lower()
    if not username:
        username = _derive_username(str(user.get("name") or ""), user_id)
    user["username"] = username

    if not user.get("name"):
        user["name"] = username
    if not user.get("plan") or user.get("plan") not in ALLOWED_PLANS:
        user["plan"] = "free"
    if user.get("email") is None:
        user["email"] = ""
    return user


def _ids_match(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return False
    return str(left) == str(right)


def _new_id() -> str:
    return str(uuid4())


def _normalize_id(raw: str, field_name: str) -> str:
    value = str(raw or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format")
    return value


SENSOR_LAT_KEYS = ("latitude", "lat")
SENSOR_LON_KEYS = ("longitude", "lon", "lng")
READING_SENSOR_ID_KEYS = ("sensor_id", "sensorId", "sensor", "station_id", "stationId")
READING_TS_KEYS = ("timestamp", "recorded_at", "created_at", "ts")


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None

    if not math.isfinite(number):
        return None
    return number


def _extract_sensor_coords(doc: dict[str, Any]) -> tuple[float | None, float | None]:
    lat: float | None = None
    lon: float | None = None

    for key in SENSOR_LAT_KEYS:
        lat = _to_float(doc.get(key))
        if lat is not None:
            break

    for key in SENSOR_LON_KEYS:
        lon = _to_float(doc.get(key))
        if lon is not None:
            break

    if lat is None or lon is None:
        coords = doc.get("coordinates")
        if isinstance(coords, dict):
            if lat is None:
                for key in SENSOR_LAT_KEYS:
                    lat = _to_float(coords.get(key))
                    if lat is not None:
                        break
            if lon is None:
                for key in SENSOR_LON_KEYS:
                    lon = _to_float(coords.get(key))
                    if lon is not None:
                        break
        elif isinstance(coords, (list, tuple)) and len(coords) >= 2:
            first = _to_float(coords[0])
            second = _to_float(coords[1])
            if first is not None and second is not None:
                # Accept either [lat, lon] or GeoJSON-style [lon, lat].
                if lat is None and lon is None:
                    if abs(first) <= 90 and abs(second) <= 180:
                        lat, lon = first, second
                    elif abs(first) <= 180 and abs(second) <= 90:
                        lat, lon = second, first

    if lat is None or lon is None:
        geometry = doc.get("geometry")
        if isinstance(geometry, dict):
            gcoords = geometry.get("coordinates")
            if isinstance(gcoords, (list, tuple)) and len(gcoords) >= 2:
                glon = _to_float(gcoords[0])
                glat = _to_float(gcoords[1])
                if lat is None:
                    lat = glat
                if lon is None:
                    lon = glon

    return lat, lon


def _normalize_sensor_for_client(doc: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(doc)
    sensor_id = str(normalized.get("_id") or normalized.get("id") or "")
    if sensor_id:
        normalized["id"] = sensor_id
    normalized.pop("_id", None)

    lat, lon = _extract_sensor_coords(normalized)
    normalized["latitude"] = lat
    normalized["longitude"] = lon
    # keep short aliases too for compatibility with older frontend code
    normalized["lat"] = lat
    normalized["lon"] = lon
    return normalized


def _nearest_location_label(
    latitude: float,
    longitude: float,
    sensors: list[dict[str, Any]],
) -> str | None:
    closest_label: str | None = None
    closest_distance: float | None = None

    for sensor in sensors:
        location = str(sensor.get("location") or "").strip()
        if not location:
            continue

        sensor_lat, sensor_lon = _extract_sensor_coords(sensor)
        if sensor_lat is None or sensor_lon is None:
            continue

        lat_delta = sensor_lat - latitude
        lon_delta = sensor_lon - longitude
        distance_sq = (lat_delta * lat_delta) + (lon_delta * lon_delta)
        if closest_distance is None or distance_sq < closest_distance:
            closest_distance = distance_sq
            closest_label = location

    return closest_label


def _reverse_geocode_cache_key(latitude: float, longitude: float) -> str:
    return (
        f"{latitude:.{LOCATION_CONTEXT_REVERSE_GEOCODE_COORD_PRECISION}f},"
        f"{longitude:.{LOCATION_CONTEXT_REVERSE_GEOCODE_COORD_PRECISION}f}"
    )


def _read_cached_reverse_geocode_label(cache_key: str) -> tuple[bool, str | None]:
    now = time.monotonic()
    with _reverse_geocode_label_cache_lock:
        cached = _reverse_geocode_label_cache.get(cache_key)
        if not cached:
            return False, None

        expires_at, label = cached
        if expires_at <= now:
            _reverse_geocode_label_cache.pop(cache_key, None)
            return False, None

        return True, label


def _cache_reverse_geocode_label(cache_key: str, label: str | None, ttl_seconds: int) -> None:
    ttl = max(1, int(ttl_seconds))
    expires_at = time.monotonic() + ttl
    with _reverse_geocode_label_cache_lock:
        _reverse_geocode_label_cache[cache_key] = (expires_at, label)


def _pick_reverse_geocode_locality_label(payload: dict[str, Any]) -> str | None:
    address = payload.get("address")
    if not isinstance(address, dict):
        return None

    preferred_keys = (
        "city",
        "town",
        "municipality",
        "village",
        "suburb",
        "city_district",
        "locality",
        "hamlet",
        "quarter",
        "neighbourhood",
    )
    fallback_keys = (
        "district",
        "county",
        "state_district",
        "state",
    )

    for key in preferred_keys + fallback_keys:
        value = str(address.get(key) or "").strip()
        if value:
            return value

    return None


def _reverse_geocode_locality_label(latitude: float, longitude: float) -> str | None:
    cache_key = _reverse_geocode_cache_key(latitude, longitude)
    cache_hit, cached_label = _read_cached_reverse_geocode_label(cache_key)
    if cache_hit:
        return cached_label

    params = urllib.parse.urlencode(
        {
            "format": "jsonv2",
            "lat": f"{latitude:.6f}",
            "lon": f"{longitude:.6f}",
            "addressdetails": "1",
            "zoom": "14",
            "accept-language": LOCATION_CONTEXT_REVERSE_GEOCODE_ACCEPT_LANGUAGE,
        }
    )
    request = urllib.request.Request(
        f"{LOCATION_CONTEXT_REVERSE_GEOCODE_URL}?{params}",
        headers={
            "Accept": "application/json",
            "User-Agent": LOCATION_CONTEXT_REVERSE_GEOCODE_USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=LOCATION_CONTEXT_REVERSE_GEOCODE_TIMEOUT_SECONDS,
        ) as response:
            payload = json.loads(response.read().decode("utf-8", "ignore"))
    except Exception:
        _cache_reverse_geocode_label(
            cache_key,
            None,
            LOCATION_CONTEXT_REVERSE_GEOCODE_ERROR_CACHE_TTL_SECONDS,
        )
        return None

    label = _pick_reverse_geocode_locality_label(payload) if isinstance(payload, dict) else None
    _cache_reverse_geocode_label(
        cache_key,
        label,
        LOCATION_CONTEXT_REVERSE_GEOCODE_CACHE_TTL_SECONDS
        if label
        else LOCATION_CONTEXT_REVERSE_GEOCODE_ERROR_CACHE_TTL_SECONDS,
    )
    return label


def _normalize_location_mode(mode: str | None) -> str:
    return "manual" if str(mode or "").strip().lower() == "manual" else "gps"


def _extract_sensor_id_from_reading(doc: dict[str, Any]) -> str | None:
    for key in READING_SENSOR_ID_KEYS:
        value = doc.get(key)
        if value is None:
            continue
        if isinstance(value, dict):
            nested = value.get("_id") or value.get("id") or value.get("sensor_id")
            if nested is not None:
                return str(nested)
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        numeric = float(value)
        # Milliseconds epoch support.
        if abs(numeric) > 1e12:
            numeric = numeric / 1000.0
        try:
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
        except Exception:
            return None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


def _extract_reading_timestamp(doc: dict[str, Any]) -> tuple[Any, float | None]:
    for key in READING_TS_KEYS:
        raw = doc.get(key)
        if raw is None:
            continue
        parsed = _parse_datetime(raw)
        if parsed is None:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return raw, parsed.timestamp()
    return None, None


def _reading_sort_key(doc: dict[str, Any]) -> tuple[int, float, str]:
    _, ts = _extract_reading_timestamp(doc)
    if ts is None:
        return (0, float("-inf"), str(doc.get("_id") or ""))
    return (1, ts, str(doc.get("_id") or ""))


def _serialize_timestamp(raw: Any) -> Any:
    parsed = _parse_datetime(raw)
    if parsed is None:
        return raw
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat()


def _select_latest_reading_doc_for_sensor(readings: list[dict[str, Any]], sensor_id: str) -> dict[str, Any] | None:
    candidates = [doc for doc in readings if _extract_sensor_id_from_reading(doc) == str(sensor_id)]
    if not candidates:
        return None
    return max(candidates, key=_reading_sort_key)


def _latest_readings_by_sensor_from_docs(
    readings: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    latest_by_sensor: dict[str, dict[str, Any]] = {}
    for reading in readings:
        sensor_id = _extract_sensor_id_from_reading(reading)
        if sensor_id is None:
            continue

        previous = latest_by_sensor.get(sensor_id)
        if previous is None or _reading_sort_key(reading) > _reading_sort_key(previous):
            latest_by_sensor[sensor_id] = reading

    return latest_by_sensor


def _build_home_preview_item(
    sensor: dict[str, Any],
    latest_doc: dict[str, Any] | None,
) -> dict[str, Any] | None:
    normalized_sensor = _normalize_sensor_for_client(sensor)
    sensor_type = normalized_sensor.get("type")
    if sensor_type not in ALLOWED_SENSOR_TYPES:
        return None

    sensor_id = str(normalized_sensor.get("id") or "")
    if not sensor_id:
        return None

    raw_timestamp = None
    value = None
    unit = normalized_sensor.get("unit")
    source = "missing"

    if latest_doc is not None:
        raw_timestamp, _ = _extract_reading_timestamp(latest_doc)
        value = latest_doc.get("value")
        unit = latest_doc.get("unit") or unit
        source = latest_doc.get("source", "unknown")

    return {
        "id": sensor_id,
        "name": normalized_sensor.get("name"),
        "location": normalized_sensor.get("location"),
        "type": sensor_type,
        "unit": unit,
        "latitude": normalized_sensor.get("latitude"),
        "longitude": normalized_sensor.get("longitude"),
        "value": value,
        "timestamp": _serialize_timestamp(raw_timestamp),
        "source": source,
    }


def _build_home_preview_payload_from_sensor_docs(
    sensors: list[dict[str, Any]],
    latest_by_sensor: dict[str, dict[str, Any]],
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for sensor in sensors:
        if sensor.get("is_active") is False:
            continue

        sensor_id = str(sensor.get("_id") or sensor.get("id") or "")
        item = _build_home_preview_item(sensor, latest_by_sensor.get(sensor_id))
        if item is not None:
            items.append(item)

    generated = generated_at or datetime.now(timezone.utc)
    return {
        "items": items,
        "generated_at": _serialize_timestamp(generated),
    }


async def _load_home_preview_payload_uncached() -> dict[str, Any]:
    sensors = await _load_sensor_docs_or_fallback({"is_active": True})

    latest_by_sensor: dict[str, dict[str, Any]] = {}

    if ACTIVE_BACKEND == "postgres":
        try:
            latest_by_sensor = await fetch_postgres_latest_sensor_readings()
        except Exception:
            latest_by_sensor = {}
    else:
        try:
            all_readings = await db.sensor_readings.find().to_list(length=None)
        except Exception:
            all_readings = []

        if all_readings:
            latest_by_sensor = _latest_readings_by_sensor_from_docs(all_readings)
        else:
            generated_readings = await asyncio.to_thread(build_sensor_readings, sensors)
            latest_by_sensor = {
                str(reading["sensor_id"]): reading
                for reading in generated_readings
                if reading.get("sensor_id") is not None
            }

    missing_sensors = [
        sensor
        for sensor in sensors
        if str(sensor.get("_id") or sensor.get("id") or "") not in latest_by_sensor
    ]
    if missing_sensors:
        try:
            generated_readings = await asyncio.to_thread(build_sensor_readings, missing_sensors)
        except Exception:
            generated_readings = []

        for reading in generated_readings:
            sensor_id = str(reading.get("sensor_id") or "")
            if sensor_id:
                latest_by_sensor.setdefault(sensor_id, reading)

    return _build_home_preview_payload_from_sensor_docs(
        sensors,
        latest_by_sensor,
    )


async def _get_home_preview_payload(
    monotonic_fn: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    global _home_preview_cache, _home_preview_cache_expires_at

    now = monotonic_fn()
    if _home_preview_cache is not None and now < _home_preview_cache_expires_at:
        return _home_preview_cache

    async with _get_home_preview_cache_lock():
        now = monotonic_fn()
        if _home_preview_cache is not None and now < _home_preview_cache_expires_at:
            return _home_preview_cache

        payload = await _load_home_preview_payload_uncached()
        _home_preview_cache = payload
        _home_preview_cache_expires_at = now + HOME_PREVIEW_CACHE_TTL_SECONDS
        return payload


def _reset_home_preview_cache() -> None:
    global _home_preview_cache, _home_preview_cache_expires_at
    _home_preview_cache = None
    _home_preview_cache_expires_at = 0.0


async def _find_user_by_username(username: str) -> dict | None:
    try:
        doc = await db.users.find_one({"username": username})
        if doc:
            return doc

        cursor = db.users.find()
        async for candidate in cursor:
            normalized = _safe_user_response(candidate).get("username")
            if normalized == username:
                return candidate
    except Exception:
        for candidate in _fallback_users:
            normalized = _safe_user_response(candidate).get("username")
            if normalized == username:
                return candidate
    return None


async def _find_user_by_email(email: str) -> dict | None:
    try:
        return await db.users.find_one({"email": email})
    except Exception:
        for candidate in _fallback_users:
            if str(candidate.get("email") or "").strip().lower() == email:
                return candidate
    return None


async def _next_available_username(base: str, strict: bool) -> str:
    candidate = base
    suffix_counter = 1
    while True:
        existing = await _find_user_by_username(candidate)
        if not existing:
            return candidate

        if strict:
            raise HTTPException(status_code=409, detail="Username already exists.")

        suffix = f"-{suffix_counter}"
        prefix = base[: max(1, 32 - len(suffix))]
        candidate = f"{prefix}{suffix}"
        suffix_counter += 1
        if suffix_counter > 1000:
            raise HTTPException(status_code=500, detail="Could not allocate username.")


def _new_auth_token(subject: str, role: str, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": subject,
        "role": role,
        "username": username,
        "iat": now,
        "exp": now + AUTH_TOKEN_TTL_SECONDS,
    }
    return _create_token(payload)


class UserCreate(BaseModel):
    name: str
    email: str = "user@gmail.com"
    plan: str = "free"  # later: free / plus / ultra
    username: Optional[str] = None
    password: Optional[str] = None


class RegisterPayload(BaseModel):
    username: str
    email: str
    password: str
    plan: str = "free"
    plan_confirmation: Optional[str] = None


class LoginPayload(BaseModel):
    username: str
    password: str


class AdminDeleteUserPayload(BaseModel):
    confirm_username: str

class UserUpdatePlan(BaseModel):
    plan: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    plan: Optional[str] = None

class UserReportUpdate(BaseModel):
    user_id: str                     # who is allowed to edit
    value: Optional[float] = None
    comment: Optional[str] = None
    timestamp: Optional[datetime] = None
    type: Optional[str] = None       # "rain" | "water_level" | "temperature"
    sensor_id: Optional[str] = None  # station to move this report to

# Like payload model for liking/unliking user reports
class UserReportLikePayload(BaseModel):
    user_id: str

ALLOWED_CATEGORIES = ["water_level", "rain", "temperature"]

CATEGORY_SYNONYMS = {
    # Water level
    "water level": "water_level",
    "waterlevel": "water_level",
    "river level": "water_level",
    "river": "water_level",
    "depth": "water_level",

    # Rain
    "rain": "rain",
    "rainfall": "rain",
    "precipitation": "rain",

    # Temperature
    "temperature": "temperature",
    "temp": "temperature",
    "heat": "temperature",
}

def normalize_category(raw: str) -> str:
    """
    Take user input like 'Water Level', 'rainfall', 'Temp'
    and return a canonical category like 'water_level', 'rain', 'temperature'.
    """
    if not raw:
        raise HTTPException(status_code=400, detail="Category is required")

    key = raw.strip().lower()

    if key in CATEGORY_SYNONYMS:
        return CATEGORY_SYNONYMS[key]

    if key in ALLOWED_CATEGORIES:
        return key

    raise HTTPException(
        status_code=400,
        detail=(
            f"Unknown category '{raw}'. "
            f"Allowed categories (or synonyms): {sorted(set(CATEGORY_SYNONYMS.keys()))}"
        ),
    )

ALLOWED_SENSOR_TYPES = ALLOWED_CATEGORIES

class SensorCreate(BaseModel):
    name: str               # "River Level Sensor - Sungai Gombak"
    type: str               # "water_level", "Water Level", "rain", etc.
    location: str           # "Sungai Gombak", "Kampung Baru"
    unit: str               # "m", "mm/h", "°C / %RH"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: bool = True


class SensorUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    unit: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: Optional[bool] = None

class ReportUpdate(BaseModel):
    category: Optional[str] = None
    location: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    timestamp: Optional[datetime] = None
    comment: Optional[str] = None


class ReportCreate(BaseModel):
    user_id: str          # user id as string
    category: str         # e.g. "Water_Level", "rain", "weather"
    location: str         # e.g. "Sungai Gombak", "Kampung Baru"
    value: float          # numeric value (e.g. 4.5)
    unit: str             # e.g. "m", "mm/h", "°C"
    timestamp: Optional[datetime] = None  # optional; default = now (UTC)
    comment: Optional[str] = None         # “heavy rain, fast current”, etc.


@app.post("/sensors")
async def create_sensor(sensor: SensorCreate):
    sensor_dict = sensor.model_dump()

    # Normalize type using the same logic as categories
    sensor_dict["type"] = normalize_category(sensor_dict["type"])

    result = await db.sensors.insert_one(sensor_dict)
    return {"id": str(result.inserted_id)}

@app.get("/sensors")
async def list_sensors():
    sensors = []
    for doc in await _load_sensor_docs_or_fallback():
        sensors.append(_normalize_sensor_for_client(doc))

    return {"sensors": sensors}


@app.get("/home-preview")
async def get_home_preview():
    return await _get_home_preview_payload()

@app.get("/weather/forecast-summaries")
async def get_weather_forecast_summaries(request: Request, sensor_ids: str = ""):
    await _enforce_weather_rate_limit(request, "forecast-summaries")

    requested_ids = [item.strip() for item in sensor_ids.split(",") if item.strip()]
    if not requested_ids:
        return {"summaries": []}

    if len(requested_ids) > OPEN_METEO_DEFAULT_BATCH_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Please request at most {OPEN_METEO_DEFAULT_BATCH_LIMIT} sensor IDs "
                f"per call."
            ),
        )

    sensors = await _load_sensor_docs_or_fallback()
    sensors_by_id = {
        str(sensor.get("_id") or sensor.get("id") or ""): sensor
        for sensor in sensors
    }

    requested_sensors = [
        sensors_by_id[sensor_id]
        for sensor_id in requested_ids
        if sensor_id in sensors_by_id
    ]

    fetched_by_id: dict[str, dict[str, Any]] = {}
    if requested_sensors:
        fetched = await asyncio.to_thread(get_forecast_summaries, requested_sensors)
        fetched_by_id = {
            str(summary.get("sensor_id") or ""): summary
            for summary in fetched
            if summary.get("sensor_id")
        }

    summaries = []
    for sensor_id in requested_ids:
        sensor = sensors_by_id.get(sensor_id)
        if sensor is None:
            summaries.append(
                {
                    "sensor_id": sensor_id,
                    "location": None,
                    "latitude": None,
                    "longitude": None,
                    "status": "unavailable",
                    "source": "open-meteo.forecast",
                    "generated_at": _serialize_timestamp(datetime.now(timezone.utc)),
                    "current": None,
                    "next_6h": None,
                    "next_12h": None,
                    "daily": [],
                }
            )
            continue

        summaries.append(
            fetched_by_id.get(sensor_id)
            or {
                "sensor_id": sensor_id,
                "location": sensor.get("location"),
                "latitude": sensor.get("latitude") if sensor.get("latitude") is not None else sensor.get("lat"),
                "longitude": (
                    sensor.get("longitude")
                    if sensor.get("longitude") is not None
                    else sensor.get("lon", sensor.get("lng"))
                ),
                "status": "unavailable",
                "source": "open-meteo.forecast",
                "generated_at": _serialize_timestamp(datetime.now(timezone.utc)),
                "current": None,
                "next_6h": None,
                "next_12h": None,
                "daily": [],
            }
        )

    return {"summaries": summaries}


@app.get("/weather/location-context")
async def get_weather_location_context(
    request: Request,
    latitude: float,
    longitude: float,
    radius_km: float = 8,
    label: str | None = None,
    mode: str = "gps",
):
    await _enforce_weather_rate_limit(request, "location-context")

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise HTTPException(status_code=400, detail="Latitude and longitude must be valid numbers.")

    if latitude < -90 or latitude > 90 or longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Latitude or longitude is out of range.")

    if not math.isfinite(radius_km) or radius_km <= 0:
        raise HTTPException(status_code=400, detail="radius_km must be greater than 0.")

    normalized_mode = _normalize_location_mode(mode)
    bounded_radius_km = min(radius_km, LOCATION_CONTEXT_MAX_RADIUS_KM)
    sensors = await _load_sensor_docs_or_fallback()
    nearest_label = _nearest_location_label(latitude, longitude, sensors)
    client_label = str(label or "").strip()
    reverse_label = None
    if normalized_mode == "gps":
        reverse_label = await asyncio.to_thread(
            _reverse_geocode_locality_label,
            latitude,
            longitude,
        )

    if normalized_mode == "manual":
        normalized_label = (
            client_label
            or nearest_label
            or f"{latitude:.3f}, {longitude:.3f}"
        )
    else:
        normalized_label = (
            reverse_label
            or client_label
            or nearest_label
            or f"{latitude:.3f}, {longitude:.3f}"
        )

    context = await asyncio.to_thread(
        get_location_forecast_context,
        latitude,
        longitude,
        bounded_radius_km,
    )
    context["location"] = {
        "label": normalized_label,
        "latitude": latitude,
        "longitude": longitude,
        "mode": normalized_mode,
    }
    return context

@app.get("/sensors/{sensor_id}")
async def get_sensor(sensor_id: str):
    sid = _normalize_id(sensor_id, "sensor ID")

    doc = await db.sensors.find_one({"_id": sid})
    if not doc:
        raise HTTPException(status_code=404, detail="Sensor not found")

    return _normalize_sensor_for_client(doc)

@app.patch("/sensors/{sensor_id}")
async def update_sensor(sensor_id: str, payload: SensorUpdate):
    sid = _normalize_id(sensor_id, "sensor ID")

    updates: dict = {}

    if payload.name is not None:
        updates["name"] = payload.name

    if payload.type is not None:
        updates["type"] = normalize_category(payload.type)

    if payload.location is not None:
        updates["location"] = payload.location

    if payload.unit is not None:
        updates["unit"] = payload.unit

    if payload.latitude is not None:
        updates["latitude"] = payload.latitude

    if payload.longitude is not None:
        updates["longitude"] = payload.longitude

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await db.sensors.update_one({"_id": sid}, {"$set": updates})

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sensor not found")

    doc = await db.sensors.find_one({"_id": sid})
    return _normalize_sensor_for_client(doc)

@app.delete("/sensors/{sensor_id}")
async def delete_sensor(sensor_id: str):
    sid = _normalize_id(sensor_id, "sensor ID")

    result = await db.sensors.delete_one({"_id": sid})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sensor not found")

    return {"id": sensor_id, "deleted": True}

def _coerce_user_id(user_id: str):
    return _normalize_id(user_id, "user ID")


@app.post("/auth/register")
async def register(payload: RegisterPayload):
    username = sanitize_username(payload.username)
    email = sanitize_email(payload.email)
    password = sanitize_password(payload.password)
    plan = (payload.plan or "free").strip().lower()

    if username == ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="That username is reserved.")
    if plan not in ALLOWED_PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}")
    validate_plan_confirmation(plan, payload.plan_confirmation)

    if await _find_user_by_username(username):
        raise HTTPException(status_code=409, detail="Username already exists.")
    if await _find_user_by_email(email):
        raise HTTPException(status_code=409, detail="Email already in use.")

    doc = {
        "_id": _new_id(),
        "username": username,
        "name": username,
        "email": email,
        "plan": plan,
        "password_hash": _hash_password(password),
        "created_at": datetime.utcnow(),
    }

    try:
        inserted = await db.users.insert_one({k: v for k, v in doc.items() if k != "_id"})
        doc["_id"] = inserted.inserted_id
    except Exception:
        _fallback_users.append(doc)

    safe_user = _safe_user_response(doc)
    return {
        "token": _new_auth_token(safe_user["id"], "user", safe_user["username"]),
        "role": "user",
        "user": safe_user,
    }


@app.post("/auth/login")
async def login(payload: LoginPayload):
    username = sanitize_username(payload.username)
    password = sanitize_password(payload.password)

    if username == ADMIN_USERNAME:
        if not hmac.compare_digest(password, ADMIN_PASSWORD):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        return {
            "token": _new_auth_token("admin", "admin", ADMIN_USERNAME),
            "role": "admin",
            "user": {"username": ADMIN_USERNAME},
        }

    user_doc = await _find_user_by_username(username)
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    if not _verify_password(password, user_doc.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    safe_user = _safe_user_response(user_doc)
    return {
        "token": _new_auth_token(safe_user["id"], "user", safe_user["username"]),
        "role": "user",
        "user": safe_user,
    }


@app.get("/admin/users")
async def admin_list_users(authorization: str | None = Header(default=None)):
    _require_admin(authorization)

    users: list[dict] = []
    try:
        cursor = db.users.find()
        async for doc in cursor:
            safe_user = _safe_user_response(doc)
            users.append(
                {
                    "id": safe_user["id"],
                    "username": safe_user["username"],
                    "email": safe_user.get("email", ""),
                }
            )
    except Exception:
        for doc in _fallback_users:
            safe_user = _safe_user_response(doc)
            users.append(
                {
                    "id": safe_user["id"],
                    "username": safe_user["username"],
                    "email": safe_user.get("email", ""),
                }
            )

    users.sort(key=lambda u: (u.get("username") or ""))
    return {"users": users}


@app.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    payload: AdminDeleteUserPayload,
    authorization: str | None = Header(default=None),
):
    _require_admin(authorization)
    expected_username = sanitize_username(payload.confirm_username)
    lookup_id = _coerce_user_id(user_id)

    try:
        user = await db.users.find_one({"_id": lookup_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")

        safe_user = _safe_user_response(user)
        if safe_user.get("username") != expected_username:
            raise HTTPException(status_code=400, detail="Username confirmation does not match.")

        await db.users.delete_one({"_id": lookup_id})
        await db.user_reports.delete_many({"user_id": lookup_id})
        return {"id": safe_user["id"], "username": safe_user["username"], "deleted": True}
    except HTTPException:
        raise
    except Exception:
        u = _get_fallback_user(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="User not found.")

        safe_user = _safe_user_response(u)
        if safe_user.get("username") != expected_username:
            raise HTTPException(status_code=400, detail="Username confirmation does not match.")

        _fallback_users[:] = [x for x in _fallback_users if str(x["_id"]) != user_id]
        return {"id": safe_user["id"], "username": safe_user["username"], "deleted": True}


@app.post("/users")
async def create_user(user: UserCreate):
    name = sanitize_name(user.name)
    email = sanitize_email(user.email)
    plan = (user.plan or "free").strip().lower()
    if plan not in ALLOWED_PLANS:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}")

    requested_username = user.username if user.username is not None else _derive_username(name)
    base_username = sanitize_username(requested_username)
    if base_username == ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="That username is reserved.")

    username = await _next_available_username(base_username, strict=user.username is not None)
    password_hash = None
    if user.password:
        password_hash = _hash_password(sanitize_password(user.password))

    user_dict = {
        "name": name,
        "username": username,
        "email": email,
        "plan": plan,
        "created_at": datetime.utcnow(),
    }
    if password_hash:
        user_dict["password_hash"] = password_hash

    try:
        result = await db.users.insert_one(user_dict)
        stored_doc = {"_id": result.inserted_id, **user_dict}
        return _safe_user_response(stored_doc)
    except Exception:
        doc = {"_id": _new_id(), **user_dict}
        _fallback_users.append(doc)
        return _safe_user_response(doc)


@app.get("/users")
async def list_users():
    users = []
    try:
        cursor = db.users.find()
        async for doc in cursor:
            users.append(_safe_user_response(doc))
    except Exception:
        users = [_safe_user_response(u) for u in _fallback_users]
    return {"users": users}


@app.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate):
    oid = _coerce_user_id(user_id)
    updates = {}

    if payload.name is not None:
        updates["name"] = sanitize_name(payload.name)

    if payload.username is not None:
        requested = sanitize_username(payload.username)
        if requested == ADMIN_USERNAME:
            raise HTTPException(status_code=400, detail="That username is reserved.")

        existing_user = await _find_user_by_username(requested)
        if existing_user and str(existing_user.get("_id")) != str(oid):
            raise HTTPException(status_code=409, detail="Username already exists.")
        updates["username"] = requested

    if payload.email is not None:
        updates["email"] = sanitize_email(payload.email)

    if payload.plan is not None:
        normalized_plan = payload.plan.strip().lower()
        if normalized_plan not in ALLOWED_PLANS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}",
            )
        updates["plan"] = normalized_plan

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = await db.users.update_one({"_id": oid}, {"$set": updates})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")

        doc = await db.users.find_one({"_id": oid})
        return _safe_user_response(doc)
    except HTTPException:
        raise
    except Exception:
        u = _get_fallback_user(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="User not found")
        u.update(updates)
        return _safe_user_response(u)


@app.patch("/users/{user_id}/plan")
async def update_user_plan(user_id: str, payload: UserUpdatePlan):
    if payload.plan not in ALLOWED_PLANS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}",
        )

    oid = _coerce_user_id(user_id)

    try:
        result = await db.users.update_one(
            {"_id": oid},
            {"$set": {"plan": payload.plan}},
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"id": user_id, "new_plan": payload.plan}
    except HTTPException:
        raise
    except Exception:
        u = _get_fallback_user(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="User not found")
        u["plan"] = payload.plan
        return {"id": user_id, "new_plan": payload.plan}


@app.get("/users/{user_id}")
async def get_user(user_id: str):
    oid = _coerce_user_id(user_id)
    try:
        doc = await db.users.find_one({"_id": oid})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        return _safe_user_response(doc)
    except HTTPException:
        raise
    except Exception:
        u = _get_fallback_user(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="User not found")
        return _safe_user_response(u)


@app.delete("/users/{user_id}")
async def delete_user(user_id: str, authorization: str | None = Header(default=None)):
    _require_admin(authorization)
    oid = _coerce_user_id(user_id)
    try:
        user = await db.users.find_one({"_id": oid})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.delete_one({"_id": oid})
        await db.user_reports.delete_many({"user_id": oid})
        return {"id": user_id, "deleted": True}
    except HTTPException:
        raise
    except Exception:
        u = _get_fallback_user(user_id)
        if u is None:
            raise HTTPException(status_code=404, detail="User not found")
        _fallback_users[:] = [x for x in _fallback_users if str(x["_id"]) != user_id]
        return {"id": user_id, "deleted": True}


@app.post("/reports")
async def create_report(report: ReportCreate):
    # 1. Validate & normalize user_id
    user_id = _normalize_id(report.user_id, "user ID")

    user = await db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Convert report to dict
    report_dict = report.model_dump()

    # 3. Normalize category (this is the important new part)
    report_dict["category"] = normalize_category(report_dict["category"])

    # 4. Use user ID string in DB
    report_dict["user_id"] = user_id

    # 5. Default timestamp if missing
    if report_dict["timestamp"] is None:
        report_dict["timestamp"] = datetime.utcnow()

    # 6. Save
    result = await db.reports.insert_one(report_dict)
    return {"id": str(result.inserted_id)}

@app.get("/reports")
async def list_reports(limit: int = 50):
    reports = []

    cursor = db.reports.find().sort("timestamp", -1).limit(limit)

    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        doc["user_id"] = str(doc["user_id"])
        del doc["_id"]
        reports.append(doc)

    return {"reports": reports}

@app.get("/reports/{report_id}")
async def get_report(report_id: str):
    rid = _normalize_id(report_id, "report ID")

    # 2. Look up report
    doc = await db.reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    # 3. Convert IDs to strings for JSON
    doc["id"] = str(doc["_id"])
    doc["user_id"] = str(doc["user_id"])
    del doc["_id"]

    return doc

# --- USER REPORTS CRUD + LIKES --------------------------------------------

@app.post("/user-reports")
async def create_user_report(report: UserReportCreate):
    # 1. Validate & normalize user_id
    user_id = _normalize_id(report.user_id, "user ID")

    user = await db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Validate & normalize sensor_id
    sensor_id = _normalize_id(report.sensor_id, "sensor ID")

    sensor = await db.sensors.find_one({"_id": sensor_id})
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    # 3. Normalise type ("rainfall", "Rain", etc → "rain")
    normalized_type = normalize_category(report.type)

    # 4. Decide timestamp
    ts = report.timestamp or datetime.utcnow()

    # 5. Build document
    source_name = user.get("name") or "User"

    doc = {
        "user_id": user_id,
        "sensor_id": sensor_id,
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "timestamp": ts,
        "type": normalized_type,
        "value": report.value,
        "unit": report.unit or sensor.get("unit"),
        "source": source_name,
        "comment": report.comment or "",
        "likes": 0,
        "liked_by": [],   # list of user-id strings
    }

    result = await db.user_reports.insert_one(doc)
    return {"id": str(result.inserted_id)}


@app.get("/user-reports")
async def list_user_reports(
    limit: int = 100,
    current_user_id: str | None = None,
):
    """
    Return user-made reports, always including a 'source' field.
    If current_user_id is provided, also include `liked_by_me` per report.
    """
    # Normalize current user ID (for liked_by_me)
    current_uid: str | None = None
    if current_user_id:
        try:
            current_uid = _normalize_id(current_user_id, "current user ID")
        except Exception:
            current_uid = None

    reports = []
    try:
        cursor = db.user_reports.find().sort("timestamp", -1).limit(limit)

        async for doc in cursor:
            user_name = None
            user_id = doc.get("user_id")
            if user_id is not None:
                user_doc = await db.users.find_one({"_id": str(user_id)}, {"name": 1})
                if user_doc:
                    user_name = user_doc.get("name")

            likes = int(doc.get("likes") or 0)
            liked_by = doc.get("liked_by") or []
            if not isinstance(liked_by, list):
                liked_by = []

            liked_by_me = False
            if current_uid is not None:
                liked_by_me = any(_ids_match(x, current_uid) for x in liked_by)

            doc["id"] = str(doc["_id"])
            doc["sensor_id"] = str(doc["sensor_id"])
            doc["user_id"] = str(doc["user_id"])

            doc["source"] = doc.get("source") or user_name or "User"
            doc["likes"] = likes
            doc["liked_by_me"] = liked_by_me

            if "liked_by" in doc:
                del doc["liked_by"]
            del doc["_id"]

            reports.append(doc)
    except Exception:
        reports = []

    return {"reports": reports}


class UserReportUpdate(BaseModel):
    user_id: str
    value: float | None = None
    comment: str | None = None
    timestamp: datetime | None = None
    type: str | None = None
    sensor_id: str | None = None


@app.patch("/user-reports/{report_id}")
async def update_user_report(report_id: str, payload: UserReportUpdate):
    """
    Update fields of a user report, but only if the requesting user_id
    matches the report's user_id.
    """
    # 1) Validate ids
    rid = _normalize_id(report_id, "report ID")
    uid = _normalize_id(payload.user_id, "user ID")

    # 2) Fetch existing
    existing = await db.user_reports.find_one({"_id": rid})
    if not existing:
        raise HTTPException(status_code=404, detail="Report not found")

    if not _ids_match(existing.get("user_id"), uid):
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own reports.",
        )

    # 3) Build updates
    updates: dict = {}
    if payload.value is not None:
        updates["value"] = payload.value
    if payload.comment is not None:
        updates["comment"] = payload.comment
    if payload.timestamp is not None:
        updates["timestamp"] = payload.timestamp
    if payload.type is not None:
        updates["type"] = normalize_category(payload.type)
    if payload.sensor_id is not None:
        new_sid = _normalize_id(payload.sensor_id, "sensor ID")

        sensor = await db.sensors.find_one({"_id": new_sid})
        if not sensor:
            raise HTTPException(status_code=404, detail="Sensor not found")

        updates["sensor_id"] = new_sid
        updates["sensor_name"] = sensor.get("name")
        updates["location"] = sensor.get("location")
        if sensor.get("unit"):
          updates["unit"] = sensor["unit"]

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.user_reports.update_one({"_id": rid}, {"$set": updates})

    doc = await db.user_reports.find_one({"_id": rid})
    # re-shape like in list_user_reports
    likes = int(doc.get("likes") or 0)
    liked_by = doc.get("liked_by") or []
    if not isinstance(liked_by, list):
        liked_by = []

    liked_by_me = False
    if uid is not None:
        liked_by_me = any(_ids_match(x, uid) for x in liked_by)

    doc["id"] = str(doc["_id"])
    doc["sensor_id"] = str(doc["sensor_id"])
    doc["user_id"] = str(doc["user_id"])
    doc["source"] = doc.get("source", "User")
    doc["likes"] = likes
    doc["liked_by_me"] = liked_by_me
    del doc["_id"]
    del doc["liked_by"]
    return doc


@app.delete("/user-reports/{report_id}")
async def delete_user_report(report_id: str, user_id: str):
    """
    Delete a single user report by its _id, but only if it belongs
    to the given user_id.
    """
    # 1) Validate ids
    rid = _normalize_id(report_id, "report ID")
    uid = _normalize_id(user_id, "user ID")

    # 2) Fetch report to check ownership
    doc = await db.user_reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    if not _ids_match(doc.get("user_id"), uid):
        raise HTTPException(
            status_code=403,
            detail="You can only delete your own reports.",
        )

    # 3) Delete
    result = await db.user_reports.delete_one({"_id": rid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")

    return {"id": report_id, "deleted": True}


class LikePayload(BaseModel):
  user_id: str


@app.post("/user-reports/{report_id}/like")
async def toggle_like_user_report(report_id: str, payload: LikePayload):
    """
    Toggle a like from a given user on a report.
    Returns { id, likes, liked }.
    """
    rid = _normalize_id(report_id, "report ID")
    uid = _normalize_id(payload.user_id, "user ID")

    doc = await db.user_reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    likes = int(doc.get("likes") or 0)
    liked_by = doc.get("liked_by") or []
    if not isinstance(liked_by, list):
        liked_by = []

    is_liked = any(_ids_match(x, uid) for x in liked_by)

    if is_liked:
        # Unlike
        liked_by = [x for x in liked_by if not _ids_match(x, uid)]
        likes = max(likes - 1, 0)
        liked = False
    else:
        # Like
        liked_by.append(str(uid))
        likes += 1
        liked = True

    await db.user_reports.update_one(
        {"_id": rid},
        {"$set": {"likes": likes, "liked_by": liked_by}},
    )

    return {"id": report_id, "likes": likes, "liked": liked}

@app.get("/sensors/{sensor_id}/readings")
async def get_sensor_readings(sensor_id: str, hours: int = 24):
    if hours <= 0:
        raise HTTPException(status_code=400, detail="hours must be positive")

    sid = _normalize_id(sensor_id, "sensor ID")
    sensor = None
    use_fallback = False

    try:
        sensor = await db.sensors.find_one({"_id": sid})
    except Exception:
        sensor = None

    if sensor is None:
        # try fallback cache
        fallback = get_fallback_sensors_with_ids()
        for s in fallback:
            if str(s["_id"]) == sensor_id:
                sensor = s
                sid = s["_id"]
                use_fallback = True
                break

    if sensor is None:
        raise HTTPException(status_code=404, detail="Sensor not found")

    since = datetime.utcnow() - timedelta(hours=hours)
    since_epoch = since.replace(tzinfo=timezone.utc).timestamp()
    async def _load_readings() -> list[dict]:
        loaded: list[dict] = []
        try:
            docs = await db.sensor_readings.find().to_list(length=None)
            for doc in docs:
                reading_sensor_id = _extract_sensor_id_from_reading(doc)
                if reading_sensor_id != str(sid):
                    continue

                raw_ts, ts_epoch = _extract_reading_timestamp(doc)
                if ts_epoch is not None and ts_epoch < since_epoch:
                    continue

                serialized = dict(doc)
                serialized["id"] = str(serialized.get("_id", _new_id()))
                serialized["sensor_id"] = str(reading_sensor_id)
                serialized["timestamp"] = _serialize_timestamp(raw_ts)
                serialized.pop("_id", None)
                loaded.append(serialized)
        except Exception:
            return []
        loaded.sort(key=lambda item: (_extract_reading_timestamp(item)[1] or float("-inf")))
        return loaded

    readings: list[dict] = []
    if not use_fallback:
        readings = await _load_readings()

        # For Selangor water-level stations, lazily backfill historical points when
        # local DB is still sparse for the selected window.
        minimum_expected_points = 12 if hours >= 24 else 4
        if sensor.get("type") == "water_level" and len(readings) < minimum_expected_points:
            try:
                history_points = await fetch_selangor_water_level_history_for_sensor(
                    sensor,
                    hours=hours,
                )
                points_to_persist = history_points
                if len(history_points) > 240:
                    # Persist an hourly downsample to keep first-load latency reasonable.
                    by_hour: dict[datetime, dict] = {}
                    for point in history_points:
                        ts = point.get("timestamp")
                        if not isinstance(ts, datetime):
                            continue
                        hour_key = ts.replace(minute=0, second=0, microsecond=0)
                        by_hour[hour_key] = point
                    points_to_persist = [by_hour[k] for k in sorted(by_hour)]

                for point in points_to_persist:
                    await db.sensor_readings.update_one(
                        {
                            "sensor_id": point["sensor_id"],
                            "timestamp": point["timestamp"],
                        },
                        {"$set": point},
                        upsert=True,
                    )
                if history_points:
                    readings = await _load_readings()
            except Exception as e:
                logger.warning(
                    "Water-level history backfill failed for sensor %s: %s",
                    sensor_id,
                    e,
                )

    if use_fallback or not readings:
        # produce a single synthetic point so UI doesn't fail
        reading = build_sensor_readings([sensor])[0]
        readings = [
            {
                "id": _new_id(),
                "sensor_id": str(sid),
                "timestamp": reading["timestamp"],
                "value": reading["value"],
                "unit": reading.get("unit"),
                "type": reading.get("type"),
                "location": reading.get("location"),
                "source": reading.get("source", "simulated"),
            }
        ]

    return {
        "sensor_id": str(sid),
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "type": sensor.get("type"),
        "unit": sensor.get("unit"),
        "hours": hours,
        "readings": readings,
    }

@app.get("/sensors/{sensor_id}/latest-reading")
async def get_latest_sensor_reading(sensor_id: str):
    sid = _normalize_id(sensor_id, "sensor ID")

    sensor = None
    try:
        sensor = await db.sensors.find_one({"_id": sid})
    except Exception:
        sensor = None

    if sensor is None:
        fallback = get_fallback_sensors_with_ids()
        for s in fallback:
            if str(s["_id"]) == sensor_id:
                sensor = s
                sid = s["_id"]
                break

    if sensor is None:
        raise HTTPException(status_code=404, detail="Sensor not found")

    doc = None
    try:
        all_readings = await db.sensor_readings.find().to_list(length=None)
        doc = _select_latest_reading_doc_for_sensor(all_readings, sid)
    except Exception:
        doc = None

    if doc is None:
        reading = build_sensor_readings([sensor])[0]
        doc = {
            "id": _new_id(),
            "sensor_id": str(sid),
            "timestamp": reading["timestamp"],
            "value": reading["value"],
            "unit": reading.get("unit"),
            "type": reading.get("type"),
            "location": reading.get("location"),
            "source": reading.get("source", "simulated"),
        }
    else:
        raw_ts, _ = _extract_reading_timestamp(doc)
        doc = {
            "id": str(doc.get("_id", _new_id())),
            "sensor_id": str(_extract_sensor_id_from_reading(doc) or sid),
            "timestamp": _serialize_timestamp(raw_ts),
            "value": doc.get("value"),
            "unit": doc.get("unit") or sensor.get("unit"),
            "type": doc.get("type") or sensor.get("type"),
            "location": doc.get("location") or sensor.get("location"),
            "source": doc.get("source", "unknown"),
        }

    return {
        "sensor_id": str(sid),
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "type": sensor.get("type"),
        "unit": sensor.get("unit"),
        "latest_reading": doc,
    }

@app.get("/sensor-readings/latest-by-sensor")
async def get_latest_readings_for_all_sensors():
    latest_readings = []
    sensors = await _load_sensor_docs_or_fallback()
    generated_fallback_by_sensor_id: dict[str, dict] | None = None

    latest_by_sensor: dict[str, dict[str, Any]] = {}
    try:
        all_readings = await db.sensor_readings.find().to_list(length=None)
        known_sensor_ids = {str(s.get("_id")) for s in sensors if s.get("_id") is not None}
        latest_by_sensor = {
            sensor_id: reading
            for sensor_id, reading in _latest_readings_by_sensor_from_docs(all_readings).items()
            if sensor_id in known_sensor_ids
        }
    except Exception:
        latest_by_sensor = {}

    for sensor in sensors:
        sensor_id = str(sensor.get("_id"))
        doc = latest_by_sensor.get(sensor_id)
        if doc is None:
            # Generate fallback data once for all sensors, not per-sensor
            if generated_fallback_by_sensor_id is None:
                generated = await asyncio.to_thread(build_sensor_readings, sensors)
                generated_fallback_by_sensor_id = {
                    str(r["sensor_id"]): r for r in generated
                }

            fallback_reading = generated_fallback_by_sensor_id.get(str(sensor["_id"]))
            if fallback_reading is None:
                doc = {
                    "value": None,
                    "timestamp": None,
                    "source": "missing",
                }
            else:
                doc = {
                    "value": fallback_reading.get("value"),
                    "timestamp": fallback_reading.get("timestamp"),
                    "source": fallback_reading.get("source", "simulated"),
                }
        else:
            raw_ts, _ = _extract_reading_timestamp(doc)
            doc = {
                "value": doc.get("value"),
                "timestamp": _serialize_timestamp(raw_ts),
                "source": doc.get("source", "unknown"),
                "unit": doc.get("unit") or sensor.get("unit"),
            }

        latest_readings.append(
            {
                "sensor_id": sensor_id,
                "sensor_name": sensor.get("name"),
                "location": sensor.get("location"),
                "type": sensor.get("type"),
                "unit": doc.get("unit") or sensor.get("unit"),
                "value": doc.get("value"),
                "timestamp": doc.get("timestamp"),
                "source": doc.get("source", "unknown"),
            }
        )

    return {"latest_readings": latest_readings}

@app.get("/sensor-readings")
async def get_all_sensor_readings(limit: int = 500):
    """
    GET ALL SENSOR READINGS (all types, all locations), newest first.
    Uses the existing async DB layer from .db and returns a simple list.
    """
    if limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be positive")
    limit = min(limit, 5000)

    readings = []
    try:
        docs = await db.sensor_readings.find().to_list(length=None)
        docs.sort(key=_reading_sort_key, reverse=True)
        for doc in docs[:limit]:
            sensor_id = _extract_sensor_id_from_reading(doc)
            raw_ts, _ = _extract_reading_timestamp(doc)
            readings.append(
                {
                    "id": str(doc.get("_id", _new_id())),
                    "sensor_id": str(sensor_id) if sensor_id is not None else None,
                    "value": doc.get("value"),
                    "unit": doc.get("unit"),
                    "timestamp": _serialize_timestamp(raw_ts),
                    "type": doc.get("type"),
                    "location": doc.get("location"),
                    "source": doc.get("source", "unknown"),
                }
            )
    except Exception:
        sensors = get_fallback_sensors_with_ids()
        generated = build_sensor_readings(sensors)
        for r in generated:
            readings.append(
                {
                    "id": _new_id(),
                    "sensor_id": str(r["sensor_id"]),
                    "value": r["value"],
                    "unit": r.get("unit"),
                    "timestamp": r["timestamp"],
                    "type": r.get("type"),
                    "location": r.get("location"),
                    "source": r.get("source", "simulated"),
                }
            )

    return {"readings": readings}


@app.post("/sensor-readings/ingest")
async def ingest_sensor_readings_now():
    return await ingest_sensor_readings_once(trigger="manual")
