import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

os.environ.setdefault("SENSOR_INGEST_ENABLED", "0")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main


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
            if doc.get(key) != value:
                return False
        return True

    def find(self, query=None):
        filtered = [doc for doc in self.docs if self._matches(doc, query)]
        return FakeCursor(filtered)

    async def find_one(self, query=None, projection=None, sort=None):
        filtered = [doc for doc in self.docs if self._matches(doc, query)]
        if not filtered:
            return None
        return filtered[0]

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
            if "$set" in update:
                next_doc.update(update["$set"])
            else:
                next_doc.update(update)
            next_doc.setdefault("_id", doc.get("_id", str(uuid4())))
            self.docs[index] = next_doc
            return SimpleNamespace(matched_count=1, modified_count=1)

        if upsert:
            new_doc = dict(update.get("$set", {}))
            new_doc.setdefault("_id", str(uuid4()))
            self.docs.append(new_doc)
            return SimpleNamespace(matched_count=1, modified_count=1)

        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        return SimpleNamespace(deleted_count=before - len(self.docs))


class HomePreviewTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        main._reset_home_preview_cache()

    async def test_latest_readings_by_sensor_from_docs_picks_newest_timestamp(self):
        latest = main._latest_readings_by_sensor_from_docs(
            [
                {
                    "_id": "reading-1",
                    "sensor_id": "sensor-a",
                    "timestamp": "2026-03-18T08:00:00+00:00",
                    "value": 1.2,
                },
                {
                    "_id": "reading-2",
                    "sensor_id": "sensor-a",
                    "timestamp": "2026-03-18T09:00:00+00:00",
                    "value": 3.4,
                },
                {
                    "_id": "reading-3",
                    "sensor_id": "sensor-b",
                    "timestamp": "2026-03-18T07:00:00+00:00",
                    "value": 28.1,
                },
            ]
        )

        self.assertEqual(latest["sensor-a"]["value"], 3.4)
        self.assertEqual(latest["sensor-b"]["value"], 28.1)

    async def test_postgres_home_preview_backfills_missing_temperature_values(self):
        sensors = [
            {
                "_id": "rain-1",
                "name": "Rain One",
                "type": "rain",
                "location": "KL",
                "unit": "mm/h",
                "latitude": 3.1,
                "longitude": 101.7,
                "is_active": True,
            },
            {
                "_id": "river-1",
                "name": "River One",
                "type": "water_level",
                "location": "PJ",
                "unit": "m",
                "latitude": 3.11,
                "longitude": 101.62,
                "is_active": True,
            },
            {
                "_id": "temp-1",
                "name": "Temp One",
                "type": "temperature",
                "location": "Subang",
                "unit": "C",
                "latitude": 3.07,
                "longitude": 101.58,
                "is_active": True,
            },
        ]
        latest_by_sensor = {
            "rain-1": {
                "_id": "reading-rain",
                "sensor_id": "rain-1",
                "timestamp": "2026-03-18T10:00:00+00:00",
                "value": 4.8,
                "unit": "mm/h",
                "source": "official",
            },
            "river-1": {
                "_id": "reading-river",
                "sensor_id": "river-1",
                "timestamp": "2026-03-18T10:05:00+00:00",
                "value": 2.3,
                "unit": "m",
                "source": "official",
            },
        }
        generated_temp = [
            {
                "sensor_id": "temp-1",
                "timestamp": "2026-03-18T10:06:00+00:00",
                "value": 31.6,
                "unit": "C",
                "source": "simulated.fallback",
            }
        ]

        fake_db = SimpleNamespace(
            sensors=FakeCollection(sensors),
            sensor_readings=FakeCollection([]),
        )

        with (
            patch.object(main, "ACTIVE_BACKEND", "postgres"),
            patch.object(main, "db", fake_db),
            patch.object(
                main,
                "fetch_postgres_latest_sensor_readings",
                AsyncMock(return_value=latest_by_sensor),
            ),
            patch.object(main, "build_sensor_readings", return_value=generated_temp),
        ):
            payload = await main._load_home_preview_payload_uncached()

        self.assertEqual(len(payload["items"]), 3)
        by_id = {item["id"]: item for item in payload["items"]}
        self.assertEqual(by_id["rain-1"]["type"], "rain")
        self.assertEqual(by_id["river-1"]["type"], "water_level")
        self.assertEqual(by_id["temp-1"]["type"], "temperature")
        self.assertEqual(by_id["rain-1"]["value"], 4.8)
        self.assertEqual(by_id["temp-1"]["value"], 31.6)
        self.assertEqual(by_id["temp-1"]["source"], "simulated.fallback")

    async def test_home_preview_cache_respects_ttl(self):
        loader = AsyncMock(
            side_effect=[
                {"items": [{"id": "first"}], "generated_at": "2026-03-18T10:00:00+00:00"},
                {"items": [{"id": "second"}], "generated_at": "2026-03-18T10:00:16+00:00"},
            ]
        )

        with patch.object(main, "_load_home_preview_payload_uncached", loader):
            first = await main._get_home_preview_payload(monotonic_fn=lambda: 0.0)
            second = await main._get_home_preview_payload(monotonic_fn=lambda: 5.0)
            third = await main._get_home_preview_payload(monotonic_fn=lambda: 16.0)

        self.assertEqual(first["items"][0]["id"], "first")
        self.assertEqual(second["items"][0]["id"], "first")
        self.assertEqual(third["items"][0]["id"], "second")
        self.assertEqual(loader.await_count, 2)

    async def test_sqlite_home_preview_uses_generated_fallback_without_readings(self):
        sensors = [
            {
                "_id": "rain-1",
                "name": "Rain One",
                "type": "rain",
                "location": "KL",
                "unit": "mm/h",
                "latitude": 3.1,
                "longitude": 101.7,
                "is_active": True,
            }
        ]

        fake_db = SimpleNamespace(
            sensors=FakeCollection(sensors),
            sensor_readings=FakeCollection([]),
        )

        generated = [
            {
                "sensor_id": "rain-1",
                "timestamp": "2026-03-18T10:00:00+00:00",
                "value": 1.4,
                "unit": "mm/h",
                "source": "simulated",
            }
        ]

        with (
            patch.object(main, "ACTIVE_BACKEND", "sqlite"),
            patch.object(main, "db", fake_db),
            patch.object(main, "build_sensor_readings", return_value=generated),
        ):
            payload = await main._load_home_preview_payload_uncached()

        self.assertEqual(payload["items"][0]["id"], "rain-1")
        self.assertEqual(payload["items"][0]["value"], 1.4)
        self.assertEqual(payload["items"][0]["source"], "simulated")

    async def test_list_sensors_inserts_default_temperature_sensors_when_missing(self):
        fake_db = SimpleNamespace(
            sensors=FakeCollection(
                [
                    {
                        "_id": "rain-1",
                        "name": "Rain One",
                        "type": "rain",
                        "location": "KL",
                        "unit": "mm/h",
                        "latitude": 3.1,
                        "longitude": 101.7,
                        "is_active": True,
                    }
                ]
            ),
            sensor_readings=FakeCollection([]),
        )

        with patch.object(main, "db", fake_db):
            payload = await main.list_sensors()

        by_type: dict[str, int] = {}
        for sensor in payload["sensors"]:
            by_type[sensor["type"]] = by_type.get(sensor["type"], 0) + 1

        self.assertEqual(by_type["rain"], 1)
        self.assertGreaterEqual(by_type["temperature"], 1)

    async def test_ingest_persists_temperature_readings_even_when_official_feed_has_data(self):
        fake_db = SimpleNamespace(
            sensors=FakeCollection(
                [
                    {
                        "_id": "temp-1",
                        "name": "Temp One",
                        "type": "temperature",
                        "location": "Subang",
                        "unit": "C",
                        "latitude": 3.07,
                        "longitude": 101.58,
                        "is_active": True,
                    }
                ]
            ),
            sensor_readings=FakeCollection([]),
        )
        official_readings = [
            {
                "sensor_id": "rain-1",
                "sensor_name": "Rain One",
                "location": "KL",
                "type": "rain",
                "value": 5.1,
                "unit": "mm/h",
                "timestamp": "2026-03-18T10:00:00+00:00",
                "source": "selangor.api.rainfall",
            }
        ]
        temp_fallback = [
            {
                "sensor_id": "temp-1",
                "sensor_name": "Temp One",
                "location": "Subang",
                "type": "temperature",
                "value": 30.4,
                "unit": "C",
                "timestamp": "2026-03-18T10:00:00+00:00",
                "source": "simulated.fallback",
            }
        ]

        with (
            patch.object(main, "db", fake_db),
            patch.object(main, "fetch_selangor_readings", AsyncMock(return_value=official_readings)),
            patch.object(main, "build_sensor_readings", return_value=temp_fallback),
        ):
            result = await main.ingest_sensor_readings_once(trigger="test")

        self.assertEqual(result["inserted_or_updated"], 2)
        stored_types = sorted(doc["type"] for doc in fake_db.sensor_readings.docs)
        self.assertEqual(stored_types, ["rain", "temperature"])


if __name__ == "__main__":
    unittest.main()
