import asyncio

from app.db import db

LOCATIONS = [
    {"name": "KLCC", "lat": 3.1563, "lon": 101.7117},
    {"name": "Batu Caves", "lat": 3.2379, "lon": 101.6843},
    {"name": "Genting", "lat": 3.4210, "lon": 101.7976},
    {"name": "Masjid Putra", "lat": 2.9359, "lon": 101.6894},
    {"name": "Putrajaya", "lat": 2.9260, "lon": 101.6960},
    {"name": "Subang Jaya", "lat": 3.0810, "lon": 101.5850},
    {"name": "Shah Alam", "lat": 3.0728, "lon": 101.5183},
    {"name": "Klang", "lat": 3.0439, "lon": 101.4465},
    {"name": "Cheras", "lat": 3.0840, "lon": 101.7430},
    {"name": "Kampung Baru", "lat": 3.1590, "lon": 101.7000},
    {"name": "Gombak", "lat": 3.2340, "lon": 101.7090},
    {"name": "Ampang", "lat": 3.1498, "lon": 101.7611},
    {"name": "Puchong", "lat": 2.9910, "lon": 101.6190},
    {"name": "Kajang", "lat": 2.9935, "lon": 101.7906},
]


async def main() -> None:
    print("Deleting old sensor readings and sensors...")
    await db.sensor_readings.delete_many({})
    await db.sensors.delete_many({})

    sensors_to_insert: list[dict] = []
    for loc in LOCATIONS:
        sensors_to_insert.append(
            {
                "name": f"{loc['name']} - Rain 0001",
                "type": "rain",
                "location": loc["name"],
                "unit": "mm/h",
                "latitude": loc["lat"],
                "longitude": loc["lon"],
                "is_active": True,
            }
        )
        sensors_to_insert.append(
            {
                "name": f"{loc['name']} - Water Level 0001",
                "type": "water_level",
                "location": loc["name"],
                "unit": "m",
                "latitude": loc["lat"],
                "longitude": loc["lon"],
                "is_active": True,
            }
        )
        sensors_to_insert.append(
            {
                "name": f"{loc['name']} - Temperature 0001",
                "type": "temperature",
                "location": loc["name"],
                "unit": "°C",
                "latitude": loc["lat"],
                "longitude": loc["lon"],
                "is_active": True,
            }
        )

    inserted = 0
    for sensor in sensors_to_insert:
        await db.sensors.insert_one(sensor)
        inserted += 1

    print(f"Inserted {inserted} sensors.")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
