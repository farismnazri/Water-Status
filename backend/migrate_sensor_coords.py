"""Backfill sensor latitude/longitude and optional real columns in Postgres.

Usage:
  cd backend
  ./venv/bin/python migrate_sensor_coords.py
"""

from __future__ import annotations

import asyncio
import json
import math
from pathlib import Path
from typing import Any

import asyncpg
from dotenv import dotenv_values

LAT_KEYS = ("latitude", "lat")
LON_KEYS = ("longitude", "lon", "lng")


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


def _extract_coords(doc: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = None
    lon = None

    for key in LAT_KEYS:
        lat = _to_float(doc.get(key))
        if lat is not None:
            break
    for key in LON_KEYS:
        lon = _to_float(doc.get(key))
        if lon is not None:
            break

    if lat is None or lon is None:
        coords = doc.get("coordinates")
        if isinstance(coords, dict):
            if lat is None:
                for key in LAT_KEYS:
                    lat = _to_float(coords.get(key))
                    if lat is not None:
                        break
            if lon is None:
                for key in LON_KEYS:
                    lon = _to_float(coords.get(key))
                    if lon is not None:
                        break
        elif isinstance(coords, (list, tuple)) and len(coords) >= 2:
            first = _to_float(coords[0])
            second = _to_float(coords[1])
            if first is not None and second is not None:
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


async def main() -> None:
    env = dotenv_values(Path(__file__).resolve().parent / ".env")
    database_url = env.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is missing in backend/.env")

    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute('ALTER TABLE "sensors" ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION')
        await conn.execute('ALTER TABLE "sensors" ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION')

        rows = await conn.fetch('SELECT _id, doc::text AS doc FROM "sensors"')
        updates: list[tuple[float | None, float | None, str, str]] = []
        with_coords = 0

        for row in rows:
            sensor_id = row["_id"]
            doc = json.loads(row["doc"])
            lat, lon = _extract_coords(doc)
            if lat is not None and lon is not None:
                with_coords += 1

            if lat is not None:
                doc["latitude"] = lat
                doc["lat"] = lat
            if lon is not None:
                doc["longitude"] = lon
                doc["lon"] = lon

            updates.append((lat, lon, json.dumps(doc), sensor_id))

        if updates:
            await conn.executemany(
                '''
                UPDATE "sensors"
                SET lat = $1, lon = $2, doc = $3::jsonb
                WHERE _id = $4
                ''',
                updates,
            )

        print(f"Processed sensors: {len(rows)}")
        print(f"Sensors with coordinates: {with_coords}")
        print("Updated sensors.lat / sensors.lon and normalized doc latitude/longitude keys.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
