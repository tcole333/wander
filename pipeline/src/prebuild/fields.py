"""The shore and water distance fields (streaming.md 3.1).

A rect of face-global texels rasterizes 4x4 subpixels per texel over itself plus a 12-texel margin
on every side (1152² for a tile's texels -4..259), at the face-global subpixel centers of 3.0
item 5. The shore mask is land (NE land and minor islands, lakes included); the water mask is lakes
and the rivers drawn at the level, each within its half-width. An exact Euclidean distance
transform gives each subpixel E, the distance in subpixels to the nearest center of the other
class, and D = E - 0.5 inside the mask, -(E - 0.5) outside. A texel's d is the mean D of its 2x2
central subpixels divided by 4, in texels, and ±inf when the raster holds one class. The water
field negates D, so water is negative. The margin exceeds the ±8-texel reach the tile stores, so
every stored value, and every |d| ≤ 8, depends only on the texel's position.

That holds because every step is a function of position: vertices project to face-global subpixel
coordinates, straight segments join them, and the clip box around each raster is padded past the
longest prepared segment (0.1°) and the widest river, so every segment that reaches a raster is the
same whichever raster clipped it. Edges are put in a canonical direction before any arithmetic, so a
ring the clip rebuilt in the other direction computes the same crossings.
"""

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import shapely
from scipy.ndimage import distance_transform_edt

from prebuild.codes import texel_m
from prebuild.config import WaterConfig
from prebuild.cube import (
    EARTH_RADIUS_M,
    FACES,
    TILE,
    dir_to_lonlat,
    face_st,
    lonlat_to_dir,
    st_to_dir,
)
from prebuild.natural_earth import SEGMENT_DEG, Vectors, parts_of_dimension

type FloatArray = npt.NDArray[np.float64]
type BoolArray = npt.NDArray[np.bool_]
type Box = tuple[float, float, float, float]  # west, south, east, north in degrees
type Segments = tuple[FloatArray, FloatArray, FloatArray, FloatArray]  # x0, y0, x1, y1

SUBPIXELS = 4  # per texel, along s and along t
MARGIN_TEXELS = 12  # rasterized around the rect on every side
MIN_RIVER_TEXELS = 0.35  # a river never draws thinner than this half-width
KM_PER_DEG = math.pi * EARTH_RADIUS_M / 180 / 1000
# A river's half-width is a fixed count of subpixels, and the equiangular projection stretches a
# subpixel diagonally to up to 1.15x its nominal size at a face corner and 1.25x at the L0 raster's
# margin corners (s = t = ±1.125), so the clip pad takes half again the widest river.
RIVER_PAD_FACTOR = 1.5
# Past the longest prepared segment: a straight segment between projected vertices strays a few
# meters from the lon/lat segment it stands for.
CLIP_SLACK_DEG = 0.01
_CHUNK = 1 << 22  # (segment, subpixel) pairs tested per pass


@dataclass(frozen=True)
class Fields:
    """Signed distances in texels, shaped like the rect: shore d > 0 on land, water d < 0 in
    water."""

    shore_d: FloatArray
    water_d: FloatArray


@dataclass(frozen=True)
class FieldVectors:
    """The prepared layers split into single parts, each layer in an STRtree for per-raster
    clipping. The union in `natural_earth` already merged overlapping features, so the parts of a
    layer never overlap and even-odd fill over all of them is the union."""

    land: np.ndarray
    lakes: np.ndarray
    rivers: np.ndarray  # single lines
    river_ranks: npt.NDArray[np.int64]  # the scalerank of each line's feature
    water: WaterConfig
    land_tree: shapely.STRtree
    lakes_tree: shapely.STRtree
    rivers_tree: shapely.STRtree

    @classmethod
    def build(cls, vectors: Vectors, water: WaterConfig) -> FieldVectors:
        land = parts_of_dimension(vectors.land, 2)
        lakes = parts_of_dimension(vectors.lakes, 2)
        lines, owner = shapely.get_parts(vectors.rivers.geoms, return_index=True)
        kept = (shapely.get_dimensions(lines) == 1) & ~shapely.is_empty(lines)
        ranks = np.asarray(vectors.rivers.attrs["scalerank"], dtype=np.int64)[owner]
        return cls(
            land=land,
            lakes=lakes,
            rivers=lines[kept],
            river_ranks=ranks[kept],
            water=water,
            land_tree=shapely.STRtree(land),
            lakes_tree=shapely.STRtree(lakes),
            rivers_tree=shapely.STRtree(lines[kept]),
        )

    def max_river_rank(self, level: int) -> int:
        """Rivers by level: those up to riversMaxScalerank[level], or all where it lists none."""
        return self.water.rivers_max_scalerank.get(level, max(self.water.half_width_km))

    def river_radius_texels(self, level: int, ranks: npt.ArrayLike) -> FloatArray:
        """max(0.35 texel, halfWidthKm[scalerank] / texel_km(L))."""
        half_km = np.array([self.water.half_width_km[int(r)] for r in np.ravel(ranks)])
        return np.maximum(MIN_RIVER_TEXELS, half_km / (texel_m(level) / 1000))

    def widest_river_km(self, level: int) -> float:
        ranks = [r for r in self.water.half_width_km if r <= self.max_river_rank(level)]
        return float(self.river_radius_texels(level, ranks).max()) * texel_m(level) / 1000


@dataclass(frozen=True)
class Grid:
    """The subpixel raster of a rect: row 0 is face-global subpixel row b0, column 0 is a0."""

    face: int
    level: int
    b0: int
    a0: int
    height: int
    width: int

    @classmethod
    def around(cls, face: int, level: int, g_rows: range, g_cols: range) -> Grid:
        rows = len(g_rows) + 2 * MARGIN_TEXELS
        cols = len(g_cols) + 2 * MARGIN_TEXELS
        return cls(
            face,
            level,
            SUBPIXELS * (g_rows.start - MARGIN_TEXELS),
            SUBPIXELS * (g_cols.start - MARGIN_TEXELS),
            SUBPIXELS * rows,
            SUBPIXELS * cols,
        )


def fields(face: int, level: int, g_rows: range, g_cols: range, vectors: FieldVectors) -> Fields:
    """Shore and water distances of face-global texels g_rows x g_cols."""
    grid = Grid.around(face, level, g_rows, g_cols)
    boxes = clip_boxes(grid, vectors.widest_river_km(level))
    return Fields(
        shore_d=texel_distance(signed_distance(shore_mask(grid, boxes, vectors))),
        water_d=-texel_distance(signed_distance(water_mask(grid, boxes, vectors))),
    )


def shore_distance(
    face: int, level: int, g_rows: range, g_cols: range, vectors: FieldVectors
) -> FloatArray:
    """The shore half of `fields`, for owner-frame strips, which need no water."""
    grid = Grid.around(face, level, g_rows, g_cols)
    boxes = clip_boxes(grid, vectors.widest_river_km(level))
    return texel_distance(signed_distance(shore_mask(grid, boxes, vectors)))


def shore_mask(grid: Grid, boxes: list[Box], vectors: FieldVectors) -> BoolArray:
    polygons = clip_polygons(vectors.land, vectors.land_tree, boxes)
    return fill(ring_segments(polygons, grid.face, grid.level), grid)


def water_mask(grid: Grid, boxes: list[Box], vectors: FieldVectors) -> BoolArray:
    lakes = clip_polygons(vectors.lakes, vectors.lakes_tree, boxes)
    mask = fill(ring_segments(lakes, grid.face, grid.level), grid)
    lines, ranks = clip_rivers(vectors, boxes, vectors.max_river_rank(grid.level))
    if lines.size:
        segments, owner = line_segments(lines, grid.face, grid.level)
        radius = SUBPIXELS * vectors.river_radius_texels(grid.level, ranks)[owner]
        mask |= river_mask(segments, radius, grid)
    return mask


def clip_boxes(grid: Grid, river_km: float) -> list[Box]:
    """Lon/lat boxes around the raster's footprint, padded by 0.1° plus the widest river (and
    slack): one box, two where it crosses ±180°, and every longitude when the raster holds a
    pole."""
    lon, lat = _outline(grid)
    pad_km = RIVER_PAD_FACTOR * river_km
    pad_lat = SEGMENT_DEG + CLIP_SLACK_DEG + pad_km / KM_PER_DEG
    south = max(-90.0, float(lat.min()) - pad_lat)
    north = min(90.0, float(lat.max()) + pad_lat)
    if _holds_pole(grid):
        return (
            [(-180.0, south, 180.0, 90.0)]
            if FACES[grid.face, 0, 2] > 0
            else [(-180.0, -90.0, 180.0, north)]
        )
    poleward = max(abs(south), abs(north))
    cos_poleward = math.cos(math.radians(poleward))
    west, span = _lon_arc(lon)
    if cos_poleward <= 0:
        return [(-180.0, south, 180.0, north)]
    pad_lon = SEGMENT_DEG + CLIP_SLACK_DEG + pad_km / (KM_PER_DEG * cos_poleward)
    if span + 2 * pad_lon >= 360:
        return [(-180.0, south, 180.0, north)]
    west -= pad_lon
    east = west + span + 2 * pad_lon
    if west < -180:
        return [(west + 360, south, 180.0, north), (-180.0, south, east, north)]
    if east > 180:
        return [(west, south, 180.0, north), (-180.0, south, east - 360, north)]
    return [(west, south, east, north)]


def clip_polygons(parts: np.ndarray, tree: shapely.STRtree, boxes: list[Box]) -> np.ndarray:
    """The polygon parts inside the boxes, clipped to them and segmentized again, which splits only
    the new clip-edge segments."""
    pieces = []
    for box in boxes:
        found = np.sort(tree.query(shapely.box(*box)))
        pieces.append(shapely.clip_by_rect(parts[found], *box))
    joined = np.concatenate(pieces)
    if joined.size == 0:
        return joined
    return shapely.segmentize(parts_of_dimension(joined, 2), SEGMENT_DEG)


def clip_rivers(
    vectors: FieldVectors, boxes: list[Box], max_rank: int
) -> tuple[np.ndarray, npt.NDArray[np.int64]]:
    """The river lines drawn at the level inside the boxes, clipped and segmentized again, with
    each line's scalerank."""
    lines, ranks = [], []
    for box in boxes:
        found = np.sort(vectors.rivers_tree.query(shapely.box(*box)))
        found = found[vectors.river_ranks[found] <= max_rank]
        parts, owner = shapely.get_parts(
            shapely.clip_by_rect(vectors.rivers[found], *box), return_index=True
        )
        kept = (shapely.get_dimensions(parts) == 1) & ~shapely.is_empty(parts)
        lines.append(parts[kept])
        ranks.append(vectors.river_ranks[found][owner[kept]])
    return shapely.segmentize(np.concatenate(lines), SEGMENT_DEG), np.concatenate(ranks)


def project(
    lon: npt.ArrayLike, lat: npt.ArrayLike, face: int, level: int
) -> tuple[FloatArray, FloatArray]:
    """Face-global subpixel coordinates A_s = (s + 1)·512n - 0.5 and A_t likewise, so the center
    of subpixel A sits at A_s = A."""
    p = lonlat_to_dir(lon, lat)
    center = FACES[face, 0]
    if np.any(p[..., 0] * center[0] + p[..., 1] * center[1] + p[..., 2] * center[2] <= 0):
        raise ValueError(f"a vertex lies outside the hemisphere of face {face}")
    s, t = face_st(face, p)
    scale = (SUBPIXELS * TILE // 2) << level
    return (s + 1) * scale - 0.5, (t + 1) * scale - 0.5


def ring_segments(polygons: np.ndarray, face: int, level: int) -> Segments:
    """Every ring edge of the polygons, projected."""
    if polygons.size == 0:
        return _no_segments()
    coords, ring = shapely.get_coordinates(shapely.get_rings(polygons), return_index=True)
    x, y = project(coords[:, 0], coords[:, 1], face, level)
    same = ring[1:] == ring[:-1]
    return x[:-1][same], y[:-1][same], x[1:][same], y[1:][same]


def line_segments(lines: np.ndarray, face: int, level: int) -> tuple[Segments, np.ndarray]:
    """Every segment of the lines, projected, with the index of its line."""
    coords, line = shapely.get_coordinates(lines, return_index=True)
    x, y = project(coords[:, 0], coords[:, 1], face, level)
    same = line[1:] == line[:-1]
    return (x[:-1][same], y[:-1][same], x[1:][same], y[1:][same]), line[:-1][same]


def fill(segments: Segments, grid: Grid) -> BoolArray:
    """Even-odd fill: a subpixel is inside when an odd number of edges cross its row left of its
    center. An edge crosses row B when B lies in [min y, max y), and crosses it at the x its lower
    end reaches, so the result does not depend on which way a ring runs."""
    x0, y0, x1, y1 = _upward(*segments)
    first = np.maximum(np.ceil(y0), grid.b0).astype(np.int64)
    last = np.minimum(np.ceil(y1) - 1, grid.b0 + grid.height - 1).astype(np.int64)
    counts = np.maximum(last - first + 1, 0)
    edge = np.repeat(np.arange(counts.size), counts)
    row = first[edge] + _ramp(counts)
    x = x0[edge] + (row - y0[edge]) * (x1[edge] - x0[edge]) / (y1[edge] - y0[edge])
    # A crossing at x toggles every subpixel whose center lies right of it: columns floor(x) + 1 on.
    column = np.clip(np.floor(x).astype(np.int64) + 1 - grid.a0, 0, grid.width)
    stride = grid.width + 1
    flat = (row - grid.b0) * stride + column
    toggles = np.bincount(flat, minlength=grid.height * stride).reshape(grid.height, stride)
    return (np.cumsum(toggles[:, : grid.width], axis=1) & 1).astype(bool)


def river_mask(segments: Segments, radius: FloatArray, grid: Grid) -> BoolArray:
    """Subpixels whose center lies within `radius` (subpixels, per segment) of a segment, by an
    exact point-to-segment distance."""
    x0, y0, x1, y1 = _canonical(*segments)
    r = np.asarray(radius, dtype=np.float64)
    a_lo = np.maximum(np.floor(np.minimum(x0, x1) - r), grid.a0).astype(np.int64)
    a_hi = np.minimum(np.ceil(np.maximum(x0, x1) + r), grid.a0 + grid.width - 1).astype(np.int64)
    b_lo = np.maximum(np.floor(np.minimum(y0, y1) - r), grid.b0).astype(np.int64)
    b_hi = np.minimum(np.ceil(np.maximum(y0, y1) + r), grid.b0 + grid.height - 1).astype(np.int64)
    widths = np.maximum(a_hi - a_lo + 1, 0)
    counts = widths * np.maximum(b_hi - b_lo + 1, 0)
    mask = np.zeros((grid.height, grid.width), dtype=bool)
    for chunk in _chunks(counts):
        seg = np.repeat(chunk, counts[chunk])
        offset = _ramp(counts[chunk])
        a = a_lo[seg] + offset % widths[seg]
        b = b_lo[seg] + offset // widths[seg]
        hit = _within(a, b, x0[seg], y0[seg], x1[seg], y1[seg], r[seg])
        mask[b[hit] - grid.b0, a[hit] - grid.a0] = True
    return mask


def signed_distance(mask: BoolArray) -> FloatArray:
    """D per subpixel: E - 0.5 inside the mask and -(E - 0.5) outside, where E is the exact
    Euclidean distance to the nearest center of the other class; ±inf with one class only."""
    if mask.all():
        return np.full(mask.shape, np.inf)
    if not mask.any():
        return np.full(mask.shape, -np.inf)
    inside = distance_transform_edt(mask)
    outside = distance_transform_edt(~mask)
    return np.where(mask, inside - 0.5, 0.5 - outside)


def texel_distance(d: FloatArray) -> FloatArray:
    """Each texel's mean D over its 2x2 central subpixels, divided by 4, summed in a fixed order,
    for the rect inside the margin."""
    m = SUBPIXELS * MARGIN_TEXELS
    core = d[m:-m, m:-m]
    texels = core.reshape(core.shape[0] // SUBPIXELS, SUBPIXELS, core.shape[1] // SUBPIXELS, -1)
    total = texels[:, 1, :, 1] + texels[:, 1, :, 2]
    total += texels[:, 2, :, 1]
    total += texels[:, 2, :, 2]
    return total * (1 / SUBPIXELS**2)


def _within(a, b, x0, y0, x1, y1, r) -> BoolArray:
    dx, dy = x1 - x0, y1 - y0
    px, py = a - x0, b - y0
    length2 = dx * dx + dy * dy
    along = np.divide(px * dx + py * dy, length2, out=np.zeros_like(px), where=length2 > 0)
    along = np.clip(along, 0.0, 1.0)
    ex, ey = px - along * dx, py - along * dy
    return ex * ex + ey * ey <= r * r


def _upward(x0, y0, x1, y1) -> Segments:
    """Edges that cross a row at all, each from its lower end."""
    keep = y0 != y1
    x0, y0, x1, y1 = x0[keep], y0[keep], x1[keep], y1[keep]
    flip = y0 > y1
    return (
        np.where(flip, x1, x0),
        np.where(flip, y1, y0),
        np.where(flip, x0, x1),
        np.where(flip, y0, y1),
    )


def _canonical(x0, y0, x1, y1) -> Segments:
    """Each segment from its lexicographically smaller end."""
    flip = (x0 > x1) | ((x0 == x1) & (y0 > y1))
    return (
        np.where(flip, x1, x0),
        np.where(flip, y1, y0),
        np.where(flip, x0, x1),
        np.where(flip, y0, y1),
    )


def _ramp(counts: npt.NDArray[np.int64]) -> npt.NDArray[np.int64]:
    """0..count-1 for each count, concatenated."""
    total = int(counts.sum())
    starts = np.cumsum(counts) - counts
    return np.arange(total, dtype=np.int64) - np.repeat(starts, counts)


def _chunks(counts: npt.NDArray[np.int64]) -> list[npt.NDArray[np.int64]]:
    """Segment indices in runs of at most _CHUNK pairs (a longer single segment runs alone)."""
    chunks, start, total = [], 0, 0
    for k, count in enumerate(counts.tolist()):
        if total and total + count > _CHUNK:
            chunks.append(np.arange(start, k))
            start, total = k, 0
        total += count
    if total:
        chunks.append(np.arange(start, counts.size))
    return chunks


def _outline(grid: Grid) -> tuple[FloatArray, FloatArray]:
    """Lon/lat along the raster's outer edge, at every subpixel corner."""
    scale = (SUBPIXELS * TILE // 2) << grid.level
    s_edge = -1.0 + np.arange(grid.a0, grid.a0 + grid.width + 1) / scale
    t_edge = -1.0 + np.arange(grid.b0, grid.b0 + grid.height + 1) / scale
    s = np.concatenate(
        [s_edge, s_edge, np.full(t_edge.size, s_edge[0]), np.full(t_edge.size, s_edge[-1])]
    )
    t = np.concatenate(
        [np.full(s_edge.size, t_edge[0]), np.full(s_edge.size, t_edge[-1]), t_edge, t_edge]
    )
    return dir_to_lonlat(st_to_dir(grid.face, s, t))


def _holds_pole(grid: Grid) -> bool:
    """Faces 4 and 5 hold a pole at s = t = 0: face-global subpixel corner 512n."""
    if FACES[grid.face, 0, 2] == 0:
        return False
    pole = (SUBPIXELS * TILE // 2) << grid.level
    return grid.a0 <= pole <= grid.a0 + grid.width and grid.b0 <= pole <= grid.b0 + grid.height


def _lon_arc(lon: FloatArray) -> tuple[float, float]:
    """(west, span) of the shortest arc of longitudes holding every one given."""
    ordered = np.sort(np.asarray(lon, dtype=np.float64).ravel())
    gaps = np.diff(np.concatenate([ordered, ordered[:1] + 360]))
    widest = int(np.argmax(gaps))
    west = float(ordered[(widest + 1) % ordered.size])
    return west, 360.0 - float(gaps[widest])


def _no_segments() -> Segments:
    empty = np.array([], dtype=np.float64)
    return empty, empty, empty, empty
