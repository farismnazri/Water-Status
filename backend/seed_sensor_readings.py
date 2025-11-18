from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime, timedelta, UTC
import os
import random
import math

# 1. Connect to Mongo using your .env
load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("MONGO_DB_NAME", "water_status")

if not MONGO_URL:
    raise RuntimeError("MONGO_URL is not set")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]


def generate_rain_value():
    """
    Rain in mm/h.
    Most of the time 0, sometimes spikes.
    """
    if random.random() < 0.7:
        return 0.0
    return round(random.uniform(1, 40), 1)


def generate_water_level_value(base_level: float):
    """
    Water level in meters, small wiggles around a base.
    """
    return round(base_level + random.uniform(-0.1, 0.1), 2)


def generate_temperature_value(hour_of_day: int):
    """
    Simple daily temperature curve: warmer around 1–3 pm.
    """
    # Base ~27°C, ±3°C sinusoidal variation across the day
    base = 27 + 3 * math.sin((hour_of_day - 14) / 24 * 2 * math.pi)
    return round(base + random.uniform(-0.8, 0.8), 1)

if __name__ == "__main__":
    load_dotenv()

    MONGO_URL = os.getenv("MONGO_URL")
    DB_NAME = os.getenv("MONGO_DB_NAME", "water_status")

    if not MONGO_URL:
        raise RuntimeError("MONGO_URL is not set")

    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    # 🚨 1) Clear previous readings so we don't clash
    db.sensor_readings.delete_many({})

    HOURS_BACK = 24
    INTERVAL_MINUTES = 10

    # Use timezone-aware UTC as the warning suggests
    now = datetime.now(UTC)

    sensors = list(db.sensors.find({"is_active": True}))
    print(f"Found {len(sensors)} active sensors")

    all_readings = []

    for sensor in sensors:
        sensor_id = sensor["_id"]
        s_type = sensor.get("type", "rain")
        unit = sensor.get("unit", "")
        location = sensor.get("location", "")

        base_level = None
        if s_type == "water_level":
            base_level = random.uniform(1.5, 3.0)

        total_steps = int((HOURS_BACK * 60) / INTERVAL_MINUTES)  # 24*60/10 = 144

        for step in range(total_steps):
            minutes_ago = (total_steps - 1 - step) * INTERVAL_MINUTES
            ts = now - timedelta(minutes=minutes_ago)

            if s_type == "rain":
                value = generate_rain_value()
            elif s_type == "water_level":
                value = generate_water_level_value(base_level)
            elif s_type == "temperature":
                value = generate_temperature_value(ts.hour)
            else:
                value = 0.0

            reading = {
                "sensor_id": sensor_id,
                "sensor_name": sensor.get("name"),
                "location": location,
                "timestamp": ts,
                "type": s_type,
                "value": value,
                "unit": unit,
            }
            all_readings.append(reading)

    # 🚨 2) Make absolutely sure no reading has _id set
    for r in all_readings:
        r.pop("_id", None)

    if all_readings:
        result = db.sensor_readings.insert_many(all_readings)
        print(
            f"Inserted {len(result.inserted_ids)} readings "
            f"for {len(sensors)} sensors "
            f"({HOURS_BACK} hours, every {INTERVAL_MINUTES} minutes)."
        )
    else:
        print("No readings inserted (no active sensors?).")