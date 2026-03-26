from __future__ import annotations

import copy
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from threading import Lock
from typing import Any

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_TIMEOUT_SECONDS = int(os.getenv("OPEN_METEO_TIMEOUT_SECONDS", "20"))
OPEN_METEO_CACHE_TTL_SECONDS = int(os.getenv("OPEN_METEO_CACHE_TTL_SECONDS", "1800"))
OPEN_METEO_COORD_PRECISION = int(os.getenv("OPEN_METEO_COORD_PRECISION", "3"))
OPEN_METEO_DEFAULT_BATCH_LIMIT = int(os.getenv("OPEN_METEO_DEFAULT_BATCH_LIMIT", "8"))
OPEN_METEO_TIMEZONE = "Asia/Kuala_Lumpur"
OPEN_METEO_SOURCE = "open-meteo.forecast"

_CURRENT_FIELDS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "weather_code",
    "wind_speed_10m",
    "is_day",
]
_HOURLY_FIELDS = [
    "temperature_2m",
    "precipitation_probability",
    "rain",
    "weather_code",
    "wind_speed_10m",
]
_DAILY_FIELDS = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "rain_sum",
]

_forecast_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_forecast_cache_lock = Lock()


def _fetch_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=OPEN_METEO_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_sensor_coords(sensor: dict[str, Any]) -> tuple[float | None, float | None]:
    latitude = _safe_float(sensor.get("latitude"))
    if latitude is None:
        latitude = _safe_float(sensor.get("lat"))

    longitude = _safe_float(sensor.get("longitude"))
    if longitude is None:
        longitude = _safe_float(sensor.get("lon"))
    if longitude is None:
        longitude = _safe_float(sensor.get("lng"))

    return latitude, longitude


def _coord_key(latitude: float, longitude: float) -> str:
    return f"{latitude:.{OPEN_METEO_COORD_PRECISION}f},{longitude:.{OPEN_METEO_COORD_PRECISION}f}"


def _serialize_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _build_unavailable_summary(sensor: dict[str, Any], *, sensor_id: str | None = None) -> dict[str, Any]:
    latitude, longitude = _extract_sensor_coords(sensor)
    return {
        "sensor_id": sensor_id or str(sensor.get("_id") or sensor.get("id") or ""),
        "location": sensor.get("location"),
        "latitude": latitude,
        "longitude": longitude,
        "status": "unavailable",
        "source": OPEN_METEO_SOURCE,
        "generated_at": _serialize_timestamp(datetime.now(timezone.utc)),
        "current": None,
        "next_6h": None,
        "next_12h": None,
        "daily": [],
    }


def _build_error_summary(
    sensor: dict[str, Any],
    *,
    sensor_id: str | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    latitude, longitude = _extract_sensor_coords(sensor)
    return {
        "sensor_id": sensor_id or str(sensor.get("_id") or sensor.get("id") or ""),
        "location": sensor.get("location"),
        "latitude": latitude,
        "longitude": longitude,
        "status": "error",
        "source": OPEN_METEO_SOURCE,
        "generated_at": _serialize_timestamp(generated_at or datetime.now(timezone.utc)),
        "current": None,
        "next_6h": None,
        "next_12h": None,
        "daily": [],
    }


def _select_hour_window(hourly: dict[str, Any], current_time: str | None, hours: int) -> dict[str, Any]:
    times = hourly.get("time") or []
    if not isinstance(times, list) or not times:
        return {}

    start_index = 0
    if isinstance(current_time, str) and current_time:
        for index, candidate in enumerate(times):
            if isinstance(candidate, str) and candidate >= current_time:
                start_index = index
                break

    end_index = min(len(times), start_index + hours)
    fields = ("precipitation_probability", "rain", "wind_speed_10m")
    window: dict[str, list[Any]] = {}
    for field in fields:
        values = hourly.get(field) or []
        if isinstance(values, list):
            window[field] = values[start_index:end_index]
        else:
            window[field] = []
    return window


def _summarize_hour_window(hourly: dict[str, Any], current_time: str | None, hours: int) -> dict[str, Any] | None:
    window = _select_hour_window(hourly, current_time, hours)
    if not window:
        return None

    rain_probability_values = [
        value for value in (_safe_float(item) for item in window["precipitation_probability"]) if value is not None
    ]
    rain_values = [
        value for value in (_safe_float(item) for item in window["rain"]) if value is not None
    ]
    wind_values = [
        value for value in (_safe_float(item) for item in window["wind_speed_10m"]) if value is not None
    ]

    return {
        "hours": hours,
        "max_precipitation_probability": max(rain_probability_values) if rain_probability_values else None,
        "rain_sum": round(sum(rain_values), 1) if rain_values else 0.0,
        "max_wind_speed_10m": max(wind_values) if wind_values else None,
    }


def _summarize_daily(payload: dict[str, Any]) -> list[dict[str, Any]]:
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    if not isinstance(times, list):
        return []

    result: list[dict[str, Any]] = []
    for index, date_text in enumerate(times[:3]):
        result.append(
            {
                "date": date_text,
                "weather_code": _safe_int((daily.get("weather_code") or [None])[index] if index < len(daily.get("weather_code") or []) else None),
                "temperature_2m_max": _safe_float((daily.get("temperature_2m_max") or [None])[index] if index < len(daily.get("temperature_2m_max") or []) else None),
                "temperature_2m_min": _safe_float((daily.get("temperature_2m_min") or [None])[index] if index < len(daily.get("temperature_2m_min") or []) else None),
                "precipitation_probability_max": _safe_float((daily.get("precipitation_probability_max") or [None])[index] if index < len(daily.get("precipitation_probability_max") or []) else None),
                "rain_sum": _safe_float((daily.get("rain_sum") or [None])[index] if index < len(daily.get("rain_sum") or []) else None),
            }
        )

    return result


def _build_base_summary(payload: dict[str, Any], generated_at: datetime) -> dict[str, Any]:
    current = payload.get("current") or {}
    current_time = current.get("time") if isinstance(current.get("time"), str) else None
    current_summary = {
        "time": current_time,
        "temperature_2m": _safe_float(current.get("temperature_2m")),
        "apparent_temperature": _safe_float(current.get("apparent_temperature")),
        "relative_humidity_2m": _safe_float(current.get("relative_humidity_2m")),
        "weather_code": _safe_int(current.get("weather_code")),
        "wind_speed_10m": _safe_float(current.get("wind_speed_10m")),
        "is_day": bool(current.get("is_day")) if current.get("is_day") is not None else None,
    }

    return {
        "status": "ok",
        "source": OPEN_METEO_SOURCE,
        "generated_at": _serialize_timestamp(generated_at),
        "current": current_summary,
        "next_6h": _summarize_hour_window(payload.get("hourly") or {}, current_time, 6),
        "next_12h": _summarize_hour_window(payload.get("hourly") or {}, current_time, 12),
        "daily": _summarize_daily(payload),
    }


def _fetch_open_meteo_payloads(coords: list[tuple[float, float]]) -> list[dict[str, Any]]:
    if not coords:
        return []

    params = {
        "latitude": ",".join(f"{latitude:.5f}" for latitude, _ in coords),
        "longitude": ",".join(f"{longitude:.5f}" for _, longitude in coords),
        "timezone": OPEN_METEO_TIMEZONE,
        "cell_selection": "land",
        "current": ",".join(_CURRENT_FIELDS),
        "hourly": ",".join(_HOURLY_FIELDS),
        "daily": ",".join(_DAILY_FIELDS),
        "forecast_hours": "12",
        "forecast_days": "3",
    }
    url = f"{OPEN_METEO_FORECAST_URL}?{urllib.parse.urlencode(params)}"
    payload = _fetch_json(url)

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def get_forecast_summaries(
    sensors: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if not sensors:
        return results

    base_summaries_by_coord: dict[str, dict[str, Any]] = {}
    missing_coords: list[tuple[str, float, float]] = []

    now_monotonic = time.monotonic()
    with _forecast_cache_lock:
        for sensor in sensors:
            latitude, longitude = _extract_sensor_coords(sensor)
            if latitude is None or longitude is None:
                continue

            coord_key = _coord_key(latitude, longitude)
            cached = _forecast_cache.get(coord_key)
            if cached and now_monotonic < cached[0]:
                base_summaries_by_coord[coord_key] = copy.deepcopy(cached[1])
                continue

            if coord_key not in {item[0] for item in missing_coords}:
                missing_coords.append((coord_key, latitude, longitude))

    if missing_coords:
        generated_at = datetime.now(timezone.utc)
        try:
            fetched_payloads = _fetch_open_meteo_payloads(
                [(latitude, longitude) for _, latitude, longitude in missing_coords]
            )
            fetched_by_coord: dict[str, dict[str, Any]] = {}
            for index, payload in enumerate(fetched_payloads):
                if index >= len(missing_coords):
                    break
                coord_key = missing_coords[index][0]
                fetched_by_coord[coord_key] = _build_base_summary(payload, generated_at)

            with _forecast_cache_lock:
                for coord_key, latitude, longitude in missing_coords:
                    base_summary = fetched_by_coord.get(coord_key)
                    if base_summary is None:
                        base_summary = _build_error_summary(
                            {"latitude": latitude, "longitude": longitude},
                            generated_at=generated_at,
                        )
                    base_summaries_by_coord[coord_key] = copy.deepcopy(base_summary)
                    _forecast_cache[coord_key] = (
                        time.monotonic() + OPEN_METEO_CACHE_TTL_SECONDS,
                        copy.deepcopy(base_summary),
                    )
        except Exception:
            error_summary = _build_error_summary({}, generated_at=generated_at)
            with _forecast_cache_lock:
                for coord_key, _, _ in missing_coords:
                    base_summaries_by_coord[coord_key] = copy.deepcopy(error_summary)

    for sensor in sensors:
        sensor_id = str(sensor.get("_id") or sensor.get("id") or "")
        latitude, longitude = _extract_sensor_coords(sensor)
        if latitude is None or longitude is None:
            results.append(_build_unavailable_summary(sensor, sensor_id=sensor_id))
            continue

        coord_key = _coord_key(latitude, longitude)
        base_summary = copy.deepcopy(base_summaries_by_coord.get(coord_key))
        if not base_summary:
            results.append(_build_error_summary(sensor, sensor_id=sensor_id))
            continue

        base_summary.update(
            {
                "sensor_id": sensor_id,
                "location": sensor.get("location"),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
        results.append(base_summary)

    return results


def _reset_forecast_cache() -> None:
    with _forecast_cache_lock:
        _forecast_cache.clear()
