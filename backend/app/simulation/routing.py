"""
Road routing for the simulation.

Vehicles used to travel in a straight line between pickup and delivery, which
cuts across water, buildings and anything else between the two points. This
module asks an OSRM server for the real driving geometry so vehicles can follow
roads instead.

Only coordinates are sent to the routing server (simulated vehicle / order
positions, nothing user-related). The default is the public OSRM demo server,
which is fine for a demo but is rate limited and has no uptime guarantee; point
ROUTING_BASE_URL at your own OSRM instance for anything heavier.

If routing is disabled or the server is unreachable, `route()` returns None and
the caller falls back to a straight line, so the simulation never stalls.
"""
import asyncio
import time
from collections import OrderedDict
from typing import List, Optional, Tuple

import httpx
import structlog

from app.config import settings
from app.utils.geo import haversine_km

logger = structlog.get_logger(__name__)

LatLng = Tuple[float, float]

_CACHE_SIZE = 512
_FAILURES_BEFORE_PAUSE = 3
_PAUSE_SECONDS = 60.0
_MAX_POINT_GAP_KM = 0.05     # densify long straight segments so interpolation stays on the road


class RoadRouter:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._cache: "OrderedDict[tuple, List[LatLng]]" = OrderedDict()
        self._lock = asyncio.Lock()          # one request at a time, spaced by the min interval
        self._last_request = 0.0
        self._failures = 0
        self._paused_until = 0.0

    @property
    def enabled(self) -> bool:
        return bool(settings.ROUTING_ENABLED)

    async def aclose(self):
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @staticmethod
    def _key(a: LatLng, b: LatLng) -> tuple:
        return (round(a[0], 4), round(a[1], 4), round(b[0], 4), round(b[1], 4))

    async def route(self, start: LatLng, end: LatLng) -> Optional[List[LatLng]]:
        """Driving path from `start` to `end` as (lat, lng) points, or None if unavailable."""
        if not self.enabled:
            return None
        key = self._key(start, end)
        cached = self._cache.get(key)
        if cached is not None:
            self._cache.move_to_end(key)
            return list(cached)
        if time.monotonic() < self._paused_until:
            return None

        async with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                return list(cached)
            if time.monotonic() < self._paused_until:
                return None
            wait = settings.ROUTING_MIN_INTERVAL_SECONDS - (time.monotonic() - self._last_request)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request = time.monotonic()
            try:
                points = await self._fetch(start, end)
            except Exception as e:
                self._failures += 1
                logger.warning("Road routing request failed", error=str(e) or type(e).__name__,
                               failures=self._failures)
                if self._failures >= _FAILURES_BEFORE_PAUSE:
                    self._paused_until = time.monotonic() + _PAUSE_SECONDS
                    self._failures = 0
                    logger.warning("Road routing paused; vehicles use straight lines until it recovers",
                                   seconds=_PAUSE_SECONDS)
                return None
            self._failures = 0
            self._cache[key] = points
            while len(self._cache) > _CACHE_SIZE:
                self._cache.popitem(last=False)
            return list(points)

    async def _fetch(self, start: LatLng, end: LatLng) -> List[LatLng]:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=settings.ROUTING_TIMEOUT_SECONDS)
        base = settings.ROUTING_BASE_URL.rstrip("/")
        url = f"{base}/route/v1/driving/{start[1]:.6f},{start[0]:.6f};{end[1]:.6f},{end[0]:.6f}"
        resp = await self._client.get(url, params={"overview": "full", "geometries": "geojson",
                                                   "steps": "false", "alternatives": "false"})
        resp.raise_for_status()
        return parse_osrm_route(resp.json())


def parse_osrm_route(payload: dict) -> List[LatLng]:
    """Extract (lat, lng) points from an OSRM /route response. Raises ValueError if there is no route."""
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise ValueError(f"no route: {payload.get('code')}")
    coords = payload["routes"][0]["geometry"]["coordinates"]
    points = [(float(lat), float(lng)) for lng, lat in coords]
    if len(points) < 2:
        raise ValueError("route has fewer than 2 points")
    return densify(points)


def densify(points: List[LatLng], max_gap_km: float = _MAX_POINT_GAP_KM) -> List[LatLng]:
    """Insert intermediate points on long segments (straight roads can have very sparse geometry)."""
    out: List[LatLng] = [points[0]]
    for prev, cur in zip(points, points[1:]):
        gap = haversine_km(prev[0], prev[1], cur[0], cur[1])
        if gap > max_gap_km:
            n = int(gap // max_gap_km)
            for i in range(1, n + 1):
                f = i / (n + 1)
                out.append((prev[0] + (cur[0] - prev[0]) * f, prev[1] + (cur[1] - prev[1]) * f))
        out.append(cur)
    return out


road_router = RoadRouter()
