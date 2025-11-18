from dotenv import load_dotenv
from pymongo import MongoClient
import os

# Load .env (MONGO_URL, MONGO_DB_NAME)
load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("MONGO_DB_NAME", "water_status")

if not MONGO_URL:
    raise RuntimeError("MONGO_URL is not set")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# Some sample sensors around KL for testing
sample_sensors = [
    {
        "name": "KLCC 0001",
        "type": "rain",          # already canonical
        "location": "KLCC",
        "unit": "mm/h",
        "latitude": 3.1562544,
        "longitude": 101.7117189,
        "is_active": True,
    },
    {
        "name": "Batu Caves 0001",
        "type": "rain",
        "location": "Batu Caves",
        "unit": "mm/h",
        "latitude": 3.2378937,
        "longitude": 101.6843203,
        "is_active": True,
    },
    {
        "name": "Genting Highlands 0001",
        "type": "rain",
        "location": "Genting Highlands",
        "unit": "mm/h",
        "latitude": 3.4210163,
        "longitude": 101.7976389,
        "is_active": True,
    },
    {
        "name": "Masjid Putra 0001",
        "type": "rain",
        "location": "Masjid Putra",
        "unit": "mm/h",
        "latitude": 2.9358969,
        "longitude": 101.6894364,
        "is_active": True,
    },
    {
        "name": "Sungai Gombak 0001",
        "type": "water_level",
        "location": "Sungai Gombak",
        "unit": "m",
        "latitude": 3.166,
        "longitude": 101.695,
        "is_active": True,
    },
    {
        "name": "Sungai Klang 0001",
        "type": "water_level",
        "location": "Sungai Klang",
        "unit": "m",
        "latitude": 3.148,
        "longitude": 101.694,
        "is_active": True,
    },
    {
        "name": "Kampung Baru 0001",
        "type": "temperature",
        "location": "Kampung Baru",
        "unit": "°C",
        "latitude": 3.159,
        "longitude": 101.700,
        "is_active": True,
    },
    {
        "name": "Cheras 0001",
        "type": "temperature",
        "location": "Cheras",
        "unit": "°C",
        "latitude": 3.084,
        "longitude": 101.743,
        "is_active": True,
    },
    {
        "name": "Putrajaya 0001",
        "type": "rain",
        "location": "Putrajaya",
        "unit": "mm/h",
        "latitude": 2.926,
        "longitude": 101.696,
        "is_active": True,
    },
    {
        "name": "Subang Jaya 0001",
        "type": "rain",
        "location": "Subang Jaya",
        "unit": "mm/h",
        "latitude": 3.081,
        "longitude": 101.585,
        "is_active": True,
    },
]

if __name__ == "__main__":
    # Optional: clear existing sensors first (for fresh testing)
    # db.sensors.delete_many({})

    result = db.sensors.insert_many(sample_sensors)
    print(f"Inserted {len(result.inserted_ids)} sensors.")