from __future__ import annotations

import json
import math
import random
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Tuple, List, Dict

from motor.motor_asyncio import AsyncIOMotorDatabase

WATER_LEVEL_URL = (
    "https://publicinfobanjir.water.gov.my/aras-air/"
    "data-paras-air/aras-air-data/?state=SEL&district=ALL&station=ALL"
)
RAINFALL_URL = (
    "https://publicinfobanjir.water.gov.my/wp-content/themes/shapely/agency/"
    "searchresultrainfall.php?state=SEL&district=ALL&station=ALL"
)

# Selangor JPS API (official, includes lat/lon and history)
SEL_API_BASE = "https://infobanjirjps.selangor.gov.my/JPSAPI/api/"
RF_DATA_URL = SEL_API_BASE + "StationRainfalls/GetRFStationData/-1"
RF_STATION_DETAILS_URL = SEL_API_BASE + "StationRainfalls/GetRFStationDetails/{id}"
WL_DATA_URL = SEL_API_BASE + "StationRiverLevels/GetWLStationData/-1"
WL_STATION_DETAILS_URL = SEL_API_BASE + "StationRiverLevels/GetWLStationDetails/{id}"
WL_HISTORY_URL = SEL_API_BASE + "StationRiverLevels/GetWaterlevelDataByStation/{id}"
WEATHER_FORECAST_URL = "https://api.data.gov.my/weather/forecast/?contains={query}&limit=1"
REQUEST_TIMEOUT_SECONDS = 20
EXTERNAL_STALE_AFTER = timedelta(hours=6)

_SENSOR_TEXT_REPLACEMENTS = {
    "sungai": "sg",
    "kampung": "kg",
}

_WATER_HINTS = {
    "sungai gombak": ["sg gombak", "jalan tun razak"],
    "sungai klang": ["sg klang", "puchong drop"],
}

_RAIN_HINTS = {
    "klcc": ["kg gandhi", "jalan 222", "kampung baru"],
    "batu caves": ["batu caves"],
    "genting highlands": ["genting peres", "bukit fraser"],
    "masjid putra": ["putrajaya", "puncak niaga putrajaya"],
    "putrajaya": ["putrajaya", "puncak niaga putrajaya"],
    "subang jaya": ["usj 1", "ttdi jaya", "kg melayu subang"],
}

_TEMP_LOCATION_HINTS = {
    "klcc": ["Kuala Lumpur"],
    "kampung baru": ["Kuala Lumpur"],
    "cheras": ["Kuala Lumpur", "Petaling"],
    "putrajaya": ["Putrajaya"],
    "masjid putra": ["Putrajaya"],
    "batu caves": ["Gombak", "Petaling"],
    "genting highlands": ["Gombak", "Bentong"],
    "subang jaya": ["Petaling"],
}

_WATER_ROW_RE = re.compile(
    r"<td[^>]*data-th=['\"]No['\"][^>]*>(?P<no>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Station ID['\"][^>]*>(?P<station_id>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Station Name['\"][^>]*>(?P<station_name>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]District['\"][^>]*>(?P<district>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Main Basin \(mm\)['\"][^>]*>(?P<basin>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Sub River Basin \(mm\)['\"][^>]*>(?P<sub_basin>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Last Update['\"][^>]*>(?P<timestamp>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]wl['\"][^>]*>(?P<value>.*?)</td>",
    flags=re.IGNORECASE | re.DOTALL,
)

_RAIN_ROW_RE = re.compile(
    r"<td[^>]*data-th=['\"]No['\"][^>]*>(?P<no>.*?)</td>\s*"
    r"<td[^>]*data-th=['\"]Station ID['\"][^>]*>(?P<station_id>.*?)</td>\s*"
    r"<td[^>]*>(?P<station_name>.*?)</td>\s*"
    r"<td[^>]*>(?P<district>.*?)</td>\s*"
    r"<td[^>]*>(?P<timestamp>.*?)</td>\s*"
    r"<td[^>]*>(?P<d1>.*?)</td>\s*"
    r"<td[^>]*>(?P<d2>.*?)</td>\s*"
    r"<td[^>]*>(?P<d3>.*?)</td>\s*"
    r"<td[^>]*>(?P<d4>.*?)</td>\s*"
    r"<td[^>]*>(?P<d5>.*?)</td>\s*"
    r"<td[^>]*>(?P<d6>.*?)</td>\s*"
    r"<td[^>]*>(?P<latest>.*?)</td>\s*"
    r"<td[^>]*>(?P<info>.*?)</td>",
    flags=re.IGNORECASE | re.DOTALL,
)


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8", "ignore")


def _fetch_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def _safe_float(val: Any) -> float | None:
    try:
        if val is None:
            return None
        f = float(val)
        if f <= -9999:
            return None
        return f
    except Exception:
        return None


def _strip_html(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", value or "")
    cleaned = unescape(cleaned).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _normalize_text(value: str) -> str:
    text = _strip_html(value).lower()
    for source, target in _SENSOR_TEXT_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_float(value: str) -> float | None:
    cleaned = _strip_html(value)
    if not cleaned:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    number = float(match.group(0))
    if number <= -9999:
        return None
    return number


def _parse_external_time(value: str) -> datetime | None:
    text = _strip_html(value)
    if not text:
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _parse_water_rows(html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for match in _WATER_ROW_RE.finditer(html):
        value = _parse_float(match.group("value"))
        timestamp = _parse_external_time(match.group("timestamp"))
        if value is None or timestamp is None:
            continue
        rows.append(
            {
                "station_name": _strip_html(match.group("station_name")),
                "district": _strip_html(match.group("district")),
                "value": value,
                "timestamp": timestamp,
                "source": "publicinfobanjir.water_level",
            }
        )
    return rows


def _parse_rain_rows(html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for match in _RAIN_ROW_RE.finditer(html):
        value = _parse_float(match.group("latest"))
        timestamp = _parse_external_time(match.group("timestamp"))
        if value is None or timestamp is None:
            continue
        rows.append(
            {
                "station_name": _strip_html(match.group("station_name")),
                "district": _strip_html(match.group("district")),
                "value": value,
                "timestamp": timestamp,
                "source": "publicinfobanjir.rainfall",
            }
        )
    return rows


def _score_row(row: dict[str, Any], terms: list[str]) -> int:
    station = _normalize_text(row["station_name"])
    district = _normalize_text(row["district"])
    score = 0

    for term in terms:
        if not term:
            continue
        if term in station:
            score = max(score, 100 + len(term))
        elif term in district:
            score = max(score, 70 + len(term))
        else:
            tokens = [token for token in term.split() if len(token) >= 3]
            token_hits = sum(1 for token in tokens if token in station or token in district)
            score = max(score, token_hits * 10)

    return score


def _terms_for_sensor(sensor: dict[str, Any], hints: dict[str, list[str]]) -> list[str]:
    location = _normalize_text(sensor.get("location", ""))
    name = _normalize_text(sensor.get("name", ""))
    terms = {location, name}

    for hint_key, hint_values in hints.items():
        if _normalize_text(hint_key) != location:
            continue
        for hint in hint_values:
            terms.add(_normalize_text(hint))

    return [term for term in terms if len(term) >= 3]


def _pick_best_row(sensor: dict[str, Any], rows: list[dict[str, Any]], hints: dict[str, list[str]]) -> dict[str, Any] | None:
    terms = _terms_for_sensor(sensor, hints)
    if not terms:
        return None

    best_row: dict[str, Any] | None = None
    best_score = 0
    for row in rows:
        score = _score_row(row, terms)
        if score <= 0:
            continue
        if best_row is None or score > best_score:
            best_row = row
            best_score = score
        elif score == best_score and row["timestamp"] > best_row["timestamp"]:
            best_row = row
    return best_row


def _simulate_sensor_value(sensor_type: str, now_utc: datetime) -> float:
    if sensor_type == "rain":
        if random.random() < 0.75:
            return 0.0
        return round(random.uniform(0.5, 40.0), 1)
    if sensor_type == "water_level":
        return round(2.3 + random.uniform(-0.35, 0.35), 2)

    # temperature fallback
    local_hour = (now_utc + timedelta(hours=8)).hour
    curve = 28 + 3 * math.sin((local_hour - 14) / 24 * 2 * math.pi)
    return round(curve + random.uniform(-0.7, 0.7), 1)


def _forecast_temperature_for_location(location: str) -> float | None:
    location_key = _normalize_text(location)
    queries = [location]
    queries.extend(_TEMP_LOCATION_HINTS.get(location_key, []))

    for query in queries:
        encoded = urllib.parse.quote(f"{query}@location__location_name")
        url = WEATHER_FORECAST_URL.format(query=encoded)
        try:
            payload = _fetch_json(url)
        except Exception:
            continue

        if not isinstance(payload, list) or not payload:
            continue

        first = payload[0]
        min_temp = first.get("min_temp")
        max_temp = first.get("max_temp")
        if min_temp is None or max_temp is None:
            continue

        min_temp = float(min_temp)
        max_temp = float(max_temp)
        if max_temp < min_temp:
            min_temp, max_temp = max_temp, min_temp

        local_hour = (datetime.utcnow() + timedelta(hours=8)).hour
        day_curve = 0.5 + 0.5 * math.sin((local_hour - 14) / 24 * 2 * math.pi)
        return round(min_temp + (max_temp - min_temp) * day_curve, 1)

    return None


def _pick_external_value(
    sensor: dict[str, Any],
    water_rows: list[dict[str, Any]],
    rain_rows: list[dict[str, Any]],
    now_local: datetime,
) -> dict[str, Any] | None:
    sensor_type = sensor.get("type")
    if sensor_type == "rain":
        match = _pick_best_row(sensor, rain_rows, _RAIN_HINTS)
    elif sensor_type == "water_level":
        match = _pick_best_row(sensor, water_rows, _WATER_HINTS)
    else:
        match = None

    if not match:
        return None

    age = now_local - match["timestamp"]
    if age > EXTERNAL_STALE_AFTER:
        return None

    return match


def build_sensor_readings(sensors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Build readings from external sources when available, then fall back to simulation.
    Returned timestamps are naive datetimes:
    - external water/rain timestamps are Malaysia local time (as provided by source)
    - fallback and temperature forecast use current UTC
    """
    water_rows: list[dict[str, Any]] = []
    rain_rows: list[dict[str, Any]] = []

    try:
        water_rows = _parse_water_rows(_fetch_text(WATER_LEVEL_URL))
    except Exception:
        water_rows = []

    try:
        rain_rows = _parse_rain_rows(_fetch_text(RAINFALL_URL))
    except Exception:
        rain_rows = []

    now_utc = datetime.utcnow()
    now_local = now_utc + timedelta(hours=8)
    readings: list[dict[str, Any]] = []

    for sensor in sensors:
        sensor_type = sensor.get("type")
        source = "simulated.fallback"
        timestamp = now_utc
        value: float | None = None

        if sensor_type in {"rain", "water_level"}:
            external = _pick_external_value(sensor, water_rows, rain_rows, now_local)
            if external:
                value = external["value"]
                timestamp = external["timestamp"]
                source = external["source"]

        elif sensor_type == "temperature":
            forecast_temp = _forecast_temperature_for_location(sensor.get("location", ""))
            if forecast_temp is not None:
                value = forecast_temp
                source = "data.gov.my.weather_forecast"

        if value is None:
            value = _simulate_sensor_value(sensor_type, now_utc)

        readings.append(
            {
                "sensor_id": sensor["_id"],
                "sensor_name": sensor.get("name"),
                "location": sensor.get("location"),
                "type": sensor_type,
                "value": value,
                "unit": sensor.get("unit"),
                "timestamp": timestamp,
                "source": source,
            }
        )

    return readings


# ---------------------------------------------------------------------------
# New Selangor JPS ingestion (rain + water level) using public JSON API
# ---------------------------------------------------------------------------

def _parse_selangor_time(text: str) -> datetime | None:
    if not text:
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _parse_selangor_date(text: str) -> datetime | None:
    if not text:
        return None
    try:
        # Daily history is date-only; store at local midnight.
        return datetime.strptime(text, "%d/%m/%Y")
    except ValueError:
        return None


def _parse_iso_datetime(text: str) -> datetime | None:
    if not text:
        return None

    normalized = str(text).strip()
    if not normalized:
        return None

    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return _parse_selangor_time(normalized)

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


async def _ensure_sensor(
    db: AsyncIOMotorDatabase,
    *,
    external_id: str,
    name: str,
    location: str,
    sensor_type: str,
    unit: str,
    latitude: float | None,
    longitude: float | None,
) -> Any:
    existing = await db.sensors.find_one({"external_id": external_id, "type": sensor_type})
    if existing:
        return existing["_id"]

    doc = {
        "name": name,
        "type": sensor_type,
        "location": location,
        "unit": unit,
        "latitude": latitude,
        "longitude": longitude,
        "is_active": True,
        "external_id": external_id,
    }
    result = await db.sensors.insert_one(doc)
    return result.inserted_id


async def _fetch_station_details(url_template: str, station_numeric_id: int) -> tuple[float | None, float | None]:
    url = url_template.format(id=station_numeric_id)
    try:
        payload = _fetch_json(url)
    except Exception:
        return None, None

    lat = _safe_float(payload.get("latitude"))
    lon = _safe_float(payload.get("longitude"))
    return lat, lon


async def fetch_selangor_readings(db: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    """Fetch latest Selangor rainfall + river level readings and ensure sensors exist.

    Returns list of reading documents ready for persistence.
    """
    readings: list[dict[str, Any]] = []

    # Rainfall
    try:
        rain_payload = _fetch_json(RF_DATA_URL)
        rain_stations = rain_payload.get("stations", []) if isinstance(rain_payload, dict) else []
    except Exception:
        rain_stations = []

    for station in rain_stations:
        station_numeric_id = station.get("id")
        ext_id = str(station.get("stationId"))
        if not ext_id or station_numeric_id is None:
            continue

        name = station.get("stationName", "")
        location = station.get("districtName", "")
        ts = _parse_selangor_time(station.get("lastUpdate")) or datetime.utcnow()
        value = _safe_float(station.get("hourlyRainfall"))
        if value is None:
            continue

        # Lat/lon would require per-station detail calls; skip for speed
        sensor_id = await _ensure_sensor(
            db,
            external_id=ext_id,
            name=name,
            location=location,
            sensor_type="rain",
            unit="mm/h",
            latitude=None,
            longitude=None,
        )

        readings.append(
            {
                "sensor_id": sensor_id,
                "sensor_name": name,
                "location": location,
                "type": "rain",
                "value": value,
                "unit": "mm/h",
                "timestamp": ts,
                "source": "selangor.api.rainfall",
            }
        )

        # Persist 7-day rainfall history if available.
        history_rows = station.get("previousReadings") or []
        if isinstance(history_rows, list):
            for row in history_rows:
                if not isinstance(row, dict):
                    continue
                hist_ts = _parse_selangor_date(row.get("dataDate"))
                hist_value = _safe_float(row.get("dailyRainfall"))
                if hist_ts is None or hist_value is None:
                    continue
                readings.append(
                    {
                        "sensor_id": sensor_id,
                        "sensor_name": name,
                        "location": location,
                        "type": "rain",
                        "value": hist_value,
                        "unit": "mm/h",
                        "timestamp": hist_ts,
                        "source": "selangor.api.rainfall_daily",
                    }
                )

    # Water level
    try:
        wl_payload = _fetch_json(WL_DATA_URL)
        wl_stations = wl_payload.get("stations", []) if isinstance(wl_payload, dict) else []
    except Exception:
        wl_stations = []

    for station in wl_stations:
        station_numeric_id = station.get("id")
        ext_id = str(station.get("stationId"))
        if not ext_id or station_numeric_id is None:
            continue

        name = station.get("stationName", "")
        location = station.get("districtName", "")
        ts = _parse_selangor_time(station.get("lastUpdate")) or datetime.utcnow()
        value = _safe_float(station.get("waterLevel"))
        if value is None:
            continue

        sensor_id = await _ensure_sensor(
            db,
            external_id=ext_id,
            name=name,
            location=location,
            sensor_type="water_level",
            unit="m",
            latitude=None,
            longitude=None,
        )

        readings.append(
            {
                "sensor_id": sensor_id,
                "sensor_name": name,
                "location": location,
                "type": "water_level",
                "value": value,
                "unit": "m",
                "timestamp": ts,
                "source": "selangor.api.water_level",
            }
        )

    return readings


async def fetch_selangor_water_level_history_for_sensor(
    sensor: dict[str, Any],
    *,
    hours: int = 168,
) -> list[dict[str, Any]]:
    """Fetch historical water-level points for one Selangor station sensor."""
    if sensor.get("type") != "water_level":
        return []

    external_id = str(sensor.get("external_id") or "").strip()
    if not external_id:
        return []

    try:
        wl_payload = _fetch_json(WL_DATA_URL)
        wl_stations = wl_payload.get("stations", []) if isinstance(wl_payload, dict) else []
    except Exception:
        return []

    station = None
    for item in wl_stations:
        if str(item.get("stationId")) == external_id:
            station = item
            break

    if not station:
        return []

    station_numeric_id = station.get("id")
    if station_numeric_id is None:
        return []

    try:
        history_rows = _fetch_json(WL_HISTORY_URL.format(id=station_numeric_id))
    except Exception:
        return []

    if not isinstance(history_rows, list):
        return []

    cutoff = datetime.utcnow() - timedelta(hours=max(1, int(hours)))
    by_timestamp: dict[str, dict[str, Any]] = {}

    def _add_point(ts: datetime | None, value: float | None, source: str) -> None:
        if ts is None or value is None or ts < cutoff:
            return
        key = ts.isoformat()
        by_timestamp[key] = {
            "sensor_id": sensor["_id"],
            "sensor_name": sensor.get("name"),
            "location": sensor.get("location"),
            "type": "water_level",
            "value": value,
            "unit": sensor.get("unit") or "m",
            "timestamp": ts,
            "source": source,
        }

    for row in history_rows:
        if not isinstance(row, dict):
            continue
        _add_point(
            _parse_iso_datetime(row.get("dateTime")),
            _safe_float(row.get("waterLevel1")),
            "selangor.api.water_level_history",
        )

    _add_point(
        _parse_selangor_time(station.get("lastUpdate")),
        _safe_float(station.get("waterLevel")),
        "selangor.api.water_level",
    )

    readings = list(by_timestamp.values())
    readings.sort(key=lambda item: item["timestamp"])
    return readings
