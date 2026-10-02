"""The names stage (streaming.md 3.3, Names; owner decision 44): where the state names stand on the
border steps, so every border says whose it is.

It reads each step the borders stage baked as that stage selected it, from the borders cache: the
step's selection without the carry-through (its Plain) with the land the carry-through carries in
it, which is what the bake draws. Each polity's land is clipped to Natural Earth's, and named:

- an outer unit's name on each region of its land (its pieces within `regionGapDeg` of each other),
  the largest region always, the others from `regionMinKm2`, on its largest piece and on any other
  at least `pieceShare` of it; on the outer plane where the region is at least `minorKm2`, else on
  the inner, which comes forward with the inner lines;
- an empire's member's name, a composite's parentheses stripped, on its own regions alike, on the
  inner plane, unless it is its unit's name.

Each name is fitted inside its piece on an azimuthal equidistant projection about the piece: its
capitals' height from the region's area, shrunk until its letters at their least tracking fit a
straight band across the piece, at the angle where they stand largest, nearest level, with room to
spread; the letters then spread by tracking over up to `spreadFill` of the band's run. Big regions
take the name again in windows `levelStep`^k smaller, its letters as much smaller (levels 1, 2...).
Where a name's short form (`titles`, `trailing`) differs from its full one, both are fitted at
level 0: the short drawn far, the full close (owner decision 44); windows take the full name.

Placements are cached by what they depend on (the piece, the texts, the plane, the area, the rules,
the faces and this code), so steps that keep a polity's land reuse its placements; consecutive
steps' equal placements merge into one with a range of steps. The stage writes the placements in
chunks of the previews' `per` steps (`fd/names/<sha16>.wsn`, gzip-in-file JSON, documented in
streaming.md 3.3), and its record: the release's names section, the polities left unnamed and why,
and the names still over `longName` characters after the short-name rule, for the owner. A name
with a character its face lacks fails the stage, naming it.
"""

import gzip
import json
import math
import multiprocessing
import os
import time
from collections import OrderedDict, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import shapely
import shapely.affinity
import yaml
from PIL import Image, ImageDraw

from prebuild import cliopatria as clio
from prebuild import step_fields
from prebuild.config import ConfigError
from prebuild.cube import EARTH_RADIUS_M
from prebuild.faces import Face, read_face
from prebuild.hashing import layer_version, sha256_bytes, sha256_file, tree_sha
from prebuild.layers import write_object
from prebuild.natural_earth import parts_of_dimension
from prebuild.paths import config_dir
from prebuild.profiles import Context
from prebuild.records import read_record, write_record

STAGE = "names"
LAYER = "fd/names"
EXTENSION = ".wsn"
CONFIG = "names.yaml"
CACHE = "names"  # under build/cache/: each placement job's placements, by its key
FORMAT = 1  # the chunks' `version`
# The code the placements depend on, whose tree hash joins every job's key. The selection's code
# is the borders stage's, which the steps' keys already hold.
CODE = (
    "pipeline/src/prebuild/names.py",
    "pipeline/src/prebuild/faces.py",
    f"pipeline/config/{CONFIG}",
)
EARTH_KM = EARTH_RADIUS_M / 1000
KM_PER_DEG = EARTH_KM * math.pi / 180
# A placement's fields in a chunk's `place`, in order.
FIELDS = ("name", "s0", "s1", "lon", "lat", "angle", "em", "span", "km2", "flags", "group")
FLAG_INNER, FLAG_MEMBER, FLAG_SHORT, LEVEL_SHIFT = 1, 2, 4, 3


class NamesError(ValueError):
    """The names cannot be placed or lettered as the stage requires."""


# Rules -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class FaceSpec:
    package: str
    weight: int
    label: str


@dataclass(frozen=True)
class Rules:
    faces: Mapping[str, FaceSpec]  # by plane: outer, inner
    subsets: tuple[str, ...]
    region_gap_deg: float
    region_min_km2: float
    piece_share: float
    minor_km2: float
    cap_km: tuple[float, float]
    inner_share: float
    band_caps: float
    fit_fill: float
    spread_fill: float
    track: Mapping[str, tuple[float, float]]
    angles: tuple[float, ...]
    cells: int
    land_simplify_deg: float
    level_step: float
    level_min_cap_km: float
    level_land: float
    level_fit: float
    level_spacing: float
    level_angles: tuple[float, ...]
    level_cells: int
    level_track: Mapping[str, float]
    titles: tuple[str, ...]
    trailing: tuple[str, ...]
    long_name: int


_KEYS = {
    "faces",
    "subsets",
    "regionGapDeg",
    "regionMinKm2",
    "pieceShare",
    "minorKm2",
    "capKm",
    "innerShare",
    "bandCaps",
    "fitFill",
    "spreadFill",
    "track",
    "angles",
    "cells",
    "landSimplifyDeg",
    "levelStep",
    "levelMinCapKm",
    "levelLand",
    "levelFit",
    "levelSpacing",
    "levelAngles",
    "levelCells",
    "levelTrack",
    "titles",
    "trailing",
    "longName",
}


def load_rules(path: Path | None = None) -> Rules:
    """`pipeline/config/names.yaml`; a key it lacks or does not name fails."""
    path = config_dir() / CONFIG if path is None else path
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or set(doc) != _KEYS:
        raise ConfigError(f"{path.name} needs exactly the keys {', '.join(sorted(_KEYS))}")

    def span(value: Any) -> tuple[float, ...]:
        first, last, by = (float(v) for v in value)
        return tuple(float(a) for a in np.arange(first, last + by / 2, by))

    faces = {
        plane: FaceSpec(str(spec["package"]), int(spec["weight"]), str(spec["label"]))
        for plane, spec in doc["faces"].items()
    }
    if set(faces) != {"outer", "inner"}:
        raise ConfigError(f"{path.name}: faces names an outer and an inner face")
    return Rules(
        faces=faces,
        subsets=tuple(str(s) for s in doc["subsets"]),
        region_gap_deg=float(doc["regionGapDeg"]),
        region_min_km2=float(doc["regionMinKm2"]),
        piece_share=float(doc["pieceShare"]),
        minor_km2=float(doc["minorKm2"]),
        cap_km=(float(doc["capKm"][0]), float(doc["capKm"][1])),
        inner_share=float(doc["innerShare"]),
        band_caps=float(doc["bandCaps"]),
        fit_fill=float(doc["fitFill"]),
        spread_fill=float(doc["spreadFill"]),
        track={plane: (float(a), float(b)) for plane, (a, b) in doc["track"].items()},
        angles=span(doc["angles"]),
        cells=int(doc["cells"]),
        land_simplify_deg=float(doc["landSimplifyDeg"]),
        level_step=float(doc["levelStep"]),
        level_min_cap_km=float(doc["levelMinCapKm"]),
        level_land=float(doc["levelLand"]),
        level_fit=float(doc["levelFit"]),
        level_spacing=float(doc["levelSpacing"]),
        level_angles=span(doc["levelAngles"]),
        level_cells=int(doc["levelCells"]),
        level_track={plane: float(v) for plane, v in doc["levelTrack"].items()},
        titles=tuple(str(t) for t in doc["titles"]),
        trailing=tuple(str(t) for t in doc["trailing"]),
        long_name=int(doc["longName"]),
    )


def face_paths(repo: Path, rules: Rules, plane: str) -> list[Path]:
    """A plane's face: its subsets' WOFF files, as @fontsource installs them in app/."""
    spec = rules.faces[plane]
    folder = repo / "app" / "node_modules" / "@fontsource" / spec.package / "files"
    return [folder / f"{spec.package}-{s}-{spec.weight}-normal.woff" for s in rules.subsets]


def load_faces(repo: Path, rules: Rules) -> dict[str, Face]:
    return {
        plane: read_face(rules.faces[plane].label, face_paths(repo, rules, plane))
        for plane in ("outer", "inner")
    }


def faces_digest(repo: Path, rules: Rules) -> str:
    """The sha256 over the faces' files: placements fitted with other faces are others."""
    paths = [p for plane in ("outer", "inner") for p in face_paths(repo, rules, plane)]
    return sha256_bytes("".join(sha256_file(p) for p in paths if p.is_file()).encode())


# Names -----------------------------------------------------------------------------------------


def display(name: str) -> str:
    """Cliopatria's name, a composite's parentheses stripped."""
    return name[1:-1] if name.startswith("(") and name.endswith(")") else name


def short_name(name: str, rules: Rules) -> str:
    """The name drawn far (owner decision 44): the display name less a trailing parenthesized
    qualifier, one leading title and a trailing 'Dynasty'."""
    text = display(name)
    if text.endswith(")") and " (" in text:
        text = text[: text.rindex(" (")]
    for title in rules.titles:
        if text.startswith(title + " ") and len(text) > len(title) + 1:
            text = text[len(title) + 1 :]
            break
    for tail in rules.trailing:
        if text.endswith(" " + tail) and len(text) > len(tail) + 4:
            text = text[: -len(tail) - 1]
            break
    return text


def lettered(text: str, plane: str) -> str:
    """The characters a name is lettered in: an outer name in capitals; an inner name as written,
    its lowercase being the inner face's small capitals."""
    return text.upper() if plane == "outer" else text


# Projections and fitting -----------------------------------------------------------------------


def aeqd(lon0: float, lat0: float):
    """Forward and inverse azimuthal equidistant projections about (lon0, lat0), km."""
    l0, p0 = math.radians(lon0), math.radians(lat0)
    sp0, cp0 = math.sin(p0), math.cos(p0)

    def forward(xy: np.ndarray) -> np.ndarray:
        lam = np.radians(xy[:, 0]) - l0
        lam = (lam + math.pi) % (2 * math.pi) - math.pi
        phi = np.radians(np.clip(xy[:, 1], -90, 90))
        cosc = np.clip(sp0 * np.sin(phi) + cp0 * np.cos(phi) * np.cos(lam), -1, 1)
        c = np.arccos(cosc)
        k = np.where(c > 1e-9, c / np.maximum(np.sin(c), 1e-12), 1.0)
        x = EARTH_KM * k * np.cos(phi) * np.sin(lam)
        y = EARTH_KM * k * (cp0 * np.sin(phi) - sp0 * np.cos(phi) * np.cos(lam))
        return np.column_stack([x, y])

    def inverse(xy: np.ndarray) -> np.ndarray:
        x, y = xy[:, 0], xy[:, 1]
        rho = np.maximum(np.hypot(x, y), 1e-12)
        c = rho / EARTH_KM
        phi = np.arcsin(np.clip(np.cos(c) * sp0 + y * np.sin(c) * cp0 / rho, -1, 1))
        lam = l0 + np.arctan2(x * np.sin(c), rho * cp0 * np.cos(c) - y * sp0 * np.sin(c))
        lon = (np.degrees(lam) + 180) % 360 - 180
        return np.column_stack([lon, np.degrees(phi)])

    return forward, inverse


def center_of(piece: shapely.Geometry) -> tuple[float, float]:
    """A piece's centroid on the sphere, lon/lat."""
    pts = shapely.get_coordinates(shapely.segmentize(piece, 0.5))
    lon, lat = np.radians(pts[:, 0]), np.radians(pts[:, 1])
    v = np.column_stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    m = v.mean(axis=0)
    m /= np.linalg.norm(m)
    return math.degrees(math.atan2(m[1], m[0])), math.degrees(math.asin(m[2]))


def project(piece: shapely.Geometry):
    """The piece on an azimuthal equidistant projection about its centroid, simplified to a
    3000th of its extent, with the projection's inverse and forward; None where nothing is left."""
    lon0, lat0 = center_of(piece)
    forward, inverse = aeqd(lon0, lat0)
    local = shapely.make_valid(shapely.buffer(shapely.transform(piece, forward), 0))
    local = shapely.union_all(parts_of_dimension(local, 2))
    if shapely.is_empty(local):
        return None
    reach = math.hypot(*np.subtract(local.bounds[2:], local.bounds[:2]))
    return shapely.simplify(local, reach / 3000), inverse, forward


def bearing(lon: float, lat: float, a: Sequence[float], b: Sequence[float]) -> float:
    """The direction from a to b about (lon, lat), degrees counterclockwise from east there."""
    forward, _ = aeqd(lon, lat)
    p = forward(np.array([a, b], dtype=np.float64))
    d = p[1] - p[0]
    return math.degrees(math.atan2(d[1], d[0]))


def raster(shape: shapely.Geometry, cell: float) -> tuple[np.ndarray, tuple[float, float]]:
    """The shape as a mask of cells `cell` km a side over its bounds, rows by y, and the corner."""
    minx, miny, maxx, maxy = shape.bounds
    nx = math.ceil((maxx - minx) / cell) + 3
    ny = math.ceil((maxy - miny) / cell) + 3
    image = Image.new("1", (nx, ny), 0)
    draw = ImageDraw.Draw(image)
    x0, y0 = minx - cell, miny - cell
    for poly in shapely.get_parts(shape):
        ring = (np.asarray(poly.exterior.coords) - [x0, y0]) / cell
        if len(ring) >= 3:
            draw.polygon([tuple(p) for p in ring], fill=1)
    return np.asarray(image, dtype=bool), (x0, y0)


def longest_runs(band: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each row's longest run of True: its length and the column it ends at (exclusive)."""
    ny = band.shape[0]
    c = np.cumsum(band, axis=1)
    run = c - np.maximum.accumulate(np.where(~band, c, 0), axis=1)
    end = np.argmax(run, axis=1)
    return run[np.arange(ny), end], end + 1


def best_band(mask: np.ndarray, h: int, prefer: float) -> tuple[int, int, int, int]:
    """The longest straight band h rows high inside the mask, the row nearest `prefer` among the
    longest: its length, first row, first column and end column, in cells."""
    ny, nx = mask.shape
    if h >= ny:
        return 0, 0, 0, 0
    cs = np.vstack([np.zeros((1, nx), dtype=np.int32), np.cumsum(mask, axis=0, dtype=np.int32)])
    lengths, ends = longest_runs((cs[h:] - cs[:-h]) == h)
    top = int(lengths.max())
    if top <= 0:
        return 0, 0, 0, 0
    rows = np.nonzero(lengths >= top * 0.97)[0]
    row = int(rows[np.argmin(np.abs(rows + h / 2 - prefer))])
    length = int(lengths[row])
    return length, row, int(ends[row]) - length, int(ends[row])


def fit(
    local: shapely.Geometry,
    natural_caps: float,
    cap0: float,
    rules: Rules,
    angles: Sequence[float],
    cells: int,
) -> tuple[float, float, float, np.ndarray] | None:
    """The best straight band for a name `natural_caps` cap heights long at its least tracking,
    its capitals at most cap0 km high: its angle, cap height and run, km, and the run's middle
    (local km); None where no band fits."""
    extent = math.hypot(*np.subtract(local.bounds[2:], local.bounds[:2]))
    cell = extent / cells
    simple = shapely.simplify(local, cell / 2)
    center = shapely.centroid(local)
    best = None
    for angle in angles:
        rotated = shapely.affinity.rotate(simple, -angle, origin=(0, 0))
        mask, (x0, y0) = raster(rotated, cell)
        c = shapely.affinity.rotate(center, -angle, origin=(0, 0))
        prefer = (c.y - y0) / cell
        cap = cap0
        found = None
        for _ in range(24):
            h = max(1, math.ceil(cap * rules.band_caps / cell))
            length, row, start, end = best_band(mask, h, prefer)
            run = length * cell
            if run <= 0:
                # Taller than the piece: the letters halve until a band fits at all.
                if h <= 1:
                    break
                cap *= 0.5
                continue
            found = (cap, run, row, start, end, h)
            if run * rules.fit_fill >= natural_caps * cap:
                break
            shrunk = run * rules.fit_fill / natural_caps
            if shrunk >= cap * 0.98:
                break
            cap = shrunk
        if found is None:
            continue
        cap, run, row, start, end, h = found
        room = min(run / max(natural_caps * cap, 1e-9), 2.5)
        tilt = math.sin(math.radians(angle)) ** 2
        score = (cap / cap0) ** 2 * math.sqrt(room) * (1 - 0.5 * tilt)
        if best is None or score > best[0]:
            mid = np.array([x0 + (start + end) / 2 * cell, y0 + (row + h / 2) * cell])
            a = math.radians(angle)
            turned = np.array(
                [
                    mid[0] * math.cos(a) - mid[1] * math.sin(a),
                    mid[0] * math.sin(a) + mid[1] * math.cos(a),
                ]
            )
            best = (score, angle, cap, run, turned)
    if best is None:
        return None
    return best[1], best[2], best[3], best[4]


def anchored(inverse, mid: np.ndarray, angle: float, em_km: float, span_km: float) -> dict:
    """A placement's anchor, baseline angle at the anchor, em and span, degrees."""
    a = math.radians(angle)
    d = np.array([math.cos(a), math.sin(a)]) * min(span_km * 0.05, 20.0)
    pts = inverse(np.array([mid, mid - d, mid + d]))
    lon, lat = float(pts[0, 0]), float(pts[0, 1])
    return {
        "lon": lon,
        "lat": lat,
        "angle": bearing(lon, lat, pts[1], pts[2]),
        "em": em_km / KM_PER_DEG,
        "span": span_km / KM_PER_DEG,
    }


def place(
    piece: shapely.Geometry,
    full: str,
    short: str,
    plane: str,
    area: float,
    faces: Mapping[str, Face],
    rules: Rules,
) -> list[dict[str, Any]]:
    """A name's placements inside the piece: level 0 for the whole piece, in its full form and,
    where it differs, its short form; and the full form at levels 1, 2... in windows
    `levelStep`^k smaller, its letters as much smaller. Each is a dict of level, form, fit (its
    capitals' height as a share of its level's), lon, lat, angle, em and span; empty where it
    fits nowhere."""
    if shapely.is_empty(piece):
        return []
    projected = project(piece)
    if projected is None:
        return []
    local, inverse, forward = projected
    face = faces[plane]
    least, most = rules.track[plane]
    cap0 = (
        rules.cap_km[0] * area ** rules.cap_km[1] * (rules.inner_share if plane == "inner" else 1)
    )
    placements: list[dict[str, Any]] = []

    def caps(text: str, track: float) -> float:
        """The text's length in cap heights at `track` cap heights between letters."""
        shown = lettered(text, plane)
        return face.width(shown) / face.cap + track * max(0, len(shown) - 1)

    def fitted(shape, back, text, form, cap_top, level, angles, cells) -> dict | None:
        natural = caps(text, least)
        found = fit(shape, natural, cap_top, rules, angles, cells)
        if found is None:
            return None
        angle, cap, run, mid = found
        if level == 0:
            span = min(max(run * rules.spread_fill, natural * cap), caps(text, most) * cap)
        else:
            span = caps(text, rules.level_track[plane]) * cap
        return {
            "level": level,
            "form": form,
            "fit": cap / cap_top,
            **anchored(back, mid, angle, cap / face.cap, span),
        }

    for text, form in ((full, "full"), (short, "short")):
        if form == "short" and short == full:
            continue
        top = fitted(local, inverse, text, form, cap0, 0, rules.angles, rules.cells)
        if top is not None:
            placements.append(top)
    if not placements:
        return []
    extent = math.hypot(*np.subtract(local.bounds[2:], local.bounds[:2]))
    minx, miny, maxx, maxy = local.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    level = 1
    while True:
        cap = cap0 / rules.level_step**level
        if cap < rules.level_min_cap_km:
            break
        side = max(
            caps(full, rules.level_track[plane]) * cap * 3.2, extent / rules.level_step**level
        )
        stride = side / 2
        nx = max(1, math.ceil((maxx - minx) / stride))
        ny = max(1, math.ceil((maxy - miny) / stride))
        found_here: list[tuple[float, dict]] = []
        for i in range(nx):
            for j in range(ny):
                x = cx + (i - (nx - 1) / 2) * stride
                y = cy + (j - (ny - 1) / 2) * stride
                window = shapely.box(x - side / 2, y - side / 2, x + side / 2, y + side / 2)
                parts = [p for p in parts_of_dimension(shapely.intersection(local, window), 2)]
                parts = [p for p in parts if p.area > 0]
                if not parts:
                    continue
                biggest = max(parts, key=lambda p: p.area)
                if biggest.area < rules.level_land * side * side:
                    continue
                lonlat = shapely.transform(shapely.segmentize(biggest, side / 40), inverse)
                lon_min, _, lon_max, _ = lonlat.bounds
                if lon_max - lon_min > 180:
                    continue  # across the antimeridian
                again = project(clio.polygons(shapely.make_valid(lonlat)))
                if again is None:
                    continue
                one = fitted(
                    again[0],
                    again[1],
                    full,
                    "full",
                    cap,
                    level,
                    rules.level_angles,
                    rules.level_cells,
                )
                if one is not None and one["fit"] >= rules.level_fit:
                    found_here.append((one["fit"], one))
        found_here.sort(key=lambda e: -e[0])
        chosen: list[np.ndarray] = []
        for _fit, one in found_here:
            here = forward(np.array([[one["lon"], one["lat"]]]))[0]
            if any(np.hypot(*(here - other)) < rules.level_spacing * side for other in chosen):
                continue
            chosen.append(here)
            placements.append(one)
        level += 1
    return placements


# Regions -----------------------------------------------------------------------------------------


def regions(pieces: Sequence[shapely.Geometry], gap_deg: float) -> list[list[shapely.Geometry]]:
    """The pieces in groups, joined where they lie within gap_deg of each other."""
    if not pieces:
        return []
    arr = np.array(pieces, dtype=object)
    group = list(range(len(pieces)))

    def find(k: int) -> int:
        while group[k] != k:
            group[k] = group[group[k]]
            k = group[k]
        return k

    near = shapely.STRtree(arr).query(arr, predicate="dwithin", distance=gap_deg)
    for a, b in near.T:
        group[find(int(a))] = find(int(b))
    joined: dict[int, list[shapely.Geometry]] = defaultdict(list)
    for k, piece in enumerate(pieces):
        joined[find(k)].append(piece)
    return list(joined.values())


def three_digits(value: float) -> float:
    """`value` to three significant digits: placements of nearly equal regions share their key."""
    if value <= 0:
        return 0.0
    return float(f"{value:.3g}")


@dataclass(frozen=True)
class Job:
    """One name on one piece, as a step calls for it."""

    polity: str
    unit: str
    kind: str  # outer, member
    plane: str  # outer, inner
    full: str
    short: str
    km2: float  # its region's, to three significant digits
    rank: int  # its region among its polity's, largest first
    piece: int  # its piece among its region's, largest first
    shape: shapely.Geometry


def step_jobs(
    land: Mapping[str, shapely.Geometry],
    outer: Mapping[str, str],
    rules: Rules,
) -> tuple[list[Job], dict[str, str]]:
    """The names a step's land calls for, and the polities it leaves unnamed, with why."""
    members: dict[str, list[str]] = defaultdict(list)
    for name, unit in outer.items():
        members[unit].append(name)
    jobs: list[Job] = []
    unnamed: dict[str, str] = {}

    def label(raw: str, unit: str, kind: str, geometry: shapely.Geometry) -> None:
        pieces = [p for p in parts_of_dimension(geometry, 2) if not shapely.is_empty(p)]
        if not pieces:
            unnamed[raw] = "no land on Natural Earth's coasts"
            return
        sized = sorted(
            (
                (float(sum(clio.km2(p) for p in g)), g)
                for g in regions(pieces, rules.region_gap_deg)
            ),
            key=lambda e: (-e[0], e[1][0].wkb),
        )
        full, short = display(raw), short_name(raw, rules)
        for rank, (area, group) in enumerate(sized):
            if rank > 0 and area < rules.region_min_km2:
                break
            plane = "outer" if kind == "outer" and area >= rules.minor_km2 else "inner"
            by_size = sorted(group, key=lambda p: (-float(clio.km2(p)), p.wkb))
            largest = float(clio.km2(by_size[0]))
            for index, piece in enumerate(by_size):
                piece_km2 = float(clio.km2(piece))
                if index > 0 and piece_km2 < max(rules.region_min_km2, rules.piece_share * largest):
                    break
                km2 = three_digits(area if index == 0 else piece_km2)
                jobs.append(Job(raw, unit, kind, plane, full, short, km2, rank, index, piece))

    for unit, names in sorted(members.items()):
        shapes = [land[n] for n in names if n in land]
        if not shapes:
            continue
        label(unit, unit, "outer", shapely.union_all(shapes))
        for name in sorted(names):
            if name == unit or display(name) == display(unit) or name not in land:
                continue
            label(name, unit, "member", land[name])
    return jobs, unnamed


# Steps -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Placed:
    """A placement as a step draws it: its job's names and region, and where it stands."""

    full: str
    short: str
    polity: str
    kind: str
    plane: str
    km2: float
    rank: int
    piece: int
    form: str
    level: int
    lon: int  # centidegrees
    lat: int
    angle: int  # decidegrees
    em: int  # 1e-4 degrees
    span: int  # 1e-3 degrees

    @property
    def group(self) -> tuple[str, str, int, int]:
        return (self.polity, self.kind, self.rank, self.piece)

    @property
    def flags(self) -> int:
        flags = self.level << LEVEL_SHIFT
        flags |= FLAG_INNER if self.plane == "inner" else 0
        flags |= FLAG_MEMBER if self.kind == "member" else 0
        flags |= FLAG_SHORT if self.form == "short" else 0
        return flags


def quantized(job: Job, placement: Mapping[str, Any]) -> Placed:
    return Placed(
        full=job.full,
        short=job.short,
        polity=job.polity,
        kind=job.kind,
        plane=job.plane,
        km2=job.km2,
        rank=job.rank,
        piece=job.piece,
        form=placement["form"],
        level=int(placement["level"]),
        lon=round(placement["lon"] * 100),
        lat=round(placement["lat"] * 100),
        angle=round(placement["angle"] * 10),
        em=round(placement["em"] * 1e4),
        span=round(placement["span"] * 1e3),
    )


def job_key(job: Job, identity: str) -> str:
    """What a job's placements depend on, hashed: the piece, the texts, the plane and the area,
    and `identity`: this code, the rules and the faces."""
    doc = {
        "identity": identity,
        "piece": sha256_bytes(shapely.to_wkb(job.shape, byte_order=1)),
        "full": job.full,
        "short": job.short,
        "plane": job.plane,
        "km2": job.km2,
    }
    return sha256_bytes(json.dumps(doc, sort_keys=True).encode())


def cache_path(cache: Path, key: str) -> Path:
    return cache / CACHE / key[:2] / f"{key}.json"


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_text(json.dumps(value), encoding="utf-8")
    partial.replace(path)


@dataclass(frozen=True)
class StepWork:
    year: int
    plain: Path
    carried: tuple[clio.Carried, ...]


@dataclass(frozen=True)
class StepNames:
    year: int
    jobs: list[tuple[str, dict[str, Any]]]  # each job's key and what it says of its name
    unnamed: dict[str, str]


_worker: dict[str, Any] = {}


def _start(repo: str, cache: str, land: bytes, identity: str, rules_path: str) -> None:
    rules = load_rules(Path(rules_path))
    _worker.update(
        repo=Path(repo),
        cache=Path(cache),
        land=shapely.from_wkb(land),
        identity=identity,
        rules=rules,
        faces=load_faces(Path(repo), rules),
        clipped=OrderedDict(),
    )


def clip(shape: shapely.Geometry, land: shapely.Geometry, memo: OrderedDict[str, Any]):
    """The shape's land on Natural Earth's coasts, remembered by the shape's bytes: steps repeat
    most polities' land."""
    key = sha256_bytes(shapely.to_wkb(shape, byte_order=1))
    if key in memo:
        memo.move_to_end(key)
        return memo[key]
    near = shapely.clip_by_rect(land, *shapely.box(*shape.bounds).buffer(0.1).bounds)
    clipped = clio.polygons(shapely.intersection(shape, near))
    memo[key] = clipped
    if len(memo) > 2048:
        memo.popitem(last=False)
    return clipped


def name_step(work: StepWork) -> StepNames:
    """A step's names: its land from its Plain and what the carry-through carries in it, clipped
    to the coasts; each job's placements from the cache, else placed now and cached."""
    w = _worker
    plain = clio.Plain.from_bytes(work.plain.read_bytes())
    shapes: dict[str, list[shapely.Geometry]] = defaultdict(list)
    outer = dict(plain.outer)
    for name, shape in plain.land.items():
        shapes[name].append(shape)
    for piece in work.carried:
        shapes[piece.polity].append(piece.shape)
        outer.setdefault(piece.polity, piece.outer)
    land = {
        name: clip(shapely.union_all(found), w["land"], w["clipped"])
        for name, found in sorted(shapes.items())
    }
    jobs, unnamed = step_jobs(land, outer, w["rules"])
    done: list[tuple[str, dict[str, Any]]] = []
    for job in jobs:
        key = job_key(job, w["identity"])
        path = cache_path(w["cache"], key)
        if not path.is_file():
            placements = place(
                job.shape, job.full, job.short, job.plane, job.km2, w["faces"], w["rules"]
            )
            _write_json(path, placements)
        meta = {
            "polity": job.polity,
            "unit": job.unit,
            "kind": job.kind,
            "plane": job.plane,
            "full": job.full,
            "short": job.short,
            "km2": job.km2,
            "rank": job.rank,
            "piece": job.piece,
        }
        done.append((key, meta))
    return StepNames(work.year, done, unnamed)


def _name_step(work: StepWork) -> StepNames:
    return name_step(work)


# The stage ------------------------------------------------------------------------------------


def code_identity(ctx: Context, rules_path: Path) -> str:
    """This code, the rules and the faces, hashed: every job's key joins it."""
    code = tree_sha(CODE, ctx.repo)
    rules = load_rules(rules_path)
    return sha256_bytes(f"{code} {faces_digest(ctx.repo, rules)}".encode())


def run(ctx: Context) -> None:
    write_record(ctx, STAGE, name_steps(ctx))


def name_steps(ctx: Context) -> dict[str, Any]:
    """Names every step the borders record gives, writes the chunks and returns the record."""
    started = time.perf_counter()
    borders_record = read_record(ctx, "borders")
    steps = borders_record.get("steps")
    if not steps:
        raise NamesError("the borders record has no steps: run `uv run prebuild borders` first")
    rules_path = config_dir(ctx.repo) / CONFIG
    rules = load_rules(rules_path)
    faces = load_faces(ctx.repo, rules)
    identity = code_identity(ctx, rules_path)
    source = clio.load_cliopatria(ctx)
    config = clio.load_config(config_dir(ctx.repo) / clio.CONFIG)
    terrain = clio.load_terrain(ctx)
    years = clio.step_years(source, config)
    masks = step_fields.terrain_masks(ctx, terrain, config.rules.sliver_km, ctx.jobs)
    step_identity = step_fields.code_identity(ctx.repo, masks)
    del masks
    plain = {y: step_fields.step_key(y, source, config, step_identity) for y in years}
    carried = step_fields.carried_steps(ctx, plain, source, config, terrain)
    folder = ctx.cache / step_fields.CACHE / step_fields.PLAIN
    kept: list[int] = list(steps["years"])
    paths = {y: folder / f"{plain[y][:40]}.bin" for y in kept}
    missing = [y for y in kept if not paths[y].is_file()]
    if missing:
        print(f"names: selecting {len(missing)} steps the borders cache lacks", flush=True)
        for summary in clio.selections(
            ctx, [(y, (), paths[y]) for y in missing], source, config, terrain
        ):
            if summary[4] is not None:
                raise NamesError(f"{summary[0]}: {summary[4]}")
    land = shapely.simplify(terrain.land, rules.land_simplify_deg)
    work = [StepWork(y, paths[y], tuple(carried.get(y, ()))) for y in kept]
    init = (str(ctx.repo), str(ctx.cache), shapely.to_wkb(land), identity, str(rules_path))
    named: dict[int, StepNames] = {}
    if ctx.jobs <= 1:
        _start(*init)
        for item in work:
            named[item.year] = name_step(item)
    else:
        block = max(1, math.ceil(len(work) / ctx.jobs))
        with ProcessPoolExecutor(
            max_workers=ctx.jobs,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=_start,
            initargs=init,
        ) as pool:
            for count, result in enumerate(pool.map(_name_step, work, chunksize=block), 1):
                named[result.year] = result
                if count % 50 == 0 or count == len(work):
                    seconds = time.perf_counter() - started
                    print(f"names: named {count} of {len(work)} steps, {seconds:.0f} s", flush=True)
    per_step: list[list[Placed]] = []
    memo: dict[str, list[dict[str, Any]]] = {}
    for year in kept:
        placed: list[Placed] = []
        for key, meta in named[year].jobs:
            if key not in memo:
                memo[key] = json.loads(cache_path(ctx.cache, key).read_text(encoding="utf-8"))
            job = Job(**meta, shape=shapely.Polygon())
            placed.extend(quantized(job, p) for p in memo[key])
        per_step.append(sorted(set(placed), key=_order))
    check_glyphs(per_step, faces)
    records = merge(per_step)
    section = write_chunks(ctx, kept, records, steps, rules)
    unnamed = unnamed_report(kept, named, per_step)
    long_names = long_names_report(kept, per_step, rules)
    total = sum(section["bytes"])
    print(
        f"names: {len(records)} placements over {len(kept)} steps in {len(section['keys'])} "
        f"chunks, {total / 1e3:.0f} KB; {len(unnamed)} polities unnamed somewhere, "
        f"{len(long_names)} names over {rules.long_name} characters; "
        f"{time.perf_counter() - started:.0f} s",
        flush=True,
    )
    return {
        "names": section,
        "unnamed": unnamed,
        "longNames": long_names,
        "inputs": {"code": identity, "steps": steps["ver"]},
    }


def _order(p: Placed) -> tuple[Any, ...]:
    return (
        p.plane != "outer",
        p.level,
        -p.km2,
        p.polity,
        p.kind,
        p.rank,
        p.piece,
        p.form,
        p.lon,
        p.lat,
    )


def check_glyphs(per_step: Iterable[Sequence[Placed]], faces: Mapping[str, Face]) -> None:
    """Fails, naming each name and the characters its face lacks, where any does."""
    lacking: dict[tuple[str, str], str] = {}
    for placed in per_step:
        for p in placed:
            text = p.short if p.form == "short" else p.full
            missing = faces[p.plane].missing(lettered(text, p.plane))
            if missing:
                lacking[(text, faces[p.plane].name)] = missing
    if lacking:
        shown = "; ".join(f"{t!r} in {face}: {m!r}" for (t, face), m in sorted(lacking.items()))
        raise NamesError(f"{len(lacking)} names have characters their face lacks: {shown}")


@dataclass
class Record:
    """A placement drawn over a run of steps, by index."""

    placed: Placed
    first: int
    last: int


def merge(per_step: Sequence[Sequence[Placed]]) -> list[Record]:
    """Each run of consecutive steps that draw an equal placement, as one record."""
    open_: dict[Placed, Record] = {}
    done: list[Record] = []
    for index, placed in enumerate(per_step):
        current: dict[Placed, Record] = {}
        for p in placed:
            record = open_.get(p)
            if record is None:
                record = Record(p, index, index)
            else:
                record.last = index
            current[p] = record
        done.extend(r for p, r in open_.items() if p not in current)
        open_ = current
    done.extend(open_.values())
    return sorted(done, key=lambda r: (r.first, _order(r.placed)))


def chunk_document(first: int, years: Sequence[int], records: Sequence[Record]) -> dict[str, Any]:
    """A chunk's document: its steps, the names its placements draw, and the placements, eleven
    integers each (FIELDS), their steps relative to the chunk's first."""
    count = len(years)
    inside = [r for r in records if r.first < first + count and r.last >= first]
    names = sorted({(r.placed.full, r.placed.short) for r in inside})
    name_index = {pair: k for k, pair in enumerate(names)}
    groups = sorted({r.placed.group for r in inside})
    group_index = {g: k for k, g in enumerate(groups)}
    place: list[int] = []
    for r in inside:
        p = r.placed
        place += [
            name_index[(p.full, p.short)],
            max(r.first, first) - first,
            min(r.last, first + count - 1) - first,
            p.lon,
            p.lat,
            p.angle,
            p.em,
            p.span,
            round(p.km2),
            p.flags,
            group_index[p.group],
        ]
    return {
        "version": FORMAT,
        "first": first,
        "years": list(years),
        "fields": list(FIELDS),
        "names": [list(pair) for pair in names],
        "place": place,
    }


def write_chunks(
    ctx: Context,
    kept: Sequence[int],
    records: Sequence[Record],
    steps: Mapping[str, Any],
    rules: Rules,
) -> dict[str, Any]:
    """Writes each chunk of `per` steps as `fd/names/<sha16>.wsn`; the release's names section."""
    per = int(steps["previews"]["per"])
    keys, sizes, digests = [], [], {}
    for first in range(0, len(kept), per):
        doc = chunk_document(first, kept[first : first + per], records)
        payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
        data = gzip.compress(payload, compresslevel=9, mtime=0)
        key = f"{LAYER}/{sha256_bytes(data)[:16]}{EXTENSION}"
        write_object(ctx.out / key, data)
        keys.append(key)
        sizes.append(len(data))
        digests[key] = sha256_bytes(data)
    return {
        "ver": layer_version(digests),
        "steps": steps["ver"],
        "per": per,
        "keys": keys,
        "bytes": sizes,
        "placements": len(records),
        "faces": {plane: rules.faces[plane].label for plane in ("outer", "inner")},
        "glyphs": glyph_set(records),
    }


def glyph_set(records: Sequence[Record]) -> dict[str, str]:
    """The characters each face letters across every placement, sorted, spaces left out: the
    glyphs the app makes at boot (streaming.md 3.3, Names)."""
    found: dict[str, set[str]] = {"outer": set(), "inner": set()}
    for r in records:
        p = r.placed
        found[p.plane].update(lettered(p.short if p.form == "short" else p.full, p.plane))
    return {plane: "".join(sorted(chars - {" "})) for plane, chars in found.items()}


def _runs(years: Sequence[int], indices: Sequence[int]) -> list[list[int]]:
    """Consecutive step indices as runs of their years, first and last."""
    runs: list[list[int]] = []
    for index in sorted(indices):
        if runs and runs[-1][2] == index - 1:
            runs[-1][1] = years[index]
            runs[-1][2] = index
        else:
            runs.append([years[index], years[index], index])
    return [[a, b] for a, b, _ in runs]


def unnamed_report(
    kept: Sequence[int], named: Mapping[int, StepNames], per_step: Sequence[Sequence[Placed]]
) -> list[dict[str, Any]]:
    """Each polity a step draws but names nowhere, with why and the runs of steps it is so in: no
    land on the coasts, or no fit for any of its names."""
    found: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, year in enumerate(kept):
        drawn = {p.polity for p in per_step[index]}
        step = named[year]
        for polity, reason in step.unnamed.items():
            found[(polity, reason)].append(index)
        for polity in {meta["polity"] for _, meta in step.jobs} - drawn:
            found[(polity, "fits nowhere")].append(index)
    return [
        {"polity": polity, "reason": reason, "years": _runs(kept, indices)}
        for (polity, reason), indices in sorted(found.items())
    ]


def long_names_report(
    kept: Sequence[int], per_step: Sequence[Sequence[Placed]], rules: Rules
) -> list[dict[str, Any]]:
    """Each name drawn far still over `longName` characters after the short-name rule, with its
    full name and the runs of steps it is drawn in: for the owner, never shortened by hand."""
    found: dict[tuple[str, str], set[int]] = defaultdict(set)
    for index, placed in enumerate(per_step):
        for p in placed:
            if len(p.short) > rules.long_name:
                found[(p.short, p.full)].add(index)
    return [
        {"name": short, "full": full, "length": len(short), "years": _runs(kept, sorted(i))}
        for (short, full), i in sorted(found.items(), key=lambda e: (-len(e[0][0]), e[0]))
    ]
