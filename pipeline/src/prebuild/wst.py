"""The surface tile format `.wst` (streaming.md 3.1): the reference encoder, a reference decoder,
and the values the app's decoder must reproduce bit for bit (`decoder_outputs`).

A tile holds 264² texels (the 256² tile plus a 4-texel border; row 0 is j = -4, the smallest t)
of height codes, shore bytes and water bytes, and the four edge profiles N, E, S, W at texel
corners 0..256. The payload is packed little-endian with every array at a multiple of its element
size, and the stored file is gzip level 9 with mtime 0.
"""

import gzip
import math
import struct
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from prebuild.codes import codes_to_meters
from prebuild.constants import CUBE, FORMATS
from prebuild.cube import Tile

type IntArray = npt.NDArray[np.int64]

MAGIC = str(FORMATS["surfaceTile"]["magic"]).encode("ascii")
VERSION = int(FORMATS["surfaceTile"]["version"])

SIZE = CUBE["tile"] + 2 * CUBE["border"]  # 264 texels a side, border included
EDGE_ENTRIES = CUBE["tile"] + 1  # texel corners 0..256
MIP_SIZES = (SIZE, SIZE // 2, SIZE // 4)  # 264, 132, 66
GRID = 33  # mesh vertices a side; vertex k sits at texel corner 8k
GRID_STEP = CUBE["tile"] // (GRID - 1)

MAX_OFFSET = 2048  # |code - codeMid|, which half-float holds exactly
MAX_RANGE = 2 * MAX_OFFSET
FLAG_INLAND_WATER = 1  # some texel has water d < 0
FLAG_ALL_SEA = 2  # every texel has shore d < 0
KNOWN_FLAGS = FLAG_INLAND_WATER | FLAG_ALL_SEA

HEADER = struct.Struct("<4sBBBBHHffhhh")
EDGES_AT = HEADER.size  # 26
HEIGHT_AT = EDGES_AT + 4 * EDGE_ENTRIES * 2  # 2,082
SHORE_AT = HEIGHT_AT + SIZE * SIZE * 2  # 141,474
WATER_AT = SHORE_AT + SIZE * SIZE  # 211,170
PAYLOAD_BYTES = WATER_AT + SIZE * SIZE  # 280,866

PLANE_SHAPE = (SIZE, SIZE)
EDGES_SHAPE = (4, EDGE_ENTRIES)
N, E, S, W = range(4)  # edge-profile order


class WstError(ValueError):
    """A tile the format does not allow, or bytes that are not one."""


@dataclass(frozen=True, eq=False)
class WstTile:
    tile: Tile
    flags: int
    q_land: float  # meters per code at or above -200 m; a multiple of 1/64, exact in f32
    code_mid: int
    code_min: int  # over the planes and the edge profiles
    code_max: int
    edges: npt.NDArray[np.int16]  # (4, 257): N, E, S, W, entries in increasing s or t
    codes: npt.NDArray[np.int16]  # (264, 264), row 0 is j = -4
    shore: npt.NDArray[np.uint8]  # (264, 264)
    water: npt.NDArray[np.uint8]  # (264, 264)

    @classmethod
    def from_planes(
        cls,
        tile: Tile,
        *,
        flags: int,
        q_land: float,
        codes: npt.ArrayLike,
        shore: npt.ArrayLike,
        water: npt.ArrayLike,
        edges: npt.ArrayLike,
    ) -> WstTile:
        """A tile whose code bounds come from its planes and edges, with codeMid
        ⌊(codeMin + codeMax)/2⌋, so a range of at most 4,096 codes keeps every offset within
        ±2,048."""
        code_array = _integers(codes, np.int16)
        edge_array = _integers(edges, np.int16)
        low = int(min(code_array.min(), edge_array.min()))
        high = int(max(code_array.max(), edge_array.max()))
        return cls(
            tile=tile,
            flags=flags,
            q_land=q_land,
            code_mid=(low + high) // 2,
            code_min=low,
            code_max=high,
            edges=edge_array,
            codes=code_array,
            shore=_integers(shore, np.uint8),
            water=_integers(water, np.uint8),
        )

    @property
    def q_deep(self) -> float:
        return 4 * self.q_land


def tile_flags(shore_d: npt.ArrayLike, water_d: npt.ArrayLike) -> int:
    """Header flags from the stored texels' signed distances: bit0 when some texel has water
    d < 0, bit1 when every texel has shore d < 0."""
    flags = 0
    if np.any(np.asarray(water_d) < 0):
        flags |= FLAG_INLAND_WATER
    if np.all(np.asarray(shore_d) < 0):
        flags |= FLAG_ALL_SEA
    return flags


def zigzag(v: npt.ArrayLike) -> IntArray:
    """Signed to unsigned: 0, -1, 1, -2, … become 0, 1, 2, 3, …"""
    a = np.asarray(v, dtype=np.int64)
    return (a << 1) ^ (a >> 63)


def unzigzag(z: npt.ArrayLike) -> IntArray:
    a = np.asarray(z, dtype=np.int64)
    return (a >> 1) ^ -(a & 1)


def predictor(plane: npt.ArrayLike) -> IntArray:
    """left + up - upleft at every texel, with 0 outside the grid. Up is the previous row."""
    a = np.asarray(plane, dtype=np.int64)
    padded = np.zeros((a.shape[0] + 1, a.shape[1] + 1), dtype=np.int64)
    padded[1:, 1:] = a
    return padded[1:, :-1] + padded[:-1, 1:] - padded[:-1, :-1]


def unpredict(residuals: npt.ArrayLike) -> IntArray:
    """The plane whose `plane - predictor(plane)` is `residuals`: running sums down, then across."""
    return np.cumsum(np.cumsum(np.asarray(residuals, dtype=np.int64), axis=0), axis=1)


def encode_payload(t: WstTile) -> bytes:
    """The raw 280,866-byte payload, once the tile is checked against the format."""
    _check(t)
    header = HEADER.pack(
        MAGIC,
        VERSION,
        t.tile.face,
        t.tile.level,
        t.flags,
        t.tile.x,
        t.tile.y,
        t.q_land,
        t.q_deep,
        t.code_mid,
        t.code_min,
        t.code_max,
    )
    # Within a 4,096-code range a residual stays within ±8,192, and the first texel's residual is
    # its own i16 code, so every zigzag fits a u16.
    height = zigzag(t.codes.astype(np.int64) - predictor(t.codes))
    payload = b"".join(
        [
            header,
            t.edges.astype("<i2").tobytes(),
            height.astype("<u2").tobytes(),
            _byte_residuals(t.shore),
            _byte_residuals(t.water),
        ]
    )
    assert len(payload) == PAYLOAD_BYTES
    return payload


def decode_payload(raw: bytes, expected: Tile | None = None) -> WstTile:
    """The tile in a raw payload. Rejects what the app's decoder rejects: a wrong length, magic,
    version or key (when `expected` is given), a qLand that is not positive or a qDeep other than
    4·qLand, any |code - codeMid| > 2048, and a codeMin or codeMax that does not match the planes
    and edges."""
    if len(raw) != PAYLOAD_BYTES:
        raise WstError(f"payload is {len(raw)} bytes, not {PAYLOAD_BYTES}")
    magic, version, face, level, flags, x, y, q_land, q_deep, mid, low, high = HEADER.unpack_from(
        raw
    )
    if magic != MAGIC:
        raise WstError(f"magic is {magic!r}, not {MAGIC!r}")
    if version != VERSION:
        raise WstError(f"version is {version}, not {VERSION}")
    try:
        tile = Tile(face, level, x, y)
    except ValueError as error:
        raise WstError(str(error)) from None
    if expected is not None and tile != expected:
        raise WstError(f"tile is {tile.key()}, not {expected.key()}")
    if not (math.isfinite(q_land) and q_land > 0 and q_deep == 4 * q_land):
        raise WstError(f"qLand {q_land} and qDeep {q_deep} are not a positive q and 4q")
    edges = np.frombuffer(raw, "<i2", 4 * EDGE_ENTRIES, EDGES_AT).reshape(EDGES_SHAPE)
    height = np.frombuffer(raw, "<u2", SIZE * SIZE, HEIGHT_AT).reshape(PLANE_SHAPE)
    codes = unpredict(unzigzag(height))
    lowest = int(min(codes.min(), edges.min()))
    highest = int(max(codes.max(), edges.max()))
    if max(highest - mid, mid - lowest) > MAX_OFFSET:
        raise WstError(f"codes {lowest}..{highest} reach past codeMid {mid} ± {MAX_OFFSET}")
    if (lowest, highest) != (low, high):
        raise WstError(f"header codes {low}..{high}, planes and edges {lowest}..{highest}")
    return WstTile(
        tile=tile,
        flags=flags,
        q_land=q_land,
        code_mid=mid,
        code_min=low,
        code_max=high,
        edges=edges.astype(np.int16),
        codes=codes.astype(np.int16),
        shore=_unpredict_bytes(raw, SHORE_AT),
        water=_unpredict_bytes(raw, WATER_AT),
    )


def to_file(t: WstTile) -> bytes:
    """The stored file: gzip level 9, mtime 0, no file name."""
    return gzip.compress(encode_payload(t), compresslevel=9, mtime=0)


def from_file(data: bytes, expected: Tile | None = None) -> WstTile:
    return decode_payload(gzip.decompress(data), expected)


def bounds_m(t: WstTile) -> tuple[int, int]:
    """[floor(h(codeMin)), ceil(h(codeMax))]: the tile's meter bounds, as bounds.bin holds them."""
    low, high = codes_to_meters([t.code_min, t.code_max], t.q_land)
    return math.floor(low), math.ceil(high)


def mips(plane: npt.ArrayLike) -> list[IntArray]:
    """Mips 264², 132² and 66², each texel m = (a + b + c + d + 2) >> 2 of the level above."""
    levels = [np.asarray(plane, dtype=np.int64)]
    while len(levels) < len(MIP_SIZES):
        a = levels[-1]
        levels.append((a[0::2, 0::2] + a[0::2, 1::2] + a[1::2, 0::2] + a[1::2, 1::2] + 2) >> 2)
    return levels


def grid33(t: WstTile) -> npt.NDArray[np.float32]:
    """The 33² mesh heights in meters, row 0 at the smallest t. Interior vertex (k, l) sits at
    texel corner (8k, 8l) and takes h of the mean of the four mip-2 codes around it; boundary
    vertices take h of the edge-profile code at their corner (rows 0 and 32 from S and N, the
    rest of columns 0 and 32 from W and E)."""
    mip2 = mips(t.codes)[2]
    # around[p, q] sums the four mip-2 texels that meet at the corner after row p and column q.
    around = mip2[:-1, :-1] + mip2[:-1, 1:] + mip2[1:, :-1] + mip2[1:, 1:]
    # Vertex k (1..31) sits between mip-2 texels 2k and 2k + 1; mip-2 texel 0 is the border.
    inner = slice(2, 2 * (GRID - 1), 2)
    along = slice(0, EDGE_ENTRIES, GRID_STEP)
    corner_codes = np.empty((GRID, GRID), dtype=np.float64)
    corner_codes[1:-1, 1:-1] = around[inner, inner] / 4
    corner_codes[0, :] = t.edges[S, along]
    corner_codes[-1, :] = t.edges[N, along]
    corner_codes[1:-1, 0] = t.edges[W, along][1:-1]
    corner_codes[1:-1, -1] = t.edges[E, along][1:-1]
    return codes_to_meters(corner_codes, t.q_land).astype(np.float32)


def half_bits(values: npt.ArrayLike) -> npt.NDArray[np.uint16]:
    """IEEE half-float bits of integers within ±2048, all of which it holds exactly."""
    v = np.asarray(values, dtype=np.int64)
    if np.abs(v).max(initial=0) > MAX_OFFSET:
        raise WstError(f"half-float holds integers within ±{MAX_OFFSET} exactly")
    return v.astype(np.float16).view(np.uint16)


def decoder_outputs(t: WstTile) -> dict[str, np.ndarray]:
    """What the app's decoder hands the GPU, for the cross-language check: R16F offsets
    code - codeMid as half-float bits and RG8 (shore, water) at mips 0, 1 and 2, the R16F edge
    offsets, and the 33² f32 meter grid."""
    height, shore, water = mips(t.codes), mips(t.shore), mips(t.water)
    outputs: dict[str, np.ndarray] = {}
    for level in range(len(MIP_SIZES)):
        outputs[f"height{level}"] = half_bits(height[level] - t.code_mid)
        outputs[f"channel{level}"] = np.stack([shore[level], water[level]], -1).astype(np.uint8)
    outputs["edges"] = half_bits(t.edges.astype(np.int64) - t.code_mid)
    outputs["grid"] = grid33(t)
    return outputs


def _check(t: WstTile) -> None:
    for name, plane, dtype in (
        ("codes", t.codes, np.int16),
        ("shore", t.shore, np.uint8),
        ("water", t.water, np.uint8),
    ):
        if plane.shape != PLANE_SHAPE or plane.dtype != dtype:
            raise WstError(f"{name} is {plane.dtype}{plane.shape}, not {np.dtype(dtype)}(264, 264)")
    if t.edges.shape != EDGES_SHAPE or t.edges.dtype != np.int16:
        raise WstError(f"edges are {t.edges.dtype}{t.edges.shape}, not int16(4, 257)")
    if t.flags & ~KNOWN_FLAGS:
        raise WstError(f"unknown flags {t.flags:#x}")
    if not (t.q_land > 0 and math.isfinite(t.q_land) and float(np.float32(t.q_land)) == t.q_land):
        raise WstError(f"qLand {t.q_land} is not a positive f32")
    lowest = int(min(t.codes.min(), t.edges.min()))
    highest = int(max(t.codes.max(), t.edges.max()))
    if highest - lowest > MAX_RANGE:
        raise WstError(f"codes {lowest}..{highest} span more than {MAX_RANGE}")
    if (lowest, highest) != (t.code_min, t.code_max):
        raise WstError(
            f"codeMin..codeMax {t.code_min}..{t.code_max}, planes and edges {lowest}..{highest}"
        )
    # Within a span of at most 4,096, this codeMid leaves every code within ±2,048.
    mid = (lowest + highest) // 2
    if t.code_mid != mid:
        raise WstError(f"codeMid {t.code_mid} is not ⌊({lowest} + {highest})/2⌋ = {mid}")
    corners = (
        (t.edges[N, 0], t.edges[W, -1]),
        (t.edges[N, -1], t.edges[E, -1]),
        (t.edges[S, 0], t.edges[W, 0]),
        (t.edges[S, -1], t.edges[E, 0]),
    )
    if any(a != b for a, b in corners):
        raise WstError("edge profiles disagree at a tile corner")


def _byte_residuals(plane: npt.NDArray[np.uint8]) -> bytes:
    """(v - pred) mod 256."""
    return ((plane.astype(np.int64) - predictor(plane)) & 0xFF).astype(np.uint8).tobytes()


def _unpredict_bytes(raw: bytes, offset: int) -> npt.NDArray[np.uint8]:
    residuals = np.frombuffer(raw, np.uint8, SIZE * SIZE, offset).reshape(PLANE_SHAPE)
    return (unpredict(residuals) & 0xFF).astype(np.uint8)


def _integers(values: npt.ArrayLike, dtype: type[np.integer]) -> np.ndarray:
    """`values` as `dtype`, refusing any value the type cannot hold exactly."""
    a = np.asarray(values)
    if not np.issubdtype(a.dtype, np.integer) and not np.array_equal(a, np.trunc(a)):
        raise WstError("planes and edges hold integers")
    info = np.iinfo(dtype)
    if a.size and (a.min() < info.min or a.max() > info.max):
        raise WstError(f"values {a.min()}..{a.max()} do not fit {np.dtype(dtype)}")
    return a.astype(dtype)
