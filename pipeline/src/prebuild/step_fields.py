"""One border step's field and preview (streaming.md 3.3), baked from its selection
(cliopatria.py), the files that store them, and the cache that lets a bake skip a step whose
inputs are unchanged.

**Field.** One raster of the step's land at 4x4 subpixels per texel (border_fields.py) makes both
planes. The selection's parts and its stateless land take raster ids; the sea and the lakes are
emptied, so the fill gives them the nearest id and no border follows a coast or rings a lake. First
a hole inside one state takes the nearest id of that state's land, never another's, which can lie
nearer across a lake, and the other pockets the selection gives that touch a polity take the nearest
polity's id, never stateless land's, which can too.
Land within `sliverKm` of a lake that lies within `sliverKm` of another id is emptied too, so a
polity whose shape reaches over a lake and onto a thin strip of the far shore does not draw its
border along that shore: the fill carries it across the lake. Each plane keeps the borders between
the id pairs its mask names:

- R, the outer plane: between two outer units, unless the piece on either side is minor, and
  every edge against stateless land. Its distance is signed + on the higher outer id.
- G, the inner plane: between two polities of one outer unit, and between two outer units where
  the piece on either side is minor. Its distance is signed + on the higher polity id.

Ids are the polities' ids (cliopatria.polity_ids), which number the sorted names, so a border's
sign follows the order of the two names on it: a correction elsewhere in time that adds a name
changes no other step's bytes.

    'WBF2' u8 version | u8 faces (6) | u16 size (1024) | u16 apron (4) | i16 year | u8 channels (2)
    u8 pad[3] | u8 rg[6][size][size][2]
      R: min(255, rha(128 + 16·clamp(d, -8, 8))), d in texels to the nearest R border
      G: bit 7 soft, where the nearest R border has stateless land on one side (3 of a texel's 4
         central subpixels); bits 0-6 rha(64 + 8·clamp(d, -8, 7.875)), d in texels to the nearest
         G border, 127 where the face holds none

**Preview.** The R plane alone on a 512 x 256 equirectangular grid (streaming.md 3.0), wrapped in
longitude, d in preview texels (78 km at the equator): v = (q << 1) | soft,
q = rha(64 + 8·clamp(d, -8, 7.875)). Chunks of at most PER_CHUNK steps store them:

    'WBP2' u8 version | u8 pad | u16 count | u16 w (512) | u16 h (256) | i32 years[count]
    u8 layer[count][256][512], the first raw, each later one (v - previous) mod 256

Both are gzip level 9, mtime 0.

**Cache.** A step's key hashes what its bytes depend on: its year, the rows valid in it, the
hierarchy entries and correction operations that reach it, the rules, the land and lakes, the code
in STEP_CODE, and the land the carry-through carries in it (`carried_key`).
`build/cache/borders/<key>/` holds its stored field, its preview layer and what its selection
reported. The carry-through reads every step selected without it: `build/cache/borders/plain/`
keeps each step's Plain by its key without the carried land, and what the carry-through found by
every step's such key.
"""

import gzip
import json
import math
import multiprocessing
import os
import shutil
import struct
from collections.abc import Callable, Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import shapely
from scipy.ndimage import distance_transform_edt, find_objects, maximum_filter, minimum_filter

from prebuild import cliopatria as clio
from prebuild.border_fields import (
    APRON,
    MARGIN_TEXELS,
    IdArray,
    Polity,
    _window,
    extend,
    rasterize,
    signed_subpixels,
    texel_distance,
)
from prebuild.codes import field_bytes, round_half_away
from prebuild.constants import FORMATS
from prebuild.cube import EARTH_RADIUS_M
from prebuild.fields import SUBPIXELS, Grid, fill
from prebuild.hashing import sha256_bytes, tree_sha
from prebuild.natural_earth import parts_of_dimension
from prebuild.paths import config_dir
from prebuild.profiles import Context

type Bytes = npt.NDArray[np.uint8]
type Bools = npt.NDArray[np.bool_]
type Keep = npt.NDArray[np.bool_]  # [a, b]: whether a plane keeps the border between ids a and b

STEP_TEXELS = 1024  # stored per face side, apron included (owner decision 36)
FACES = 6
CHANNELS = 2
PREVIEW_WIDTH, PREVIEW_HEIGHT = 512, 256
PREVIEW_MARGIN = 12  # preview texels wrapped in longitude past each side, past the stored reach
PER_CHUNK = 16  # previews a chunk holds; chunks start at multiples of it, so at even steps
SOFT_MIN = 3  # of a texel's 4 central subpixels
INNER_ZERO, INNER_STEP, INNER_LOW, INNER_HIGH = 64, 8, -8.0, 7.875
STATELESS = 1  # stateless land's raster id; parts number from 2
STEP_MAGIC = str(FORMATS["borderStep"]["magic"]).encode("ascii")
STEP_VERSION = int(FORMATS["borderStep"]["version"])
PREVIEW_MAGIC = str(FORMATS["borderPreviews"]["magic"]).encode("ascii")
PREVIEW_VERSION = int(FORMATS["borderPreviews"]["version"])
STEP_HEADER = struct.Struct("<4sBBHHhB3x")  # 16 bytes
PREVIEW_HEADER = struct.Struct("<4sBxHHH")  # 12 bytes, then the years
# The code a step's bytes depend on, whose tree hash joins every step's key.
STEP_CODE = (
    "pipeline/src/prebuild/border_fields.py",
    "pipeline/src/prebuild/step_fields.py",
    "pipeline/src/prebuild/cliopatria.py",
    "pipeline/src/prebuild/fields.py",
    "pipeline/src/prebuild/cube.py",
    "pipeline/src/prebuild/codes.py",
    "pipeline/src/prebuild/natural_earth.py",
    "pipeline/uv.lock",
    "shared/constants.json",
)
CACHE = "borders"  # under build/cache/
PLAIN = "plain"  # under CACHE: the steps selected without the carry-through, and what it found


class StepError(ValueError):
    """A stored step or preview chunk is not what the format says."""


# Rasters ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class StepRaster:
    """A step's land as raster ids: stateless land 1, the selection's parts from 2."""

    shapes: tuple[Polity, ...]  # largest first, so a smaller shape wins a shared edge
    pockets: shapely.Geometry  # the other pockets touching a polity, filled from the polities
    holes: tuple[tuple[int, shapely.Geometry], ...]  # the holes inside one state, by its outer id
    polity: npt.NDArray[np.int32]  # by raster id, the polity's id: the order of G's sides
    outer: npt.NDArray[np.int32]  # by raster id, its outer unit's id: the order of R's sides
    minor: Bools  # by raster id, whether it lies in a minor piece

    def keep(self) -> tuple[Keep, Keep]:
        """The id pairs R and G keep a border between."""
        n = self.polity.size
        a, b = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        real = (a > 0) & (b > 0)
        stateless = (a == STATELESS) | (b == STATELESS)
        minor = self.minor[a] | self.minor[b]
        apart = self.outer[a] != self.outer[b]
        r = real & apart & (stateless | ~minor)
        g = real & ~stateless & (self.polity[a] != self.polity[b]) & (~apart | minor)
        return r, g


def step_raster(selection: clio.Selection, ids: Mapping[str, int]) -> StepRaster:
    """The raster ids of a step's parts and stateless land, with their polity and outer unit ids."""
    count = len(selection.parts) + STATELESS + 1
    polity = np.zeros(count, dtype=np.int32)
    outer = np.zeros(count, dtype=np.int32)
    minor = np.zeros(count, dtype=bool)
    polity[STATELESS] = outer[STATELESS] = ids[clio.STATELESS]
    shapes = []
    if not shapely.is_empty(selection.stateless):
        shapes.append((STATELESS, selection.stateless))
    for k, part in enumerate(selection.parts, STATELESS + 1):
        polity[k], outer[k], minor[k] = ids[part.polity], ids[part.outer], part.minor
        shapes.append((k, part.geometry))
    drawn = [Polity(k, shape, float(shapely.area(shape))) for k, shape in shapes]
    drawn.sort(key=lambda p: (-p.area, p.id))
    holes = tuple((ids[unit], shape) for unit, shape in selection.holes)
    return StepRaster(tuple(drawn), selection.pockets, holes, polity, outer, minor)


def masked_signed(
    ids: IdArray, keep: Keep, order: npt.NDArray[np.int32], soft: bool = False
) -> tuple[npt.NDArray[np.float32], Bools | None]:
    """D per subpixel to the nearest border `keep` keeps, as `signed_subpixels` gives it, + on the
    side whose `order` is higher. A subpixel beyond a border `keep` does not keep takes the side of
    the border subpixel nearest it, so the sign never flips over a border the plane leaves out.
    With `soft`, also whether that border subpixel's border has stateless land on one side."""
    other = ids.copy()
    border = np.zeros(ids.shape, dtype=bool)
    touch = np.zeros(ids.shape, dtype=bool) if soft else None
    for axis in (0, 1):
        for step in (1, -1):
            neighbor = np.roll(ids, step, axis=axis)
            kept = keep[ids, neighbor]
            edge = [slice(None), slice(None)]
            edge[axis] = slice(0, 1) if step == 1 else slice(-1, None)
            kept[tuple(edge)] = False  # np.roll wraps; the raster's edge has no neighbor there
            border |= kept
            other = np.where(kept & (other == ids), neighbor, other)
            if touch is not None:
                touch |= kept & ((ids == STATELESS) | (neighbor == STATELESS))
            del neighbor, kept
    if not border.any():
        none = np.zeros(ids.shape, dtype=bool) if soft else None
        return np.full(ids.shape, np.inf, dtype=np.float32), none
    distance, (rows, cols) = distance_transform_edt(~border, return_indices=True)
    del border
    mine = ids[rows, cols]
    across = other[rows, cols]
    del other
    # Across a kept border from the nearest border subpixel's side: E = |p - b|. On its side, or
    # beyond a border the plane leaves out: E = |p - b| + 1, as if on its side.
    beyond = keep[ids, mine]
    size = np.where(beyond, distance - 0.5, distance + 0.5).astype(np.float32)
    del distance
    positive = np.where(beyond, order[ids] > order[mine], order[mine] > order[across])
    del mine, across, beyond
    near = touch[rows, cols] if touch is not None else None
    return np.where(positive, size, -size), near


def texel_soft(soft: Bools) -> Bools:
    """A texel is soft when at least SOFT_MIN of its 2x2 central subpixels are."""
    blocks = soft.reshape(soft.shape[0] // SUBPIXELS, SUBPIXELS, soft.shape[1] // SUBPIXELS, -1)
    count = sum(blocks[:, i, :, j].astype(np.uint8) for i in (1, 2) for j in (1, 2))
    return count >= SOFT_MIN


def inner_bytes(d_texels: npt.ArrayLike) -> Bytes:
    """G's bits 0-6, and a preview's q: rha(64 + 8·clamp(d, -8, 7.875))."""
    d = np.clip(np.asarray(d_texels, dtype=np.float64), INNER_LOW, INNER_HIGH)
    return round_half_away(INNER_ZERO + INNER_STEP * d).astype(np.uint8)


def fill_given(
    ids: IdArray, raster: StepRaster, dry: Bools, draw: Callable[[Sequence[Polity]], IdArray]
) -> None:
    """Fills, in place, the land the selection gives away that touches a polity: the holes inside
    one state from that state's land, then the other pockets from the polities. `draw` rasterizes
    shapes on the grid of `ids`."""
    pockets = np.zeros(ids.shape, dtype=bool)
    if raster.holes:
        holes = draw([Polity(k + 1, shape, 0.0) for k, (_, shape) in enumerate(raster.holes)])
        holes[~dry] = 0
        pockets = fill_holes(ids, holes, [unit for unit, _ in raster.holes], raster.outer)
    if not shapely.is_empty(raster.pockets):
        pockets |= (draw([Polity(1, raster.pockets, 0.0)]) > 0) & dry
    fill_pockets(ids, pockets)


def fill_holes(
    ids: IdArray, holes: IdArray, units: Sequence[int], outer: npt.NDArray[np.int32]
) -> Bools:
    """Gives, in place, each subpixel of a hole, k + 1 in `holes`, the id of the nearest subpixel
    whose outer unit (`outer`, by raster id) is units[k]: a hole inside one state is that state's
    land though another's lies nearer across a lake, and among an empire's members each takes the
    part nearest it. The search runs within twice the hole's extent around it, which holds the land
    along its edge. Returns the holes' subpixels whose state holds no land there, as at the edge of
    a face's raster, for the pockets' fill."""
    left = np.zeros(ids.shape, dtype=bool)
    for k, box in enumerate(find_objects(holes)):
        if box is None:
            continue
        rows, cols = box
        reach = 2 * max(rows.stop - rows.start, cols.stop - cols.start) + 2
        window = (
            slice(max(0, rows.start - reach), rows.stop + reach),
            slice(max(0, cols.start - reach), cols.stop + reach),
        )
        hole = holes[window] == k + 1
        part = ids[window]
        held = outer[part] == units[k]
        if not held.any():
            left[window] |= hole
            continue
        near = distance_transform_edt(~held, return_distances=False, return_indices=True)
        part[hole] = part[near[0][hole], near[1][hole]]
    return left


def fill_pockets(ids: IdArray, pockets: Bools) -> None:
    """Gives, in place, each subpixel of `pockets` the id of the nearest polity's subpixel, never
    stateless land's: a pocket goes to its neighbours, and across a lake stateless land can lie
    nearer than the polity beside it."""
    if not pockets.any():
        return
    held = ids > STATELESS
    if not held.any():
        return
    rows, cols = distance_transform_edt(~held, return_distances=False, return_indices=True)
    ids[pockets] = ids[rows[pockets], cols[pockets]]


def empty_lakeside(ids: IdArray, lakeside: Bools, reach: int) -> None:
    """Empties, in place, the land in `lakeside` that lies within `reach` subpixels (a square) of
    another id, so the fill carries a border across a lake rather than along its shore."""
    if reach < 1 or not lakeside.any():
        return
    rows = np.flatnonzero(lakeside.any(axis=1))
    cols = np.flatnonzero(lakeside.any(axis=0))
    r0, r1 = max(0, rows[0] - reach), min(ids.shape[0], rows[-1] + reach + 1)
    c0, c1 = max(0, cols[0] - reach), min(ids.shape[1], cols[-1] + reach + 1)
    window = ids[r0:r1, c0:c1]
    size = 2 * reach + 1
    high = maximum_filter(window, size=size, mode="nearest")
    empty = np.iinfo(ids.dtype).max
    low = minimum_filter(np.where(window == 0, empty, window), size=size, mode="nearest")
    window[(window > 0) & (high != low) & lakeside[r0:r1, c0:c1]] = 0


def lakeside_reach(subpixel_km: float, sliver_km: float) -> int:
    """sliverKm in subpixels of `subpixel_km`, rounded."""
    return int(round_half_away(sliver_km / subpixel_km))


def face_planes(
    face: int, raster: StepRaster, dry: Bools, lakeside: Bools, reach: int, texels: int
) -> Bytes:
    """One face's stored R and G bytes, texels x texels x 2, row 0 the smallest t. `dry` is the
    face's land less its lakes and `lakeside` the land within `reach` subpixels of a lake, at the
    raster's subpixels."""
    keep_r, keep_g = raster.keep()
    ids = rasterize(face, raster.shapes, texels - 2 * APRON)
    ids[~dry] = 0
    fill_given(ids, raster, dry, lambda shapes: rasterize(face, shapes, texels - 2 * APRON))
    empty_lakeside(ids, lakeside, reach)
    ids = extend(ids)
    m = SUBPIXELS * MARGIN_TEXELS
    r_sub, soft_sub = masked_signed(ids, keep_r, raster.outer, soft=True)
    r = field_bytes(texel_distance(r_sub[m:-m, m:-m]))
    del r_sub
    assert soft_sub is not None
    soft = texel_soft(soft_sub[m:-m, m:-m])
    del soft_sub
    g_sub, _ = masked_signed(ids, keep_g, raster.polity)
    del ids
    g = inner_bytes(texel_distance(g_sub[m:-m, m:-m])) | (soft.astype(np.uint8) << 7)
    return np.stack([r, g], axis=-1)


def face_dry(face: int, dry: shapely.Geometry, texels: int) -> Bools:
    """Where a face's raster lies on land less lakes."""
    return rasterize(face, [Polity(1, dry, 0.0)], texels - 2 * APRON) > 0


def lake_masks(face: int, lakes: shapely.Geometry, texels: int, reach: int) -> tuple[Bytes, Bools]:
    """A face's signed distance to the drawn lakes' shores, as R stores it, + off the lakes, what
    `npm run verify:bake` checks the borders against; and the subpixels within `reach` of a
    lake."""
    wet = rasterize(face, [Polity(1, lakes, 0.0)], texels - 2 * APRON) > 0
    ids = np.where(wet, 1, 2).astype(np.uint16)
    m = SUBPIXELS * MARGIN_TEXELS
    shore = field_bytes(texel_distance(signed_subpixels(ids)[m:-m, m:-m]))
    return shore, _within(wet, reach)


def _within(mask: Bools, reach: int) -> Bools:
    """The subpixels within `reach` of the mask, outside it."""
    if not mask.any() or reach < 1:
        return np.zeros(mask.shape, dtype=bool)
    return ~mask & (distance_transform_edt(~mask) <= reach)


def equirect_ids(shapes: Sequence[Polity], width: int, height: int) -> IdArray:
    """Ids at the subpixels of an equirectangular grid over the globe, row 0 the northmost, 0
    where no shape is; later shapes overwrite earlier ones."""
    grid = Grid(0, 0, 0, 0, height, width)
    ids = np.zeros((height, width), dtype=np.uint16)
    for shape in shapes:
        parts = parts_of_dimension(shape.geometry, 2)
        if parts.size == 0:
            continue
        coords, ring = shapely.get_coordinates(shapely.get_rings(parts), return_index=True)
        x = (coords[:, 0] + 180) / 360 * width - 0.5
        y = (90 - coords[:, 1]) / 180 * height - 0.5
        same = ring[1:] == ring[:-1]
        segments = x[:-1][same], y[:-1][same], x[1:][same], y[1:][same]
        window = _window(segments, grid)
        if window is None:
            continue
        mask = fill(segments, window)
        rows = slice(window.b0, window.b0 + window.height)
        cols = slice(window.a0, window.a0 + window.width)
        ids[rows, cols][mask] = shape.id
    return ids


def preview_dry(dry: shapely.Geometry) -> Bools:
    """Where the preview's subpixels lie on land less lakes."""
    width, height = PREVIEW_WIDTH * SUBPIXELS, PREVIEW_HEIGHT * SUBPIXELS
    return equirect_ids([Polity(1, dry, 0.0)], width, height) > 0


def preview_lakeside(lakes: shapely.Geometry, reach: int) -> Bools:
    """The preview's subpixels within `reach` of a lake."""
    width, height = PREVIEW_WIDTH * SUBPIXELS, PREVIEW_HEIGHT * SUBPIXELS
    return _within(equirect_ids([Polity(1, lakes, 0.0)], width, height) > 0, reach)


def preview_layer(raster: StepRaster, dry: Bools, lakeside: Bools, reach: int) -> Bytes:
    """A step's preview, PREVIEW_HEIGHT x PREVIEW_WIDTH bytes: R's distance and soft bit."""
    width, height = PREVIEW_WIDTH * SUBPIXELS, PREVIEW_HEIGHT * SUBPIXELS
    ids = equirect_ids(raster.shapes, width, height)
    ids[~dry] = 0
    fill_given(ids, raster, dry, lambda shapes: equirect_ids(shapes, width, height))
    empty_lakeside(ids, lakeside, reach)
    pad = PREVIEW_MARGIN * SUBPIXELS
    ids = extend(np.concatenate([ids[:, -pad:], ids, ids[:, :pad]], axis=1))
    keep_r, _ = raster.keep()
    d, soft = masked_signed(ids, keep_r, raster.outer, soft=True)
    assert soft is not None
    q = inner_bytes(texel_distance(d[:, pad:-pad]))
    return (q << 1) | texel_soft(soft[:, pad:-pad]).astype(np.uint8)


# Files -----------------------------------------------------------------------------------------


def step_file(faces: Bytes, year: int) -> bytes:
    """The stored step: the header and the six faces' R and G, gzip level 9, mtime 0."""
    count, size, _, channels = faces.shape
    header = STEP_HEADER.pack(STEP_MAGIC, STEP_VERSION, count, size, APRON, year, channels)
    return gzip.compress(header + faces.astype(np.uint8).tobytes(), compresslevel=9, mtime=0)


def read_step(data: bytes) -> tuple[int, Bytes]:
    """The year and the faces, [6][size][size][2], of a stored step."""
    raw = gzip.decompress(data)
    magic, version, count, size, apron, year, channels = STEP_HEADER.unpack_from(raw)
    if magic != STEP_MAGIC or version != STEP_VERSION or apron != APRON or channels != CHANNELS:
        raise StepError(f"not a version {STEP_VERSION} border step: {magic!r} {version}")
    faces = np.frombuffer(raw, np.uint8, offset=STEP_HEADER.size)
    if faces.size != count * size * size * channels:
        raise StepError(f"{faces.size} bytes are not {count} faces of {size}² x {channels}")
    return year, faces.reshape(count, size, size, channels)


def chunk_file(years: Sequence[int], layers: Sequence[Bytes]) -> bytes:
    """A stored preview chunk: the first layer raw, each later one less the one before, mod 256."""
    if not 0 < len(years) == len(layers) <= PER_CHUNK:
        raise StepError(f"a chunk holds 1-{PER_CHUNK} previews, not {len(layers)}")
    stack = np.stack([np.asarray(layer, dtype=np.uint8) for layer in layers])
    if stack.shape[1:] != (PREVIEW_HEIGHT, PREVIEW_WIDTH):
        raise StepError(f"a preview is {PREVIEW_HEIGHT} x {PREVIEW_WIDTH}, not {stack.shape[1:]}")
    deltas = stack.copy()
    deltas[1:] = stack[1:] - stack[:-1]  # uint8 arithmetic wraps mod 256
    header = PREVIEW_HEADER.pack(
        PREVIEW_MAGIC, PREVIEW_VERSION, len(years), PREVIEW_WIDTH, PREVIEW_HEIGHT
    )
    body = header + struct.pack(f"<{len(years)}i", *years) + deltas.tobytes()
    return gzip.compress(body, compresslevel=9, mtime=0)


def read_chunk(data: bytes) -> tuple[list[int], Bytes]:
    """The years and the previews, [count][256][512], of a stored chunk."""
    raw = gzip.decompress(data)
    magic, version, count, width, height = PREVIEW_HEADER.unpack_from(raw)
    if magic != PREVIEW_MAGIC or version != PREVIEW_VERSION:
        raise StepError(f"not a version {PREVIEW_VERSION} preview chunk: {magic!r} {version}")
    years = list(struct.unpack_from(f"<{count}i", raw, PREVIEW_HEADER.size))
    offset = PREVIEW_HEADER.size + 4 * count
    deltas = np.frombuffer(raw, np.uint8, offset=offset)
    if deltas.size != count * width * height:
        raise StepError(f"{deltas.size} bytes are not {count} previews of {width} x {height}")
    layers = np.cumsum(deltas.reshape(count, height, width), axis=0, dtype=np.uint8)
    return years, layers


# Keys and the cache ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Terrain:
    """The land less lakes and the land beside lakes on each face and on the preview grid, and the
    lakes' shores."""

    identity: str  # sha256 over the prepared land and lakes
    texels: int  # a face side's stored texels, apron included
    reach: int  # sliverKm in a face's subpixels
    preview_reach: int  # and in the preview's
    dry: tuple[bytes, ...]  # per face, np.packbits of the subpixel mask
    lakeside: tuple[bytes, ...]  # per face, np.packbits of the land within reach of a lake
    preview: bytes  # np.packbits of the preview grid's land less lakes
    preview_lakeside: bytes  # and of its land within preview_reach of a lake
    shores: tuple[bytes, ...]  # per face, the lakes' shores as R stores them


def terrain_masks(ctx: Context, terrain: clio.Terrain, sliver_km: float, jobs: int = 1) -> Terrain:
    """The masks every step reads, from the cache when the land, the lakes, sliverKm and the code
    are those they were made from."""
    identity = sha256_bytes(terrain.to_wkb())
    texels = STEP_TEXELS
    face_km = math.pi / 2 * EARTH_RADIUS_M / 1000 / (texels - 2 * APRON) / SUBPIXELS
    preview_km = math.pi * EARTH_RADIUS_M / 1000 / (PREVIEW_HEIGHT * SUBPIXELS)
    reach = lakeside_reach(face_km, sliver_km)
    preview_reach = lakeside_reach(preview_km, sliver_km)
    name = f"terrain-{texels}-{reach}-{preview_reach}-{_code(ctx.repo)[:16]}-{identity[:16]}"
    folder = ctx.cache / CACHE / name
    faces = list(range(FACES))
    names = [f"{kind}-{f}.bin" for kind in ("dry", "lakeside", "shore") for f in faces]
    names += ["preview.bin", "preview-lakeside.bin"]
    if not all((folder / name).is_file() for name in names):
        dry_work = [(f, terrain.dry, texels) for f in faces]
        lake_work = [(f, terrain.lakes, texels, reach) for f in faces]
        if jobs <= 1:
            dry = [_face_dry(item) for item in dry_work]
            lakes = [_lake_masks(item) for item in lake_work]
        else:
            with _pool(min(jobs, FACES), None) as pool:
                dry = list(pool.map(_face_dry, dry_work))
                lakes = list(pool.map(_lake_masks, lake_work))
        files = {f"dry-{f}.bin": dry[f] for f in faces}
        files |= {f"shore-{f}.bin": lakes[f][0] for f in faces}
        files |= {f"lakeside-{f}.bin": lakes[f][1] for f in faces}
        files["preview.bin"] = np.packbits(preview_dry(terrain.dry)).tobytes()
        beside = preview_lakeside(terrain.lakes, preview_reach)
        files["preview-lakeside.bin"] = np.packbits(beside).tobytes()
        packed = {name: gzip.compress(data, 1, mtime=0) for name, data in files.items()}
        _write_folder(folder, packed)
    read = {name: gzip.decompress((folder / name).read_bytes()) for name in names}
    return Terrain(
        identity=identity,
        texels=texels,
        reach=reach,
        preview_reach=preview_reach,
        dry=tuple(read[f"dry-{f}.bin"] for f in faces),
        lakeside=tuple(read[f"lakeside-{f}.bin"] for f in faces),
        preview=read["preview.bin"],
        preview_lakeside=read["preview-lakeside.bin"],
        shores=tuple(read[f"shore-{f}.bin"] for f in faces),
    )


def _face_dry(args: tuple[int, shapely.Geometry, int]) -> bytes:
    return np.packbits(face_dry(*args)).tobytes()


def _lake_masks(args: tuple[int, shapely.Geometry, int, int]) -> tuple[bytes, bytes]:
    shore, lakeside = lake_masks(*args)
    return shore.tobytes(), np.packbits(lakeside).tobytes()


def _unpack(packed: bytes, shape: tuple[int, int]) -> Bools:
    count = shape[0] * shape[1]
    return np.unpackbits(np.frombuffer(packed, np.uint8), count=count).reshape(shape).astype(bool)


def face_side(texels: int) -> int:
    """Subpixels along a face raster's side, margin included."""
    return SUBPIXELS * (texels + 2 * MARGIN_TEXELS)


def step_key(year: int, source: clio.Cliopatria, config: clio.Config, identity: str) -> str:
    """What a step's selection without the carry-through depends on, hashed: `identity` (the code
    and the terrain), the rules, the year, the POLITY and vassalage rows valid in it, the
    hierarchy's classes of those, and the operations of the corrections active in it."""
    rows = [
        r for r in source.rows if r.holds(year) and (r.polity or clio.VASSALAGE.fullmatch(r.name))
    ]
    hierarchy = config.hierarchy
    classes = {
        r.name: hierarchy.composites.get(r.name) if r.polity else hierarchy.relations.get(r.name)
        for r in rows
        if r.composite
    }
    active = [
        operation_digest(c, source) for c in config.corrections if c.years[0] <= year <= c.years[1]
    ]
    doc = {
        "identity": identity,
        "texels": STEP_TEXELS,
        "rules": asdict(config.rules),
        "year": year,
        "rows": sorted(r.digest for r in rows),
        "classes": dict(sorted(classes.items())),
        "corrections": active,
    }
    return sha256_bytes(json.dumps(doc, sort_keys=True).encode())


def carried_key(key: str, carried: Sequence[clio.Carried]) -> str:
    """A step's key with the land the carry-through carries in it: its polities, outer units,
    runs and shapes."""
    pieces = [
        [c.polity, c.outer, list(c.run), sha256_bytes(shapely.to_wkb(c.shape, byte_order=1))]
        for c in carried
    ]
    return sha256_bytes(json.dumps({"key": key, "carried": pieces}).encode())


def carried_steps(
    ctx: Context,
    keys: Mapping[int, str],
    source: clio.Cliopatria,
    config: clio.Config,
    terrain: clio.Terrain,
) -> dict[int, tuple[clio.Carried, ...]]:
    """The land the carry-through carries in each step, by its year: from the cache when every
    step's key is the one it was found for, else from each step's Plain, selecting those the cache
    lacks by `ctx.jobs` workers. A step whose selection fails has none, and its error is the bake's
    to report."""
    folder = ctx.cache / CACHE / PLAIN
    years = sorted(keys)
    found = folder / f"carried-{sha256_bytes(json.dumps([keys[y] for y in years]).encode())[:40]}"
    if found.is_file():
        return clio.unpack_carried(found.read_bytes())
    paths = {year: folder / f"{keys[year][:40]}.bin" for year in years}
    work: list[clio.Work] = [(y, (), paths[y]) for y in years if not paths[y].is_file()]
    if work:
        print(f"borders: selecting {len(work)} steps without the carry-through", flush=True)
    selected = clio.selections(ctx, work, source, config, terrain)
    failed = {summary[0] for summary in selected if summary[4] is not None}
    plains = clio.read_plains(paths[y] for y in years if y not in failed)
    carried = clio.carry_through(plains, config.rules.sliver_km)
    if not failed:
        _write_file(found, clio.pack_carried(carried))
    print(f"borders: {len(carried)} steps carry land through a stateless run", flush=True)
    return carried


def _write_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_bytes(data)
    partial.replace(path)


def operation_digest(correction: clio.Correction, source: clio.Cliopatria) -> str:
    """A correction's years and operation, hashed, with the rows it reads from other years: what
    it does to a step, but not why or on whose authority."""
    op = correction.op
    fields: dict[str, Any] = {"kind": type(op).__name__, "years": list(correction.years)}
    for name, value in vars(op).items():
        if isinstance(value, shapely.Geometry):
            value = sha256_bytes(shapely.to_wkb(value, byte_order=1))
        fields[name] = value
    if isinstance(op, clio.Carry):
        fields["row"] = _row_digest(source, op.polity, op.year)
    if isinstance(op, clio.Give | clio.Pocket) and op.shape_from is not None:
        fields["row"] = _row_digest(source, *op.shape_from)
    return sha256_bytes(json.dumps(fields, sort_keys=True, default=list).encode())


def _row_digest(source: clio.Cliopatria, name: str, year: int) -> str | None:
    row = source.at(name, year)
    return None if row is None else row.digest


def _code(repo: Path) -> str:
    return tree_sha(STEP_CODE, repo)


def code_identity(repo: Path, terrain: Terrain) -> str:
    """The code and terrain every step's key joins."""
    return sha256_bytes(f"{_code(repo)} {terrain.identity}".encode())


@dataclass(frozen=True)
class Baked:
    """A step as the cache holds it."""

    year: int
    key: str
    folder: Path  # holds field.bin, preview.bin and step.json
    report: dict[str, Any]
    applied: tuple[str, ...]  # the operation digests of the corrections that changed it
    outers: dict[str, str]
    unacknowledged: tuple[tuple[str, str], ...]
    planes: str  # sha256 of the six faces' bytes, which equal steps share

    def field(self) -> bytes:
        return (self.folder / "field.bin").read_bytes()

    def preview(self) -> Bytes:
        raw = (self.folder / "preview.bin").read_bytes()
        return np.frombuffer(raw, np.uint8).reshape(PREVIEW_HEIGHT, PREVIEW_WIDTH)


def cached(cache: Path, year: int, key: str) -> Baked | None:
    """The step baked for `key`, or None when the cache lacks it."""
    folder = cache / key[:40]
    try:
        meta = json.loads((folder / "step.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if meta["key"] != key or not (folder / "field.bin").is_file():
        return None
    return Baked(
        year=year,
        key=key,
        folder=folder,
        report=meta["report"],
        applied=tuple(meta["applied"]),
        outers=meta["outers"],
        unacknowledged=tuple((a, b) for a, b in meta["unacknowledged"]),
        planes=meta["planes"],
    )


def bake_step(
    year: int,
    key: str,
    cache: Path,
    source: clio.Cliopatria,
    config: clio.Config,
    terrain: clio.Terrain,
    masks: Terrain,
    ids: Mapping[str, int],
    carried: Sequence[clio.Carried] = (),
) -> Baked:
    """Selects and bakes one step, with the land the carry-through carries in it, into the cache;
    a SelectionError fails it."""
    chosen = clio.select(year, source, config, terrain, carried)
    raster = step_raster(chosen, ids)
    side = face_side(masks.texels)
    faces = np.stack(
        [
            face_planes(
                f,
                raster,
                _unpack(masks.dry[f], (side, side)),
                _unpack(masks.lakeside[f], (side, side)),
                masks.reach,
                masks.texels,
            )
            for f in range(FACES)
        ]
    )
    planes = sha256_bytes(faces.tobytes())
    stored = step_file(faces, year)
    del faces
    grid = (PREVIEW_HEIGHT * SUBPIXELS, PREVIEW_WIDTH * SUBPIXELS)
    dry, beside = _unpack(masks.preview, grid), _unpack(masks.preview_lakeside, grid)
    preview = preview_layer(raster, dry, beside, masks.preview_reach)
    digests = {k: operation_digest(c, source) for k, c in enumerate(config.corrections)}
    meta = {
        "key": key,
        "year": year,
        "report": chosen.report,
        "applied": sorted(digests[k] for k in chosen.applied),
        "outers": chosen.outers(),
        "unacknowledged": [list(pair) for pair in chosen.unacknowledged],
        "planes": planes,
    }
    folder = cache / key[:40]
    _write_folder(
        folder,
        {
            "field.bin": stored,
            "preview.bin": preview.tobytes(),
            "step.json": json.dumps(meta, ensure_ascii=False).encode(),
        },
    )
    baked = cached(cache, year, key)
    assert baked is not None
    return baked


def _write_folder(folder: Path, files: Mapping[str, bytes]) -> None:
    """Writes the files into `folder` whole: another run sees all of them or none."""
    partial = folder.with_name(f".{folder.name}.{os.getpid()}.tmp")
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir(parents=True)
    for name, data in files.items():
        (partial / name).write_bytes(data)
    shutil.rmtree(folder, ignore_errors=True)
    partial.rename(folder)


# Baking every step -----------------------------------------------------------------------------

_worker: tuple[clio.Cliopatria, clio.Config, clio.Terrain, Terrain, dict[str, int], Path] | None
_worker = None


def bake_steps(
    ctx: Context,
    keys: Mapping[int, str],
    source: clio.Cliopatria,
    config: clio.Config,
    terrain: clio.Terrain,
    masks: Terrain,
    progress: Callable[[int, int, int], None] | None = None,
    carried: Mapping[int, tuple[clio.Carried, ...]] | None = None,
) -> Iterator[tuple[int, Baked | None, str | None]]:
    """Each step's bake, with the land `carried` gives it, from the cache or baked now by
    `ctx.jobs` workers, in no set order, with the error of a step whose selection fails."""
    cache = ctx.cache / CACHE
    ids = clio.polity_ids(source, config)
    missing = []
    for year, key in keys.items():
        found = cached(cache, year, key)
        if found is None:
            missing.append(year)
        else:
            yield year, found, None
    if not missing:
        return
    work = [(year, keys[year], (carried or {}).get(year, ())) for year in missing]
    if ctx.jobs <= 1:
        for count, (year, key, land) in enumerate(work, 1):
            yield _bake_or_fail(year, key, cache, source, config, terrain, masks, ids, land)
            if progress:
                progress(count, len(work), year)
        return
    init = (ctx, terrain.to_wkb(), masks, ids, cache)
    with _pool(ctx.jobs, init) as pool:
        futures = [pool.submit(_task, item) for item in work]
        for count, future in enumerate(as_completed(futures), 1):
            result = future.result()
            yield result
            if progress:
                progress(count, len(work), result[0])


def _bake_or_fail(year, key, cache, source, config, terrain, masks, ids, carried=()):
    try:
        baked = bake_step(year, key, cache, source, config, terrain, masks, ids, carried)
        return year, baked, None
    except clio.SelectionError as error:
        return year, None, str(error)


def _pool(jobs: int, init: tuple[Any, ...] | None) -> ProcessPoolExecutor:
    return ProcessPoolExecutor(
        max_workers=jobs,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=None if init is None else _start,
        initargs=() if init is None else init,
    )


def _start(ctx: Context, terrain: bytes, masks: Terrain, ids: dict[str, int], cache: Path) -> None:
    global _worker
    source = clio.load_cliopatria(ctx)
    config = clio.load_config(config_dir(ctx.repo) / clio.CONFIG)
    _worker = (source, config, clio.Terrain.from_wkb(terrain), masks, ids, cache)


def _task(
    work: tuple[int, str, tuple[clio.Carried, ...]],
) -> tuple[int, Baked | None, str | None]:
    if _worker is None:
        raise RuntimeError("the steps' inputs exist only inside a bake worker")
    source, config, terrain, masks, ids, cache = _worker
    year, key, carried = work
    return _bake_or_fail(year, key, cache, source, config, terrain, masks, ids, carried)
