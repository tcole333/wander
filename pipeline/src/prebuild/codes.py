"""Height codes and field bytes of the surface tile (streaming.md 3.1).

A code is an integer height step: qLand meters per code at or above -200 m, and qDeep = 4·qLand
below it. Shore and water distances are stored as bytes, 16 per texel around 128. Every rounding
here, and everywhere in the build, is half away from zero; `np.round` rounds half to even and is
never used.
"""

import math

import numpy as np
import numpy.typing as npt

from prebuild.constants import CUBE

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]

EARTH_RADIUS_M: float = CUBE["earthRadiusM"]
Q_STEP = 1 / 64  # qLand is a multiple of 1/64 m, so f32 holds it exactly
Q_FLOOR_M = 2.0
SHELF_M = -200.0  # qDeep takes over below this height
DEEP_RATIO = 4  # qDeep = 4·qLand
FIELD_REACH = 8  # shore and water distances are clamped to ±8 texels
FIELD_STEP = 16  # bytes per texel of distance


def round_half_away(x: npt.ArrayLike) -> IntArray:
    """rha: r = trunc(x), plus sign(x) when |x - r| ≥ 0.5."""
    v = np.asarray(x, dtype=np.float64)
    r = np.trunc(v)
    return np.where(np.abs(v - r) >= 0.5, r + np.sign(v), r).astype(np.int64)


def texel_m(level: int) -> float:
    """Nominal texel size in meters at a face center: (π/2)·R/(256·2^L)."""
    return (math.pi / 2) * EARTH_RADIUS_M / (CUBE["tile"] << level)


def q_land_start(level: int) -> float:
    """The first qLand candidate at a level: max(2 m, texelM/1000), rounded up to 1/64 m."""
    return max(Q_FLOOR_M, math.ceil(texel_m(level) / 1000 / Q_STEP) * Q_STEP)


def c200(q: float) -> int:
    """The code where qDeep takes over: rha(-200/qLand)."""
    return int(round_half_away(SHELF_M / q))


def meters_to_codes(h: npt.ArrayLike, q: float) -> IntArray:
    """The code of each height: the rha of the inverse of `codes_to_meters`."""
    meters = np.asarray(h, dtype=np.float64)
    deep = c200(q)
    shallow_codes = round_half_away(meters / q)
    deep_codes = deep + round_half_away((meters - deep * q) / (DEEP_RATIO * q))
    return np.where(meters >= deep * q, shallow_codes, deep_codes)


def codes_to_meters(c: npt.ArrayLike, q: float) -> FloatArray:
    """h(c) = c·qLand at or above c200, else c200·qLand + (c - c200)·qDeep. Codes may be fractional
    (a mean of codes); the operations run in this order in the decoder too, so both agree bit for
    bit."""
    codes = np.asarray(c, dtype=np.float64)
    deep = c200(q)
    return np.where(codes >= deep, codes * q, deep * q + (codes - deep) * (DEEP_RATIO * q))


def field_bytes(d_texels: npt.ArrayLike) -> npt.NDArray[np.uint8]:
    """The stored shore or water byte of a signed distance in texels (±inf allowed):
    min(255, rha(128 + 16·clamp(d, -8, 8)))."""
    d = np.clip(np.asarray(d_texels, dtype=np.float64), -FIELD_REACH, FIELD_REACH)
    return np.minimum(255, round_half_away(128 + FIELD_STEP * d)).astype(np.uint8)
