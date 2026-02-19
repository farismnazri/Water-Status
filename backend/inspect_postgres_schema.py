"""Inspect sensors/sensor_readings schema and key distribution in Postgres.

Usage:
  cd backend
  ./venv/bin/python inspect_postgres_schema.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import asyncpg
from dotenv import dotenv_values


async def main() -> None:
    env = dotenv_values(Path(__file__).resolve().parent / ".env")
    database_url = env.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is missing in backend/.env")

    conn = await asyncpg.connect(database_url)
    try:
        columns = await conn.fetch(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name IN ('sensors','sensor_readings')
            ORDER BY table_name, ordinal_position
            """
        )
        print("Columns:")
        for row in columns:
            print(dict(row))

        print("\nCounts:")
        for table in ("sensors", "sensor_readings"):
            total = await conn.fetchval(f'SELECT count(*) FROM "{table}"')
            print(f"{table}: {total}")

        print("\nSensor coordinate key counts:")
        for key in ("latitude", "longitude", "lat", "lon", "lng"):
            count = await conn.fetchval(f'SELECT count(*) FROM "sensors" WHERE doc ? {key!r}')
            print(f"{key}: {count}")

        print("\nReading timestamp key counts:")
        for key in ("timestamp", "recorded_at", "created_at", "ts"):
            count = await conn.fetchval(f'SELECT count(*) FROM "sensor_readings" WHERE doc ? {key!r}')
            print(f"{key}: {count}")

        print("\nReading sensor-id key counts:")
        for key in ("sensor_id", "sensorId", "sensor", "station_id", "stationId"):
            count = await conn.fetchval(f'SELECT count(*) FROM "sensor_readings" WHERE doc ? {key!r}')
            print(f"{key}: {count}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
