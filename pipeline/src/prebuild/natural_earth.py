"""Natural Earth 10m vectors for the shore and water fields (streaming.md 3.1): the zip and excerpt
loaders, and each layer prepared once, in the parent process, before tiles rasterize it:

1. `make_valid`
2. drop Null island and apply the class filters (the land feature with no attributes stays)
3. union the layer: land with the minor islands (owner decision 12) for the shore, lakes for water
4. segmentize to at most 0.1° in lon and lat

The union keeps overlapping features from canceling under even-odd fill, as Georgian Bay, North
Channel and Saginaw Bay would inside Lake Huron. Rivers keep one line per feature, with its
scalerank. Workers receive the prepared layers as WKB (`to_wkb`).
"""

import gzip
import json
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pyogrio.raw
import shapely

from prebuild.config import WaterConfig
from prebuild.paths import excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.sources import verified_path

SEGMENT_DEG = 0.1
NULL_ISLAND = "Null island"
PHYSICAL = "natural-earth-10m-physical"
MINOR_ISLANDS = "natural-earth-10m-minor-islands"
# Layer name -> (source id, zip), as `excerpts` names its files under pipeline/tests/data/ne/.
ZIPS: dict[str, tuple[str, str]] = {
    "land": (PHYSICAL, "ne_10m_land.zip"),
    "minor_islands": (MINOR_ISLANDS, "ne_10m_minor_islands.zip"),
    "lakes": (PHYSICAL, "ne_10m_lakes.zip"),
    "rivers": (PHYSICAL, "ne_10m_rivers_lake_centerlines_scale_rank.zip"),
}
_COLLECTIONS = [
    shapely.GeometryType.MULTIPOINT,
    shapely.GeometryType.MULTILINESTRING,
    shapely.GeometryType.MULTIPOLYGON,
    shapely.GeometryType.GEOMETRYCOLLECTION,
]
_LENGTH = struct.Struct("<I")


@dataclass(frozen=True)
class Layer:
    """Features of one layer: shapely geometries and a column per attribute, row for row."""

    geoms: np.ndarray
    attrs: Mapping[str, np.ndarray]

    def __len__(self) -> int:
        return len(self.geoms)

    def rows(self, keep: np.ndarray) -> Layer:
        return Layer(self.geoms[keep], {name: v[keep] for name, v in self.attrs.items()})


@dataclass(frozen=True)
class Vectors:
    land: shapely.Geometry  # land and minor islands, one (multi)polygon
    lakes: shapely.Geometry  # the lakes that draw, one (multi)polygon
    rivers: Layer  # the river lines that draw, with `scalerank`


def read_zip_layer(path: Path) -> Layer:
    """Every feature of a zipped shapefile, with every attribute."""
    meta, _, wkb, fields = pyogrio.raw.read(path, read_geometry=True)
    names = [str(name) for name in meta["fields"]]
    return Layer(shapely.from_wkb(wkb), dict(zip(names, map(np.asarray, fields), strict=True)))


def land(layer: Layer, minor: Layer | None) -> shapely.Geometry:
    """NE land less Null island, joined with the minor islands. The land feature with no
    attributes, which holds 2,773 small islands, stays."""
    valid = shapely.make_valid(layer.geoms)
    kept = valid[layer.attrs["featurecla"] != NULL_ISLAND]
    parts = [kept] if minor is None else [kept, shapely.make_valid(minor.geoms)]
    return _prepare(np.concatenate(parts))


def lakes(layer: Layer, water: WaterConfig) -> shapely.Geometry:
    """The lakes whose class draws, and the reservoirs on the allowlist."""
    valid = shapely.make_valid(layer.geoms)
    drawn = np.isin(layer.attrs["featurecla"], water.lake_classes)
    allowed = np.isin(layer.attrs["ne_id"], sorted(water.reservoir_allowlist))
    return _prepare(valid[drawn | allowed])


def rivers(layer: Layer, water: WaterConfig) -> Layer:
    """The river lines whose class draws, segmentized, each with its scalerank."""
    kept = layer.rows(np.isin(layer.attrs["featurecla"], water.river_classes))
    lines = shapely.segmentize(shapely.make_valid(kept.geoms), SEGMENT_DEG)
    return Layer(lines, {"scalerank": kept.attrs["scalerank"].astype(np.int64)})


def load_vectors(ctx: Context, water: WaterConfig) -> Vectors:
    """The prepared layers: from the zips under $WANDER_DATA, or for the fixture from the committed
    excerpts, which are prepared the same way."""
    if ctx.profile is Profile.FIXTURE:
        folder = excerpts_dir(ctx.repo) / "ne"
        layers = {name: read_excerpt_layer(folder, name) for name in ZIPS}
    else:
        layers = {
            name: read_zip_layer(verified_path(ctx, source, filename))
            for name, (source, filename) in ZIPS.items()
        }
    return Vectors(
        land=land(layers["land"], layers["minor_islands"]),
        lakes=lakes(layers["lakes"], water),
        rivers=rivers(layers["rivers"], water),
    )


def to_wkb(vectors: Vectors) -> bytes:
    """The prepared layers for a worker: the river count, the river scaleranks as int32, then
    land, lakes and each river as `u32 length | WKB` records."""
    ranks = np.asarray(vectors.rivers.attrs["scalerank"], dtype="<i4")
    geoms = np.concatenate([[vectors.land, vectors.lakes], vectors.rivers.geoms])
    return _LENGTH.pack(len(ranks)) + ranks.tobytes() + records(geoms)


def from_wkb(data: bytes) -> Vectors:
    (count,) = _LENGTH.unpack_from(data)
    start = _LENGTH.size + 4 * count
    ranks = np.frombuffer(data[_LENGTH.size : start], dtype="<i4").astype(np.int64)
    geoms = parse_records(data[start:])
    return Vectors(geoms[0], geoms[1], Layer(geoms[2:], {"scalerank": ranks}))


def records(geoms: np.ndarray) -> bytes:
    """Repeated `u32 length | WKB` records, 2-D little-endian WKB."""
    wkb = shapely.to_wkb(geoms, output_dimension=2, byte_order=1)
    return b"".join(_LENGTH.pack(len(item)) + item for item in wkb)


def parse_records(data: bytes) -> np.ndarray:
    items = []
    at = 0
    while at < len(data):
        (length,) = _LENGTH.unpack_from(data, at)
        at += _LENGTH.size
        items.append(data[at : at + length])
        at += length
    return shapely.from_wkb(np.array(items, dtype=object))


def write_excerpt_layer(directory: Path, name: str, layer: Layer, meta: Mapping[str, Any]) -> None:
    """`<name>.wkb.gz` (gzip level 9 with mtime 0 of the records) and its sidecar `<name>.json`:
    `meta` (source, file, sha256, tiers), the row count and the attribute columns."""
    directory.mkdir(parents=True, exist_ok=True)
    stored = gzip.compress(records(layer.geoms), compresslevel=9, mtime=0)
    (directory / f"{name}.wkb.gz").write_bytes(stored)
    fields = {column: [_json_value(v) for v in values] for column, values in layer.attrs.items()}
    sidecar = {**meta, "rows": len(layer), "fields": fields}
    (directory / f"{name}.json").write_text(_json_text(sidecar) + "\n", encoding="utf-8")


def read_excerpt_layer(directory: Path, name: str) -> Layer:
    sidecar = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
    geoms = parse_records(gzip.decompress((directory / f"{name}.wkb.gz").read_bytes()))
    if len(geoms) != sidecar["rows"]:
        raise ValueError(f"{name}: {len(geoms)} geometries for {sidecar['rows']} rows")
    attrs = {column: _column(values) for column, values in sidecar["fields"].items()}
    return Layer(geoms, attrs)


def _prepare(geoms: np.ndarray) -> shapely.Geometry:
    """Union the polygons of already valid geometries, then segmentize."""
    union = shapely.union_all(parts_of_dimension(geoms, 2))
    return shapely.segmentize(union, SEGMENT_DEG)


def parts_of_dimension(geoms: Any, dim: int) -> np.ndarray:
    """The single-part geometries of dimension `dim` (1 lines, 2 polygons) inside `geoms`, which
    `make_valid`, clipping or a union may have made multi-part or mixed."""
    parts = shapely.get_parts(geoms)
    while np.isin(shapely.get_type_id(parts), _COLLECTIONS).any():
        parts = shapely.get_parts(parts)
    return parts[(shapely.get_dimensions(parts) == dim) & ~shapely.is_empty(parts)]


def _json_text(value: Any, depth: int = 0) -> str:
    """JSON with one key per line in objects and each array on one line."""
    if not isinstance(value, Mapping) or not value:
        return json.dumps(value, ensure_ascii=False)
    pad = "  " * (depth + 1)
    items = [f"{pad}{json.dumps(k)}: {_json_text(v, depth + 1)}" for k, v in value.items()]
    return "{\n" + ",\n".join(items) + "\n" + "  " * depth + "}"


def _json_value(value: Any) -> Any:
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def _column(values: list[Any]) -> np.ndarray:
    if values and all(isinstance(v, int) and not isinstance(v, bool) for v in values):
        return np.asarray(values, dtype=np.int64)
    return np.asarray(values, dtype=object)
