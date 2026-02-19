from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class UserReportCreate(BaseModel):
    user_id: str              # user id (string)
    sensor_id: str            # sensor id (string)
    type: str                 # "rain", "water_level", "temperature"
    value: float              # numeric value
    unit: str                 # "mm/h", "m", "°C"
    timestamp: Optional[datetime] = None  # optional; default = now
    comment: Optional[str] = None         # personalised post
    source: Optional[str] = None
