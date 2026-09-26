"""The surface tile format `.wst` (streaming.md 3.1): the reference encoder, a reference decoder,
and the values the app's decoder must reproduce bit for bit (`decoder_outputs`).

A tile holds 264² texels (the 256² tile plus a 4-texel border; row 0 is j = -4, the smallest t)
of height codes, shore bytes and water bytes, and an edge profile on each side that lies on a face
edge (`cube.face_edge_sides`): codes and shore bytes at mips 0, 1 and 2, entry k of mip m at texel
corner 2^m·k. Within a face, border identity makes a profile redundant, so in-face sides store
none. The payload is packed little-endian with every array at a multiple of its element size, and
the stored file is gzip level 9 with mtime 0.
"""

import gzip
import math
import struct
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from prebuild.codes import codes_to_meters
from prebuild.constants import FORMATS
from prebuild.cube import BORDER, EDGES, TILE, Tile, face_edge_sides

type IntArray = npt.NDArray[np.int64]

MAGIC = str(FORMATS["surfaceTile"]["magic"]).encode("ascii")
VERSION = int(FORMATS["surfaceTile"]["version"])

SIZE = TILE + 2 * BORDER  # 264 texels a side, border included
MIP_SIZES = (SIZE, SIZE // 2, SIZE // 4)  # 264, 132, 66
GRID = 33  # mesh vertices a side; vertex k sits at texel corner 8k
GRID_STEP = TILE // (GRID - 1)

# A side's profile: mip 0 entries 0..256, then mip 1 entries 0..128, then mip 2 entries 0..64.
MIP_ENTRIES = tuple((TILE >> m) + 1 for m in range(len(MIP_SIZES)))  # 257, 129, 65
MIP_START = (0, MIP_ENTRIES[0], MIP_ENTRIES[0] + MIP_ENTRIES[1])  # 0, 257, 386
PROFILE_ENTRIES = sum(MIP_ENTRIES)  # 451
ENTRY_MIP = np.repeat(np.arange(len(MIP_SIZES)), MIP_ENTRIES)  # the mip of each entry
ENTRY_CORNER = np.concatenate([np.arange(n) << m for m, n in enumerate(MIP_ENTRIES)])  # 2^m·k
ENTRY_MIP.setflags(write=False)
ENTRY_CORNER.setflags(write=False)
EDGE_ENTRIES = TILE + 1  # the edges output's width: mip 0's texel corners 0..256
EDGE_ROWS = len(EDGES) * len(MIP_SIZES)  # 12: row 4m + e holds side e at mip m

MAX_OFFSET = 2048  # |code - codeMid|, which half-float holds exactly
MAX_RANGE = 2 * MAX_OFFSET
FLAG_INLAND_WATER = 1  # some texel has water d < 0
FLAG_ALL_SEA = 2  # every texel has shore d < 0
KNOWN_FLAGS = FLAG_INLAND_WATER | FLAG_ALL_SEA

HEADER = struct.Struct("<4sBBBBHHffhhh")
PROFILES_AT = HEADER.size  # 26
SIDE_BYTES = PROFILE_ENTRIES * 3  # 1,353: the i16 codes and u8 shore bytes of one side
PLANE_BYTES = SIZE * SIZE * 4  # 278,784: the u16 height, u8 shore and u8 water planes

PLANE_SHAPE = (SIZE, SIZE)
PROFILES_SHAPE = (len(EDGES), PROFILE_ENTRIES)
N, E, S, W = range(4)  # edge-profile order
# Where two sides meet at a tile corner: (side, entry, side, entry), entry -1 the mip's last.
TILE_CORNERS = ((N, 0, W, -1), (N, -1, E, -1), (S, 0, W, 0), (S, -1, E, 0))


class WstError(ValueError):
    """A tile the format does not allow, or bytes that are not one."""


@dataclass(frozen=True, eq=False)
class WstTile:
    tile: Tile
    flags: int
    q_land: float  # meters per code at or above -200 m; a multiple of 1/64, exact in f32
    code_mid: int
    code_min: int  # over the planes and the stored profile entries
    code_max: int
    # (4, 451): sides N, E, S, W, each mip 0 entries 0..256, mip 1 0..128 and mip 2 0..64, in
    # increasing s or t; the rows of in-face sides are zero.
    profiles: npt.NDArray[np.int16]
    profile_shore: npt.NDArray[np.uint8]  # (4, 451): the shore byte of each entry, laid out alike
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
        profiles: npt.ArrayLike | None = None,
        profile_shore: npt.ArrayLike | None = None,
    ) -> WstTile:
        """A tile whose code bounds come from its planes and stored profile entries, with codeMid
        ⌊(codeMin + codeMax)/2⌋, so a range of at most 4,096 codes keeps every offset within
        ±2,048. Profiles left out are zero, as a tile with no face-edge side stores them."""
        code_array = _integers(codes, np.int16)
        profile_array = _integers(_or_zeros(profiles), np.int16)
        low, high = _code_range(tile, code_array, profile_array)
        return cls(
            tile=tile,
            flags=flags,
            q_land=q_land,
            code_mid=(low + high) // 2,
            code_min=low,
            code_max=high,
            profiles=profile_array,
            profile_shore=_integers(_or_zeros(profile_shore), np.uint8),
            codes=code_array,
            shore=_integers(shore, np.uint8),
            water=_integers(water, np.uint8),
        )

    @property
    def q_deep(self) -> float:
        return 4 * self.q_land


def payload_bytes(sides: int) -> int:
    """The raw payload's length for a tile with `sides` face-edge sides: 26 + 1,353·sides, one pad
    byte when sides is odd, then the 278,784 bytes of the planes."""
    return PROFILES_AT + SIDE_BYTES * sides + sides % 2 + PLANE_BYTES


def mip_entries(profiles: np.ndarray, m: int) -> np.ndarray:
    """The entries of mip m, 0..(256 >> m), along the last axis of a profile layout."""
    return profiles[..., MIP_START[m] : MIP_START[m] + MIP_ENTRIES[m]]


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
    """The raw payload, `payload_bytes` long for the tile's face-edge sides, once the tile is
    checked against the format."""
    _check(t)
    sides = face_edge_sides(t.tile)
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
            *(t.profiles[e].astype("<i2").tobytes() for e in sides),
            *(t.profile_shore[e].tobytes() for e in sides),
            bytes(len(sides) % 2),  # keeps the height plane at an even offset
            height.astype("<u2").tobytes(),
            _byte_residuals(t.shore),
            _byte_residuals(t.water),
        ]
    )
    assert len(payload) == payload_bytes(len(sides))
    return payload


def decode_payload(raw: bytes, expected: Tile | None = None) -> WstTile:
    """The tile in a raw payload. Rejects what the app's decoder rejects: a wrong magic, version
    or key (when `expected` is given), a length other than `payload_bytes` for the key's face-edge
    sides, a qLand that is not positive or a qDeep other than 4·qLand, any |code - codeMid| > 2048,
    a codeMin or codeMax that does not match the planes and stored profile entries, and stored
    profiles that disagree at a tile corner."""
    if len(raw) < HEADER.size:
        raise WstError(f"payload is {len(raw)} bytes, shorter than the {HEADER.size}-byte header")
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
    sides = face_edge_sides(tile)
    n = len(sides)
    if len(raw) != payload_bytes(n):
        raise WstError(f"payload is {len(raw)} bytes, not {payload_bytes(n)} for {n} stored sides")
    if not (math.isfinite(q_land) and q_land > 0 and q_deep == 4 * q_land):
        raise WstError(f"qLand {q_land} and qDeep {q_deep} are not a positive q and 4q")
    profiles = np.zeros(PROFILES_SHAPE, dtype=np.int16)
    profile_shore = np.zeros(PROFILES_SHAPE, dtype=np.uint8)
    stored = (n, PROFILE_ENTRIES)
    shore_at = PROFILES_AT + 2 * PROFILE_ENTRIES * n
    profiles[list(sides)] = np.frombuffer(raw, "<i2", n * PROFILE_ENTRIES, PROFILES_AT).reshape(
        stored
    )
    profile_shore[list(sides)] = np.frombuffer(
        raw, np.uint8, n * PROFILE_ENTRIES, shore_at
    ).reshape(stored)
    height_at = PROFILES_AT + SIDE_BYTES * n + n % 2
    height = np.frombuffer(raw, "<u2", SIZE * SIZE, height_at).reshape(PLANE_SHAPE)
    codes = unpredict(unzigzag(height))
    lowest, highest = _code_range(tile, codes, profiles)
    if max(highest - mid, mid - lowest) > MAX_OFFSET:
        raise WstError(f"codes {lowest}..{highest} reach past codeMid {mid} ± {MAX_OFFSET}")
    if (lowest, highest) != (low, high):
        raise WstError(f"header codes {low}..{high}, planes and profiles {lowest}..{highest}")
    disagreement = _corner_disagreement(sides, profiles, profile_shore)
    if disagreement:
        raise WstError(disagreement)
    shore_plane_at = height_at + 2 * SIZE * SIZE
    return WstTile(
        tile=tile,
        flags=flags,
        q_land=q_land,
        code_mid=mid,
        code_min=low,
        code_max=high,
        profiles=profiles,
        profile_shore=profile_shore,
        codes=codes.astype(np.int16),
        shore=_unpredict_bytes(raw, shore_plane_at),
        water=_unpredict_bytes(raw, shore_plane_at + SIZE * SIZE),
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
    """Mips 0, 1 and 2 of a plane whose sides are multiples of 4 (264², 132² and 66² for a tile),
    each texel m = (a + b + c + d + 2) >> 2 of the 2x2 block above it."""
    levels = [np.asarray(plane, dtype=np.int64)]
    while len(levels) < len(MIP_SIZES):
        a = levels[-1]
        levels.append((a[0::2, 0::2] + a[0::2, 1::2] + a[1::2, 0::2] + a[1::2, 1::2] + 2) >> 2)
    return levels


def grid33(t: WstTile) -> npt.NDArray[np.float32]:
    """The 33² mesh heights in meters, row 0 at the smallest t. Vertex (k, l) sits at texel corner
    (8k, 8l). A vertex on a stored side (row 32 for N, column 32 for E, row 0 for S, column 0 for
    W) takes h of that side's mip-2 entry 2·(its index along the side), which two stored sides
    agree on at a tile corner; every other vertex, on an in-face side too, takes h of the mean of
    the four mip-2 codes around its corner."""
    mip2 = mips(t.codes)[2]
    # around[p, q] sums the four mip-2 texels that meet at the corner after row p and column q.
    around = mip2[:-1, :-1] + mip2[:-1, 1:] + mip2[1:, :-1] + mip2[1:, 1:]
    # Vertex k sits between mip-2 texels 2k and 2k + 1; mip-2 texel 0 is the border.
    every = slice(0, 2 * GRID - 1, 2)
    corner_codes = around[every, every] / 4
    along = mip_entries(t.profiles, 2)[:, :: GRID_STEP >> 2]  # mip-2 entry 2k sits at corner 8k
    sides = face_edge_sides(t.tile)
    if S in sides:
        corner_codes[0, :] = along[S]
    if N in sides:
        corner_codes[-1, :] = along[N]
    if W in sides:
        corner_codes[:, 0] = along[W]
    if E in sides:
        corner_codes[:, -1] = along[E]
    return codes_to_meters(corner_codes, t.q_land).astype(np.float32)


def half_bits(values: npt.ArrayLike) -> npt.NDArray[np.uint16]:
    """IEEE half-float bits of integers within ±2048, all of which it holds exactly."""
    v = np.asarray(values, dtype=np.int64)
    if np.abs(v).max(initial=0) > MAX_OFFSET:
        raise WstError(f"half-float holds integers within ±{MAX_OFFSET} exactly")
    return v.astype(np.float16).view(np.uint16)


def edge_texels(t: WstTile) -> npt.NDArray[np.uint16]:
    """The RG16F edge texture as half-float bits, (12, 257, 2): row 4m + e holds side e at mip m,
    column k its entry k as (code - codeMid, shore byte). Columns past 256 >> m and the rows of
    in-face sides are 0."""
    texels = np.zeros((EDGE_ROWS, EDGE_ENTRIES, 2), dtype=np.uint16)
    for e in face_edge_sides(t.tile):
        for m, count in enumerate(MIP_ENTRIES):
            row = texels[len(EDGES) * m + e]
            row[:count, 0] = half_bits(mip_entries(t.profiles[e], m).astype(np.int64) - t.code_mid)
            row[:count, 1] = half_bits(mip_entries(t.profile_shore[e], m))
    return texels


def decoder_outputs(t: WstTile) -> dict[str, np.ndarray]:
    """What the app's decoder hands the GPU, for the cross-language check: R16F offsets
    code - codeMid as half-float bits and RG8 (shore, water) at mips 0, 1 and 2, the RG16F edge
    texture (`edge_texels`), and the 33² f32 meter grid."""
    height, shore, water = mips(t.codes), mips(t.shore), mips(t.water)
    outputs: dict[str, np.ndarray] = {}
    for level in range(len(MIP_SIZES)):
        outputs[f"height{level}"] = half_bits(height[level] - t.code_mid)
        outputs[f"channel{level}"] = np.stack([shore[level], water[level]], -1).astype(np.uint8)
    outputs["edges"] = edge_texels(t)
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
    for name, profile, dtype in (
        ("profiles", t.profiles, np.int16),
        ("profile shore", t.profile_shore, np.uint8),
    ):
        if profile.shape != PROFILES_SHAPE or profile.dtype != dtype:
            raise WstError(
                f"{name} is {profile.dtype}{profile.shape}, not {np.dtype(dtype)}(4, 451)"
            )
    sides = face_edge_sides(t.tile)
    for e, edge in enumerate(EDGES):
        if e not in sides and (t.profiles[e].any() or t.profile_shore[e].any()):
            raise WstError(f"side {edge} of {t.tile.key()} lies inside its face and stores nothing")
    if t.flags & ~KNOWN_FLAGS:
        raise WstError(f"unknown flags {t.flags:#x}")
    if not (t.q_land > 0 and math.isfinite(t.q_land) and float(np.float32(t.q_land)) == t.q_land):
        raise WstError(f"qLand {t.q_land} is not a positive f32")
    lowest, highest = _code_range(t.tile, t.codes, t.profiles)
    if highest - lowest > MAX_RANGE:
        raise WstError(f"codes {lowest}..{highest} span more than {MAX_RANGE}")
    if (lowest, highest) != (t.code_min, t.code_max):
        raise WstError(
            f"codeMin..codeMax {t.code_min}..{t.code_max}, planes and profiles {lowest}..{highest}"
        )
    # Within a span of at most 4,096, this codeMid leaves every code within ±2,048.
    mid = (lowest + highest) // 2
    if t.code_mid != mid:
        raise WstError(f"codeMid {t.code_mid} is not ⌊({lowest} + {highest})/2⌋ = {mid}")
    disagreement = _corner_disagreement(sides, t.profiles, t.profile_shore)
    if disagreement:
        raise WstError(disagreement)


def _code_range(tile: Tile, codes: np.ndarray, profiles: np.ndarray) -> tuple[int, int]:
    """The lowest and highest code over the planes and the entries of the stored sides."""
    stored = profiles[list(face_edge_sides(tile))]
    values = np.concatenate([np.ravel(codes), np.ravel(stored)])
    return int(values.min()), int(values.max())


def _corner_disagreement(
    sides: tuple[int, ...], profiles: np.ndarray, profile_shore: np.ndarray
) -> str | None:
    """Where two stored sides meet at a tile corner, both hold its entry at every mip, as the same
    code and shore byte. The first corner where they differ, or None."""
    for m in range(len(MIP_SIZES)):
        codes, shore = mip_entries(profiles, m), mip_entries(profile_shore, m)
        for a, at_a, b, at_b in TILE_CORNERS:
            if a not in sides or b not in sides:
                continue
            if codes[a, at_a] != codes[b, at_b] or shore[a, at_a] != shore[b, at_b]:
                return (
                    f"edge profiles {EDGES[a]} and {EDGES[b]} disagree at a tile corner at mip {m}"
                )
    return None


def _or_zeros(values: npt.ArrayLike | None) -> npt.ArrayLike:
    return np.zeros(PROFILES_SHAPE, dtype=np.int64) if values is None else values


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
        raise WstError("planes and profiles hold integers")
    info = np.iinfo(dtype)
    if a.size and (a.min() < info.min or a.max() > info.max):
        raise WstError(f"values {a.min()}..{a.max()} do not fit {np.dtype(dtype)}")
    return a.astype(dtype)
