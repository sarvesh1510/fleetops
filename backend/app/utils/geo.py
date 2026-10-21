"""Shared geography and time helpers."""
import math
from datetime import datetime, timedelta, timezone

MUMBAI = "Mumbai MMR"
DELHI = "Delhi NCR"
REGIONS = (MUMBAI, DELHI)

# Mumbai is at ~72.9E, Delhi NCR at ~77.2E.
_REGION_SPLIT_LNG = 76.5

IST = timezone(timedelta(hours=5, minutes=30))


def region_for_lng(lng: float) -> str:
    return DELHI if lng > _REGION_SPLIT_LNG else MUMBAI


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlng = math.radians(lng2 - lng1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlng) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def ist_now() -> datetime:
    return datetime.now(IST)


def ist_day_start_utc() -> datetime:
    """Start of the current India day, expressed as a naive UTC datetime (how we store times)."""
    start = ist_now().replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def ist_hour(utc_naive: datetime) -> int:
    return (utc_naive.replace(tzinfo=timezone.utc).astimezone(IST)).hour
