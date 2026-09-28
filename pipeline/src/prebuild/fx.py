"""Story routes (streaming.md 3.6): great-circle samples with distance-interpolated dates.

Every story's named route datasets are built, once each, into fx/<sha16>.json. Record names
are story/dataset, since dataset names are local to a story. A point's flags describe its
OUTGOING segment (bit 0 uncertain, bit 1 sea); the last point repeats the last leg's flags.
Repeated positions preserve stays, and equal dates preserve the source's same-day controls.
"""

import json
import math
import re
from itertools import pairwise
from pathlib import Path
from typing import Any

import yaml

from prebuild.constants import CUBE
from prebuild.events import month_days
from prebuild.hashing import sha256_bytes
from prebuild.meanwhile import day_number
from prebuild.media import BEAT_BLOCK
from prebuild.profiles import Context
from prebuild.records import write_record

MAX_STEP_KM = 50  # compact story core; the runtime evaluates the spherical arcs analytically
UNCERTAIN = 1
SEA = 2
NAME = re.compile(r"[a-zA-Z0-9_-]+")


class RouteError(ValueError):
    """A named route cannot be built; do not silently omit it from the release."""


def route_names(markdown: str) -> list[str]:
    names = set()
    for block in BEAT_BLOCK.findall(markdown):
        beat = yaml.safe_load(block)
        for effect in beat.get("effects", []):
            if "route" not in effect:
                continue
            name = effect["route"].get("dataset")
            if not isinstance(name, str) or not NAME.fullmatch(name):
                raise RouteError(f"invalid route dataset name: {name!r}")
            names.add(name)
    return sorted(names)


def run(ctx: Context) -> None:
    record = {}
    for story in sorted((ctx.repo / "stories").glob("*/story.md")):
        for name in route_names(story.read_text(encoding="utf-8")):
            path = story.parent / "data" / f"{name}.geojson"
            try:
                route = build_route(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError) as error:
                raise RouteError(f"{path}: {error}") from error
            stored = (json.dumps(route, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
            key = f"fx/{sha256_bytes(stored)[:16]}.json"
            write_asset(ctx.out / key, stored)
            record[f"{story.parent.name}/{name}"] = {
                "key": key,
                "kind": "route",
                "epochDay": route["epochDay"],
                "bbox": bounds(route["pts"]),
                "bytes": len(stored),
            }
            print(f"  {story.parent.name}/{name}: {len(route['pts'])} points, {len(stored)} B")
    write_record(ctx, "fx", record)


def build_route(source: dict[str, Any], max_step_km: float = MAX_STEP_KM) -> dict[str, Any]:
    if not math.isfinite(max_step_km) or max_step_km <= 0:
        raise RouteError("max_step_km must be positive")
    props = source.get("properties", {})
    geometry = source.get("geometry", {})
    if (
        source.get("type") != "Feature"
        or props.get("kind") != "route"
        or geometry.get("type") != "LineString"
    ):
        raise RouteError("expected a route Feature with one LineString")
    coords = geometry.get("coordinates", [])
    if len(coords) < 2:
        raise RouteError("a route needs at least two vertices")
    for at in coords:
        if (
            not isinstance(at, list)
            or len(at) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in at)
            or abs(at[0]) > 180
            or abs(at[1]) > 90
        ):
            raise RouteError(f"invalid longitude/latitude: {at!r}")
    dates = props.get("dates", [])
    if len(dates) != len(coords):
        raise RouteError("dates must have one entry per vertex")
    epoch = date_day(props.get("epoch"))
    days = [date_day(date) - epoch for date in dates]
    if days != sorted(days):
        raise RouteError("vertex dates must not run backward")
    legs = props.get("legs", [])
    if len(legs) != len(coords) - 1:
        raise RouteError("legs must describe every consecutive pair of vertices")
    for i, leg in enumerate(legs):
        if (
            leg.get("from") != i
            or leg.get("to") != i + 1
            or type(leg.get("uncertain")) is not bool
            or type(leg.get("sea")) is not bool
        ):
            raise RouteError(f"leg {i} needs from/to, uncertain and sea")
    vertices = props.get("vertices", [{} for _ in coords])
    if len(vertices) != len(coords):
        raise RouteError("vertices must have one entry per coordinate")

    pts = []
    labels = []
    for i, (a, b) in enumerate(pairwise(coords)):
        label = vertices[i].get("name")
        if label:
            labels.append({"i": len(pts), "text": str(label)})
        u, v = direction(a), direction(b)
        dot = sum(x * y for x, y in zip(u, v, strict=True))
        angle = math.acos(max(-1, min(1, dot)))
        if math.pi - angle < 1e-7:
            raise RouteError(f"leg {i} is antipodal: add an intermediate control")
        steps = max(1, math.ceil(angle * CUBE["earthRadiusM"] / 1000 / max_step_km))
        flags = int(legs[i]["uncertain"]) * UNCERTAIN | int(legs[i]["sea"]) * SEA
        for j in range(steps):
            f = j / steps
            at = a if j == 0 else interpolate(u, v, angle, f)
            pts.append(
                [
                    round(at[0], 6),
                    round(at[1], 6),
                    round(days[i] + f * (days[i + 1] - days[i]), 6),
                    flags,
                ]
            )
    if vertices[-1].get("name"):
        labels.append({"i": len(pts), "text": str(vertices[-1]["name"])})
    pts.append([*coords[-1], days[-1], flags])
    return {"v": 1, "epochDay": epoch, "pts": pts, "labels": labels}


def date_day(value: object) -> int:
    match = re.fullmatch(r"(-?\d{4,})-(\d{2})-(\d{2})", str(value))
    if match:
        year, month, day = map(int, match.groups())
        if 1 <= month <= 12 and 1 <= day <= month_days(year, month):
            return day_number(year, month, day)
    raise RouteError(f"invalid ISO date: {value!r}")


def direction(at: list[float]) -> tuple[float, float, float]:
    lon, lat = map(math.radians, at)
    return math.cos(lat) * math.sin(lon), math.sin(lat), math.cos(lat) * math.cos(lon)


def interpolate(u, v, angle: float, f: float) -> list[float]:
    if angle < 1e-10:
        q = u
    else:
        a, b = math.sin((1 - f) * angle), math.sin(f * angle)
        q = [(a * x + b * y) / math.sin(angle) for x, y in zip(u, v, strict=True)]
    return [math.degrees(math.atan2(q[0], q[2])), math.degrees(math.asin(max(-1, min(1, q[1]))))]


def bounds(pts: list[list[float]]) -> list[float]:
    """Unwrapped west..east (3.0), or -180..180 for a track going all the way round."""
    unwrapped = [pts[0][0]]
    for a, b in pairwise(pts):
        unwrapped.append(unwrapped[-1] + (b[0] - a[0] + 180) % 360 - 180)
    west, east = min(unwrapped), max(unwrapped)
    span = east - west
    west = (west + 180) % 360 - 180
    west, east = (-180, 180) if span >= 360 - 1e-6 else (west, west + span)
    return [round(west, 6), min(p[1] for p in pts), round(east, 6), max(p[1] for p in pts)]


def write_asset(path: Path, stored: bytes) -> None:
    if path.exists():
        if path.read_bytes() != stored:
            raise RouteError(f"{path} already holds different bytes")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    partial.write_bytes(stored)
    partial.replace(path)
