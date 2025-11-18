from dotenv import load_dotenv
from pymongo import MongoClient
import os

load_dotenv()

mongo_url = os.getenv("MONGO_URL")
db_name = os.getenv("MONGO_DB_NAME", "water_status")

client = MongoClient(mongo_url)
db = client[db_name]

# 1. Wipe old data (DEV ONLY!)
print("Deleting old sensor readings and sensors...")
db.sensor_readings.delete_many({})
db.sensors.delete_many({})

# 2. Define 14 base locations around KL/Selangor
LOCATIONS = [
    {"name": "KLCC",          "lat": 3.1563, "lon": 101.7117},
    {"name": "Batu Caves",    "lat": 3.2379, "lon": 101.6843},
    {"name": "Genting",       "lat": 3.4210, "lon": 101.7976},
    {"name": "Masjid Putra",  "lat": 2.9359, "lon": 101.6894},
    {"name": "Putrajaya",     "lat": 2.9260, "lon": 101.6960},
    {"name": "Subang Jaya",   "lat": 3.0810, "lon": 101.5850},
    {"name": "Shah Alam",     "lat": 3.0728, "lon": 101.5183},
    {"name": "Klang",         "lat": 3.0439, "lon": 101.4465},
    {"name": "Cheras",        "lat": 3.0840, "lon": 101.7430},
    {"name": "Kampung Baru",  "lat": 3.1590, "lon": 101.7000},
    {"name": "Gombak",        "lat": 3.2340, "lon": 101.7090},
    {"name": "Ampang",        "lat": 3.1498, "lon": 101.7611},
    {"name": "Puchong",       "lat": 2.9910, "lon": 101.6190},
    {"name": "Kajang",        "lat": 2.9935, "lon": 101.7906},
]

sensors_to_insert = []

for loc in LOCATIONS:
    # Rain sensor
    sensors_to_insert.append({
        "name": f"{loc['name']} - Rain 0001",
        "type": "rain",
        "location": loc["name"],
        "unit": "mm/h",
        "latitude": loc["lat"],
        "longitude": loc["lon"],
        "is_active": True,
    })

    # River / water level sensor
    sensors_to_insert.append({
        "name": f"{loc['name']} - Water Level 0001",
        "type": "water_level",
        "location": loc["name"],
        "unit": "m",
        "latitude": loc["lat"],
        "longitude": loc["lon"],
        "is_active": True,
    })

    # Temperature sensor
    sensors_to_insert.append({
        "name": f"{loc['name']} - Temperature 0001",
        "type": "temperature",
        "location": loc["name"],
        "unit": "°C",
        "latitude": loc["lat"],
        "longitude": loc["lon"],
        "is_active": True,
    })

result = db.sensors.insert_many(sensors_to_insert)
print(f"Inserted {len(result.inserted_ids)} sensors.")
print("Done.")