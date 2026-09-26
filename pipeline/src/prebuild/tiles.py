"""Surface tiles from their sources (streaming.md 3.1): texel heights, the shore and water fields,
the coastal clamp, edge profiles, and the planes the `.wst` encoder takes.

`surface` computes everything about a tile that is in meters and texels, so it holds for any
qLand; `build_tile` turns it into codes and bytes for one qLand. Every value is a function of
position and the sources, never of which tile asked, so a tile's border texels equal its
within-face neighbor's interior, and an edge-profile entry is the same in every tile that shares
its corner.

Edge profiles, on the sides that lie on a face edge: each entry of mip m is computed once, by its
owner face (3.0 item 7), from the four owner-frame mip-m texels around its corner, codes and shore
bytes alike. Mips take the decoder's (a + b + c + d + 2) >> 2 over blocks aligned in face-global
texels, so they are the owner tile's own mips. The code is the mean of the four codes rounded half
away from zero, and the shore byte (T + 2) >> 2 of their sum T. The tile's own 264² texels hold
every corner its own face owns, border texels included. Corners another face owns read owner-frame
strips (`footprint.profile_rects`), computed by the same functions of position, so the owner's
tile need not be baked.
"""

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from prebuild.codes import field_bytes, meters_to_codes
from prebuild.config import load_water
from prebuild.cube import EDGES, TILE, Tile, edge_corner, face_edge_sides, profile_owner
from prebuild.fields import Fields, FieldVectors, fields, shore_distance
from prebuild.footprint import STRIP_DEPTH, profile_rects, tile_texels
from prebuild.gebco import Raster
from prebuild.height import HeightSource, height_source, texel_means
from prebuild.natural_earth import load_vectors
from prebuild.paths import config_dir
from prebuild.profiles import Context
from prebuild.wst import (
    ENTRY_CORNER,
    ENTRY_MIP,
    MAX_RANGE,
    MIP_SIZES,
    PROFILES_SHAPE,
    WstTile,
    mips,
    tile_flags,
)

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
    """Owner-frame texels on another face that the tile's edge profiles read: clamped heights and
    shore distances of face-global texels rows x cols, which start and end at multiples of 4."""

    face: int
    rows: range
    cols: range
    heights: FloatArray
    shore_d: FloatArray


@dataclass(frozen=True)
class Surface:
    """A tile in meters and texels. `heights` and `fields` cover the stored 264² texels, row 0 at
    j = -4. Profile entry (e, k), of mip m = ENTRY_MIP[k], reads the four mip-m texels at rows r,
    r + 1 and columns c, c + 1 of a plane, where (r, c) = entry_texel[e, k]: plane 0 is the tile's
    own and plane p is `strips[p - 1]`, p = entry_plane[e, k]. In-face sides store no profile and
    read nothing: their entry_plane is -1."""

    tile: Tile
    heights: FloatArray  # clamped
    fields: Fields
    strips: tuple[Strip, ...]
    entry_plane: IntArray  # (4, 451)
    entry_texel: IntArray  # (4, 451, 2)


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
        _strip(f, level, r, c, raster, sources.vectors) for f, _, r, c in profile_rects(tile)
    )
    plane, texel = _profile_reads(tile, strips)
    return Surface(tile, heights, tile_fields, strips, plane, texel)


def edge_profiles(s: Surface, q: float) -> tuple[npt.NDArray[np.int16], npt.NDArray[np.uint8]]:
    """(4, 451) codes and shore bytes of sides N, E, S, W, zero on in-face sides. Entry k of mip m
    has code sign(S)·((|S| + 2) >> 2), the half-away-from-zero mean of the four owner-frame mip-m
    codes around its corner, whose sum is S, and shore byte (T + 2) >> 2 of the four mip-m shore
    bytes, whose sum is T."""
    planes = [(s.heights, s.fields.shore_d)] + [(p.heights, p.shore_d) for p in s.strips]
    code_sums = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    shore_sums = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    entry_mip = np.broadcast_to(ENTRY_MIP, PROFILES_SHAPE)
    for p, (heights, shore_d) in enumerate(planes):
        code_mips, shore_mips = mips(meters_to_codes(heights, q)), mips(field_bytes(shore_d))
        for m in range(len(MIP_SIZES)):
            at = (s.entry_plane == p) & (entry_mip == m)
            r, c = s.entry_texel[at, 0], s.entry_texel[at, 1]
            code_sums[at] = _around(code_mips[m], r, c)
            shore_sums[at] = _around(shore_mips[m], r, c)
    codes = np.sign(code_sums) * ((np.abs(code_sums) + 2) >> 2)
    return codes.astype(np.int16), ((shore_sums + 2) >> 2).astype(np.uint8)


def height_bound(s: Surface) -> tuple[float, float]:
    """The lowest and highest clamped heights a tile's codes and edges can take: its 264² texels
    and the owner-frame texels its edges read. Codes rise with height, and a mip texel or a
    profile entry, a rounded mean, lies between the codes it averages, so the tile spans at most
    code(high) - code(low) codes."""
    values = [s.heights, *(p.heights for p in s.strips)]
    return min(float(v.min()) for v in values), max(float(v.max()) for v in values)


def build_tile(s: Surface, q: float) -> WstTile:
    """The tile's planes for the encoder at qLand q: codes, shore and water bytes, flags and edge
    profiles. Fails when the tile spans more than 4,096 codes, which the coverage stage's qLand
    rules out."""
    profiles, profile_shore = edge_profiles(s, q)
    t = WstTile.from_planes(
        s.tile,
        flags=tile_flags(s.fields.shore_d, s.fields.water_d),
        q_land=q,
        codes=meters_to_codes(s.heights, q),
        shore=field_bytes(s.fields.shore_d),
        water=field_bytes(s.fields.water_d),
        profiles=profiles,
        profile_shore=profile_shore,
    )
    if t.code_max - t.code_min > MAX_RANGE:
        raise ValueError(
            f"tile {s.tile.key()} spans codes {t.code_min}..{t.code_max} at qLand {q}, "
            f"more than {MAX_RANGE}"
        )
    return t


def _strip(
    face: int, level: int, rows: range, cols: range, raster: Raster, vectors: FieldVectors
) -> Strip:
    shore_d = shore_distance(face, level, rows, cols, vectors)
    heights = clamp_coastal(texel_means(face, level, rows, cols, raster), shore_d)
    return Strip(face, rows, cols, heights, shore_d)


def _around(plane: IntArray, r: IntArray, c: IntArray) -> IntArray:
    """The sums of the four texels at rows r, r + 1 and columns c, c + 1."""
    return plane[r, c] + plane[r, c + 1] + plane[r + 1, c] + plane[r + 1, c + 1]


def _profile_reads(tile: Tile, strips: tuple[Strip, ...]) -> tuple[IntArray, IntArray]:
    """Where each profile entry reads its owner texels: the plane (0 for the tile's own, p for
    strips[p - 1], -1 on in-face sides) and, in that plane's mip m, the row and column of the
    owner-frame texel below and left of the entry's corner (cs, ct), face-global mip-m texel
    ((ct >> m) - 1, (cs >> m) - 1). Every plane starts at a multiple of 4, so its mip-m indices are
    the face-global ones less its start >> m."""
    plane = np.full(PROFILES_SHAPE, -1, dtype=np.int64)
    texel = np.zeros((*PROFILES_SHAPE, 2), dtype=np.int64)
    _, _, rows, cols = tile_texels(tile)
    for e in face_edge_sides(tile):
        # Every mip's corners are among mip 0's, 0..256.
        owners = [profile_owner(tile, EDGES[e], c) for c in range(TILE + 1)]
        for k, (m, c) in enumerate(zip(ENTRY_MIP.tolist(), ENTRY_CORNER.tolist(), strict=True)):
            owner, owner_edge, owner_k = owners[c]
            cs, ct = edge_corner(owner, owner_edge, owner_k)
            if owner.face == tile.face:
                p, origin_t, origin_s = 0, rows.start, cols.start
            else:
                p = _strip_holding(strips, owner.face, ct, cs)
                origin_t, origin_s = strips[p - 1].rows.start, strips[p - 1].cols.start
            plane[e, k] = p
            texel[e, k] = ((ct >> m) - 1 - (origin_t >> m), (cs >> m) - 1 - (origin_s >> m))
    return plane, texel


def _strip_holding(strips: tuple[Strip, ...], face: int, ct: int, cs: int) -> int:
    """1 + the index of a strip on `face` holding the 8x8 texels around corner (cs, ct), all that
    mip 2 reads there."""
    for p, strip in enumerate(strips, start=1):
        rows, cols = strip.rows, strip.cols
        if (
            strip.face == face
            and rows.start <= ct - STRIP_DEPTH
            and ct + STRIP_DEPTH <= rows.stop
            and cols.start <= cs - STRIP_DEPTH
            and cs + STRIP_DEPTH <= cols.stop
        ):
            return p
    raise ValueError(f"no owner-frame strip on face {face} holds corner ({cs}, {ct})")
