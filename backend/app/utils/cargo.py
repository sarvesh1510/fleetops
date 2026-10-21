"""Cargo generation shared by the seeder and the live simulation."""
import random


def random_cargo_weight() -> float:
    """
    Realistic parcel/consignment weights for an Indian last-mile + mid-mile fleet:
    most orders are small parcels, some are van loads, few need a truck.
    """
    r = random.random()
    if r < 0.60:
        return round(random.uniform(3, 60), 1)      # parcels - bikes, vans
    if r < 0.90:
        return round(random.uniform(60, 700), 1)    # van loads
    if r < 0.98:
        return round(random.uniform(700, 3500), 1)  # truck loads
    return round(random.uniform(3500, 6000), 1)     # heavy truck loads
