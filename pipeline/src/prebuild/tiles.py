"""Surface tiles from their sources (streaming.md 3.1): texel heights, the shore and water fields,
the coastal clamp, edge profiles, and the planes the `.wst` encoder takes.

`surface` computes everything about a tile that is in meters and texels, so it holds for any
qLand; `build_tile` turns it into codes and bytes for one qLand. Every value is a function of
position and the sources, never of which tile asked, so a tile's border texels equal its
within-face neighbor's interior, and an edge-profile entry is the same in every tile that shares
its corner.

Edge profiles: each entry is computed once, by its owner face (3.0 item 7), as the mean of the
codes of the four owner-face texels around its corner, rounded half away from zero. The tile's own
264² texels hold every corner its own face owns, border texels included. Corners another face owns
read owner-frame strips (`footprint.profile_rects`), computed by the same functions of position,
so the owner's tile need not be baked.
"""

import itertools
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from prebuild.codes import field_bytes, meters_to_codes
from prebuild.config import load_water
from prebuild.cube import EDGES, Tile, edge_corner, profile_owner
from prebuild.fields import Fields, FieldVectors, fields, shore_distance
from prebuild.footprint import profile_rects, tile_texels
from prebuild.height import HeightSource, height_source, texel_means
from prebuild.natural_earth import load_vectors
from prebuild.paths import config_dir
from prebuild.profiles import Context
from prebuild.wst import EDGE_ENTRIES, MAX_RANGE, WstTile, tile_flags

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]

CLAMP_TEXELS = 2.0  # the coastal clamp reaches this far from the shore


@dataclass(frozen=True)
class TileSources:
    """What every tile reads: GEBCO heights (the real grid or the fixture's excerpts) and the
    prepared Natural Earth layers."""

    heights: HeightSource
    vectors: FieldVectors


@dataclass(frozen=True)
class Strip:
    """Owner-frame texels on another face that the tile's edge profiles read: clamped heights of
    face-global texels rows x cols."""

    face: int
    rows: range
    cols: range
    heights: FloatArray


@dataclass(frozen=True)
class Surface:
    """A tile in meters and texels. `heights` and `fields` cover the stored 264² texels, row 0 at
    j = -4. Edge entry (e, k) reads the four texels at rows r, r + 1 and columns c, c + 1 of a
    plane, where (r, c) = entry_texel[e, k]: plane 0 is `heights` and plane p is
    `strips[p - 1].heights`, p = entry_plane[e, k]."""

    tile: Tile
    heights: FloatArray  # clamped
    fields: Fields
    strips: tuple[Strip, ...]
    entry_plane: IntArray  # (4, 257)
    entry_texel: IntArray  # (4, 257, 2)


def open_sources(ctx: Context) -> TileSources:
    """The profile's sources: the committed excerpts for the fixture, else the pinned GEBCO grid
    and Natural Earth zips under $WANDER_DATA."""
    water = load_water(config_dir(ctx.repo) / "water.yaml")
    return TileSources(height_source(ctx), FieldVectors.build(load_vectors(ctx, water), water))


def clamp_coastal(h: npt.ArrayLike, shore_d: npt.ArrayLike) -> FloatArray:
    """Within 2 texels of the shore (by the unclamped shore distance), land heights are at least 0
    and sea heights at most 0, and a texel on the shore line (d = 0) is 0. Inland depressions such
    as the Dead Sea lie farther from the sea and keep their heights."""
    heights = np.asarray(h, dtype=np.float64)
    d = np.asarray(shore_d, dtype=np.float64)
    near = np.abs(d) <= CLAMP_TEXELS
    clamped = np.where(d > 0, np.maximum(heights, 0.0), np.minimum(heights, 0.0))
    clamped = np.where(d == 0, 0.0, clamped)
    return np.where(near, clamped, heights)


def surface(tile: Tile, sources: TileSources) -> Surface:
    """The tile's clamped heights and fields, and the owner-frame texels its edges read."""
    raster = sources.heights.raster(tile)
    face, level, rows, cols = tile_texels(tile)
    tile_fields = fields(face, level, rows, cols, sources.vectors)
    heights = clamp_coastal(texel_means(face, level, rows, cols, raster), tile_fields.shore_d)
    strips = tuple(
        Strip(
            face=f,
            rows=r,
            cols=c,
            heights=clamp_coastal(
                texel_means(f, level, r, c, raster), shore_distance(f, level, r, c, sources.vectors)
            ),
        )
        for f, _, r, c in profile_rects(tile)
    )
    plane, texel = _profile_reads(tile, strips)
    return Surface(tile, heights, tile_fields, strips, plane, texel)


def edge_profiles(s: Surface, q: float) -> npt.NDArray[np.int16]:
    """(4, 257) codes N, E, S, W: each entry sign(S)·((|S| + 2) >> 2), the half-away-from-zero
    mean of its four owner-face texel codes, whose sum is S."""
    planes = [meters_to_codes(s.heights, q)] + [meters_to_codes(p.heights, q) for p in s.strips]
    total = np.zeros(s.entry_plane.shape, dtype=np.int64)
    for p, plane in enumerate(planes):
        at = s.entry_plane == p
        r, c = s.entry_texel[at, 0], s.entry_texel[at, 1]
        total[at] = plane[r, c] + plane[r, c + 1] + plane[r + 1, c] + plane[r + 1, c + 1]
    return (np.sign(total) * ((np.abs(total) + 2) >> 2)).astype(np.int16)


def height_bound(s: Surface) -> tuple[float, float]:
    """The lowest and highest clamped heights a tile's codes and edges can take: its 264² texels
    and the owner-frame texels its edges read. Codes rise with height, and an edge entry lies
    between its texels' codes, so the tile spans at most code(high) - code(low) codes."""
    values = [s.heights, *(p.heights for p in s.strips)]
    return min(float(v.min()) for v in values), max(float(v.max()) for v in values)


def build_tile(s: Surface, q: float) -> WstTile:
    """The tile's planes for the encoder at qLand q: codes, shore and water bytes, flags and edge
    profiles. Fails when the tile spans more than 4,096 codes, which the coverage stage's qLand
    rules out."""
    codes = meters_to_codes(s.heights, q)
    edges = edge_profiles(s, q)
    low = int(min(codes.min(), edges.min()))
    high = int(max(codes.max(), edges.max()))
    if high - low > MAX_RANGE:
        raise ValueError(
            f"tile {s.tile.key()} spans codes {low}..{high} at qLand {q}, more than {MAX_RANGE}"
        )
    return WstTile.from_planes(
        s.tile,
        flags=tile_flags(s.fields.shore_d, s.fields.water_d),
        q_land=q,
        codes=codes,
        shore=field_bytes(s.fields.shore_d),
        water=field_bytes(s.fields.water_d),
        edges=edges,
    )


def _profile_reads(tile: Tile, strips: tuple[Strip, ...]) -> tuple[IntArray, IntArray]:
    """Where each edge entry reads its owner texels: the plane (0 for the tile's own, p for
    strips[p - 1]) and the row and column there of owner-face texel (ct - 1, cs - 1), the one below
    and left of its corner (cs, ct)."""
    plane = np.zeros((len(EDGES), EDGE_ENTRIES), dtype=np.int64)
    texel = np.zeros((len(EDGES), EDGE_ENTRIES, 2), dtype=np.int64)
    _, _, rows, cols = tile_texels(tile)
    for (e, edge), k in itertools.product(enumerate(EDGES), range(EDGE_ENTRIES)):
        owner, owner_edge, owner_k = profile_owner(tile, edge, k)
        cs, ct = edge_corner(owner, owner_edge, owner_k)
        if owner.face == tile.face:
            texel[e, k] = (ct - 1 - rows.start, cs - 1 - cols.start)
            continue
        p = _strip_holding(strips, owner.face, ct, cs)
        texel[e, k] = (ct - 1 - strips[p - 1].rows.start, cs - 1 - strips[p - 1].cols.start)
        plane[e, k] = p
    return plane, texel


def _strip_holding(strips: tuple[Strip, ...], face: int, ct: int, cs: int) -> int:
    """1 + the index of a strip on `face` holding the four texels around corner (cs, ct)."""
    for p, strip in enumerate(strips, start=1):
        rows, cols = strip.rows, strip.cols
        if strip.face == face and rows.start < ct < rows.stop and cols.start < cs < cols.stop:
            return p
    raise ValueError(f"no owner-frame strip on face {face} holds corner ({cs}, {ct})")
