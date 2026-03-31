from __future__ import annotations

import copy
import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_TIMEOUT_SECONDS = int(os.getenv("OPEN_METEO_TIMEOUT_SECONDS", "20"))
OPEN_METEO_CACHE_TTL_SECONDS = int(os.getenv("OPEN_METEO_CACHE_TTL_SECONDS", "1800"))
OPEN_METEO_COORD_PRECISION = int(os.getenv("OPEN_METEO_COORD_PRECISION", "3"))
OPEN_METEO_DEFAULT_BATCH_LIMIT = int(os.getenv("OPEN_METEO_DEFAULT_BATCH_LIMIT", "8"))
OPEN_METEO_TIMEZONE = "Asia/Kuala_Lumpur"
OPEN_METEO_SOURCE = "open-meteo.forecast"
OPEN_METEO_LOCATION_RADIUS_KM = float(os.getenv("OPEN_METEO_LOCATION_RADIUS_KM", "8"))
OPEN_METEO_LOCATION_FRAME_COUNT = int(os.getenv("OPEN_METEO_LOCATION_FRAME_COUNT", "6"))

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
    "precipitation",
    "rain",
    "weather_code",
    "wind_speed_10m",
]
_MINUTELY_15_FIELDS = [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "rain",
]
_DAILY_FIELDS = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "rain_sum",
]
_MAP_SAMPLE_GRID: tuple[tuple[str, int, int], ...] = (
    ("north-west", 1, -1),
    ("north", 1, 0),
    ("north-east", 1, 1),
    ("west", 0, -1),
    ("center", 0, 0),
    ("east", 0, 1),
    ("south-west", -1, -1),
    ("south", -1, 0),
    ("south-east", -1, 1),
)

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


def _safe_iso_to_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _serialize_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


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


def _payload_generated_at(payload: dict[str, Any]) -> str | None:
    generated_at = payload.get("_generated_at")
    return generated_at if isinstance(generated_at, str) else None


def _error_payload(generated_at: datetime | None = None) -> dict[str, Any]:
    return {
        "_fetch_status": "error",
        "_generated_at": _serialize_timestamp(generated_at or datetime.now(timezone.utc)),
    }


def _stamp_payload(payload: dict[str, Any], generated_at: datetime) -> dict[str, Any]:
    stamped = copy.deepcopy(payload)
    stamped["_fetch_status"] = "ok"
    stamped["_generated_at"] = _serialize_timestamp(generated_at)
    return stamped


def _find_series_start_index(times: list[Any], current_time: str | None) -> int:
    if not times:
        return 0

    if isinstance(current_time, str) and current_time:
        for index, candidate in enumerate(times):
            if isinstance(candidate, str) and candidate >= current_time:
                return index

    return 0


def _slice_time_series(
    series: dict[str, Any],
    current_time: str | None,
    steps: int,
    fields: tuple[str, ...],
) -> dict[str, list[Any]]:
    times = series.get("time") or []
    if not isinstance(times, list) or not times:
        return {}

    start_index = _find_series_start_index(times, current_time)
    end_index = min(len(times), start_index + steps)
    window: dict[str, list[Any]] = {"time": times[start_index:end_index]}

    for field in fields:
        values = series.get(field) or []
        if isinstance(values, list):
            window[field] = values[start_index:end_index]
        else:
            window[field] = []

    return window


def _summarize_hour_window(hourly: dict[str, Any], current_time: str | None, hours: int) -> dict[str, Any] | None:
    window = _slice_time_series(
        hourly,
        current_time,
        hours,
        ("precipitation_probability", "rain", "wind_speed_10m"),
    )
    if not window:
        return None

    rain_probability_values = [
        value
        for value in (_safe_float(item) for item in window["precipitation_probability"])
        if value is not None
    ]
    rain_values = [
        value for value in (_safe_float(item) for item in window["rain"]) if value is not None
    ]
    wind_values = [
        value
        for value in (_safe_float(item) for item in window["wind_speed_10m"])
        if value is not None
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


def _build_base_summary(payload: dict[str, Any]) -> dict[str, Any]:
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
        "generated_at": _payload_generated_at(payload),
        "current": current_summary,
        "next_6h": _summarize_hour_window(payload.get("hourly") or {}, current_time, 6),
        "next_12h": _summarize_hour_window(payload.get("hourly") or {}, current_time, 12),
        "daily": _summarize_daily(payload),
    }


def _fetch_open_meteo_payloads(
    coords: list[tuple[float, float]],
    *,
    include_minutely_15: bool = True,
) -> list[dict[str, Any]]:
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
        "past_hours": "6",
        "forecast_days": "3",
    }
    if include_minutely_15:
        params["minutely_15"] = ",".join(_MINUTELY_15_FIELDS)
        params["forecast_minutely_15"] = "4"

    url = f"{OPEN_METEO_FORECAST_URL}?{urllib.parse.urlencode(params)}"
    payload = _fetch_json(url)

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def _get_cached_payloads_by_coord(coords: list[tuple[float, float]]) -> dict[str, dict[str, Any]]:
    payloads_by_coord: dict[str, dict[str, Any]] = {}
    missing_coords: list[tuple[str, float, float]] = []
    seen_missing: set[str] = set()

    now_monotonic = time.monotonic()
    with _forecast_cache_lock:
        for latitude, longitude in coords:
            coord_key = _coord_key(latitude, longitude)
            cached = _forecast_cache.get(coord_key)
            if cached and now_monotonic < cached[0]:
                payloads_by_coord[coord_key] = copy.deepcopy(cached[1])
                continue

            if coord_key in seen_missing:
                continue

            seen_missing.add(coord_key)
            missing_coords.append((coord_key, latitude, longitude))

    if not missing_coords:
        return payloads_by_coord

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
            fetched_by_coord[coord_key] = _stamp_payload(payload, generated_at)

        with _forecast_cache_lock:
            for coord_key, _, _ in missing_coords:
                cached_payload = fetched_by_coord.get(coord_key)
                if cached_payload is None:
                    payloads_by_coord[coord_key] = _error_payload(generated_at)
                    continue

                payloads_by_coord[coord_key] = copy.deepcopy(cached_payload)
                _forecast_cache[coord_key] = (
                    time.monotonic() + OPEN_METEO_CACHE_TTL_SECONDS,
                    copy.deepcopy(cached_payload),
                )
    except Exception:
        error_payload = _error_payload(generated_at)
        for coord_key, _, _ in missing_coords:
            payloads_by_coord[coord_key] = copy.deepcopy(error_payload)

    return payloads_by_coord


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _add_minutes(value: str | None, minutes: int) -> str | None:
    if not isinstance(value, str) or not value:
        return value

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value

    shifted = parsed + timedelta(minutes=minutes)
    return shifted.isoformat(timespec="minutes")


def _build_next_hour_30m(payload: dict[str, Any]) -> list[dict[str, Any]]:
    current_time = ((payload.get("current") or {}).get("time"))
    window = _slice_time_series(
        payload.get("minutely_15") or {},
        current_time if isinstance(current_time, str) else None,
        4,
        ("precipitation_probability", "rain"),
    )
    times = window.get("time") or []
    if not isinstance(times, list) or not times:
        return []

    buckets: list[dict[str, Any]] = []
    for index in range(0, min(len(times), 4), 2):
        bucket_times = times[index:index + 2]
        probability_values = [
            value
            for value in (
                _safe_float(item)
                for item in (window.get("precipitation_probability") or [])[index:index + 2]
            )
            if value is not None
        ]
        rain_values = [
            value
            for value in (_safe_float(item) for item in (window.get("rain") or [])[index:index + 2])
            if value is not None
        ]
        if not bucket_times:
            continue

        average_probability = _average(probability_values)
        buckets.append(
            {
                "start": bucket_times[0],
                "end": _add_minutes(bucket_times[-1], 15),
                "rain_amount": round(sum(rain_values), 2) if rain_values else 0.0,
                "precipitation_probability": round(average_probability) if average_probability is not None else None,
            }
        )

    return buckets


def _build_hourly_timeline(
    payload: dict[str, Any],
    *,
    past_hours: int = 6,
    future_hours: int = 6,
) -> list[dict[str, Any]]:
    current_time = ((payload.get("current") or {}).get("time"))
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not isinstance(times, list) or not times:
        return []

    start_index = _find_series_start_index(times, current_time if isinstance(current_time, str) else None)
    from_index = max(0, start_index - past_hours)
    to_index = min(len(times), start_index + future_hours + 1)
    timeline: list[dict[str, Any]] = []

    rain_values = hourly.get("rain") or []
    probability_values = hourly.get("precipitation_probability") or []
    precipitation_values = hourly.get("precipitation") or []
    temperature_values = hourly.get("temperature_2m") or []

    for index in range(from_index, to_index):
        timeline.append(
            {
                "time": times[index] if index < len(times) else None,
                "offset_hours": index - start_index,
                "rain_amount": _safe_float(rain_values[index]) if index < len(rain_values) else None,
                "precipitation_amount": (
                    _safe_float(precipitation_values[index])
                    if index < len(precipitation_values)
                    else None
                ),
                "precipitation_probability": (
                    _safe_float(probability_values[index])
                    if index < len(probability_values)
                    else None
                ),
                "temperature_2m": (
                    _safe_float(temperature_values[index])
                    if index < len(temperature_values)
                    else None
                ),
            }
        )

    return timeline


def _radius_km_to_deltas(latitude: float, radius_km: float) -> tuple[float, float]:
    step_km = max(radius_km / 2, 0.1)
    lat_delta = step_km / 111.0
    lon_scale = max(math.cos(math.radians(latitude)), 0.2)
    lon_delta = step_km / (111.0 * lon_scale)
    return lat_delta, lon_delta


def _build_location_samples(latitude: float, longitude: float, radius_km: float) -> list[dict[str, Any]]:
    lat_delta, lon_delta = _radius_km_to_deltas(latitude, radius_km)
    samples: list[dict[str, Any]] = []

    for sample_id, row_offset, col_offset in _MAP_SAMPLE_GRID:
        sample_lat = latitude + (lat_delta * row_offset)
        sample_lon = longitude + (lon_delta * col_offset)
        samples.append(
            {
                "id": sample_id,
                "latitude": round(sample_lat, 5),
                "longitude": round(sample_lon, 5),
                "_coord_key": _coord_key(sample_lat, sample_lon),
            }
        )

    return samples


def _hourly_value(payload: dict[str, Any], offset: int, field: str) -> float | None:
    if payload.get("_fetch_status") == "error":
        return None

    current_time = ((payload.get("current") or {}).get("time"))
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not isinstance(times, list) or not times:
        return None

    start_index = _find_series_start_index(times, current_time if isinstance(current_time, str) else None)
    target_index = start_index + offset
    values = hourly.get(field) or []
    if not isinstance(values, list) or target_index >= len(values):
        return None

    return _safe_float(values[target_index])


def _build_map_frames(samples: list[dict[str, Any]], payloads_by_coord: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    center_sample = next((sample for sample in samples if sample["id"] == "center"), None)
    if center_sample is None:
        return []

    center_payload = payloads_by_coord.get(center_sample["_coord_key"])
    if not center_payload or center_payload.get("_fetch_status") == "error":
        return []

    center_hourly = center_payload.get("hourly") or {}
    center_times = center_hourly.get("time") or []
    current_time = ((center_payload.get("current") or {}).get("time"))
    if not isinstance(center_times, list) or not center_times:
        return []

    start_index = _find_series_start_index(center_times, current_time if isinstance(current_time, str) else None)
    frames: list[dict[str, Any]] = []

    for offset in range(OPEN_METEO_LOCATION_FRAME_COUNT):
        time_index = start_index + offset
        if time_index >= len(center_times):
            break

        frame_samples: list[dict[str, Any]] = []
        for sample in samples:
            payload = payloads_by_coord.get(sample["_coord_key"], {})
            frame_samples.append(
                {
                    "sample_id": sample["id"],
                    "precipitation_amount": _hourly_value(payload, offset, "precipitation"),
                    "temperature_2m": _hourly_value(payload, offset, "temperature_2m"),
                }
            )

        frames.append(
            {
                "label": "Now" if offset == 0 else f"+{offset}h",
                "time": center_times[time_index],
                "samples": frame_samples,
            }
        )

    return frames


def get_forecast_summaries(sensors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if not sensors:
        return results

    coords = []
    for sensor in sensors:
        latitude, longitude = _extract_sensor_coords(sensor)
        if latitude is None or longitude is None:
            continue
        coords.append((latitude, longitude))

    payloads_by_coord = _get_cached_payloads_by_coord(coords)

    for sensor in sensors:
        sensor_id = str(sensor.get("_id") or sensor.get("id") or "")
        latitude, longitude = _extract_sensor_coords(sensor)
        if latitude is None or longitude is None:
            results.append(_build_unavailable_summary(sensor, sensor_id=sensor_id))
            continue

        coord_key = _coord_key(latitude, longitude)
        payload = copy.deepcopy(payloads_by_coord.get(coord_key))
        if not payload:
            results.append(_build_error_summary(sensor, sensor_id=sensor_id))
            continue
        if payload.get("_fetch_status") == "error":
            generated_at = _safe_iso_to_datetime(_payload_generated_at(payload))
            results.append(
                _build_error_summary(
                    sensor,
                    sensor_id=sensor_id,
                    generated_at=generated_at,
                )
            )
            continue

        summary = _build_base_summary(payload)
        summary.update(
            {
                "sensor_id": sensor_id,
                "location": sensor.get("location"),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
        results.append(summary)

    return results


def get_location_forecast_context(
    latitude: float,
    longitude: float,
    radius_km: float = OPEN_METEO_LOCATION_RADIUS_KM,
) -> dict[str, Any]:
    samples = _build_location_samples(latitude, longitude, radius_km)
    coords = [(sample["latitude"], sample["longitude"]) for sample in samples]
    payloads_by_coord = _get_cached_payloads_by_coord(coords)
    center_key = _coord_key(latitude, longitude)
    center_payload = copy.deepcopy(payloads_by_coord.get(center_key))

    if not center_payload:
        return {
            "status": "error",
            "source": OPEN_METEO_SOURCE,
            "generated_at": _serialize_timestamp(datetime.now(timezone.utc)),
            "current": None,
            "next_6h": None,
            "daily": [],
            "next_hour_30m": [],
            "hourly_timeline": [],
            "map": {
                "radius_km": radius_km,
                "samples": [
                    {
                        "id": sample["id"],
                        "latitude": sample["latitude"],
                        "longitude": sample["longitude"],
                    }
                    for sample in samples
                ],
                "frames": [],
            },
        }

    if center_payload.get("_fetch_status") == "error":
        return {
            "status": "error",
            "source": OPEN_METEO_SOURCE,
            "generated_at": _payload_generated_at(center_payload),
            "current": None,
            "next_6h": None,
            "daily": [],
            "next_hour_30m": [],
            "hourly_timeline": [],
            "map": {
                "radius_km": radius_km,
                "samples": [
                    {
                        "id": sample["id"],
                        "latitude": sample["latitude"],
                        "longitude": sample["longitude"],
                    }
                    for sample in samples
                ],
                "frames": [],
            },
        }

    summary = _build_base_summary(center_payload)
    return {
        "status": summary["status"],
        "source": summary["source"],
        "generated_at": summary["generated_at"],
        "current": summary["current"],
        "next_6h": summary["next_6h"],
        "daily": summary["daily"],
        "next_hour_30m": _build_next_hour_30m(center_payload),
        "hourly_timeline": _build_hourly_timeline(center_payload),
        "map": {
            "radius_km": radius_km,
            "samples": [
                {
                    "id": sample["id"],
                    "latitude": sample["latitude"],
                    "longitude": sample["longitude"],
                }
                for sample in samples
            ],
            "frames": _build_map_frames(samples, payloads_by_coord),
        },
    }


def _reset_forecast_cache() -> None:
    with _forecast_cache_lock:
        _forecast_cache.clear()
