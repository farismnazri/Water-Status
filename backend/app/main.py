from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .db import db

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "River & Farm Guardian backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}

# ---- Fake sensor data (for now) ----

fake_sensors = [
    {
        "id": 1,
        "name": "River Level Sensor - Sungai Gombak",
        "type": "water_level",
        "location": "Sungai Gombak",
        "unit": "m",
    },
    {
        "id": 2,
        "name": "Rain Gauge - Kampung Baru",
        "type": "rainfall",
        "location": "Kampung Baru",
        "unit": "mm/h",
    },
    {
        "id": 3,
        "name": "Temperature Sensor - Kampung Baru",
        "type": "weather",
        "location": "Kampung Baru",
        "unit": "°C / %RH",
    },
]

class UserCreate(BaseModel):
    name: str
    email: str
    plan: str = "free"  # later: free / plus / ultra

@app.get("/sensors")
def list_sensors():
    return {"sensors": fake_sensors}

@app.post("/users")
async def create_user(user: UserCreate):
    # Convert Pydantic model to dict
    user_dict = user.model_dump()

    # Insert into MongoDB 'users' collection
    result = await db.users.insert_one(user_dict)

    # Return the new document ID as a string
    return {"id": str(result.inserted_id)}


@app.get("/users")
async def list_users():
    users = []
    cursor = db.users.find()

    async for doc in cursor:
        # Convert ObjectId to string and tidy up
        doc["id"] = str(doc["_id"])
        del doc["_id"]
        users.append(doc)

    return {"users": users}