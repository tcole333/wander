import numpy as np
import pytest

from prebuild.codes import (
    c200,
    codes_to_meters,
    field_bytes,
    meters_to_codes,
    q_land_start,
    round_half_away,
)

Q_START = [39.09375, 19.546875, 9.78125, 4.890625, 2.453125, 2.0, 2.0, 2.0]
C200 = [-5, -10, -20, -41, -82, -100, -100, -100]


def test_q_land_starts_at_a_thousandth_of_the_texel_rounded_up_to_a_64th():
    assert [q_land_start(level) for level in range(8)] == Q_START


def test_q_land_starts_are_exact_in_f32():
    assert all(float(np.float32(q)) == q for q in Q_START)


def test_c200_is_the_rounded_code_of_minus_200_m():
    assert [c200(q) for q in Q_START] == C200


@pytest.mark.parametrize(
    ("x", "rounded"),
    [(0.5, 1), (-0.5, -1), (1.5, 2), (-1.5, -2), (2.5, 3), (-2.5, -3), (0.49, 0), (-2.51, -3)],
)
def test_rounding_goes_half_away_from_zero(x, rounded):
    assert round_half_away(x) == rounded


def test_rounding_keeps_integers():
    values = np.arange(-5, 6)
    assert np.array_equal(round_half_away(values), values)


@pytest.mark.parametrize("q", Q_START[:6])
def test_meters_are_continuous_at_c200(q):
    deep = c200(q)
    at, below = codes_to_meters([deep, deep - 1], q)
    assert at == deep * q
    assert below == deep * q - 4 * q


@pytest.mark.parametrize("q", Q_START[:6])
def test_codes_step_by_q_land_above_c200_and_4_q_land_below(q):
    deep = c200(q)
    meters = codes_to_meters(np.arange(deep - 3, deep + 4), q)
    assert np.array_equal(np.diff(meters), [4 * q] * 3 + [q] * 3)


@pytest.mark.parametrize("q", Q_START[:6])
def test_codes_round_trip_through_meters(q):
    codes = np.arange(-4000, 6000)
    assert np.array_equal(meters_to_codes(codes_to_meters(codes, q), q), codes)


def test_a_height_takes_the_nearest_code_half_away_from_zero():
    # qLand 2: 1 m is half a code (up to 1), -1 m half a code down (to -1); below -200 m a code is
    # 8 m, so -204 m is half a code below c200 = -100 (to -101).
    assert meters_to_codes([1.0, -1.0, 0.9, -204.0, -203.9], 2.0).tolist() == [1, -1, 0, -101, -100]


def test_codes_rise_with_height():
    heights = np.linspace(-11000, 9000, 100_001)
    assert np.all(np.diff(meters_to_codes(heights, 2.453125)) >= 0)


def test_field_bytes_center_on_128_at_16_per_texel():
    d = [0.0, 1.0, -1.0, 0.5, -0.5, 1 / 32, -1 / 32]
    assert field_bytes(d).tolist() == [128, 144, 112, 136, 120, 129, 128]


def test_field_bytes_clamp_at_8_texels():
    d = [8.0, 9.0, np.inf, -8.0, -9.0, -np.inf]
    assert field_bytes(d).tolist() == [255, 255, 255, 0, 0, 0]
