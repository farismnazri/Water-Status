from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

# Load .env from the Backend folder
load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("MONGO_DB_NAME", "water_status")

if not MONGO_URL:
    raise RuntimeError("MONGO_URL is not set. Did you create Backend/.env?")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]