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
    MIP_ENTRIES,
    PLANE_SHAPE,
    PROFILES_SHAPE,
    WstError,
    WstTile,
    bounds_m,
    decode_payload,
    decoder_outputs,
    encode_payload,
    from_file,
    grid33,
    half_bits,
    mip_entries,
    mips,
    payload_bytes,
    predictor,
    tile_flags,
    to_file,
    unpredict,
    unzigzag,
    zigzag,
)

SYNTHETIC = synthetic_tiles()
PLANES = ("codes", "shore", "water", "profiles", "profile_shore")
N, E, S, W = range(4)
KIRKUK_TOP = Tile(4, 7, 127, 0)  # its S and E sides lie on face edges


def flat_tile(code: int = 0, **changes) -> WstTile:
    """A tile inside a face, of one code everywhere, shore 200 and water 60, with `changes`
    applied."""
    tile = WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=0,
        q_land=2.0,
        codes=np.full(PLANE_SHAPE, code),
        shore=np.full(PLANE_SHAPE, 200),
        water=np.full(PLANE_SHAPE, 60),
    )
    return dataclasses.replace(tile, **changes)


def corner_tile(code: int = 0) -> WstTile:
    """The face-4 Kirkuk tile, of one code everywhere, its S and E profiles included."""
    profiles = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    profiles[[S, E]] = code
    return WstTile.from_planes(
        KIRKUK_TOP,
        flags=0,
        q_land=2.0,
        codes=np.full(PLANE_SHAPE, code),
        shore=np.full(PLANE_SHAPE, 200),
        water=np.full(PLANE_SHAPE, 60),
        profiles=profiles,
    )


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


def test_the_payload_grows_by_a_side_and_keeps_the_height_plane_even():
    assert [payload_bytes(n) for n in range(5)] == [278_810, 280_164, 281_516, 282_870, 284_222]
    assert all((payload_bytes(n) - 278_784) % 2 == 0 for n in range(5))


@pytest.mark.parametrize(
    ("name", "sides"), [("trench", 0), ("random", 1), ("extremes", 2), ("root", 4)]
)
def test_each_synthetic_payload_holds_its_face_edge_sides(name, sides):
    assert len(encode_payload(SYNTHETIC[name])) == payload_bytes(sides)


def test_every_field_sits_at_its_offset():
    # One side, N: its codes, its shore bytes, the pad byte, then the planes.
    t = dataclasses.replace(
        SYNTHETIC["random"], flags=FLAG_INLAND_WATER | FLAG_ALL_SEA, q_land=2.453125
    )
    raw = encode_payload(t)
    assert len(raw) == 280_164
    assert raw[0:4] == b"WST1"
    assert struct.unpack_from("<BBBBHH", raw, 4) == (2, 5, 9, 3, 300, 511)
    assert struct.unpack_from("<ff", raw, 12) == (2.453125, 4 * 2.453125)
    assert struct.unpack_from("<hhh", raw, 20) == (t.code_mid, t.code_min, t.code_max)
    assert struct.unpack_from("<h", raw, 26) == (t.profiles[N, 0],)
    assert struct.unpack_from("<h", raw, 26 + 2 * 257) == (mip_entries(t.profiles, 1)[N, 0],)
    assert struct.unpack_from("<h", raw, 26 + 2 * 386) == (mip_entries(t.profiles, 2)[N, 0],)
    assert struct.unpack_from("<h", raw, 926) == (mip_entries(t.profiles, 2)[N, 64],)
    assert raw[928] == t.profile_shore[N, 0]
    assert raw[928 + 450] == mip_entries(t.profile_shore, 2)[N, 64]
    assert raw[1379] == 0  # the pad byte
    assert struct.unpack_from("<H", raw, 1380) == (zigzag(t.codes[0, 0]),)
    assert struct.unpack_from("<H", raw, 140_770) == (
        zigzag(t.codes[-1, -1] - predictor(t.codes)[-1, -1]),
    )
    assert raw[140_772] == t.shore[0, 0]
    assert raw[210_468] == t.water[0, 0]
    assert raw[-1] == (int(t.water[-1, -1]) - predictor(t.water)[-1, -1]) & 0xFF


def test_sides_are_stored_in_n_e_s_w_order_codes_first():
    t = SYNTHETIC["root"]  # all four sides
    raw = encode_payload(t)
    for position, e in enumerate((N, E, S, W)):
        assert struct.unpack_from("<h", raw, 26 + 902 * position) == (t.profiles[e, 0],)
        assert raw[26 + 3608 + 451 * position + 450] == t.profile_shore[e, 450]
    assert struct.unpack_from("<H", raw, 26 + 4 * 1353) == (zigzag(t.codes[0, 0]),)


def test_a_tile_inside_a_face_goes_straight_from_the_header_to_the_planes():
    t = SYNTHETIC["trench"]
    raw = encode_payload(t)
    assert struct.unpack_from("<H", raw, 26) == (zigzag(t.codes[0, 0]),)


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


# Code bounds


def test_the_code_bounds_cover_the_profiles_at_every_mip():
    profiles = corner_tile(500).profiles.copy()
    mip_entries(profiles, 1)[S, 100] = 493
    t = dataclasses.replace(corner_tile(500), profiles=profiles)
    with pytest.raises(WstError, match=r"codeMin\.\.codeMax"):
        encode_payload(t)
    widened = dataclasses.replace(t, code_min=493, code_mid=496)
    assert decode_payload(encode_payload(widened)).code_min == 493


def test_the_code_bounds_skip_the_empty_rows_of_in_face_sides():
    # N and W hold zeros, which are not entries.
    assert (corner_tile(500).code_min, corner_tile(500).code_max) == (500, 500)
    assert (flat_tile(500).code_min, flat_tile(500).code_max) == (500, 500)


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


@pytest.mark.parametrize(
    ("name", "shift"),
    [("flat", 37), ("random", -1), ("random", 1), ("extremes", -1), ("extremes", 1)],
)
def test_the_encoder_refuses_any_code_mid_but_the_floor_of_the_mean(name, shift):
    t = flat_tile() if name == "flat" else SYNTHETIC[name]
    with pytest.raises(WstError, match="codeMid"):
        encode_payload(dataclasses.replace(t, code_mid=t.code_mid + shift))


@pytest.mark.parametrize("m", range(3))
@pytest.mark.parametrize("field", ["profiles", "profile_shore"])
def test_the_encoder_refuses_profiles_that_disagree_at_a_corner(field, m):
    t = SYNTHETIC["extremes"]
    changed = getattr(t, field).copy()
    # E's first entry takes the other extreme from S's last, so the code bounds stay.
    extremes = {"profiles": t.code_min + t.code_max, "profile_shore": 255}[field]
    mip_entries(changed, m)[E, 0] = extremes - mip_entries(changed, m)[S, -1]
    with pytest.raises(WstError, match=f"corner at mip {m}"):
        encode_payload(dataclasses.replace(t, **{field: changed}))


@pytest.mark.parametrize("field", ["profiles", "profile_shore"])
def test_the_encoder_refuses_data_on_an_in_face_side(field):
    t = corner_tile(0)
    changed = getattr(t, field).copy()
    changed[W, 7] = 1  # W of 7/4/127/0 lies inside face 4
    with pytest.raises(WstError, match="inside its face"):
        encode_payload(dataclasses.replace(t, **{field: changed}))


@pytest.mark.parametrize(
    "changes",
    [
        {"flags": 4},
        {"q_land": 0.0},
        {"q_land": 0.1},
        {"codes": np.zeros((264, 263), dtype=np.int16)},
        {"shore": np.zeros(PLANE_SHAPE, dtype=np.int16)},
        {"profiles": np.zeros((4, 450), dtype=np.int16)},
        {"profile_shore": np.zeros(PROFILES_SHAPE, dtype=np.int16)},
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
        )


# The decoder refuses bytes that are not a tile


RAW = encode_payload(SYNTHETIC["extremes"])
KEY = SYNTHETIC["extremes"].tile
# S's mip-2 entry 64, at the corner it shares with E. E is stored first, then S.
S_MIP2_LAST = 26 + 902 + 2 * 450
S_SHORE_MIP2_LAST = 26 + 2 * 902 + 451 + 450


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (RAW[:-1], "bytes"),
        (RAW + b"\0", "bytes"),
        (RAW[:25], "header"),
        (b"WST2" + RAW[4:], "magic"),
        (poke(RAW, 4, "<B", 1), "version"),
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


def test_the_decoder_refuses_a_length_that_does_not_fit_the_keys_sides():
    # 7/4/127/1 stores only E, so two sides' profiles are one side too many.
    with pytest.raises(WstError, match="bytes, not 280164 for 1 stored sides"):
        decode_payload(poke(RAW, 10, "<H", 1))


def test_the_decoder_refuses_another_tile():
    with pytest.raises(WstError, match="not 7/4/127/1"):
        decode_payload(RAW, Tile(4, 7, 127, 1))


@pytest.mark.parametrize(
    ("offset", "fmt"), [(S_MIP2_LAST, "<h"), (S_SHORE_MIP2_LAST, "<B")], ids=["code", "shore"]
)
def test_the_decoder_refuses_profiles_that_disagree_at_a_corner(offset, fmt):
    t = SYNTHETIC["extremes"]
    code, shore = mip_entries(t.profiles, 2)[S, -1], mip_entries(t.profile_shore, 2)[S, -1]
    # The other extreme: the code bounds stay, and only the corner disagrees.
    other = {"<h": t.code_min + t.code_max - code, "<B": 255 - shore}[fmt]
    with pytest.raises(WstError, match="corner at mip 2"):
        decode_payload(poke(RAW, offset, fmt, other), KEY)


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
    assert [m.shape for m in mips(np.zeros((8, 264)))] == [(8, 264), (4, 132), (2, 66)]


def test_grid_vertices_off_the_stored_sides_take_h_of_the_mean_of_four_mip2_codes():
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
    # Vertex (0, 0), a corner of two in-face sides, sits between mip-2 columns and rows 0 and 1:
    # stored texels 0..7, border included.
    codes[0:4, 0:8] = 9
    t = WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=0,
        q_land=2.0,
        codes=codes,
        shore=np.zeros(PLANE_SHAPE),
        water=np.zeros(PLANE_SHAPE),
    )
    grid = grid33(t)
    assert grid[2, 1] == np.float32((5 + 6 - 300 + 7) / 4 * 2)  # -70.5 codes, above c200
    assert grid[3, 3] == np.float32(-200 + (-300.25 + 100) * 8)
    assert grid[0, 0] == np.float32(9 / 2 * 2)
    assert grid[1, 1] == grid[3, 1] == grid[2, 2] == grid[2, 0] == grid[0, 1] == 0


def test_grid_vertices_on_stored_sides_take_their_mip2_entries():
    t = SYNTHETIC["root"]  # all four sides stored
    grid = grid33(t)
    meters = codes_to_meters(mip_entries(t.profiles, 2), t.q_land).astype(np.float32)
    assert np.array_equal(grid[0, :], meters[S, ::2])
    assert np.array_equal(grid[-1, :], meters[N, ::2])
    assert np.array_equal(grid[:, 0], meters[W, ::2])
    assert np.array_equal(grid[:, -1], meters[E, ::2])


def test_grid_takes_profiles_only_on_the_stored_sides():
    t = SYNTHETIC["extremes"]  # S and E stored; N and W inside face 4
    grid = grid33(t)
    meters = codes_to_meters(mip_entries(t.profiles, 2), t.q_land).astype(np.float32)
    assert np.array_equal(grid[0, :], meters[S, ::2])
    assert np.array_equal(grid[:, -1], meters[E, ::2])
    mip2 = mips(t.codes)[2]
    around = (mip2[:-1, :-1] + mip2[:-1, 1:] + mip2[1:, :-1] + mip2[1:, 1:]) / 4
    means = codes_to_meters(around[::2, ::2], t.q_land).astype(np.float32)
    assert np.array_equal(grid[-1, :-1], means[-1, :-1])
    assert np.array_equal(grid[1:, 0], means[1:, 0])


def test_grid_uses_the_deep_step_below_c200():
    t = flat_tile(-300, q_land=2.0)
    assert np.all(grid33(t) == np.float32(-200 + (-300 + 100) * 8))


def test_profiles_of_a_tiles_own_planes_fill_only_its_face_edge_sides():
    t = SYNTHETIC["random"]  # N only
    profiles, shore = edge_profiles(t.tile, t.codes, t.shore)
    assert profiles[N].any() and shore[N].any()
    assert not profiles[[E, S, W]].any() and not shore[[E, S, W]].any()


def test_profiles_of_a_tiles_own_planes_meet_at_its_corners_at_every_mip():
    t = SYNTHETIC["root"]
    profiles, shore = edge_profiles(t.tile, t.codes, t.shore)
    for m in range(3):
        for values in (mip_entries(profiles, m), mip_entries(shore, m)):
            corners = (values[N, 0], values[N, -1], values[S, 0], values[S, -1])
            assert corners == (values[W, -1], values[E, -1], values[W, 0], values[E, 0])


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
    assert np.array_equal(outputs["channel0"][..., 0], t.shore)
    assert np.array_equal(outputs["channel0"][..., 1], t.water)
    assert outputs["grid"].shape == (33, 33)


def test_the_edge_texture_holds_each_stored_side_at_each_mip():
    t = SYNTHETIC["extremes"]
    edges = decoder_outputs(t)["edges"]
    assert edges.shape == (12, 257, 2) and edges.dtype == np.uint16
    values = edges.view(np.float16).astype(np.int64)
    for m, count in enumerate(MIP_ENTRIES):
        for e in (S, E):
            row = values[4 * m + e]
            assert np.array_equal(row[:count, 0], mip_entries(t.profiles[e], m) - t.code_mid)
            assert np.array_equal(row[:count, 1], mip_entries(t.profile_shore[e], m))
            assert not edges[4 * m + e, count:].any()
        assert not edges[4 * m + N].any() and not edges[4 * m + W].any()


def test_a_tile_inside_a_face_has_an_empty_edge_texture():
    assert not decoder_outputs(SYNTHETIC["trench"])["edges"].any()
