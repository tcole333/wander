"""Where a tile samples GEBCO (streaming.md 3.0 item 5, 3.1): the lon/lat of its height
sub-samples, the owner-frame texels its edge profiles read, and the window of grid cells that
bilinear sampling of all of them touches. The excerpt windows and the cheap qLand bound both use
`tile_window`.

A window is (i0, j0, w, h) in a global grid's cell indices, as in `gebco.Raster`: rows [j0, j0 + h)
and columns (i0 + k) mod global_w for k in [0, w).
"""

from collections.abc import Iterable

import numpy as np
import numpy.typing as npt

from prebuild.cube import (
    BORDER,
    EDGES,
    TILE,
    Edge,
    Tile,
    dir_to_lonlat,
    edge_corner,
    face_edge_sides,
    profile_owner,
    st_to_dir,
    subsample,
)
from prebuild.gebco import ARCSEC_PER_TURN

type FloatArray = npt.NDArray[np.float64]
type Window = tuple[int, int, int, int]
type Rect = tuple[int, int, range, range]  # face, level, texel rows (t), texel columns (s)

SUBSAMPLES = 4  # height sub-samples per texel along s and along t
HALO = 1  # cells kept around the cells bilinear sampling touches
# Mip 2 reads the 4x4 mip-0 blocks on either side of a texel corner, aligned at multiples of 4.
STRIP_DEPTH = 4
STRIP_ALIGN = 4


def subsample_lonlat(
    face: int, level: int, g_rows: range, g_cols: range
) -> tuple[FloatArray, FloatArray]:
    """Lon and lat of the 4x4 height sub-samples of face-global texels g_rows x g_cols, shaped
    (4·rows, 4·cols): row 4j + b is sub-sample b of texel row j, from exact positions."""
    s = _subsample_axis(level, g_cols)
    t = _subsample_axis(level, g_rows)
    return dir_to_lonlat(st_to_dir(face, s[None, :], t[:, None]))


def tile_texels(tile: Tile) -> Rect:
    """The tile's stored texels, -4..259 along s and along t (face-global)."""
    return (
        tile.face,
        tile.level,
        range(TILE * tile.y - BORDER, TILE * (tile.y + 1) + BORDER),
        range(TILE * tile.x - BORDER, TILE * (tile.x + 1) + BORDER),
    )


def profile_rects(tile: Tile) -> list[Rect]:
    """Owner-frame texels the tile's edge profiles read on other faces (streaming.md 3.0 item 7,
    3.1 Edges): for each side on a face edge and each other face that owns some of its entries, a
    strip from 4 texels before the first owned corner to 4 past the last, along the side and across
    the face edge, its ends widened to multiples of 4 so its mip blocks are the owner tile's own.
    Entries the tile's own face owns read its texels -4..259; in-face sides store no profile."""
    corners: dict[tuple[int, Edge], list[tuple[int, int]]] = {}
    for e in face_edge_sides(tile):
        edge = EDGES[e]
        for k in range(TILE + 1):  # every mip's corners are among mip 0's
            owner, owner_edge, owner_k = profile_owner(tile, edge, k)
            if owner.face != tile.face:
                corners.setdefault((owner.face, edge), []).append(
                    edge_corner(owner, owner_edge, owner_k)
                )
    rects: list[Rect] = []
    for (face, _), points in sorted(corners.items()):
        cs = [c for c, _ in points]
        ct = [c for _, c in points]
        rects.append(
            (face, tile.level, _strip_span(min(ct), max(ct)), _strip_span(min(cs), max(cs)))
        )
    return rects


def cell_window(lon: npt.ArrayLike, lat: npt.ArrayLike, cell_arcsec: int) -> Window:
    """The smallest window holding every cell that bilinear sampling at these points touches, plus
    a one-cell halo: rows clamp at the poles, and columns wrap across ±180°."""
    global_w = ARCSEC_PER_TURN // cell_arcsec
    global_h = global_w // 2
    per_degree = 3600 / cell_arcsec
    x = np.floor((np.asarray(lon, dtype=np.float64) + 180) * per_degree - 0.5).astype(np.int64)
    y = np.floor((np.asarray(lat, dtype=np.float64) + 90) * per_degree - 0.5).astype(np.int64)
    j_lo = max(0, int(np.clip(y.min(), 0, global_h - 1)) - HALO)
    j_hi = min(global_h - 1, int(np.clip(y.max() + 1, 0, global_h - 1)) + HALO)
    covered = np.zeros(global_w, dtype=bool)
    columns = np.unique(x % global_w)
    for offset in range(-HALO, 2 + HALO):
        covered[(columns + offset) % global_w] = True
    i0, w = _arc(covered)
    return i0, j_lo, w, j_hi - j_lo + 1


def union_windows(windows: Iterable[Window], cell_arcsec: int) -> Window:
    """The smallest window holding every window given (columns as arcs of the circle)."""
    global_w = ARCSEC_PER_TURN // cell_arcsec
    covered = np.zeros(global_w, dtype=bool)
    rows: list[int] = []
    for i0, j0, w, h in windows:
        covered[(i0 + np.arange(w)) % global_w] = True
        rows += [j0, j0 + h]
    if not rows:
        raise ValueError("no windows to join")
    i0, w = _arc(covered)
    return i0, min(rows), w, max(rows) - min(rows)


def tile_window(tile: Tile, cell_arcsec: int) -> Window:
    """Every cell a tile's heights read in a grid of `cell_arcsec` cells: bilinear sub-samples of
    its texels -4..259 and of the owner-frame strips its edge profiles take, with a one-cell
    halo."""
    windows = []
    for face, level, rows, cols in [tile_texels(tile), *profile_rects(tile)]:
        lon, lat = subsample_lonlat(face, level, rows, cols)
        windows.append(cell_window(lon, lat, cell_arcsec))
    return union_windows(windows, cell_arcsec)


def _strip_span(first: int, last: int) -> range:
    """Texels from 4 before corner `first` to 4 past corner `last`, widened to multiples of 4."""
    start = (first - STRIP_DEPTH) // STRIP_ALIGN * STRIP_ALIGN
    stop = -(-(last + STRIP_DEPTH) // STRIP_ALIGN) * STRIP_ALIGN
    return range(start, stop)


def _subsample_axis(level: int, g: range) -> FloatArray:
    """s (or t) of sub-samples A = 4G + a for the texels G in g, in order."""
    a = np.arange(SUBSAMPLES * g.start, SUBSAMPLES * g.stop)
    return subsample(level, a // SUBSAMPLES, a % SUBSAMPLES)


def _arc(covered: npt.NDArray[np.bool_]) -> tuple[int, int]:
    """(start, length) of the shortest arc of the circle of columns holding every covered one: the
    complement of the longest uncovered run. A full circle starts at column 0."""
    n = covered.size
    if covered.all():
        return 0, n
    if not covered.any():
        raise ValueError("no columns are covered")
    # Rotate so the columns start at an uncovered run that follows a covered column: then no
    # uncovered run wraps around the end.
    starts = np.flatnonzero(~covered & np.roll(covered, 1))
    shift = int(starts[0])
    rolled = covered[np.r_[shift:n, 0:shift]]
    edges = np.flatnonzero(np.diff(np.r_[1, rolled.astype(np.int8), 1]))
    gap_starts, gap_ends = edges[0::2], edges[1::2]
    longest = int(np.argmax(gap_ends - gap_starts))
    gap = int(gap_ends[longest] - gap_starts[longest])
    return (int(gap_ends[longest]) + shift) % n, n - gap
