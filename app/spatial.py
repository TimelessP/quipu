from __future__ import annotations

from dataclasses import dataclass

from app.models import Quadrant


@dataclass(frozen=True)
class BBox:
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float


def root_bbox() -> BBox:
    return BBox(min_lat=-90.0, max_lat=90.0, min_lng=-180.0, max_lng=180.0)


def choose_quadrant(lat: float, lng: float, bbox: BBox) -> tuple[Quadrant, BBox]:
    mid_lat = (bbox.min_lat + bbox.max_lat) / 2
    mid_lng = (bbox.min_lng + bbox.max_lng) / 2

    north = lat >= mid_lat
    east = lng >= mid_lng

    if north and east:
        return (
            Quadrant.NE,
            BBox(min_lat=mid_lat, max_lat=bbox.max_lat, min_lng=mid_lng, max_lng=bbox.max_lng),
        )
    if north and not east:
        return (
            Quadrant.NW,
            BBox(min_lat=mid_lat, max_lat=bbox.max_lat, min_lng=bbox.min_lng, max_lng=mid_lng),
        )
    if not north and east:
        return (
            Quadrant.SE,
            BBox(min_lat=bbox.min_lat, max_lat=mid_lat, min_lng=mid_lng, max_lng=bbox.max_lng),
        )
    return (
        Quadrant.SW,
        BBox(min_lat=bbox.min_lat, max_lat=mid_lat, min_lng=bbox.min_lng, max_lng=mid_lng),
    )


def path_for_coordinate(lat: float, lng: float, depth: int) -> list[Quadrant]:
    bbox = root_bbox()
    path: list[Quadrant] = []
    for _ in range(depth):
        quadrant, bbox = choose_quadrant(lat, lng, bbox)
        path.append(quadrant)
    return path


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6_371_000
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    return 2 * r * asin(sqrt(a))
