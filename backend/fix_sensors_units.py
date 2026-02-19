import asyncio

from app.db import db


async def main() -> None:
    before = len(await db.sensors.find({"unit": "string"}).to_list(length=None))
    print(f"Sensors with unit='string' BEFORE update: {before}")

    to_fix = await db.sensors.find({"type": "rain", "unit": "string"}).to_list(length=None)

    modified = 0
    for sensor in to_fix:
        result = await db.sensors.update_one(
            {"_id": sensor["_id"]},
            {"$set": {"unit": "mm/h"}},
        )
        modified += int(result.modified_count)

    print(f"Matched: {len(to_fix)}, Modified: {modified}")

    after = len(await db.sensors.find({"unit": "string"}).to_list(length=None))
    print(f"Sensors with unit='string' AFTER update: {after}")


if __name__ == "__main__":
    asyncio.run(main())
