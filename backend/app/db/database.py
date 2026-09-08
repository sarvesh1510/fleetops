"""
MongoDB connection management using Motor (async driver).
"""
from typing import Optional
import motor.motor_asyncio
from pymongo import ASCENDING, DESCENDING, GEOSPHERE, TEXT
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)

_client: Optional[motor.motor_asyncio.AsyncIOMotorClient] = None
_db: Optional[motor.motor_asyncio.AsyncIOMotorDatabase] = None


def get_client() -> motor.motor_asyncio.AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _client


def get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _db


async def init_db() -> None:
    global _client, _db

    logger.info("Connecting to MongoDB", uri=settings.MONGODB_URI[:30] + "...")
    _client = motor.motor_asyncio.AsyncIOMotorClient(
        settings.MONGODB_URI,
        serverSelectionTimeoutMS=5000,
    )
    _db = _client[settings.MONGODB_DB]

    # Verify connection
    await _client.admin.command("ping")
    logger.info("MongoDB connected", database=settings.MONGODB_DB)

    await create_indexes()


async def close_db() -> None:
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None
        logger.info("MongoDB connection closed")


async def create_indexes() -> None:
    """Create all required indexes for performance and correctness."""
    db = get_db()

    # vehicles
    await db.vehicles.create_index([("vehicle_id", ASCENDING)], unique=True)
    await db.vehicles.create_index([("status", ASCENDING)])
    await db.vehicles.create_index([("location", GEOSPHERE)])
    await db.vehicles.create_index([("updated_at", DESCENDING)])

    # drivers
    await db.drivers.create_index([("driver_id", ASCENDING)], unique=True)
    await db.drivers.create_index([("vehicle_id", ASCENDING)])

    # orders
    await db.orders.create_index([("order_id", ASCENDING)], unique=True)
    await db.orders.create_index([("status", ASCENDING)])
    await db.orders.create_index([("priority", DESCENDING)])
    await db.orders.create_index([("assigned_vehicle_id", ASCENDING)])
    await db.orders.create_index([("deadline", ASCENDING)])
    await db.orders.create_index([("created_at", DESCENDING)])
    await db.orders.create_index([("pickup_location", GEOSPHERE)])
    await db.orders.create_index([("delivery_location", GEOSPHERE)])

    # routes
    await db.routes.create_index([("route_id", ASCENDING)], unique=True)
    await db.routes.create_index([("vehicle_id", ASCENDING)])
    await db.routes.create_index([("status", ASCENDING)])
    await db.routes.create_index([("updated_at", DESCENDING)])

    # telemetry (time-series style)
    # Drop any non-TTL timestamp index that might exist from a previous schema version
    try:
        await db.telemetry.drop_index("timestamp_-1")
    except Exception:
        pass  # Index didn't exist, that's fine

    await db.telemetry.create_index([("vehicle_id", ASCENDING), ("timestamp", DESCENDING)])
    await db.telemetry.create_index([("timestamp", DESCENDING)], expireAfterSeconds=86400)  # TTL: 24h
    await db.incidents.create_index([("incident_id", ASCENDING)], unique=True)
    await db.incidents.create_index([("vehicle_id", ASCENDING)])
    await db.incidents.create_index([("status", ASCENDING)])
    await db.incidents.create_index([("severity", ASCENDING)])
    await db.incidents.create_index([("created_at", DESCENDING)])

    # optimization_runs
    await db.optimization_runs.create_index([("run_id", ASCENDING)], unique=True)
    await db.optimization_runs.create_index([("created_at", DESCENDING)])

    # users
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.users.create_index([("username", ASCENDING)], unique=True)

    # audit_logs
    await db.audit_logs.create_index([("created_at", DESCENDING)])
    await db.audit_logs.create_index([("entity_id", ASCENDING)])

    # alerts
    await db.alerts.create_index([("created_at", DESCENDING)])
    await db.alerts.create_index([("acknowledged", ASCENDING)])

    # Compound indexes for common query patterns
    await db.orders.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await db.orders.create_index([("assigned_vehicle_id", ASCENDING), ("status", ASCENDING)])
    await db.incidents.create_index([("status", ASCENDING), ("severity", ASCENDING)])

    logger.info("MongoDB indexes created")
