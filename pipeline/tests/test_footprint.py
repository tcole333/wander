import math

import numpy as np
import pytest

from prebuild.cube import (
    TILE,
    Tile,
    dir_to_lonlat,
    face_st,
    lonlat_to_dir,
    st_to_dir,
    subsample,
)
from prebuild.footprint import (
    cell_window,
    profile_rects,
    subsample_lonlat,
    tile_texels,
    tile_window,
    union_windows,
)

KIRKUK = (45.0, math.degrees(math.atan(math.sqrt(0.5))))


def cells_touched(lon, lat, cell_arcsec):
    """Every (row, column) bilinear sampling reads, rows clamped and columns wrapped."""
    global_w = 360 * 3600 // cell_arcsec
    per_degree = 3600 / cell_arcsec
    x = np.floor((np.ravel(lon) + 180) * per_degree - 0.5).astype(np.int64)
    y = np.floor((np.ravel(lat) + 90) * per_degree - 0.5).astype(np.int64)
    rows = np.clip(np.concatenate([y, y + 1]), 0, global_w // 2 - 1)
    columns = np.concatenate([x, x + 1]) % global_w
    return rows, columns, global_w


def assert_holds(window, lon, lat, cell_arcsec):
    i0, j0, w, h = window
    rows, columns, global_w = cells_touched(lon, lat, cell_arcsec)
    assert ((rows >= j0) & (rows < j0 + h)).all()
    assert ((columns - i0) % global_w < w).all()


def test_sub_samples_sit_at_the_exact_face_positions():
    lon, lat = subsample_lonlat(1, 7, range(-4, 2), range(3, 5))
    assert lon.shape == lat.shape == (24, 8)
    s = subsample(7, 3, 2)  # texel column 3, sub-sample 2 -> array column 2
    t = subsample(7, -3, 1)  # texel row -3, sub-sample 1 -> array row 5
    expect_lon, expect_lat = dir_to_lonlat(st_to_dir(1, s, t))
    assert (lon[5, 2], lat[5, 2]) == (expect_lon, expect_lat)


def test_a_cell_window_holds_every_cell_bilinear_sampling_reads():
    rng = np.random.default_rng(3)
    lon = rng.uniform(116.0, 119.5, 5000)
    lat = rng.uniform(-10.0, -7.0, 5000)
    for cell in (15, 60, 240, 1800):
        window = cell_window(lon, lat, cell)
        assert_holds(window, lon, lat, cell)
        tight = cell_window(lon, lat, cell)
        assert tight[2] <= (3.5 * 3600 / cell) + 4


def test_a_cell_window_wraps_across_the_dateline():
    lon = np.array([179.2, 179.9, -179.8, -179.1])
    lat = np.array([10.0, 10.2, 10.4, 10.6])
    window = cell_window(lon, lat, 3600)
    assert (window[0], window[2]) == (357, 6)  # columns 357-359 and 0-2
    assert_holds(window, lon, lat, 3600)


def test_a_cell_window_around_a_pole_reaches_the_last_row():
    lon, lat = subsample_lonlat(4, 1, range(252, 260), range(252, 260))  # around the north pole
    assert lat.max() > 89.9
    window = cell_window(lon, lat, 1800)
    assert_holds(window, lon, lat, 1800)
    assert window[1] + window[3] == 360


def test_a_cell_window_of_a_face_holding_a_pole_spans_every_longitude():
    lon, lat = subsample_lonlat(4, 0, range(-4, 260), range(-4, 260))
    i0, j0, w, h = cell_window(lon, lat, 1800)
    assert (i0, w, j0 + h) == (0, 720, 360)


def test_windows_join_as_arcs_of_the_circle():
    assert union_windows([(350, 10, 5, 2), (358, 12, 4, 3)], 3600) == (350, 10, 12, 5)
    assert union_windows([(0, 0, 10, 1), (200, 0, 10, 1)], 3600) == (200, 0, 170, 1)
    assert union_windows([(0, 0, 360, 1), (5, 3, 2, 1)], 3600) == (0, 0, 360, 4)


def test_a_tile_inside_a_face_reads_no_other_face():
    assert profile_rects(Tile(1, 7, 103, 50)) == []
    assert profile_rects(Tile(0, 7, 127, 127)) == []  # face 0 owns every edge at Kirkuk


def test_edge_profiles_at_kirkuk_read_owner_texels_on_the_lower_faces():
    full = TILE << 7
    rects = profile_rects(Tile(4, 7, 127, 0))
    assert {face for face, *_ in rects} == {0, 1}
    for _, level, rows, cols in rects:
        assert level == 7
        assert len(rows) == 2 or len(cols) == 2  # a strip two texels across the face edge
        # Each strip straddles the owner face's N edge, where face 4 meets faces 0 and 1.
        assert (rows.start, rows.stop) == (full - 1, full + 1)


def test_owner_texels_sit_where_the_tile_meets_the_owner_face():
    full = TILE << 7
    for face, level, rows, cols in profile_rects(Tile(1, 7, 0, 127)):
        assert face == 0
        # Face 1's W edge is face 0's E edge: owner columns straddle s = 1 on face 0.
        assert (cols.start, cols.stop) == (full - 1, full + 1)
        s = subsample(level, np.array([cols.start, cols.stop - 1]), 2)
        t = subsample(level, np.array([rows.start, rows.stop - 1]), 2)
        lon, lat = dir_to_lonlat(st_to_dir(face, s, t))
        s1, _ = face_st(1, lonlat_to_dir(lon, lat))
        assert np.all(np.abs(s1 + 1) < 0.01)


def test_a_tile_window_holds_its_texels_and_its_owner_strips():
    tile = Tile(4, 6, 63, 0)
    window = tile_window(tile, 60)
    for face, level, rows, cols in [tile_texels(tile), *profile_rects(tile)]:
        lon, lat = subsample_lonlat(face, level, rows, cols)
        assert_holds(window, lon, lat, 60)


@pytest.mark.parametrize("cell", [15, 240])
def test_the_kirkuk_tiles_share_the_vertex_cell(cell):
    per_degree = 3600 / cell
    column = math.floor((KIRKUK[0] + 180) * per_degree - 0.5)
    row = math.floor((KIRKUK[1] + 90) * per_degree - 0.5)
    for face, x, y in ((0, 127, 127), (1, 0, 127), (4, 127, 0)):
        i0, j0, w, h = tile_window(Tile(face, 7, x, y), cell)
        assert i0 <= column < i0 + w and j0 <= row < j0 + h
