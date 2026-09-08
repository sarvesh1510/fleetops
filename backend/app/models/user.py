"""
User model for authentication and authorization.
"""
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, EmailStr


class UserRole(str, Enum):
    ADMIN = "admin"
    OPERATIONS_MANAGER = "operations_manager"
    DISPATCHER = "dispatcher"
    VIEWER = "viewer"


class User(BaseModel):
    user_id: str
    username: str
    email: str
    full_name: str
    role: UserRole = UserRole.VIEWER
    hashed_password: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None


class Driver(BaseModel):
    driver_id: str
    full_name: str
    license_number: str
    phone: str
    email: Optional[str] = None
    vehicle_id: Optional[str] = None  # currently assigned vehicle
    status: str = "available"  # available | on_duty | off_duty | break
    shift_start: Optional[datetime] = None
    shift_end: Optional[datetime] = None
    total_deliveries_today: int = 0
    rating: float = 4.8
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
