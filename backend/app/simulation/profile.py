"""
The simulated world's "physics": speeds, traffic by hour of day and stop handling times.

These live in one place so the simulation engine (which moves vehicles with them) and the
ETA model (which is trained on trips generated with them) can never drift apart.
"""
from typing import Dict

import numpy as np

from app.utils.geo import DELHI, MUMBAI


def _plain(x):
    """numpy 0-d results become plain floats; arrays stay arrays."""
    return float(x) if np.ndim(x) == 0 else x

# ── Handling at stops (simulated seconds) ─────────────────────────────────────
PICKUP_HANDLING_SEC = 240
DELIVERY_HANDLING_SEC = 180

# How long a traffic surge lasts (simulated seconds); its last quarter eases off.
SURGE_DURATION_SEC = 1200

# ── Speeds ────────────────────────────────────────────────────────────────────
# Typical free-flow city speed (km/h) by region and by vehicle type.
BASE_SPEED_KMH: Dict[str, float] = {MUMBAI: 24.0, DELHI: 30.0}
TYPE_SPEED_FACTOR: Dict[str, float] = {
    "van": 1.0, "truck": 0.85, "cargo_bike": 1.15, "motorcycle": 1.3, "refrigerated": 0.95,
}
# Order of vehicle types as the ETA model sees them (vehicle_type_enc = index).
VEHICLE_TYPES = ["van", "truck", "cargo_bike", "motorcycle", "refrigerated"]

# Road distance is longer than the straight line; used for ETAs before/without a real route.
ROAD_CIRCUITY = 1.3

# The "fixed speed" guess: one city-wide speed for every vehicle, ignoring traffic.
FIXED_SPEED_KMH = 25.0


def handling_minutes(n_stops):
    """Time spent loading/unloading: the pickup, then each further stop. Works on arrays too."""
    minutes = PICKUP_HANDLING_SEC / 60 + (np.asarray(n_stops) - 1) * DELIVERY_HANDLING_SEC / 60
    return _plain(np.where(np.asarray(n_stops) <= 0, 0.0, minutes))


def target_traffic(region: str, hour: int) -> float:
    """Congestion multiplier (1 = free flow) the simulation steers towards at an IST hour."""
    peak = 1.9 if region == MUMBAI else 1.7
    if 8 <= hour <= 11 or 17 <= hour <= 20:
        return peak
    if 13 <= hour <= 15:
        return 1.3
    if hour < 7 or hour > 22:
        return 0.85
    return 1.15


def free_flow_speed_kmh(region: str, vehicle_type: str) -> float:
    return BASE_SPEED_KMH.get(region, 24.0) * TYPE_SPEED_FACTOR.get(vehicle_type, 1.0)


# Congestion table [region][hour] - region 0 is Mumbai MMR, 1 is Delhi NCR
TRAFFIC_TABLE = np.array([[target_traffic(r, h) for h in range(24)] for r in (MUMBAI, DELHI)])


def region_index(region: str) -> int:
    return 1 if region == DELHI else 0


def trip_window_hours(region_idx, start_hour, distance_km, free_flow_kmh, n_stops, sim_speed=1.0):
    """
    Wall-clock hours a trip will roughly occupy, judged with the *typical* traffic for its start
    hour (not today's reading) so that it does not move when only the live traffic changes.
    At sim speed 10x a trip lasts a tenth of the wall-clock time.
    """
    typical = TRAFFIC_TABLE[np.asarray(region_idx), (np.asarray(start_hour, dtype=float) % 24.0).astype(int)]
    minutes = np.asarray(distance_km) / np.asarray(free_flow_kmh) * 60 * typical + handling_minutes(n_stops)
    return _plain(minutes / (60.0 * np.asarray(sim_speed)))


def typical_traffic_ahead(region_idx, start_hour, window_hours, samples: int = 8):
    """
    Typical congestion over the time window a trip will occupy: the average of the hourly
    traffic profile from `start_hour` to `start_hour + window_hours` (IST, wraps past midnight).
    This is the "what is traffic about to do" signal - rush hour starting mid-trip raises it.
    Accepts single numbers or numpy arrays.
    """
    region_idx = np.asarray(region_idx)
    start = np.asarray(start_hour, dtype=float)
    window = np.asarray(window_hours, dtype=float)
    total = 0.0
    for k in range(samples):
        h = (start + window * (k + 0.5) / samples) % 24.0
        total = total + TRAFFIC_TABLE[region_idx, h.astype(int)]
    return _plain(total / samples)


# ── Baseline ETA formulas (what the ML model has to beat) ─────────────────────
def formula_eta_minutes(distance_km, free_flow_kmh, traffic, n_stops=2):
    """
    Simple formula: driving time at the speed the vehicle can hold in today's traffic,
    plus handling time. This is what the app used before the ML model.
    (Accepts single numbers or numpy arrays.)
    """
    speed = np.maximum(5.0, np.asarray(free_flow_kmh) / np.maximum(np.asarray(traffic), 0.6))
    return _plain(np.asarray(distance_km) / speed * 60 + handling_minutes(n_stops))


def fixed_speed_eta_minutes(distance_km, n_stops=2):
    """Rule of thumb: every vehicle does 25 km/h, whatever the traffic."""
    return _plain(np.asarray(distance_km) / FIXED_SPEED_KMH * 60 + handling_minutes(n_stops))
