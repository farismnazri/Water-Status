import asyncio
import math
import random
from datetime import UTC, datetime, timedelta

from app.db import db


def generate_rain_value() -> float:
    """Rain in mm/h. Most of the time 0, sometimes spikes."""
    if random.random() < 0.7:
        return 0.0
    return round(random.uniform(1, 40), 1)


def generate_water_level_value(base_level: float) -> float:
    """Water level in meters, small wiggles around a base."""
    return round(base_level + random.uniform(-0.1, 0.1), 2)


def generate_temperature_value(hour_of_day: int) -> float:
    """Simple daily temperature curve: warmer around 1-3 pm."""
    base = 27 + 3 * math.sin((hour_of_day - 14) / 24 * 2 * math.pi)
    return round(base + random.uniform(-0.8, 0.8), 1)


async def main() -> None:
    await db.sensor_readings.delete_many({})

    hours_back = 24
    interval_minutes = 10
    now = datetime.now(UTC)

    sensors = await db.sensors.find({"is_active": True}).to_list(length=None)
    print(f"Found {len(sensors)} active sensors")

    all_readings: list[dict] = []

    for sensor in sensors:
        sensor_id = sensor["_id"]
        sensor_type = sensor.get("type", "rain")
        unit = sensor.get("unit", "")
        location = sensor.get("location", "")

        base_level = None
        if sensor_type == "water_level":
            base_level = random.uniform(1.5, 3.0)

        total_steps = int((hours_back * 60) / interval_minutes)

        for step in range(total_steps):
            minutes_ago = (total_steps - 1 - step) * interval_minutes
            ts = now - timedelta(minutes=minutes_ago)

            if sensor_type == "rain":
                value = generate_rain_value()
            elif sensor_type == "water_level":
                value = generate_water_level_value(base_level)
            elif sensor_type == "temperature":
                value = generate_temperature_value(ts.hour)
            else:
                value = 0.0

            all_readings.append(
                {
                    "sensor_id": sensor_id,
                    "sensor_name": sensor.get("name"),
                    "location": location,
                    "timestamp": ts,
                    "type": sensor_type,
                    "value": value,
                    "unit": unit,
                }
            )

    inserted = 0
    for reading in all_readings:
        await db.sensor_readings.insert_one(reading)
        inserted += 1

    print(
        f"Inserted {inserted} readings for {len(sensors)} sensors "
        f"({hours_back} hours, every {interval_minutes} minutes)."
    )


if __name__ == "__main__":
    asyncio.run(main())
