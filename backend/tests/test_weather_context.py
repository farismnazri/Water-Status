import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

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
                "2026-03-18T10:00",
                "2026-03-18T11:00",
                "2026-03-18T12:00",
                "2026-03-18T13:00",
                "2026-03-18T14:00",
                "2026-03-18T15:00",
                "2026-03-18T16:00",
                "2026-03-18T17:00",
                "2026-03-18T18:00",
                "2026-03-18T19:00",
                "2026-03-18T20:00",
                "2026-03-18T21:00",
            ],
            "precipitation_probability": [30, 40, 55, 70, 60, 20, 10, 0, 0, 5, 10, 15],
            "rain": [0.0, 0.2, 0.4, 1.1, 0.8, 0.3, 0.0, 0.0, 0.0, 0.1, 0.1, 0.0],
            "wind_speed_10m": [wind, wind + 2, wind + 4, wind + 5, wind + 3, wind + 1, wind, wind, wind, wind + 1, wind + 2, wind + 1],
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


class WeatherContextTests(unittest.TestCase):
    def setUp(self):
        weather_context._reset_forecast_cache()

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

        def fake_fetch(coords):
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


class SensorIngestTests(unittest.TestCase):
    def setUp(self):
        weather_context._reset_forecast_cache()

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
            payload = await main.get_weather_forecast_summaries("sensor-b,missing,sensor-a")

        self.assertEqual(
            [item["sensor_id"] for item in payload["summaries"]],
            ["sensor-b", "missing", "sensor-a"],
        )
        self.assertEqual(payload["summaries"][0]["status"], "ok")
        self.assertEqual(payload["summaries"][1]["status"], "unavailable")
        self.assertEqual(payload["summaries"][2]["current"]["temperature_2m"], 31.6)


if __name__ == "__main__":
    unittest.main()
