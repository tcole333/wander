"""The cube-face rasters border fields are made from (streaming.md 3.3): polity ids at 4x4 subpixels
per texel in face-global subpixels, as fields.py rasterizes coasts, the fill that gives every
empty subpixel the id nearest it, and signed distances to the borders between ids, per subpixel
and per texel. Milestone 1's 1815 field (borders.py) and the border steps (step_fields.py) share
them.

Each face stores INTERIOR texels across the face and an APRON past each edge, computed from the
same polygons, so lines run on across face edges. Texel (i, j) is centered at
s = -1 + (2(i - APRON) + 1)/INTERIOR, t likewise; row 0 is the smallest t.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import shapely
from scipy.ndimage import distance_transform_edt

from prebuild.cube import FACES, dir_to_lonlat, face_st, lonlat_to_dir, st_to_dir
from prebuild.fields import SUBPIXELS, Grid, fill
from prebuild.natural_earth import SEGMENT_DEG, parts_of_dimension

type FloatArray = npt.NDArray[np.float64]
type IdArray = npt.NDArray[np.uint16]

APRON = 4  # texels past each face edge
MARGIN_TEXELS = 16  # rasterized past the apron, beyond the stored reach
CLIP_PAD_DEG = SEGMENT_DEG + 0.5  # around a face's footprint when clipping polygons
JUMP_SUBPIXELS = 1.0  # central subpixels all at least this far from a border straddle no border


@dataclass(frozen=True)
class Polity:
    id: int
    geometry: shapely.Geometry
    area: float  # square degrees, for the drawing order only


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
        # Segmentizing can split a polygon whose ring nearly meets itself into several, when the
        # points it adds cross there and GEOS mends the result, and a multipolygon has no rings.
        dense = parts_of_dimension(shapely.segmentize(parts, SEGMENT_DEG), 2)
        segments = ring_segments(dense, face, interior)
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
