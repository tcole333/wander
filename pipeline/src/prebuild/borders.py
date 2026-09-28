"""The borders stage (streaming.md 3.3, 7.1, 7.2): each historical-basemaps snapshot pinned in
`sources.toml` as a field of signed distances to the borders between its polities, one plane per
cube face, with the GPL notice and the corrected source it is published under (owner decision 6).

For each snapshot `world_<stem>.geojson` the stage applies the cited corrections in
`pipeline/config/borders-<stem>.yaml`, then, face by face:

1. rasterizes the polities, largest first so enclaves stay, at 4x4 subpixels per texel in
   face-global subpixels (as fields.py does for coasts), over the face, its apron and a margin;
2. gives every subpixel no polity holds (the sea, and the slivers between the source's coarse
   coast and Natural Earth's) the polity nearest it, so no border ever follows a coast: the look
   draws borders on land only, and they end where it draws the coast;
3. takes each subpixel's distance E to the nearest subpixel center of another polity, D = E - 0.5,
   signed + on the side of the higher polity id; a texel's d is the mean D of its 2x2 central
   subpixels divided by 4, and where those straddle two borders' sides rather than a border (a
   polity's middle, where the nearest border changes), the mean of their sizes.

A polity is the snapshot's NAME, else its SUBJECTO; features with neither are one "unclaimed"
polity, so the lines between unnamed features never draw but a polity's edge against unclaimed land
does. Each face stores FACE_TEXELS texels a side: INTERIOR across the face and an APRON past each
edge, computed from the same polygons, so lines run on across face edges. Texel (i, j) is centered
at s = -1 + (2(i - APRON) + 1)/INTERIOR, t likewise; row 0 is the smallest t.

    'WBF1' u8 version | u8 faces (6) | u16 size (texels a side) | u16 apron | i16 year | u32 pad
    u8 d[6][size][size]    min(255, rha(128 + 16·clamp(d, -8, 8))), d in texels, + on the higher id

stored gzip level 9, mtime 0, as `fd/borders/<ver8>/<stem>.bin` in the profile's output root, the
corrected source as `lic/<sha16>.geojson` and the notice as `lic/<sha16>.txt`. The record
`build/stages/<profile>/borders.json` is release.json's borders section as is. The fixture profile
skips this stage: it reads raw data, and tests use synthetic snapshots.
"""

import copy
import gzip
import json
import math
import re
import shutil
import struct
import textwrap
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import shapely
import yaml
from scipy.ndimage import distance_transform_edt

from prebuild.codes import field_bytes
from prebuild.config import CONFIG_DIR, ConfigError
from prebuild.constants import FORMATS
from prebuild.cube import FACES, dir_to_lonlat, face_st, lonlat_to_dir, st_to_dir
from prebuild.fields import SUBPIXELS, Grid, fill
from prebuild.hashing import sha256_bytes
from prebuild.layers import publish, staging_folder, write_object
from prebuild.natural_earth import SEGMENT_DEG, parts_of_dimension
from prebuild.profiles import Context
from prebuild.records import write_record
from prebuild.sources import Source, load_sources, verified_path

type FloatArray = npt.NDArray[np.float64]
type IdArray = npt.NDArray[np.uint16]

STAGE = "borders"
LAYER = "fd/borders"
LICENSES = "lic"
SOURCE = "historical-basemaps"  # the source id in sources.toml
SNAPSHOT = re.compile(r"world_(bc\d+|\d+)\.geojson")
FACE_TEXELS = 2048  # stored per face side, apron included
APRON = 4  # texels past each face edge
MARGIN_TEXELS = 16  # rasterized past the apron, beyond the stored reach
CLIP_PAD_DEG = SEGMENT_DEG + 0.5  # around a face's footprint when clipping polygons
JUMP_SUBPIXELS = 1.0  # central subpixels all at least this far from a border straddle no border
MAGIC = str(FORMATS["borderField"]["magic"]).encode("ascii")
VERSION = int(FORMATS["borderField"]["version"])
HEADER = struct.Struct("<4sBBHHhI")  # 16 bytes
BUILD_SCRIPTS = "https://github.com/tcole333/wander/tree/borders-{ver}/pipeline"
GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.txt"
UNCLAIMED = ""  # the polity key of land the snapshot names no polity for


class BordersError(ValueError):
    """A snapshot or its corrections are not what the stage expects."""


@dataclass(frozen=True)
class Correction:
    polity: str
    becomes: str
    at: tuple[float, float] | None  # only the part holding this point, else all of the polity
    why: str
    source: Mapping[str, str]  # title, publisher, url


@dataclass(frozen=True)
class Corrections:
    modified: str  # the notice's date, YYYY-MM-DD
    items: tuple[Correction, ...]


@dataclass(frozen=True)
class Polity:
    id: int
    geometry: shapely.Geometry
    area: float  # square degrees, for the drawing order only


def run(ctx: Context) -> None:
    started = time.perf_counter()
    source = load_sources()[SOURCE]
    stems = snapshot_stems(source)
    layer = ctx.out / LAYER
    staging = staging_folder(layer)
    digests: dict[str, str] = {}
    sizes: dict[str, int] = {}
    corrected: dict[str, bytes] = {}
    fixes: dict[str, Corrections] = {}
    try:
        for stem in stems:
            path = verified_path(ctx, SOURCE, f"world_{stem}.geojson")
            fixes[stem] = load_corrections(stem)
            collection = correct(json.loads(path.read_bytes()), fixes[stem].items)
            corrected[stem] = geojson_bytes(collection)
            drawn = polities(collection)
            faces = [face_field(face, drawn, FACE_TEXELS) for face in range(6)]
            stored = to_file(np.stack(faces), stem_year(stem))
            (staging / f"{stem}.bin").write_bytes(stored)
            digests[f"{stem}.bin"] = sha256_bytes(stored)
            sizes[stem] = len(stored)
        ver = publish(staging, layer, digests)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    files = {}
    for stem in stems:
        key = f"{LAYER}/{ver}/{stem}.bin"
        source_key = write_license_file(ctx.out, corrected[stem], "geojson")
        text = notice(source, stem, fixes[stem], ver, key, source_key)
        notice_key = write_license_file(ctx.out, text.encode("utf-8"), "txt")
        files[stem] = {"key": key, "bytes": sizes[stem], "notice": notice_key, "source": source_key}
    record = {"ver": ver, "stems": stems, "years": [stem_year(s) for s in stems], "files": files}
    write_record(ctx, STAGE, record)
    seconds = time.perf_counter() - started
    total = sum(sizes.values()) / 1e6
    print(
        f"borders: {', '.join(stems)} into {LAYER}/{ver}/, {total:.1f} MB, {seconds:.1f} s",
        flush=True,
    )


def snapshot_stems(source: Source) -> list[str]:
    """The stems of the pinned snapshots, oldest first: `world_1815.geojson` gives 1815."""
    stems = [m.group(1) for f in source.files if (m := SNAPSHOT.fullmatch(Path(f.path).name))]
    return sorted(stems, key=stem_year)


def stem_year(stem: str) -> int:
    """A stem's astronomical year: `bc123000` is 1 - 123000, `1815` is 1815 (streaming.md 3.0)."""
    return 1 - int(stem[2:]) if stem.startswith("bc") else int(stem)


def polity_key(properties: Mapping[str, Any]) -> str:
    """The polity a feature belongs to: its NAME, else its SUBJECTO, else unclaimed land."""
    for field in ("NAME", "SUBJECTO"):
        value = properties.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return UNCLAIMED


def load_corrections(stem: str, directory: Path = CONFIG_DIR) -> Corrections:
    """`borders-<stem>.yaml`, or none when the snapshot has no such file."""
    path = directory / f"borders-{stem}.yaml"
    if not path.is_file():
        return Corrections(modified="", items=())
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or set(doc) != {"modified", "corrections"}:
        raise ConfigError(f"{path.name} needs exactly the keys corrections, modified")
    items = []
    for row in doc["corrections"]:
        keys = {"polity", "becomes", "why", "source"}
        if not isinstance(row, dict) or not keys <= set(row) <= keys | {"at"}:
            raise ConfigError(f"{path.name}: a correction needs {', '.join(sorted(keys))}")
        source = row["source"]
        if not isinstance(source, dict) or set(source) != {"title", "publisher", "url"}:
            raise ConfigError(f"{path.name}: {row['polity']}'s source needs title, publisher, url")
        at = row.get("at")
        items.append(
            Correction(
                polity=str(row["polity"]),
                becomes=str(row["becomes"]),
                at=None if at is None else (float(at[0]), float(at[1])),
                why=" ".join(str(row["why"]).split()),
                source={key: str(value) for key, value in source.items()},
            )
        )
    return Corrections(modified=str(doc["modified"]), items=tuple(items))


def correct(collection: Mapping[str, Any], corrections: Sequence[Correction]) -> dict[str, Any]:
    """The snapshot with each correction applied in turn: the polity's polygons (only the one
    holding `at`, if given) join the first feature of the polity it becomes, and a feature left
    with none is dropped. Every other feature stays as it was."""
    fixed = copy.deepcopy(dict(collection))
    features: list[dict[str, Any]] = fixed["features"]
    for c in corrections:
        target = next((f for f in features if polity_key(f["properties"]) == c.becomes), None)
        if target is None:
            raise BordersError(f"no polity {c.becomes!r} to give {c.polity}'s land to")
        moved = []
        for feature in features:
            if polity_key(feature["properties"]) != c.polity:
                continue
            parts = _polygons(feature["geometry"])
            taking = [p for p in parts if c.at is None or _holds(p, c.at)]
            moved += taking
            feature["geometry"] = {
                "type": "MultiPolygon",
                "coordinates": [p for p in parts if not any(p is q for q in taking)],
            }
        if not moved:
            where = "" if c.at is None else f" at {c.at}"
            raise BordersError(f"no land of {c.polity!r}{where} to correct")
        target["geometry"] = {
            "type": "MultiPolygon",
            "coordinates": _polygons(target["geometry"]) + moved,
        }
        features[:] = [f for f in features if f["geometry"]["coordinates"]]
    return fixed


def geojson_bytes(collection: Mapping[str, Any]) -> bytes:
    """The corrected source as published: compact UTF-8 JSON, keys in the source's order."""
    return json.dumps(collection, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def polities(collection: Mapping[str, Any]) -> list[Polity]:
    """Each feature's polygons with its polity's id, largest first: ids number the polity keys in
    sorted order from 1, unclaimed land first; 0 is left for no polity."""
    features = collection["features"]
    keys = sorted({polity_key(f["properties"]) for f in features})
    ids = {key: k + 1 for k, key in enumerate(keys)}
    drawn = []
    for feature in features:
        geometry = shapely.make_valid(shapely.from_geojson(json.dumps(feature["geometry"])))
        parts = parts_of_dimension(geometry, 2)
        if parts.size == 0:
            continue
        shape = shapely.multipolygons(parts)
        drawn.append(Polity(ids[polity_key(feature["properties"])], shape, shapely.area(shape)))
    if len(ids) > int(np.iinfo(np.uint16).max):
        raise BordersError(f"{len(ids)} polities do not fit u16 ids")
    return sorted(drawn, key=lambda p: (-p.area, p.id))


def face_field(
    face: int, drawn: Sequence[Polity], texels: int = FACE_TEXELS
) -> npt.NDArray[np.uint8]:
    """The stored bytes of one face, texels x texels, row 0 the smallest t."""
    subpixels = signed_subpixels(extend(rasterize(face, drawn, texels - 2 * APRON)))
    m = SUBPIXELS * MARGIN_TEXELS
    return field_bytes(texel_distance(subpixels[m:-m, m:-m]))


def rasterize(face: int, drawn: Sequence[Polity], interior: int) -> IdArray:
    """Polity ids at the face-global subpixels of the stored texels and the margin around them, 0
    where no polity is; later polities overwrite earlier ones."""
    reach = APRON + MARGIN_TEXELS
    side = SUBPIXELS * (interior + 2 * reach)
    origin = -SUBPIXELS * reach
    grid = Grid(face, 0, origin, origin, side, side)
    ids = np.zeros((side, side), dtype=np.uint16)
    boxes = face_boxes(face, interior)
    for polity in drawn:
        clipped = [shapely.clip_by_rect(polity.geometry, *box) for box in boxes]
        parts = parts_of_dimension(np.array(clipped, dtype=object), 2)
        if parts.size == 0:
            continue
        segments = ring_segments(shapely.segmentize(parts, SEGMENT_DEG), face, interior)
        window = _window(segments, grid)
        if window is None:
            continue
        mask = fill(segments, window)
        rows = slice(window.b0 - grid.b0, window.b0 - grid.b0 + window.height)
        cols = slice(window.a0 - grid.a0, window.a0 - grid.a0 + window.width)
        ids[rows, cols][mask] = polity.id
    return ids


def extend(ids: IdArray) -> IdArray:
    """Every subpixel no polity holds takes the id of the nearest one that holds one."""
    empty = ids == 0
    if not empty.any() or empty.all():
        return ids
    nearest = distance_transform_edt(empty, return_distances=False, return_indices=True)
    return ids[nearest[0], nearest[1]]


def signed_subpixels(ids: IdArray) -> npt.NDArray[np.float32]:
    """D per subpixel: E - 0.5, E the distance to the nearest subpixel center of another polity,
    + where this subpixel's id is the higher of the two; +inf with one polity only.

    E comes from the nearest border subpixel b (one with a 4-neighbor of another id): when b is of
    another polity, E = |p - b|; when b is of p's own, the other polity's subpixel lies one step
    past it, and E = |p - b| + 1."""
    other = ids.copy()
    border = np.zeros(ids.shape, dtype=bool)
    for axis in (0, 1):
        for step in (1, -1):
            neighbor = np.roll(ids, step, axis=axis)
            differs = neighbor != ids
            edge = [slice(None), slice(None)]
            edge[axis] = slice(0, 1) if step == 1 else slice(-1, None)
            differs[tuple(edge)] = False  # np.roll wraps; the raster's edge has no neighbor there
            border |= differs
            other = np.where(differs & (other == ids), neighbor, other)
    if not border.any():
        return np.full(ids.shape, np.inf, dtype=np.float32)
    distance, (rows, cols) = distance_transform_edt(~border, return_indices=True)
    nearest = ids[rows, cols]
    own = nearest == ids
    across = np.where(own, other[rows, cols], nearest)
    size = np.where(own, distance + 0.5, distance - 0.5).astype(np.float32)
    return np.where(ids > across, size, -size)


def texel_distance(d: npt.ArrayLike) -> FloatArray:
    """Each texel's d in texels from its 2x2 central subpixels: their mean over 4, or where they
    lie on both sides of a jump between two borders' sides (all at least JUMP_SUBPIXELS from a
    border, on both signs), their mean size with the sign of their sum."""
    sub = np.asarray(d, dtype=np.float64)
    blocks = sub.reshape(sub.shape[0] // SUBPIXELS, SUBPIXELS, sub.shape[1] // SUBPIXELS, -1)
    central = np.stack([blocks[:, i, :, j] for i in (1, 2) for j in (1, 2)])
    with np.errstate(invalid="ignore"):
        mean = central.mean(axis=0)
        sizes = np.abs(central)
        jump = (central.min(axis=0) < 0) & (central.max(axis=0) > 0)
        jump &= sizes.min(axis=0) >= JUMP_SUBPIXELS
        sign = np.where(mean < 0, -1.0, 1.0)
        return np.where(jump, sign * sizes.mean(axis=0), mean) / SUBPIXELS


def face_boxes(face: int, interior: int) -> list[tuple[float, float, float, float]]:
    """Lon/lat boxes (west, south, east, north) holding the raster's footprint on the face, padded,
    all within the face's hemisphere: one box, two where it crosses 180°, or a cap for a polar
    face."""
    edge = 1 + 2 * (APRON + MARGIN_TEXELS) / interior
    center = FACES[face, 0]
    if center[2] != 0:
        steps = np.linspace(-edge, edge, 513)
        ends = np.full(steps.size, edge)
        s = np.concatenate([steps, steps, -ends, ends])
        t = np.concatenate([-ends, ends, steps, steps])
        _, lat = dir_to_lonlat(st_to_dir(face, s, t))
        low = float(np.abs(lat).min()) - CLIP_PAD_DEG
        return [(-180.0, low, 180.0, 90.0)] if center[2] > 0 else [(-180.0, -90.0, 180.0, -low)]
    reach = math.degrees(math.pi / 4 * edge) + CLIP_PAD_DEG
    lon0 = math.degrees(math.atan2(center[1], center[0]))
    west, east = lon0 - reach, lon0 + reach
    if west < -180:
        return [(west + 360, -reach, 180.0, reach), (-180.0, -reach, east, reach)]
    if east > 180:
        return [(west, -reach, 180.0, reach), (-180.0, -reach, east - 360, reach)]
    return [(west, -reach, east, reach)]


def project(
    lon: npt.ArrayLike, lat: npt.ArrayLike, face: int, interior: int
) -> tuple[FloatArray, FloatArray]:
    """Face-global subpixel coordinates A_s = (s + 1)·2·SUBPIXELS·interior/4 - 0.5 and A_t alike,
    so the center of subpixel A (s = -1 + (2A + 1)/(SUBPIXELS·interior)) sits at A_s = A."""
    s, t = face_st(face, lonlat_to_dir(lon, lat))
    scale = SUBPIXELS * interior / 2
    return (s + 1) * scale - 0.5, (t + 1) * scale - 0.5


def ring_segments(polygons: np.ndarray, face: int, interior: int):
    """Every ring edge of the polygons, projected."""
    coords, ring = shapely.get_coordinates(shapely.get_rings(polygons), return_index=True)
    x, y = project(coords[:, 0], coords[:, 1], face, interior)
    same = ring[1:] == ring[:-1]
    return x[:-1][same], y[:-1][same], x[1:][same], y[1:][same]


def to_file(faces: npt.NDArray[np.uint8], year: int) -> bytes:
    """The stored file: the header and the six faces, gzip level 9, mtime 0, no file name."""
    count, size, _ = faces.shape
    header = HEADER.pack(MAGIC, VERSION, count, size, APRON, year, 0)
    return gzip.compress(header + faces.astype(np.uint8).tobytes(), compresslevel=9, mtime=0)


def from_file(data: bytes) -> tuple[int, npt.NDArray[np.uint8]]:
    """The year and the faces of a stored file."""
    raw = gzip.decompress(data)
    magic, version, count, size, apron, year, _ = HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION or apron != APRON:
        raise BordersError(f"not a version {VERSION} border field: {magic!r} {version}")
    faces = np.frombuffer(raw, np.uint8, offset=HEADER.size)
    return year, faces.reshape(count, size, size)


def write_license_file(out: Path, data: bytes, extension: str) -> str:
    """Writes `lic/<sha16>.<extension>` under the output root and returns its key."""
    key = f"{LICENSES}/{sha256_bytes(data)[:16]}.{extension}"
    write_object(out / key, data)
    return key


def notice(
    source: Source, stem: str, fixes: Corrections, ver: str, key: str, source_key: str
) -> str:
    """The GPL notice published beside a snapshot's borders (owner decision 6): what they come
    from, under which license, what changed and when, and where the changed source and the build
    scripts are."""
    pinned = next(f for f in source.files if Path(f.path).name == f"world_{stem}.geojson")
    corrections = [
        (
            f"{c.polity}{'' if c.at is None else f' (its part at {c.at[0]}, {c.at[1]})'} "
            f"becomes {c.becomes}. {c.why} Source: {c.source['title']}, {c.source['publisher']}, "
            f"{c.source['url']}"
        )
        for c in fixes.items
    ]
    changes = [
        *(["The corrections below are applied."] if corrections else []),
        f"The corrected snapshot is published beside this notice as {source_key}.",
        f"It is drawn on the six faces of Wander's cube sphere, {FACE_TEXELS - 2 * APRON:,} texels "
        "along each face edge, as signed distances to the borders between its polities, once "
        "every stretch of sea is given to the polity nearest it, so no border follows a coast. "
        f"The result is {key}.",
    ]
    lines = [
        f"Wander's historical borders, {stem}",
        "",
        *_wrap(
            f"These borders are built from {Path(pinned.path).name} of {source.attribution}, at "
            f"commit {source.version}:"
        ),
        f"  {source.landing_page}",
        f"  {pinned.source_url}",
        "",
        *_wrap(
            f"Like their source, they are free software under the {_license_name(source)}, with "
            "no warranty, to the extent permitted by law:"
        ),
        f"  {GPL_URL}",
        "",
        f"Changed for Wander on {fixes.modified}:" if fixes.modified else "Changed for Wander:",
        *[line for change in changes for line in _wrap(change, "- ")],
        *(["", "Corrections:"] if corrections else []),
        *[line for c in corrections for line in _wrap(c, "- ")],
        "",
        "The build scripts:",
        f"  {BUILD_SCRIPTS.format(ver=ver)}",
        "",
    ]
    return "\n".join(lines)


def _wrap(text: str, bullet: str = "") -> list[str]:
    """Text wrapped at 80 columns, hanging under its bullet; URLs never break."""
    indent = " " * len(bullet)
    return textwrap.wrap(
        text,
        80,
        initial_indent=bullet,
        subsequent_indent=indent,
        break_long_words=False,
        break_on_hyphens=False,
    )


def _license_name(source: Source) -> str:
    if source.license == "GPL-3.0":
        return "GNU General Public License, version 3 (GPL-3.0)"
    return source.license


def _polygons(geometry: Mapping[str, Any]) -> list[Any]:
    kind = geometry["type"]
    if kind == "Polygon":
        return [geometry["coordinates"]]
    if kind == "MultiPolygon":
        return list(geometry["coordinates"])
    raise BordersError(f"a {kind} is no polity's land")


def _holds(polygon: Any, at: tuple[float, float]) -> bool:
    return bool(shapely.Polygon(polygon[0], polygon[1:]).contains(shapely.Point(at)))


def _window(segments, grid: Grid) -> Grid | None:
    """The part of the raster the segments' bounding box covers, or None when it misses it."""
    x0, y0, x1, y1 = segments
    if x0.size == 0:
        return None
    b_lo = max(grid.b0, math.ceil(min(y0.min(), y1.min())))
    b_hi = min(grid.b0 + grid.height - 1, math.floor(max(y0.max(), y1.max())))
    a_lo = max(grid.a0, math.floor(min(x0.min(), x1.min())))
    a_hi = min(grid.a0 + grid.width - 1, math.ceil(max(x0.max(), x1.max())))
    if b_lo > b_hi or a_lo > a_hi:
        return None
    return Grid(grid.face, 0, b_lo, a_lo, b_hi - b_lo + 1, a_hi - a_lo + 1)
