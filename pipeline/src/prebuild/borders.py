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
edge, computed from the same polygons, so lines run on across face edges (border_fields.py).

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

from prebuild.border_fields import (
    APRON,
    MARGIN_TEXELS,
    Polity,
    extend,
    rasterize,
    signed_subpixels,
    texel_distance,
)
from prebuild.codes import field_bytes
from prebuild.config import CONFIG_DIR, ConfigError
from prebuild.constants import FORMATS
from prebuild.fields import SUBPIXELS
from prebuild.hashing import sha256_bytes
from prebuild.layers import publish, staging_folder, write_object
from prebuild.natural_earth import parts_of_dimension
from prebuild.profiles import Context
from prebuild.records import write_record
from prebuild.sources import Source, load_sources, verified_path

STAGE = "borders"
LAYER = "fd/borders"
LICENSES = "lic"
SOURCE = "historical-basemaps"  # the source id in sources.toml
SNAPSHOT = re.compile(r"world_(bc\d+|\d+)\.geojson")
FACE_TEXELS = 2048  # stored per face side, apron included
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
