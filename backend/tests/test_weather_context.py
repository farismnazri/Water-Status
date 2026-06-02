import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

os.environ.setdefault("SENSOR_INGEST_ENABLED", "0")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main, sensor_ingest, weather_context


def make_forecast_payload(
    *,
    temperature: float,
    apparent_temperature: float,
    humidity: float,
    wind: float,
    weather_code: int,
) -> dict:
    return {
        "current": {
            "time": "2026-03-18T10:00",
            "temperature_2m": temperature,
            "apparent_temperature": apparent_temperature,
            "relative_humidity_2m": humidity,
            "weather_code": weather_code,
            "wind_speed_10m": wind,
            "is_day": 1,
        },
        "hourly": {
            "time": [
                "2026-03-18T04:00",
                "2026-03-18T05:00",
                "2026-03-18T06:00",
                "2026-03-18T07:00",
                "2026-03-18T08:00",
                "2026-03-18T09:00",
                "2026-03-18T10:00",
                "2026-03-18T11:00",
                "2026-03-18T12:00",
                "2026-03-18T13:00",
                "2026-03-18T14:00",
                "2026-03-18T15:00",
                "2026-03-18T16:00",
            ],
            "temperature_2m": [
                temperature - 0.6,
                temperature - 0.5,
                temperature - 0.4,
                temperature - 0.3,
                temperature - 0.2,
                temperature - 0.1,
                temperature,
                temperature + 0.2,
                temperature + 0.3,
                temperature + 0.4,
                temperature + 0.1,
                temperature - 0.1,
                temperature - 0.2,
            ],
            "precipitation_probability": [10, 15, 20, 25, 30, 35, 30, 40, 55, 70, 60, 20, 10],
            "precipitation": [0.0, 0.1, 0.2, 0.2, 0.1, 0.0, 0.0, 0.3, 0.7, 1.6, 1.1, 0.4, 0.1],
            "rain": [0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.0, 0.2, 0.4, 1.1, 0.8, 0.3, 0.0],
            "wind_speed_10m": [wind - 1, wind, wind + 1, wind + 1, wind + 2, wind + 1, wind, wind + 2, wind + 4, wind + 5, wind + 3, wind + 1, wind],
        },
        "minutely_15": {
            "time": [
                "2026-03-18T10:00",
                "2026-03-18T10:15",
                "2026-03-18T10:30",
                "2026-03-18T10:45",
            ],
            "temperature_2m": [temperature, temperature + 0.1, temperature + 0.2, temperature + 0.1],
            "precipitation_probability": [30, 40, 55, 70],
            "precipitation": [0.0, 0.3, 0.6, 1.4],
            "rain": [0.0, 0.2, 0.4, 1.1],
        },
        "daily": {
            "time": ["2026-03-18", "2026-03-19", "2026-03-20"],
            "weather_code": [weather_code, 3, 61],
            "temperature_2m_max": [32.1, 31.0, 30.5],
            "temperature_2m_min": [24.4, 24.1, 23.9],
            "precipitation_probability_max": [75, 40, 60],
            "rain_sum": [3.2, 1.1, 4.8],
        },
    }


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)
        self._index = 0

    async def to_list(self, length=None):
        if length is None:
            return list(self.docs)
        return list(self.docs[:length])

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self.docs):
            raise StopAsyncIteration
        value = self.docs[self._index]
        self._index += 1
        return value


class FakeCollection:
    def __init__(self, docs):
        self.docs = list(docs)

    def _matches(self, doc, query=None):
        for key, value in (query or {}).items():
            doc_value = doc.get(key)
            if isinstance(value, dict):
                if "$in" in value and doc_value not in value["$in"]:
                    return False
                continue
            if doc_value != value:
                return False
        return True

    def find(self, query=None):
        return FakeCursor([doc for doc in self.docs if self._matches(doc, query)])

    async def find_one(self, query=None, projection=None, sort=None):
        matches = [doc for doc in self.docs if self._matches(doc, query)]
        return matches[0] if matches else None

    async def insert_one(self, doc):
        inserted = dict(doc)
        inserted.setdefault("_id", str(uuid4()))
        self.docs.append(inserted)
        return SimpleNamespace(inserted_id=inserted["_id"])

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if not self._matches(doc, query):
                continue
            next_doc = dict(doc)
            next_doc.update(update.get("$set", {}))
            self.docs[index] = next_doc
            return SimpleNamespace(matched_count=1, modified_count=1)

        if upsert:
            new_doc = dict(update.get("$set", {}))
            new_doc.setdefault("_id", str(uuid4()))
            self.docs.append(new_doc)
            return SimpleNamespace(matched_count=1, modified_count=1)

        return SimpleNamespace(matched_count=0, modified_count=0)


def make_request(client_ip: str = "198.51.100.10", forwarded_for: str | None = None):
    headers = {}
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=client_ip))


class WeatherContextTests(unittest.TestCase):
    def setUp(self):
        weather_context._reset_forecast_cache()
        main._reset_weather_rate_limit_state()
        main._reset_location_reverse_geocode_cache()

    def test_batches_nearby_coordinates_and_reuses_cache(self):
        sensors = [
            {
                "_id": "sensor-a",
                "location": "KLCC",
                "latitude": 3.15631,
                "longitude": 101.71171,
            },
            {
                "_id": "sensor-b",
                "location": "KLCC Annex",
                "latitude": 3.15634,
                "longitude": 101.71174,
            },
            {
                "_id": "sensor-c",
                "location": "Putrajaya",
                "latitude": 2.92600,
                "longitude": 101.69600,
            },
        ]

        fetch_calls = []

        def fake_fetch(coords, *_, **__):
            fetch_calls.append(coords)
            return [
                make_forecast_payload(
                    temperature=31.6,
                    apparent_temperature=35.1,
                    humidity=72,
                    wind=9,
                    weather_code=2,
                ),
                make_forecast_payload(
                    temperature=29.4,
                    apparent_temperature=32.0,
                    humidity=76,
                    wind=12,
                    weather_code=61,
                ),
            ]

        with patch.object(weather_context, "_fetch_open_meteo_payloads", side_effect=fake_fetch):
            first = weather_context.get_forecast_summaries(sensors)
            second = weather_context.get_forecast_summaries(sensors)

        self.assertEqual(len(fetch_calls), 1)
        self.assertEqual(len(fetch_calls[0]), 2)
        self.assertEqual(first[0]["status"], "ok")
        self.assertEqual(first[1]["status"], "ok")
        self.assertEqual(first[0]["current"]["temperature_2m"], 31.6)
        self.assertEqual(first[1]["current"]["temperature_2m"], 31.6)
        self.assertEqual(second[2]["current"]["temperature_2m"], 29.4)

    def test_missing_coordinates_returns_unavailable(self):
        summaries = weather_context.get_forecast_summaries(
            [{"_id": "sensor-a", "location": "Unknown", "latitude": None, "longitude": None}]
        )

        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["status"], "unavailable")
        self.assertIsNone(summaries[0]["current"])

    def test_fetch_errors_return_error_status(self):
        sensors = [
            {
                "_id": "sensor-a",
                "location": "KLCC",
                "latitude": 3.15631,
                "longitude": 101.71171,
            }
        ]

        with patch.object(
            weather_context,
            "_fetch_open_meteo_payloads",
            side_effect=RuntimeError("network down"),
        ):
            summaries = weather_context.get_forecast_summaries(sensors)

        self.assertEqual(summaries[0]["status"], "error")
        self.assertIsNone(summaries[0]["current"])

    def test_location_context_uses_raw_coordinates_and_builds_map_frames(self):
        fetch_calls = []

        def fake_fetch(coords, *_, **__):
            fetch_calls.append(coords)
            return [
                make_forecast_payload(
                    temperature=29.8 + index,
                    apparent_temperature=33.0 + index,
                    humidity=74,
                    wind=10 + index,
                    weather_code=61 if index % 2 == 0 else 2,
                )
                for index, _ in enumerate(coords)
            ]

        with patch.object(weather_context, "_fetch_open_meteo_payloads", side_effect=fake_fetch):
            context = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)

        self.assertEqual(len(fetch_calls), 1)
        self.assertEqual(len(fetch_calls[0]), 9)
        self.assertEqual(context["status"], "ok")
        self.assertEqual(len(context["next_hour_30m"]), 2)
        self.assertEqual(len(context["hourly_timeline"]), 13)
        self.assertEqual(context["hourly_timeline"][6]["offset_hours"], 0)
        self.assertEqual(context["hourly_timeline"][6]["precipitation_amount"], 0.0)
        self.assertEqual(len(context["map"]["samples"]), 9)
        self.assertEqual(len(context["map"]["frames"]), 6)
        self.assertEqual(context["map"]["frames"][0]["label"], "Now")
        self.assertEqual(len(context["map"]["frames"][0]["samples"]), 9)

    def test_location_context_reuses_cache_for_same_coordinates(self):
        fetch_calls = []

        def fake_fetch(coords, *_, **__):
            fetch_calls.append(coords)
            return [
                make_forecast_payload(
                    temperature=31.0 + index,
                    apparent_temperature=34.0 + index,
                    humidity=70,
                    wind=9,
                    weather_code=2,
                )
                for index, _ in enumerate(coords)
            ]

        with patch.object(weather_context, "_fetch_open_meteo_payloads", side_effect=fake_fetch):
            first = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)
            second = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)

        self.assertEqual(len(fetch_calls), 1)
        self.assertEqual(first["status"], "ok")
        self.assertEqual(second["status"], "ok")
        self.assertEqual(first["current"]["temperature_2m"], second["current"]["temperature_2m"])

    def test_location_context_reuses_stale_cache_when_refresh_fails(self):
        cached_payload = make_forecast_payload(
            temperature=30.2,
            apparent_temperature=33.7,
            humidity=73,
            wind=8,
            weather_code=2,
        )

        with patch.object(
            weather_context,
            "_fetch_open_meteo_payloads",
            return_value=[cached_payload for _ in range(9)],
        ):
            first = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)

        weather_context._forecast_cache = {
            coord_key: (0.0, payload)
            for coord_key, (_, payload) in weather_context._forecast_cache.items()
        }

        with patch.object(
            weather_context,
            "_fetch_open_meteo_payloads",
            side_effect=RuntimeError("network down"),
        ) as fetch_mock:
            second = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)

        self.assertEqual(fetch_mock.call_count, 1)
        self.assertEqual(first["status"], "ok")
        self.assertEqual(second["status"], "ok")
        self.assertEqual(second["current"]["temperature_2m"], 30.2)
        self.assertEqual(len(second["map"]["frames"]), 6)

    def test_location_context_caches_error_payload_briefly(self):
        with patch.object(
            weather_context,
            "_fetch_open_meteo_payloads",
            side_effect=RuntimeError("network down"),
        ) as fetch_mock:
            first = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)
            first_call_count = fetch_mock.call_count
            second = weather_context.get_location_forecast_context(3.1563, 101.7117, 8)

        self.assertGreater(first_call_count, 1)
        self.assertEqual(fetch_mock.call_count, first_call_count)
        self.assertEqual(first["status"], "error")
        self.assertEqual(second["status"], "error")

    def test_location_context_recovers_center_forecast_when_batch_fetch_fails(self):
        center_payload = make_forecast_payload(
            temperature=30.2,
            apparent_temperature=33.7,
            humidity=73,
            wind=8,
            weather_code=2,
        )

        def fake_fetch(coords, *_, **__):
            if len(coords) > 1:
                raise RuntimeError("batched upstream failure")

            latitude, longitude = coords[0]
            if round(latitude, 5) == 2.92640 and round(longitude, 5) == 101.69640:
                return [center_payload]

            raise RuntimeError("sample fetch failed")

        with patch.object(weather_context, "_fetch_open_meteo_payloads", side_effect=fake_fetch):
            context = weather_context.get_location_forecast_context(2.9264, 101.6964, 8)

        self.assertEqual(context["status"], "ok")
        self.assertEqual(context["current"]["temperature_2m"], 30.2)
        self.assertEqual(len(context["daily"]), 3)
        self.assertEqual(len(context["hourly_timeline"]), 13)
        self.assertEqual(len(context["map"]["frames"]), 6)
        first_frame_samples = context["map"]["frames"][0]["samples"]
        center_sample = next(sample for sample in first_frame_samples if sample["sample_id"] == "center")
        edge_sample = next(sample for sample in first_frame_samples if sample["sample_id"] == "north-west")
        self.assertEqual(center_sample["temperature_2m"], 30.2)
        self.assertIsNone(edge_sample["temperature_2m"])


class SensorIngestTests(unittest.TestCase):
    def setUp(self):
        weather_context._reset_forecast_cache()
        main._reset_weather_rate_limit_state()

    def test_temperature_fallback_prefers_open_meteo(self):
        sensor = {
            "_id": "temp-1",
            "name": "Temp One",
            "type": "temperature",
            "location": "Subang",
            "unit": "C",
            "latitude": 3.07,
            "longitude": 101.58,
        }

        with (
            patch.object(sensor_ingest, "_fetch_text", side_effect=RuntimeError("skip")),
            patch.object(
                sensor_ingest,
                "get_forecast_summaries",
                return_value=[
                    {
                        "sensor_id": "temp-1",
                        "status": "ok",
                        "source": "open-meteo.forecast",
                        "current": {"temperature_2m": 30.5},
                    }
                ],
            ),
            patch.object(
                sensor_ingest,
                "_forecast_temperature_for_location",
                return_value=27.2,
            ),
        ):
            readings = sensor_ingest.build_sensor_readings([sensor])

        self.assertEqual(readings[0]["value"], 30.5)
        self.assertEqual(readings[0]["source"], "open-meteo.forecast")


class ForecastEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        weather_context._reset_forecast_cache()
        main._reset_weather_rate_limit_state()

    async def test_forecast_endpoint_keeps_requested_order_and_placeholders(self):
        fake_db = SimpleNamespace(
            sensors=FakeCollection(
                [
                    {
                        "_id": "sensor-a",
                        "name": "KLCC Temp",
                        "type": "temperature",
                        "location": "KLCC",
                        "unit": "C",
                        "latitude": 3.1563,
                        "longitude": 101.7117,
                        "is_active": True,
                    },
                    {
                        "_id": "sensor-b",
                        "name": "Putrajaya Temp",
                        "type": "temperature",
                        "location": "Putrajaya",
                        "unit": "C",
                        "latitude": 2.9260,
                        "longitude": 101.6960,
                        "is_active": True,
                    },
                ]
            ),
            sensor_readings=FakeCollection([]),
        )

        with (
            patch.object(main, "db", fake_db),
            patch.object(
                main,
                "get_forecast_summaries",
                return_value=[
                    {
                        "sensor_id": "sensor-a",
                        "location": "KLCC",
                        "latitude": 3.1563,
                        "longitude": 101.7117,
                        "status": "ok",
                        "source": "open-meteo.forecast",
                        "generated_at": "2026-03-18T10:00:00+00:00",
                        "current": {"temperature_2m": 31.6},
                        "next_6h": {"max_precipitation_probability": 70},
                        "next_12h": {"max_precipitation_probability": 80},
                        "daily": [],
                    },
                    {
                        "sensor_id": "sensor-b",
                        "location": "Putrajaya",
                        "latitude": 2.9260,
                        "longitude": 101.6960,
                        "status": "ok",
                        "source": "open-meteo.forecast",
                        "generated_at": "2026-03-18T10:00:00+00:00",
                        "current": {"temperature_2m": 29.4},
                        "next_6h": {"max_precipitation_probability": 55},
                        "next_12h": {"max_precipitation_probability": 60},
                        "daily": [],
                    },
                ],
            ),
        ):
            payload = await main.get_weather_forecast_summaries(
                make_request(),
                "sensor-b,missing,sensor-a",
            )

        self.assertEqual(
            [item["sensor_id"] for item in payload["summaries"]],
            ["sensor-b", "missing", "sensor-a"],
        )
        self.assertEqual(payload["summaries"][0]["status"], "ok")
        self.assertEqual(payload["summaries"][1]["status"], "unavailable")
        self.assertEqual(payload["summaries"][2]["current"]["temperature_2m"], 31.6)

    async def test_location_context_endpoint_wraps_forecast_and_location_metadata(self):
        with patch.object(
            main,
            "get_location_forecast_context",
            return_value={
                "status": "ok",
                "source": "open-meteo.forecast",
                "generated_at": "2026-03-18T10:00:00+00:00",
                "current": {"temperature_2m": 30.2},
                "next_6h": {"max_precipitation_probability": 65},
                "daily": [],
                "next_hour_30m": [
                    {
                        "start": "2026-03-18T10:00",
                        "end": "2026-03-18T10:30",
                        "rain_amount": 0.2,
                        "precipitation_probability": 35,
                    }
                ],
                "hourly_timeline": [
                    {
                        "time": "2026-03-18T10:00",
                        "offset_hours": 0,
                        "rain_amount": 0.2,
                        "precipitation_amount": 0.3,
                        "precipitation_probability": 35,
                        "temperature_2m": 30.2,
                    }
                ],
                "map": {
                    "radius_km": 8,
                    "samples": [{"id": "center", "latitude": 3.1563, "longitude": 101.7117}],
                    "frames": [],
                },
            },
        ), patch.object(
            main,
            "_load_sensor_docs_or_fallback",
            return_value=[
                {
                    "_id": "sensor-a",
                    "location": "KLCC",
                    "latitude": 3.1563,
                    "longitude": 101.7117,
                }
            ],
        ), patch.object(
            main,
            "_reverse_geocode_locality_label",
            return_value=None,
        ):
            payload = await main.get_weather_location_context(
                request=make_request(),
                latitude=3.1563,
                longitude=101.7117,
                radius_km=8,
                label=None,
                mode="gps",
            )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["location"]["label"], "KLCC")
        self.assertEqual(payload["location"]["mode"], "gps")
        self.assertEqual(payload["current"]["temperature_2m"], 30.2)
        self.assertEqual(payload["map"]["radius_km"], 8)

    async def test_location_context_endpoint_caps_radius_to_100km(self):
        context_calls = []

        def fake_context(latitude, longitude, radius_km):
            context_calls.append((latitude, longitude, radius_km))
            return {
                "status": "ok",
                "source": "open-meteo.forecast",
                "generated_at": "2026-03-18T10:00:00+00:00",
                "current": {"temperature_2m": 30.2},
                "next_6h": {"max_precipitation_probability": 65},
                "daily": [],
                "next_hour_30m": [],
                "hourly_timeline": [],
                "map": {"radius_km": radius_km, "samples": [], "frames": []},
            }

        with patch.object(
            main,
            "get_location_forecast_context",
            side_effect=fake_context,
        ), patch.object(
            main,
            "_load_sensor_docs_or_fallback",
            return_value=[],
        ):
            payload = await main.get_weather_location_context(
                request=make_request(),
                latitude=3.1563,
                longitude=101.7117,
                radius_km=180,
                label="KLCC",
                mode="manual",
            )

        self.assertEqual(context_calls[0][2], 100)
        self.assertEqual(payload["map"]["radius_km"], 100)

    async def test_location_context_endpoint_prefers_reverse_geocode_label_for_gps(self):
        with patch.object(
            main,
            "get_location_forecast_context",
            return_value={
                "status": "ok",
                "source": "open-meteo.forecast",
                "generated_at": "2026-03-18T10:00:00+00:00",
                "current": {"temperature_2m": 30.2},
                "next_6h": {"max_precipitation_probability": 65},
                "daily": [],
                "next_hour_30m": [],
                "hourly_timeline": [],
                "map": {"radius_km": 8, "samples": [], "frames": []},
            },
        ), patch.object(
            main,
            "_load_sensor_docs_or_fallback",
            return_value=[
                {
                    "_id": "sensor-a",
                    "location": "Gombak",
                    "latitude": 3.249,
                    "longitude": 101.730,
                }
            ],
        ), patch.object(
            main,
            "_reverse_geocode_locality_label",
            return_value="Kajang",
        ):
            payload = await main.get_weather_location_context(
                request=make_request(),
                latitude=2.996,
                longitude=101.790,
                radius_km=8,
                label="Sepang",
                mode="gps",
            )

        self.assertEqual(payload["location"]["label"], "Kajang")

    async def test_location_context_endpoint_falls_back_when_reverse_geocode_missing(self):
        with patch.object(
            main,
            "get_location_forecast_context",
            return_value={
                "status": "ok",
                "source": "open-meteo.forecast",
                "generated_at": "2026-03-18T10:00:00+00:00",
                "current": {"temperature_2m": 30.2},
                "next_6h": {"max_precipitation_probability": 65},
                "daily": [],
                "next_hour_30m": [],
                "hourly_timeline": [],
                "map": {"radius_km": 8, "samples": [], "frames": []},
            },
        ), patch.object(
            main,
            "_load_sensor_docs_or_fallback",
            return_value=[
                {
                    "_id": "sensor-a",
                    "location": "Gombak",
                    "latitude": 3.249,
                    "longitude": 101.730,
                }
            ],
        ), patch.object(
            main,
            "_reverse_geocode_locality_label",
            return_value=None,
        ):
            payload = await main.get_weather_location_context(
                request=make_request(),
                latitude=2.996,
                longitude=101.790,
                radius_km=8,
                label="Sepang",
                mode="gps",
            )

        self.assertEqual(payload["location"]["label"], "Sepang")

    async def test_location_context_endpoint_returns_429_after_limit(self):
        request = make_request("203.0.113.5")
        context_payload = {
            "status": "ok",
            "source": "open-meteo.forecast",
            "generated_at": "2026-03-18T10:00:00+00:00",
            "current": {"temperature_2m": 30.2},
            "next_6h": {"max_precipitation_probability": 65},
            "daily": [],
            "next_hour_30m": [],
            "hourly_timeline": [],
            "map": {"radius_km": 8, "samples": [], "frames": []},
        }

        with (
            patch.object(main.time, "monotonic", return_value=1_000.0),
            patch.object(main, "_load_sensor_docs_or_fallback", return_value=[]),
            patch.object(main, "get_location_forecast_context", return_value=context_payload),
            patch.object(main, "_reverse_geocode_locality_label", return_value=None),
        ):
            for _ in range(main.WEATHER_RATE_LIMITS["location-context"]):
                payload = await main.get_weather_location_context(
                    request=request,
                    latitude=3.1563,
                    longitude=101.7117,
                    radius_km=8,
                    label="KLCC",
                    mode="gps",
                )
                self.assertEqual(payload["status"], "ok")

            with self.assertRaises(HTTPException) as raised:
                await main.get_weather_location_context(
                    request=request,
                    latitude=3.1563,
                    longitude=101.7117,
                    radius_km=8,
                    label="KLCC",
                    mode="gps",
                )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], "300")
        self.assertEqual(raised.exception.detail["retry_after_seconds"], 300)

    async def test_forecast_summaries_endpoint_returns_429_after_limit(self):
        fake_db = SimpleNamespace(
            sensors=FakeCollection(
                [
                    {
                        "_id": "sensor-a",
                        "name": "KLCC Temp",
                        "type": "temperature",
                        "location": "KLCC",
                        "unit": "C",
                        "latitude": 3.1563,
                        "longitude": 101.7117,
                        "is_active": True,
                    }
                ]
            ),
            sensor_readings=FakeCollection([]),
        )

        with (
            patch.object(main.time, "monotonic", return_value=2_000.0),
            patch.object(main, "db", fake_db),
            patch.object(
                main,
                "get_forecast_summaries",
                return_value=[
                    {
                        "sensor_id": "sensor-a",
                        "location": "KLCC",
                        "latitude": 3.1563,
                        "longitude": 101.7117,
                        "status": "ok",
                        "source": "open-meteo.forecast",
                        "generated_at": "2026-03-18T10:00:00+00:00",
                        "current": {"temperature_2m": 31.6},
                        "next_6h": {"max_precipitation_probability": 70},
                        "next_12h": {"max_precipitation_probability": 80},
                        "daily": [],
                    }
                ],
            ),
        ):
            for _ in range(main.WEATHER_RATE_LIMITS["forecast-summaries"]):
                payload = await main.get_weather_forecast_summaries(
                    make_request("203.0.113.6"),
                    "sensor-a",
                )
                self.assertEqual(payload["summaries"][0]["status"], "ok")

            with self.assertRaises(HTTPException) as raised:
                await main.get_weather_forecast_summaries(
                    make_request("203.0.113.6"),
                    "sensor-a",
                )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], "300")
        self.assertEqual(raised.exception.detail["retry_after_seconds"], 300)


if __name__ == "__main__":
    unittest.main()
