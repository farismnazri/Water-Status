from datetime import datetime
import asyncio

from .db import db  # same db you use in main.py


async def main():
    # Grab all dummy readings
    docs = await db.sensor_readings.find().to_list(length=None)
    if not docs:
        print("No sensor_readings found.")
        return

    # Find the newest timestamp in the collection
    newest = max(d["timestamp"] for d in docs if "timestamp" in d)
    now = datetime.utcnow()
    delta = now - newest

    print(f"Newest reading is at {newest} UTC")
    print(f"Shifting all readings forward by {delta} so newest ≈ now ({now}).")

    # Shift every timestamp by the same delta
    for d in docs:
        ts = d.get("timestamp")
        if not ts:
          continue
        new_ts = ts + delta
        await db.sensor_readings.update_one(
            {"_id": d["_id"]},
            {"$set": {"timestamp": new_ts}},
        )

    print(f"Updated {len(docs)} readings.")


if __name__ == "__main__":
    asyncio.run(main())