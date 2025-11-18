from dotenv import load_dotenv
from pymongo import MongoClient
import os

load_dotenv()  # loads MONGO_URL and MONGO_DB_NAME from .env

mongo_url = os.getenv("MONGO_URL")
db_name = os.getenv("MONGO_DB_NAME", "water_status")

client = MongoClient(mongo_url)
db = client[db_name]

# Show how many are wrong before
before = db.sensors.count_documents({"unit": "string"})
print(f"Sensors with unit='string' BEFORE update: {before}")

result = db.sensors.update_many(
    {"type": "rain", "unit": "string"},
    {"$set": {"unit": "mm/h"}}
)

print(f"Matched: {result.matched_count}, Modified: {result.modified_count}")

# Show after
after = db.sensors.count_documents({"unit": "string"})
print(f"Sensors with unit='string' AFTER update: {after}")