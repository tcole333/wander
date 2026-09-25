"""Cube-sphere conventions (streaming.md 3.0): face frames, projection, exact positions, tile
addressing, the node index and the face-edge table. `app/src/surface/cube.ts` implements the same.

Functions take numpy arrays or scalars and broadcast. Texel, sub-sample, corner and subpixel
indices are face-global integers (G = 256x + i), so a position is exact and depends only on where
it is, never on which tile asks.
"""

import math
import re
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from prebuild.constants import CUBE

type Edge = Literal["N", "E", "S", "W"]
type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]

EDGES: tuple[Edge, ...] = ("N", "E", "S", "W")
OPPOSITE: dict[Edge, Edge] = {"N": "S", "E": "W", "S": "N", "W": "E"}

TILE: int = CUBE["tile"]

# (6, 3, 3): center C, U and V of each face in the globe frame G.
FACES: FloatArray = np.array(
    [[face["c"], face["u"], face["v"]] for face in CUBE["faces"]], dtype=np.float64
)
FACES.setflags(write=False)

# (face, edge) -> (neighbor face, the neighbor's edge that meets it, whether entries run reversed),
# streaming.md 3.0 item 7. Ownership and neighbors read this table, never a float comparison.
FACE_EDGES: dict[tuple[int, Edge], tuple[int, Edge, bool]] = {
    (0, "N"): (4, "S", False),
    (0, "E"): (1, "W", False),
    (0, "S"): (5, "N", False),
    (0, "W"): (3, "E", False),
    (1, "N"): (4, "E", False),
    (1, "E"): (2, "W", False),
    (1, "S"): (5, "E", True),
    (1, "W"): (0, "E", False),
    (2, "N"): (4, "N", True),
    (2, "E"): (3, "W", False),
    (2, "S"): (5, "S", True),
    (2, "W"): (1, "E", False),
    (3, "N"): (4, "W", True),
    (3, "E"): (0, "W", False),
    (3, "S"): (5, "W", False),
    (3, "W"): (2, "E", False),
    (4, "N"): (2, "N", True),
    (4, "E"): (1, "N", False),
    (4, "S"): (0, "N", False),
    (4, "W"): (3, "N", True),
    (5, "N"): (0, "S", False),
    (5, "E"): (1, "S", True),
    (5, "S"): (2, "S", True),
    (5, "W"): (3, "S", False),
}

_KEY = re.compile(r"(0|[1-9]\d*)/(0|[1-9]\d*)/(0|[1-9]\d*)/(0|[1-9]\d*)")
_STEP: dict[Edge, tuple[int, int]] = {"N": (0, 1), "E": (1, 0), "S": (0, -1), "W": (-1, 0)}


@dataclass(frozen=True, slots=True)
class Tile:
    face: int
    level: int
    x: int
    y: int

    def __post_init__(self) -> None:
        side = 1 << self.level if self.level >= 0 else 0
        if not (0 <= self.face < 6 and 0 <= self.x < side and 0 <= self.y < side):
            raise ValueError(f"no tile {self.level}/{self.face}/{self.x}/{self.y}")

    def key(self) -> str:
        """`L/f/x/y`, the tile's path under `surf/<ver8>/`."""
        return f"{self.level}/{self.face}/{self.x}/{self.y}"

    def parent(self) -> Tile:
        if self.level == 0:
            raise ValueError(f"tile {self.key()} has no parent")
        return Tile(self.face, self.level - 1, self.x >> 1, self.y >> 1)


@dataclass(frozen=True, slots=True)
class Neighbor:
    tile: Tile
    edge: Edge  # the neighbor's edge that meets the asking tile's edge
    reversed: bool  # entry k is the neighbor's entry 256 - k


def lonlat_to_dir(lon: npt.ArrayLike, lat: npt.ArrayLike) -> FloatArray:
    """Unit direction in G for longitude and latitude in degrees; shape (..., 3)."""
    lam, phi = np.broadcast_arrays(
        np.asarray(lon, dtype=np.float64) * (math.pi / 180),
        np.asarray(lat, dtype=np.float64) * (math.pi / 180),
    )
    cos_phi = np.cos(phi)
    return np.stack([cos_phi * np.cos(lam), cos_phi * np.sin(lam), np.sin(phi)], axis=-1)


def dir_to_lonlat(p: npt.ArrayLike) -> tuple[FloatArray, FloatArray]:
    """Longitude in (-180, 180] and latitude, in degrees, of directions shaped (..., 3)."""
    q = np.asarray(p, dtype=np.float64)
    x, y, z = q[..., 0], q[..., 1], q[..., 2]
    return np.arctan2(y, x) * (180 / math.pi), np.arctan2(z, np.hypot(x, y)) * (180 / math.pi)


def face_of(p: npt.ArrayLike) -> IntArray:
    """The face of the largest |component| with its sign; ties go to the lowest face."""
    q = np.asarray(p, dtype=np.float64)
    toward = np.stack([_dot(q, FACES[f, 0]) for f in range(6)], axis=-1)
    return np.argmax(toward, axis=-1).astype(np.int64)


def face_st(face: npt.ArrayLike, p: npt.ArrayLike) -> tuple[FloatArray, FloatArray]:
    """(s, t) of directions p in the frame of `face`: s = (4/pi)·atan((p·U)/(p·C))."""
    frame = FACES[np.asarray(face)]
    q = np.asarray(p, dtype=np.float64)
    along_c = _dot(q, frame[..., 0, :])
    s = (4 / math.pi) * np.arctan(_dot(q, frame[..., 1, :]) / along_c)
    t = (4 / math.pi) * np.arctan(_dot(q, frame[..., 2, :]) / along_c)
    return s, t


def st_to_dir(face: npt.ArrayLike, s: npt.ArrayLike, t: npt.ArrayLike) -> FloatArray:
    """normalize(C + tan(pi·s/4)·U + tan(pi·t/4)·V); shape (..., 3)."""
    frame = FACES[np.asarray(face)]
    a = np.tan(math.pi * np.asarray(s, dtype=np.float64) / 4)[..., None]
    b = np.tan(math.pi * np.asarray(t, dtype=np.float64) / 4)[..., None]
    p = frame[..., 0, :] + a * frame[..., 1, :] + b * frame[..., 2, :]
    length = np.sqrt(p[..., 0] * p[..., 0] + p[..., 1] * p[..., 1] + p[..., 2] * p[..., 2])
    return p / length[..., None]


def to_three(p: npt.ArrayLike) -> FloatArray:
    """three.js space (G.y, G.z, G.x): north is +Y and longitude 0 faces +Z."""
    return np.asarray(p, dtype=np.float64)[..., [1, 2, 0]]


def texel_center(level: int, g: npt.ArrayLike) -> FloatArray:
    """s of the center of face-global texel G = 256x + i (t likewise): -1 + (2G + 1)/(256n)."""
    return -1.0 + (2 * _integers(g) + 1) / (TILE << level)


def subsample(level: int, g: npt.ArrayLike, a: npt.ArrayLike) -> FloatArray:
    """s of height sub-sample a in 0..3 of texel G: -1 + (8G + 2a + 1)/(1024n)."""
    return -1.0 + (8 * _integers(g) + 2 * _integers(a) + 1) / ((4 * TILE) << level)


def corner(level: int, c: npt.ArrayLike) -> FloatArray:
    """s of face-global texel corner C = 256x + c: -1 + C/(128n)."""
    return -1.0 + 2 * _integers(c) / (TILE << level)


def subpixel_center(level: int, a: npt.ArrayLike) -> FloatArray:
    """s of face-global shore and water subpixel A = 4G + a: -1 + (2A + 1)/(1024n)."""
    return -1.0 + (2 * _integers(a) + 1) / ((4 * TILE) << level)


def tile_of(s: npt.ArrayLike, level: int) -> IntArray:
    """Tile index x along s (y along t), clamped to the face."""
    side = 1 << level
    x = np.floor((np.asarray(s, dtype=np.float64) + 1) * (side / 2))
    return np.clip(x, 0, side - 1).astype(np.int64)


def texel_of(s: npt.ArrayLike, level: int, tile: npt.ArrayLike) -> IntArray:
    """Texel index i in 0..255 within tile x along s (j within y along t), clamped to the tile."""
    g = np.floor((np.asarray(s, dtype=np.float64) + 1) * ((TILE << level) / 2))
    return np.clip(g - TILE * _integers(tile), 0, TILE - 1).astype(np.int64)


def node_index(t: Tile) -> int:
    """2(4^L - 1) + f·4^L + y·2^L + x: the tile's bit in the availability bitmap."""
    side = 1 << t.level
    return 2 * (side * side - 1) + (t.face * side + t.y) * side + t.x


def node_from_index(k: int) -> Tile:
    if k < 0:
        raise ValueError(f"no node {k}")
    level = 0
    while k >= node_count(level):
        level += 1
    side = 1 << level
    face, rest = divmod(k - 2 * (side * side - 1), side * side)
    y, x = divmod(rest, side)
    return Tile(face, level, x, y)


def node_count(max_level: int) -> int:
    """Nodes at levels 0..max_level: 2(4^(max_level + 1) - 1)."""
    side = 2 << max_level
    return 2 * (side * side - 1)


def parse_tile_key(key: str) -> Tile:
    match = _KEY.fullmatch(key)
    if match is None:
        raise ValueError(f"not a tile key: {key!r}")
    level, face, x, y = (int(part) for part in match.groups())
    return Tile(face, level, x, y)


def neighbor(t: Tile, edge: Edge) -> Neighbor:
    """The tile across `edge`, the edge of it that meets `edge`, and whether entries reverse."""
    dx, dy = _STEP[edge]
    last = (1 << t.level) - 1
    if 0 <= t.x + dx <= last and 0 <= t.y + dy <= last:
        return Neighbor(Tile(t.face, t.level, t.x + dx, t.y + dy), OPPOSITE[edge], False)
    face, facing, reverse = FACE_EDGES[(t.face, edge)]
    along = t.x if edge in ("N", "S") else t.y
    if reverse:
        along = last - along
    across = last if facing in ("N", "E") else 0
    x, y = (along, across) if facing in ("N", "S") else (across, along)
    return Neighbor(Tile(face, t.level, x, y), facing, reverse)


def profile_owner(t: Tile, edge: Edge, k: int) -> tuple[Tile, Edge, int]:
    """Where the owner face addresses entry k (0..256) of `t`'s edge profile.

    The owner is the lowest-numbered face among the faces that meet at the entry's corner point
    (streaming.md 3.0 item 7). Every tile that shares the point gets the same answer: on the owner
    face, the S edge of the tile above the corner's row, or the W edge of the tile right of its
    column (N or E on the face's last row or column), with a row preferred over a column.
    """
    if not 0 <= k <= TILE:
        raise ValueError(f"edge entry {k} is outside 0..{TILE}")
    full = TILE << t.level
    cs, ct = _edge_corner(t, edge, k)
    candidates = [(t.face, cs, ct)]
    for face_edge in _face_edges_at(cs, ct, full):
        candidates.append(_across_face_edge(t.face, face_edge, cs, ct, full))
    face, cs, ct = min(candidates)
    return _address(face, t.level, cs, ct)


def avail_get(bitmap: bytes | bytearray, k: int) -> bool:
    """Bit k of an availability bitmap: byte k >> 3, bit k & 7, least significant first."""
    return bool((bitmap[k >> 3] >> (k & 7)) & 1)


def avail_set(bitmap: bytearray, k: int) -> None:
    bitmap[k >> 3] |= 1 << (k & 7)


def _dot(p: FloatArray, axis: FloatArray) -> FloatArray:
    # Exact: every axis component is 0 or ±1.
    return p[..., 0] * axis[..., 0] + p[..., 1] * axis[..., 1] + p[..., 2] * axis[..., 2]


def _integers(values: npt.ArrayLike) -> IntArray:
    array = np.asarray(values)
    if not np.issubdtype(array.dtype, np.integer):
        raise TypeError(f"face-global indices must be integers, not {array.dtype}")
    return array.astype(np.int64)


def _edge_corner(t: Tile, edge: Edge, k: int) -> tuple[int, int]:
    """Face-global texel corner of entry k of the tile's edge."""
    x0, y0 = TILE * t.x, TILE * t.y
    corners = {
        "N": (x0 + k, y0 + TILE),
        "E": (x0 + TILE, y0 + k),
        "S": (x0 + k, y0),
        "W": (x0, y0 + k),
    }
    return corners[edge]


def _face_edges_at(cs: int, ct: int, full: int) -> list[Edge]:
    edges: list[Edge] = []
    if ct == full:
        edges.append("N")
    if cs == full:
        edges.append("E")
    if ct == 0:
        edges.append("S")
    if cs == 0:
        edges.append("W")
    return edges


def _across_face_edge(face: int, edge: Edge, cs: int, ct: int, full: int) -> tuple[int, int, int]:
    """A corner on a face edge, in the frame of the face across it."""
    other, facing, reverse = FACE_EDGES[(face, edge)]
    along = cs if edge in ("N", "S") else ct
    if reverse:
        along = full - along
    across = full if facing in ("N", "E") else 0
    return (other, along, across) if facing in ("N", "S") else (other, across, along)


def _address(face: int, level: int, cs: int, ct: int) -> tuple[Tile, Edge, int]:
    last = (1 << level) - 1
    if ct % TILE == 0:
        row = ct // TILE
        x = min(cs // TILE, last)
        if row > last:
            return Tile(face, level, x, last), "N", cs - TILE * x
        return Tile(face, level, x, row), "S", cs - TILE * x
    column = cs // TILE
    y = ct // TILE
    if column > last:
        return Tile(face, level, last, y), "E", ct - TILE * y
    return Tile(face, level, column, y), "W", ct - TILE * y
