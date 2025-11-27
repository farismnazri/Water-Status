from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

import os
import stripe

from .db import db
from .models import UserReportCreate

app = FastAPI()

class CheckoutItem(BaseModel):
    name: str
    price: float
    quantity: int

class CheckoutPayload(BaseModel):
    items: List[CheckoutItem]

@app.post("/create-checkout-session")
async def create_checkout_session(payload: CheckoutPayload):
    # For now: just log and return a fake URL
    print("CHECKOUT PAYLOAD:", payload)

    # Later you plug Stripe here. For now this must be valid JSON:
    return {"url": "https://example.com"}

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # only your frontend dev origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "River & Farm Guardian backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}

# ---- Fake sensor data (for now) ----

# fake_sensors = [
#     {
#         "id": 1,
#         "name": "River Level Sensor - Sungai Gombak",
#         "type": "Water_Level",
#         "location": "Sungai Gombak",
#         "unit": "m",
#     },
#     {
#         "id": 2,
#         "name": "Rain Gauge - Kampung Baru",
#         "type": "rainfall",
#         "location": "Kampung Baru",
#         "unit": "mm/h",
#     },
#     {
#         "id": 3,
#         "name": "Temperature Sensor - Kampung Baru",
#         "type": "temperature",
#         "location": "Kampung Baru",
#         "unit": "°C / %RH",
#     },
# ]

ALLOWED_PLANS = ["free", "plus", "ultra"]

class UserCreate(BaseModel):
    name: str
    email: str = "@gmail.com" #pre-fills the email
    plan: str = "free"  # later: free / plus / ultra

class UserUpdatePlan(BaseModel):
    plan: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    plan: Optional[str] = None

class UserReportUpdate(BaseModel):
    user_id: str                     # who is allowed to edit
    value: Optional[float] = None
    comment: Optional[str] = None
    timestamp: Optional[datetime] = None
    type: Optional[str] = None       # "rain" | "water_level" | "temperature"
    sensor_id: Optional[str] = None  # station to move this report to

# Like payload model for liking/unliking user reports
class UserReportLikePayload(BaseModel):
    user_id: str

ALLOWED_CATEGORIES = ["water_level", "rain", "temperature"]

CATEGORY_SYNONYMS = {
    # Water level
    "water level": "water_level",
    "waterlevel": "water_level",
    "river level": "water_level",
    "river": "water_level",
    "depth": "water_level",

    # Rain
    "rain": "rain",
    "rainfall": "rain",
    "precipitation": "rain",

    # Temperature
    "temperature": "temperature",
    "temp": "temperature",
    "heat": "temperature",
}

def normalize_category(raw: str) -> str:
    """
    Take user input like 'Water Level', 'rainfall', 'Temp'
    and return a canonical category like 'water_level', 'rain', 'temperature'.
    """
    if not raw:
        raise HTTPException(status_code=400, detail="Category is required")

    key = raw.strip().lower()

    if key in CATEGORY_SYNONYMS:
        return CATEGORY_SYNONYMS[key]

    if key in ALLOWED_CATEGORIES:
        return key

    raise HTTPException(
        status_code=400,
        detail=(
            f"Unknown category '{raw}'. "
            f"Allowed categories (or synonyms): {sorted(set(CATEGORY_SYNONYMS.keys()))}"
        ),
    )

ALLOWED_SENSOR_TYPES = ALLOWED_CATEGORIES

class SensorCreate(BaseModel):
    name: str               # "River Level Sensor - Sungai Gombak"
    type: str               # "water_level", "Water Level", "rain", etc.
    location: str           # "Sungai Gombak", "Kampung Baru"
    unit: str               # "m", "mm/h", "°C / %RH"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: bool = True


class SensorUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    unit: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_active: Optional[bool] = None

class ReportUpdate(BaseModel):
    category: Optional[str] = None
    location: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    timestamp: Optional[datetime] = None
    comment: Optional[str] = None


class ReportCreate(BaseModel):
    user_id: str          # Mongo user id as string
    category: str         # e.g. "Water_Level", "rain", "weather"
    location: str         # e.g. "Sungai Gombak", "Kampung Baru"
    value: float          # numeric value (e.g. 4.5)
    unit: str             # e.g. "m", "mm/h", "°C"
    timestamp: Optional[datetime] = None  # optional; default = now (UTC)
    comment: Optional[str] = None         # “heavy rain, fast current”, etc.


@app.post("/sensors")
async def create_sensor(sensor: SensorCreate):
    sensor_dict = sensor.model_dump()

    # Normalize type using the same logic as categories
    sensor_dict["type"] = normalize_category(sensor_dict["type"])

    result = await db.sensors.insert_one(sensor_dict)
    return {"id": str(result.inserted_id)}

@app.get("/sensors")
async def list_sensors():
    sensors = []
    cursor = db.sensors.find()

    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        del doc["_id"]
        sensors.append(doc)

    return {"sensors": sensors}

@app.get("/sensors/{sensor_id}")
async def get_sensor(sensor_id: str):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    doc = await db.sensors.find_one({"_id": sid})
    if not doc:
        raise HTTPException(status_code=404, detail="Sensor not found")

    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

@app.patch("/sensors/{sensor_id}")
async def update_sensor(sensor_id: str, payload: SensorUpdate):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    updates: dict = {}

    if payload.name is not None:
        updates["name"] = payload.name

    if payload.type is not None:
        updates["type"] = normalize_category(payload.type)

    if payload.location is not None:
        updates["location"] = payload.location

    if payload.unit is not None:
        updates["unit"] = payload.unit

    if payload.latitude is not None:
        updates["latitude"] = payload.latitude

    if payload.longitude is not None:
        updates["longitude"] = payload.longitude

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await db.sensors.update_one({"_id": sid}, {"$set": updates})

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sensor not found")

    doc = await db.sensors.find_one({"_id": sid})
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

@app.delete("/sensors/{sensor_id}")
async def delete_sensor(sensor_id: str):
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    result = await db.sensors.delete_one({"_id": sid})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sensor not found")

    return {"id": sensor_id, "deleted": True}

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

@app.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate):
    # 1. Validate ID
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2. Build the update dict only with fields that are provided
    updates = {}

    if payload.name is not None:
        updates["name"] = payload.name

    if payload.email is not None:
        updates["email"] = payload.email

    if payload.plan is not None:
        if payload.plan not in ALLOWED_PLANS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}",
            )
        updates["plan"] = payload.plan

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # 3. Apply the update in MongoDB
    result = await db.users.update_one({"_id": oid}, {"$set": updates})

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # 4. Return the updated user
    doc = await db.users.find_one({"_id": oid})
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

@app.patch("/users/{user_id}/plan")
async def update_user_plan(user_id: str, payload: UserUpdatePlan):
    # 1. Validate requested plan
    if payload.plan not in ALLOWED_PLANS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Allowed plans: {ALLOWED_PLANS}",
        )

    # 2. Convert string ID to Mongo ObjectId
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 3. Update the user in MongoDB
    result = await db.users.update_one(
        {"_id": oid},
        {"$set": {"plan": payload.plan}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # 4. Option: return updated plan or simple success
    return {"id": user_id, "new_plan": payload.plan}

@app.get("/users/{user_id}")
async def get_user(user_id: str):
    # 1. Validate & convert ID to ObjectId
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2. Find the user in MongoDB
    doc = await db.users.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    # 3. Convert _id to id string and return
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

@app.delete("/users/{user_id}")
async def delete_user(user_id: str):
    """
    Delete a user by ID.
    Optionally also delete their user_reports so we don't leave orphans.
    """
    # 1) Validate ObjectId
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2) Check user exists
    user = await db.users.find_one({"_id": oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 3) Delete the user
    await db.users.delete_one({"_id": oid})

    # 4) Optional: clean up that user's reports
    await db.user_reports.delete_many({"user_id": oid})

    return {"id": user_id, "deleted": True}


@app.post("/reports")
async def create_report(report: ReportCreate):
    # 1. Validate & convert user_id
    try:
        user_oid = ObjectId(report.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Convert report to dict
    report_dict = report.model_dump()

    # 3. Normalize category (this is the important new part)
    report_dict["category"] = normalize_category(report_dict["category"])

    # 4. Use real ObjectId in DB
    report_dict["user_id"] = user_oid

    # 5. Default timestamp if missing
    if report_dict["timestamp"] is None:
        report_dict["timestamp"] = datetime.utcnow()

    # 6. Save
    result = await db.reports.insert_one(report_dict)
    return {"id": str(result.inserted_id)}

@app.get("/reports")
async def list_reports(limit: int = 50):
    reports = []

    cursor = db.reports.find().sort("timestamp", -1).limit(limit)

    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        doc["user_id"] = str(doc["user_id"])
        del doc["_id"]
        reports.append(doc)

    return {"reports": reports}

@app.patch("/user-reports/{report_id}")
async def update_user_report(report_id: str, payload: UserReportUpdate):
    """
    Update fields of a user report, but only if the requesting user_id
    matches the report's user_id.
    """
    # 1) Validate ids
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(payload.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2) Fetch existing report
    existing = await db.user_reports.find_one({"_id": rid})
    if not existing:
        raise HTTPException(status_code=404, detail="Report not found")

    if existing.get("user_id") != uid:
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own reports.",
        )

    # 3) Build updates
    updates: dict = {}
    if payload.value is not None:
        updates["value"] = payload.value
    if payload.comment is not None:
        updates["comment"] = payload.comment
    if payload.timestamp is not None:
        updates["timestamp"] = payload.timestamp
    # ⭐ allow changing type (rain / water_level / temperature)
    if payload.type is not None:
        updates["type"] = normalize_category(payload.type)

    # ⭐ allow changing station (sensor)
    if payload.sensor_id is not None:
        try:
            new_sid = ObjectId(payload.sensor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid sensor ID format")

        sensor = await db.sensors.find_one({"_id": new_sid})
        if not sensor:
            raise HTTPException(status_code=404, detail="Sensor not found")
        
        # update sensor fields together
        updates["sensor_id"] = new_sid
        updates["sensor_name"] = sensor.get("name")
        updates["location"] = sensor.get("location")
        if sensor.get("unit"):
            updates["unit"] = sensor["unit"]   # keep unit in sync with station

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # 4) Apply and return updated doc
    await db.user_reports.update_one({"_id": rid}, {"$set": updates})

    doc = await db.user_reports.find_one({"_id": rid})
    doc["id"] = str(doc["_id"])
    doc["sensor_id"] = str(doc["sensor_id"])
    doc["user_id"] = str(doc["user_id"])
    doc["source"] = doc.get("source", "User")
    del doc["_id"]
    return doc



@app.get("/reports/{report_id}")
async def get_report(report_id: str):
    # 1. Validate ID format
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    # 2. Look up report in Mongo
    doc = await db.reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    # 3. Convert ObjectIds to strings for JSON
    doc["id"] = str(doc["_id"])
    doc["user_id"] = str(doc["user_id"])
    del doc["_id"]

    return doc

# --- USER REPORTS CRUD + LIKES --------------------------------------------

@app.post("/user-reports")
async def create_user_report(report: UserReportCreate):
    # 1. Validate & convert user_id
    try:
        user_oid = ObjectId(report.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Validate & convert sensor_id
    try:
        sensor_oid = ObjectId(report.sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    sensor = await db.sensors.find_one({"_id": sensor_oid})
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    # 3. Normalise type ("rainfall", "Rain", etc → "rain")
    normalized_type = normalize_category(report.type)

    # 4. Decide timestamp
    ts = report.timestamp or datetime.utcnow()

    # 5. Build document
    source_name = user.get("name") or "User"

    doc = {
        "user_id": user_oid,
        "sensor_id": sensor_oid,
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "timestamp": ts,
        "type": normalized_type,
        "value": report.value,
        "unit": report.unit or sensor.get("unit"),
        "source": source_name,
        "comment": report.comment or "",
        "likes": 0,
        "liked_by": [],   # list of ObjectIds
    }

    result = await db.user_reports.insert_one(doc)
    return {"id": str(result.inserted_id)}


@app.get("/user-reports")
async def list_user_reports(
    limit: int = 100,
    current_user_id: str | None = None,
):
    """
    Return user-made reports, always including a 'source' field.
    If current_user_id is provided, also include `liked_by_me` per report.
    """
    # Try to parse the current user ID (for liked_by_me)
    current_oid: ObjectId | None = None
    if current_user_id:
        try:
            current_oid = ObjectId(current_user_id)
        except Exception:
            current_oid = None

    reports = []
    cursor = db.user_reports.find().sort("timestamp", -1).limit(limit)

    async for doc in cursor:
        # --- resolve user name for `source` ---
        user_name = None
        user_id = doc.get("user_id")
        if isinstance(user_id, ObjectId):
            user_doc = await db.users.find_one({"_id": user_id}, {"name": 1})
            if user_doc:
                user_name = user_doc.get("name")

        # --- likes info ---
        likes = int(doc.get("likes") or 0)
        liked_by = doc.get("liked_by") or []
        if not isinstance(liked_by, list):
            liked_by = []

        liked_by_me = False
        if current_oid is not None:
            liked_by_me = any(
                isinstance(x, ObjectId) and x == current_oid for x in liked_by
            )

        # --- shape the document for frontend ---
        doc["id"] = str(doc["_id"])
        doc["sensor_id"] = str(doc["sensor_id"])
        doc["user_id"] = str(doc["user_id"])

        doc["source"] = doc.get("source") or user_name or "User"
        doc["likes"] = likes
        doc["liked_by_me"] = liked_by_me

        # do NOT send raw ObjectId list
        if "liked_by" in doc:
            del doc["liked_by"]
        del doc["_id"]

        reports.append(doc)

    return {"reports": reports}


class UserReportUpdate(BaseModel):
    user_id: str
    value: float | None = None
    comment: str | None = None
    timestamp: datetime | None = None
    type: str | None = None
    sensor_id: str | None = None


@app.patch("/user-reports/{report_id}")
async def update_user_report(report_id: str, payload: UserReportUpdate):
    """
    Update fields of a user report, but only if the requesting user_id
    matches the report's user_id.
    """
    # 1) Validate ids
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(payload.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2) Fetch existing
    existing = await db.user_reports.find_one({"_id": rid})
    if not existing:
        raise HTTPException(status_code=404, detail="Report not found")

    if existing.get("user_id") != uid:
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own reports.",
        )

    # 3) Build updates
    updates: dict = {}
    if payload.value is not None:
        updates["value"] = payload.value
    if payload.comment is not None:
        updates["comment"] = payload.comment
    if payload.timestamp is not None:
        updates["timestamp"] = payload.timestamp
    if payload.type is not None:
        updates["type"] = normalize_category(payload.type)
    if payload.sensor_id is not None:
        try:
            new_sid = ObjectId(payload.sensor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid sensor ID format")

        sensor = await db.sensors.find_one({"_id": new_sid})
        if not sensor:
            raise HTTPException(status_code=404, detail="Sensor not found")

        updates["sensor_id"] = new_sid
        updates["sensor_name"] = sensor.get("name")
        updates["location"] = sensor.get("location")
        if sensor.get("unit"):
          updates["unit"] = sensor["unit"]

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.user_reports.update_one({"_id": rid}, {"$set": updates})

    doc = await db.user_reports.find_one({"_id": rid})
    # re-shape like in list_user_reports
    likes = int(doc.get("likes") or 0)
    liked_by = doc.get("liked_by") or []
    if not isinstance(liked_by, list):
        liked_by = []

    liked_by_me = False
    if uid is not None:
        liked_by_me = any(isinstance(x, ObjectId) and x == uid for x in liked_by)

    doc["id"] = str(doc["_id"])
    doc["sensor_id"] = str(doc["sensor_id"])
    doc["user_id"] = str(doc["user_id"])
    doc["source"] = doc.get("source", "User")
    doc["likes"] = likes
    doc["liked_by_me"] = liked_by_me
    del doc["_id"]
    del doc["liked_by"]
    return doc


@app.delete("/user-reports/{report_id}")
async def delete_user_report(report_id: str, user_id: str):
    """
    Delete a single user report by its Mongo _id, but only if it belongs
    to the given user_id.
    """
    # 1) Validate ids
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    # 2) Fetch report to check ownership
    doc = await db.user_reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    if doc.get("user_id") != uid:
        raise HTTPException(
            status_code=403,
            detail="You can only delete your own reports.",
        )

    # 3) Delete
    result = await db.user_reports.delete_one({"_id": rid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")

    return {"id": report_id, "deleted": True}


class LikePayload(BaseModel):
  user_id: str


@app.post("/user-reports/{report_id}/like")
async def toggle_like_user_report(report_id: str, payload: LikePayload):
    """
    Toggle a like from a given user on a report.
    Returns { id, likes, liked }.
    """
    try:
        rid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID format")

    try:
        uid = ObjectId(payload.user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID format")

    doc = await db.user_reports.find_one({"_id": rid})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")

    likes = int(doc.get("likes") or 0)
    liked_by = doc.get("liked_by") or []
    if not isinstance(liked_by, list):
        liked_by = []

    is_liked = any(isinstance(x, ObjectId) and x == uid for x in liked_by)

    if is_liked:
        # Unlike
        liked_by = [x for x in liked_by if not (isinstance(x, ObjectId) and x == uid)]
        likes = max(likes - 1, 0)
        liked = False
    else:
        # Like
        liked_by.append(uid)
        likes += 1
        liked = True

    await db.user_reports.update_one(
        {"_id": rid},
        {"$set": {"likes": likes, "liked_by": liked_by}},
    )

    return {"id": report_id, "likes": likes, "liked": liked}

@app.get("/sensors/{sensor_id}/readings")
async def get_sensor_readings(sensor_id: str, hours: int = 24):
    # 1. Validate sensor id
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    if hours <= 0:
        raise HTTPException(status_code=400, detail="hours must be positive")

    # 2. (Optional but nice) Check sensor exists
    sensor = await db.sensors.find_one({"_id": sid})
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    # 3. Compute time window
    since = datetime.utcnow() - timedelta(hours=hours)

    # 4. Query readings for this sensor, newest last (for graphs)
    readings = []
    cursor = (
        db.sensor_readings.find(
            {
                "sensor_id": sid,
                "timestamp": {"$gte": since},
            }
        )
        .sort("timestamp", 1)  # oldest → newest
    )

    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        doc["sensor_id"] = str(doc["sensor_id"])
        # timestamp is already JSON-serializable via FastAPI
        del doc["_id"]
        readings.append(doc)

    return {
        "sensor_id": str(sid),
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "type": sensor.get("type"),
        "unit": sensor.get("unit"),
        "hours": hours,
        "readings": readings,
    }

@app.get("/sensors/{sensor_id}/latest-reading")
async def get_latest_sensor_reading(sensor_id: str):
    # 1. Validate sensor id
    try:
        sid = ObjectId(sensor_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sensor ID format")

    # 2. Check sensor exists
    sensor = await db.sensors.find_one({"_id": sid})
    if not sensor:
        raise HTTPException(status_code=404, detail="Sensor not found")

    # 3. Find latest reading
    doc = await db.sensor_readings.find_one(
        {"sensor_id": sid},
        sort=[("timestamp", -1)],
    )

    if not doc:
        raise HTTPException(status_code=404, detail="No readings for this sensor")

    doc["id"] = str(doc["_id"])
    doc["sensor_id"] = str(doc["sensor_id"])
    del doc["_id"]

    return {
        "sensor_id": str(sid),
        "sensor_name": sensor.get("name"),
        "location": sensor.get("location"),
        "type": sensor.get("type"),
        "unit": sensor.get("unit"),
        "latest_reading": doc,
    }

@app.get("/sensor-readings")
async def get_all_sensor_readings():
    """
    GET ALL SENSOR READINGS (all types, all locations), newest first.
    Uses the existing async Mongo DB from .db and returns a simple list.
    """
    readings = []
    cursor = db.sensor_readings.find().sort("timestamp", -1)

    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        if "sensor_id" in doc:
            doc["sensor_id"] = str(doc["sensor_id"])
        del doc["_id"]
        readings.append(doc)

    return {"readings": readings}