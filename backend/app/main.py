import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import copy
import re
import time

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from bson import ObjectId
from datetime import datetime, timedelta
from typing import Any, Optional, List
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

import stripe

from .db import db
from .models import UserReportCreate
from .sensor_ingest import (
    build_sensor_readings,
    fetch_selangor_readings,
    fetch_selangor_water_level_history_for_sensor,
)

app = FastAPI()
logger = logging.getLogger("sensor-ingest")

SENSOR_INGEST_INTERVAL_SECONDS = int(os.getenv("SENSOR_INGEST_INTERVAL_SECONDS", "600"))
SENSOR_INGEST_ENABLED = os.getenv("SENSOR_INGEST_ENABLED", "1").lower() in {"1", "true", "yes"}
_sensor_ingest_task: asyncio.Task | None = None

# Fallback sample sensors (used when Mongo is unavailable)
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
            s["_id"] = ObjectId()
        _fallback_cached = sensors
    return copy.deepcopy(_fallback_cached)

_fallback_cached = None


# --- Fallback user store when Mongo is unavailable -------------------------
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

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # only your frontend dev origins
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


async def ingest_sensor_readings_once(trigger: str = "manual") -> dict:
    persist = True
    try:
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

    # 2) If nothing came in, fall back to existing scraping + simulation
    if not generated:
        if not sensors:
            return {
                "trigger": trigger,
                "inserted_or_updated": 0,
                "total_sensors": 0,
                "message": "No active sensors found",
                "persisted": False,
            }
        generated.extend(await asyncio.to_thread(build_sensor_readings, sensors))

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
AUTH_TOKEN_SECRET = os.getenv("AUTH_TOKEN_SECRET", "water-status-dev-secret")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "adminwaterstatus")
SENSITIVE_USER_FIELDS = {"password_hash", "password"}


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
    user_id: str          # Mongo user id as string
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
    try:
        cursor = db.sensors.find()
        async for doc in cursor:
            doc["id"] = str(doc["_id"])
            del doc["_id"]
            sensors.append(doc)
    except Exception:
        fallback = get_fallback_sensors_with_ids()
        for s in fallback:
            sensors.append(
                {
                    **{k: v for k, v in s.items() if k != "_id"},
                    "id": str(s["_id"]),
                }
            )
    else:
        if not sensors:
            fallback = get_fallback_sensors_with_ids()
            for s in fallback:
                sensors.append(
                    {
                        **{k: v for k, v in s.items() if k != "_id"},
                        "id": str(s["_id"]),
                    }
                )

    return {"sensors": sensors}

@app.get("/sensors/{sensor_id}")
async def get_sensor(sensor_id: str):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        sid = sensor_id  # SQLite fallback string key

    doc = await db.sensors.find_one({"_id": sid})
    if not doc:
        raise HTTPException(status_code=404, detail="Sensor not found")

    if "_id" in doc:
        doc["id"] = str(doc["_id"])
        doc.pop("_id", None)
    else:
        doc["id"] = str(sid)
    return doc

@app.patch("/sensors/{sensor_id}")
async def update_sensor(sensor_id: str, payload: SensorUpdate):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        sid = sensor_id  # SQLite fallback

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
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

@app.delete("/sensors/{sensor_id}")
async def delete_sensor(sensor_id: str):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        sid = sensor_id  # SQLite fallback

    result = await db.sensors.delete_one({"_id": sid})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sensor not found")

    return {"id": sensor_id, "deleted": True}

def _coerce_user_id(user_id: str):
    try:
        return ObjectId(user_id)
    except Exception:
        return user_id


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
        "_id": ObjectId(),
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
        doc = {"_id": ObjectId(), **user_dict}
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
    # 1. Validate & convert user_id
    try:
        user_oid = ObjectId(report.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Convert report to dict
    report_dict = report.model_dump()

    # 3. Normalize category (this is the important new part)
    report_dict["category"] = normalize_category(report_dict["category"])

    # 4. Use real ObjectId in DB
    report_dict["user_id"] = user_oid

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
    # 1. Validate ID format
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    # 2. Look up report in Mongo
    doc = await db.reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    # 3. Convert ObjectIds to strings for JSON
    doc["id"] = str(doc["_id"])
    doc["user_id"] = str(doc["user_id"])
    del doc["_id"]

    return doc

# --- USER REPORTS CRUD + LIKES --------------------------------------------

@app.post("/user-reports")
async def create_user_report(report: UserReportCreate):
    # 1. Validate & convert user_id
    try:
        user_oid = ObjectId(report.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Validate & convert sensor_id
    try:
        sensor_oid = ObjectId(report.sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    sensor = await db.sensors.find_one({"_id": sensor_oid})
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    # 3. Normalise type ("rainfall", "Rain", etc → "rain")
    normalized_type = normalize_category(report.type)

    # 4. Decide timestamp
    ts = report.timestamp or datetime.utcnow()

    # 5. Build document
    source_name = user.get("name") or "User"

    doc = {
        "user_id": user_oid,
        "sensor_id": sensor_oid,
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "timestamp": ts,
        "type": normalized_type,
        "value": report.value,
        "unit": report.unit or sensor.get("unit"),
        "source": source_name,
        "comment": report.comment or "",
        "likes": 0,
        "liked_by": [],   # list of ObjectIds
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
    # Try to parse the current user ID (for liked_by_me)
    current_oid: ObjectId | None = None
    if current_user_id:
        try:
            current_oid = ObjectId(current_user_id)
        except Exception:
            current_oid = None

    reports = []
    try:
        cursor = db.user_reports.find().sort("timestamp", -1).limit(limit)

        async for doc in cursor:
            user_name = None
            user_id = doc.get("user_id")
            if isinstance(user_id, ObjectId):
                user_doc = await db.users.find_one({"_id": user_id}, {"name": 1})
                if user_doc:
                    user_name = user_doc.get("name")

            likes = int(doc.get("likes") or 0)
            liked_by = doc.get("liked_by") or []
            if not isinstance(liked_by, list):
                liked_by = []

            liked_by_me = False
            if current_oid is not None:
                liked_by_me = any(_ids_match(x, current_oid) for x in liked_by)

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
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(payload.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

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
        try:
            new_sid = ObjectId(payload.sensor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid sensor ID format")

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
    Delete a single user report by its Mongo _id, but only if it belongs
    to the given user_id.
    """
    # 1) Validate ids
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

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
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(payload.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

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

    sid: ObjectId | None = None
    sensor = None
    use_fallback = False

    try:
        sid = ObjectId(sensor_id)
        sensor = await db.sensors.find_one({"_id": sid})
    except Exception:
        sid = None

    if sensor is None:
        # try string id (SQLite)
        sensor = await db.sensors.find_one({"_id": sensor_id})
        if sensor:
            sid = sensor_id

    if sensor is None:
        # try fallback cache
        fallback = get_fallback_sensors_with_ids()
        for s in fallback:
            if str(s["_id"]) == sensor_id:
                sensor = s
                sid = s["_id"]
                use_fallback = True
                break

    if sensor is None or sid is None:
        raise HTTPException(status_code=404, detail="Sensor not found")

    since = datetime.utcnow() - timedelta(hours=hours)
    async def _load_readings() -> list[dict]:
        loaded: list[dict] = []
        try:
            cursor = (
                db.sensor_readings.find(
                    {
                        "sensor_id": sid,
                        "timestamp": {"$gte": since},
                    }
                )
                .sort("timestamp", 1)
            )
            async for doc in cursor:
                doc["id"] = str(doc["_id"])
                doc["sensor_id"] = str(doc["sensor_id"])
                del doc["_id"]
                loaded.append(doc)
        except Exception:
            return []
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
                "id": str(ObjectId()),
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
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        sid = None

    sensor = None
    if sid is not None:
        try:
            sensor = await db.sensors.find_one({"_id": sid})
        except Exception:
            sensor = None

    if sensor is None:
        sensor = await db.sensors.find_one({"_id": sensor_id})
        if sensor:
            sid = sensor_id

    if sensor is None:
        fallback = get_fallback_sensors_with_ids()
        for s in fallback:
            if str(s["_id"]) == sensor_id:
                sensor = s
                sid = s["_id"]
                break

    if sensor is None or sid is None:
        raise HTTPException(status_code=404, detail="Sensor not found")

    doc = None
    try:
        doc = await db.sensor_readings.find_one(
            {"sensor_id": sid},
            sort=[("timestamp", -1)],
        )
    except Exception:
        doc = None

    if doc is None:
        reading = build_sensor_readings([sensor])[0]
        doc = {
            "id": str(ObjectId()),
            "sensor_id": str(sid),
            "timestamp": reading["timestamp"],
            "value": reading["value"],
            "unit": reading.get("unit"),
            "type": reading.get("type"),
            "location": reading.get("location"),
            "source": reading.get("source", "simulated"),
        }
    else:
        doc["id"] = str(doc["_id"])
        doc["sensor_id"] = str(doc["sensor_id"])
        del doc["_id"]

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
    sensors: list[dict] = []
    generated_fallback_by_sensor_id: dict[str, dict] | None = None

    try:
        cursor = db.sensors.find()
        async for sensor in cursor:
            sensors.append(sensor)
    except Exception:
        sensors = get_fallback_sensors_with_ids()

    try_db = True
    for sensor in sensors:
        doc = None
        if try_db:
            try:
                doc = await db.sensor_readings.find_one(
                    {"sensor_id": sensor["_id"]},
                    sort=[("timestamp", -1)],
                )
            except Exception:
                try_db = False
                doc = None

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

        latest_readings.append(
            {
                "sensor_id": str(sensor["_id"]),
                "sensor_name": sensor.get("name"),
                "location": sensor.get("location"),
                "type": sensor.get("type"),
                "unit": sensor.get("unit"),
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
    Uses the existing async Mongo DB from .db and returns a simple list.
    """
    if limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be positive")
    limit = min(limit, 5000)

    readings = []
    try:
        cursor = db.sensor_readings.find().sort("timestamp", -1).limit(limit)
        async for doc in cursor:
            doc["id"] = str(doc["_id"])
            if "sensor_id" in doc:
                doc["sensor_id"] = str(doc["sensor_id"])
            del doc["_id"]
            readings.append(doc)
    except Exception:
        sensors = get_fallback_sensors_with_ids()
        generated = build_sensor_readings(sensors)
        for r in generated:
            readings.append(
                {
                    "id": str(ObjectId()),
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
