import dataclasses
import gzip
import math
import struct

import numpy as np
import pytest

from prebuild.codes import codes_to_meters
from prebuild.cube import Tile
from prebuild.expect import edge_profiles, synthetic_tiles
from prebuild.wst import (
    FLAG_ALL_SEA,
    FLAG_INLAND_WATER,
    PAYLOAD_BYTES,
    PLANE_SHAPE,
    WstError,
    WstTile,
    bounds_m,
    decode_payload,
    decoder_outputs,
    encode_payload,
    from_file,
    grid33,
    half_bits,
    mips,
    predictor,
    tile_flags,
    to_file,
    unpredict,
    unzigzag,
    zigzag,
)

SYNTHETIC = synthetic_tiles()
PLANES = ("codes", "shore", "water", "edges")
N, E, S, W = range(4)


def flat_tile(code: int = 0, **changes) -> WstTile:
    """A tile of one code everywhere, shore 200 and water 60, with `changes` applied."""
    tile = WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=0,
        q_land=2.0,
        codes=np.full(PLANE_SHAPE, code),
        shore=np.full(PLANE_SHAPE, 200),
        water=np.full(PLANE_SHAPE, 60),
        edges=np.full((4, 257), code),
    )
    return dataclasses.replace(tile, **changes)


def same_tile(a: WstTile, b: WstTile) -> bool:
    scalars = ("tile", "flags", "q_land", "code_mid", "code_min", "code_max")
    return all(getattr(a, name) == getattr(b, name) for name in scalars) and all(
        np.array_equal(getattr(a, name), getattr(b, name)) for name in PLANES
    )


def poke(payload: bytes, offset: int, fmt: str, *values) -> bytes:
    changed = bytearray(payload)
    struct.pack_into(fmt, changed, offset, *values)
    return bytes(changed)


# Zigzag and predictors


def test_zigzag_interleaves_signs():
    assert zigzag([0, -1, 1, -2, 2]).tolist() == [0, 1, 2, 3, 4]
    assert np.array_equal(unzigzag(zigzag(np.arange(-40000, 40000))), np.arange(-40000, 40000))


def test_zigzag_stays_within_a_u16_over_a_4096_code_range():
    # Interior residuals of a 4,096-code range span ±8,192; the first texel's residual is its code.
    assert zigzag([-8192, 8192]).tolist() == [16383, 16384]
    assert zigzag([-32768, 32767]).tolist() == [65535, 65534]


def test_the_predictor_is_left_plus_up_minus_upleft_with_zero_outside():
    plane = np.array([[1, 2], [4, 8]])
    assert predictor(plane).tolist() == [[0, 1], [1, 2 + 4 - 1]]


@pytest.mark.parametrize("name", SYNTHETIC)
def test_undoing_the_predictor_restores_the_plane(name):
    codes = SYNTHETIC[name].codes
    assert np.array_equal(unpredict(codes - predictor(codes)), codes)


def test_byte_residuals_wrap_both_ways():
    # 0 and 255 in a checkerboard: interior residuals are 510 and -510.
    shore = np.where(np.indices(PLANE_SHAPE).sum(0) % 2 == 1, 255, 0)
    residual = shore - predictor(shore)
    assert residual.min() < 0 and residual.max() > 255
    assert np.array_equal(unpredict(residual & 0xFF) & 0xFF, shore)


# Layout


def test_every_field_sits_at_its_offset():
    t = dataclasses.replace(
        SYNTHETIC["random"], flags=FLAG_INLAND_WATER | FLAG_ALL_SEA, q_land=2.453125
    )
    raw = encode_payload(t)
    assert len(raw) == PAYLOAD_BYTES == 280_866
    assert raw[0:4] == b"WST1"
    assert struct.unpack_from("<BBBBHH", raw, 4) == (1, 5, 9, 3, 300, 257)
    assert struct.unpack_from("<ff", raw, 12) == (2.453125, 4 * 2.453125)
    assert struct.unpack_from("<hhh", raw, 20) == (t.code_mid, t.code_min, t.code_max)
    assert struct.unpack_from("<h", raw, 26) == (t.edges[N, 0],)
    assert struct.unpack_from("<h", raw, 26 + 2 * 257) == (t.edges[E, 0],)
    assert struct.unpack_from("<h", raw, 2080) == (t.edges[W, 256],)
    assert struct.unpack_from("<H", raw, 2082) == (zigzag(t.codes[0, 0]),)
    assert struct.unpack_from("<H", raw, 141_472) == (
        zigzag(t.codes[-1, -1] - predictor(t.codes)[-1, -1]),
    )
    assert raw[141_474] == t.shore[0, 0]
    assert raw[211_170] == t.water[0, 0]
    assert raw[-1] == (int(t.water[-1, -1]) - predictor(t.water)[-1, -1]) & 0xFF


def test_the_stored_file_is_gzip_level_9_with_mtime_0_and_no_name():
    data = to_file(SYNTHETIC["trench"])
    assert data[:3] == b"\x1f\x8b\x08"
    assert data[3] == 0  # no FNAME or other optional fields
    assert data[4:8] == b"\0\0\0\0"
    assert data[8] == 2  # maximum compression
    assert gzip.decompress(data) == encode_payload(SYNTHETIC["trench"])


def test_the_stored_file_is_the_same_every_time():
    assert to_file(SYNTHETIC["random"]) == to_file(SYNTHETIC["random"])


# Round trip


@pytest.mark.parametrize("name", SYNTHETIC)
def test_synthetic_tiles_round_trip(name):
    t = SYNTHETIC[name]
    assert same_tile(from_file(to_file(t), t.tile), t)


def test_the_extremes_tile_reaches_both_offset_limits():
    t = SYNTHETIC["extremes"]
    assert (t.code_min - t.code_mid, t.code_max - t.code_mid) == (-2048, 2048)
    residual = t.codes.astype(np.int64) - predictor(t.codes)
    assert (residual[1:, 1:].min(), residual[1:, 1:].max()) == (-8192, 8192)


# -1.5 and 1.5 set floor apart from ceiling, truncation and rounding half away from zero.
@pytest.mark.parametrize(("low", "high", "mid"), [(-3, 0, -2), (0, 3, 1)])
def test_code_mid_is_the_floor_of_the_mean_of_the_code_bounds(low, high, mid):
    codes = np.full(PLANE_SHAPE, low)
    codes[5, 5] = high
    t = WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=0,
        q_land=2.0,
        codes=codes,
        shore=np.zeros(PLANE_SHAPE),
        water=np.zeros(PLANE_SHAPE),
        edges=np.full((4, 257), low),
    )
    assert t.code_mid == mid


def test_the_synthetic_flags_follow_their_fields():
    assert SYNTHETIC["trench"].flags == FLAG_ALL_SEA
    assert SYNTHETIC["random"].flags == FLAG_INLAND_WATER


def test_the_trench_crosses_c200():
    t = SYNTHETIC["trench"]
    assert t.code_min < -100 < t.code_max  # c200 at qLand 2


def test_flags_mark_inland_water_and_all_sea():
    sea, land = np.full(PLANE_SHAPE, -1.0), np.full(PLANE_SHAPE, 1.0)
    one_lake = land.copy()
    one_lake[100, 100] = -0.1
    assert tile_flags(sea, land) == FLAG_ALL_SEA
    assert tile_flags(land, one_lake) == FLAG_INLAND_WATER
    assert tile_flags(np.where(one_lake < 0, 0.0, -1.0), land) == 0


# The encoder refuses tiles the format does not allow


def test_the_encoder_refuses_a_range_over_4096():
    codes = np.zeros(PLANE_SHAPE, dtype=np.int16)
    codes[5, 5] = 4097
    with pytest.raises(WstError, match="span"):
        encode_payload(dataclasses.replace(flat_tile(), codes=codes, code_max=4097))


@pytest.mark.parametrize(("field", "shift"), [("code_min", -1), ("code_min", 1), ("code_max", 1)])
def test_the_encoder_refuses_code_bounds_that_miss_the_planes(field, shift):
    t = SYNTHETIC["random"]
    with pytest.raises(WstError, match=r"codeMin\.\.codeMax"):
        encode_payload(dataclasses.replace(t, **{field: getattr(t, field) + shift}))


def test_the_code_bounds_cover_the_edges():
    edges = np.zeros((4, 257), dtype=np.int16)
    edges[N, 100] = -7
    t = dataclasses.replace(flat_tile(), edges=edges)
    with pytest.raises(WstError, match=r"codeMin\.\.codeMax"):
        encode_payload(t)
    widened = dataclasses.replace(t, code_min=-7, code_mid=-4)
    assert decode_payload(encode_payload(widened)).code_min == -7


@pytest.mark.parametrize(
    ("name", "shift"),
    [("flat", 37), ("random", -1), ("random", 1), ("extremes", -1), ("extremes", 1)],
)
def test_the_encoder_refuses_any_code_mid_but_the_floor_of_the_mean(name, shift):
    t = flat_tile() if name == "flat" else SYNTHETIC[name]
    with pytest.raises(WstError, match="codeMid"):
        encode_payload(dataclasses.replace(t, code_mid=t.code_mid + shift))


def test_the_encoder_refuses_edges_that_disagree_at_a_corner():
    edges = np.zeros((4, 257), dtype=np.int16)
    edges[S, 256] = 1  # E[0] stays 0
    with pytest.raises(WstError, match="corner"):
        encode_payload(dataclasses.replace(flat_tile(), edges=edges, code_max=1))


@pytest.mark.parametrize(
    "changes",
    [
        {"flags": 4},
        {"q_land": 0.0},
        {"q_land": 0.1},
        {"codes": np.zeros((264, 263), dtype=np.int16)},
        {"shore": np.zeros(PLANE_SHAPE, dtype=np.int16)},
        {"edges": np.zeros((4, 256), dtype=np.int16)},
    ],
)
def test_the_encoder_refuses_malformed_fields(changes):
    with pytest.raises(WstError):
        encode_payload(flat_tile(**changes))


def test_planes_must_fit_their_types():
    with pytest.raises(WstError, match="fit"):
        WstTile.from_planes(
            Tile(0, 0, 0, 0),
            flags=0,
            q_land=2.0,
            codes=np.full(PLANE_SHAPE, 40_000),
            shore=np.zeros(PLANE_SHAPE),
            water=np.zeros(PLANE_SHAPE),
            edges=np.zeros((4, 257)),
        )


# The decoder refuses bytes that are not a tile


RAW = encode_payload(SYNTHETIC["extremes"])
KEY = SYNTHETIC["extremes"].tile


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (RAW[:-1], "bytes"),
        (RAW + b"\0", "bytes"),
        (b"WST2" + RAW[4:], "magic"),
        (poke(RAW, 4, "<B", 2), "version"),
        (poke(RAW, 16, "<f", 7.0), "qDeep"),
        (poke(RAW, 12, "<ff", 0.0, 0.0), "positive"),
        (poke(RAW, 12, "<ff", -2.0, -8.0), "positive"),
        (poke(RAW, 12, "<ff", math.inf, math.inf), "positive"),
        (poke(RAW, 20, "<h", SYNTHETIC["extremes"].code_mid + 1), "codeMid"),
        (poke(RAW, 20, "<h", SYNTHETIC["extremes"].code_mid - 1), "codeMid"),
        (poke(RAW, 22, "<h", SYNTHETIC["extremes"].code_min - 1), "header codes"),
        (poke(RAW, 24, "<h", SYNTHETIC["extremes"].code_max + 1), "header codes"),
        (poke(RAW, 5, "<B", 6), "no tile"),
    ],
)
def test_the_decoder_refuses_a_malformed_payload(raw, message):
    with pytest.raises(WstError, match=message):
        decode_payload(raw, KEY)


def test_the_decoder_refuses_another_tile():
    with pytest.raises(WstError, match="not 7/4/127/1"):
        decode_payload(RAW, Tile(4, 7, 127, 1))


# Meter bounds, mips, the grid and the decoder's outputs


def test_meter_bounds_round_outward():
    # qLand 2.453125: code 3 is 7.359375 m; code -83 is one deep step below c200 = -82, at
    # -201.15625 - 9.8125 = -210.96875 m.
    t = dataclasses.replace(flat_tile(), q_land=2.453125, code_min=-83, code_max=3)
    assert bounds_m(t) == (-211, 8)


def test_mips_round_the_mean_half_up():
    plane = np.zeros((4, 4), dtype=np.int64)
    plane[:2, :2] = [[-3, -2], [-2, -2]]  # mean -2.25
    plane[:2, 2:] = [[-3, -3], [-2, -2]]  # mean -2.5
    plane[2:, :2] = [[1, 2], [2, 2]]  # mean 1.75
    plane[2:, 2:] = [[5, 5], [6, 6]]  # mean 5.5
    first = mips(np.tile(plane, (66, 66)))[1][:2, :2]
    assert first.tolist() == [[-2, -2], [2, 6]]


def test_mips_halve_twice():
    assert [m.shape for m in mips(SYNTHETIC["random"].codes)] == [(264, 264), (132, 132), (66, 66)]


def test_grid_interior_vertices_take_h_of_the_mean_of_four_mip2_codes():
    codes = np.zeros(PLANE_SHAPE, dtype=np.int64)
    # Vertex (k, l) = (1, 2) sits at texel corner (8, 16), between mip-2 columns 2 and 3 and rows
    # 4 and 5: stored texels 8..15 across and 16..23 up. No other vertex sees those texels.
    codes[16:20, 8:12] = 5
    codes[16:20, 12:16] = 6
    codes[20:24, 8:12] = -300
    codes[20:24, 12:16] = 7
    # Vertex (3, 3) sits between mip-2 columns and rows 6 and 7: a mean of -300.25, below c200.
    codes[24:32, 24:32] = -300
    codes[28:32, 28:32] = -301
    t = WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=0,
        q_land=2.0,
        codes=codes,
        shore=np.zeros(PLANE_SHAPE),
        water=np.zeros(PLANE_SHAPE),
        edges=np.zeros((4, 257)),
    )
    grid = grid33(t)
    assert grid[2, 1] == np.float32((5 + 6 - 300 + 7) / 4 * 2)  # -70.5 codes, above c200
    assert grid[3, 3] == np.float32(-200 + (-300.25 + 100) * 8)
    assert grid[1, 1] == grid[3, 1] == grid[2, 2] == grid[2, 0] == 0


def test_grid_boundary_vertices_take_the_edge_profiles():
    t = SYNTHETIC["trench"]
    grid = grid33(t)
    meters = codes_to_meters(t.edges, t.q_land).astype(np.float32)
    assert np.array_equal(grid[0, :], meters[S, ::8])
    assert np.array_equal(grid[-1, :], meters[N, ::8])
    assert np.array_equal(grid[:, 0], meters[W, ::8])
    assert np.array_equal(grid[:, -1], meters[E, ::8])


def test_grid_uses_the_deep_step_below_c200():
    t = flat_tile(-300, q_land=2.0)
    assert np.all(grid33(t) == np.float32(-200 + (-300 + 100) * 8))


def test_edge_profiles_of_a_tile_meet_at_its_corners():
    edges = edge_profiles(SYNTHETIC["random"].codes)
    assert (edges[N, 0], edges[N, -1], edges[S, 0], edges[S, -1]) == (
        edges[W, -1],
        edges[E, -1],
        edges[W, 0],
        edges[E, 0],
    )


def test_half_bits_are_exact_to_2048():
    v = np.arange(-2048, 2049)
    assert np.array_equal(half_bits(v).view(np.float16).astype(np.int64), v)
    assert half_bits([0, 1, -1, 2048, -2048]).tolist() == [0x0000, 0x3C00, 0xBC00, 0x6800, 0xE800]
    with pytest.raises(WstError):
        half_bits([2049])


def test_decoder_outputs_offset_codes_by_code_mid():
    t = SYNTHETIC["extremes"]
    outputs = decoder_outputs(t)
    offsets = outputs["height0"].view(np.float16).astype(np.int64)
    assert np.array_equal(offsets, t.codes - t.code_mid)
    assert np.array_equal(outputs["edges"].view(np.float16).astype(np.int64), t.edges - t.code_mid)
    assert np.array_equal(outputs["channel0"][..., 0], t.shore)
    assert np.array_equal(outputs["channel0"][..., 1], t.water)
    assert outputs["grid"].shape == (33, 33)
