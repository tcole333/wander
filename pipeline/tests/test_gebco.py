import gzip

import numpy as np
import pytest

from prebuild.gebco import (
    OVERVIEWS,
    Raster,
    bilinear,
    block_means,
    crop,
    overviews,
    read_excerpt,
    read_sidecar,
    read_window,
    write_excerpt,
)


@pytest.fixture
def degree_grid(write_grid):
    """A global grid of 1° cells holding seeded random heights."""
    rng = np.random.default_rng(7)
    elevation = rng.integers(-8000, 8000, (180, 360)).astype(np.int16)
    return write_grid(elevation), elevation


def test_a_window_across_the_dateline_reads_the_two_slices(degree_grid):
    nc, elevation = degree_grid
    r = read_window(nc, 357, 40, 6, 3)
    expected = np.concatenate([elevation[40:43, 357:], elevation[40:43, :3]], axis=1)
    np.testing.assert_array_equal(r.data, expected)
    assert (r.i0, r.j0, r.w, r.h, r.cell_arcsec) == (357, 40, 6, 3, 3600)


def test_rows_run_south_first(write_grid):
    elevation = np.zeros((180, 360), dtype=np.int16)
    elevation[10, :] = 1234  # centered at 79.5°S
    nc = write_grid(elevation)
    r = read_window(nc, 0, 0, 360, 180)
    assert bilinear(r, 20.0, -79.5) == 1234
    assert bilinear(r, 20.0, 79.5) == 0


def test_bilinear_interpolates_between_the_four_cell_centers(degree_grid):
    nc, elevation = degree_grid
    r = read_window(nc, 0, 0, 360, 180)
    # 10.25°E, 20.75°N: between columns 190 (10.5°E) and 189, rows 110 (20.5°N) and 111.
    fx, fy = 0.75, 0.25
    corners = elevation[110:112, 189:191].astype(np.float64)
    expected = (1 - fy) * ((1 - fx) * corners[0, 0] + fx * corners[0, 1]) + fy * (
        (1 - fx) * corners[1, 0] + fx * corners[1, 1]
    )
    assert bilinear(r, 10.25, 20.75) == pytest.approx(expected, abs=1e-9)


def test_bilinear_returns_cell_values_at_cell_centers(degree_grid):
    nc, elevation = degree_grid
    r = read_window(nc, 0, 0, 360, 180)
    j, i = np.meshgrid(np.arange(1, 179), np.arange(360), indexing="ij")
    np.testing.assert_array_equal(bilinear(r, -179.5 + i, -89.5 + j), elevation[1:179])


def test_bilinear_wraps_longitude_on_a_global_raster(degree_grid):
    nc, elevation = degree_grid
    r = read_window(nc, 0, 0, 360, 180)
    # 180° sits halfway between the last column (179.5°E) and the first (179.5°W).
    halfway = (float(elevation[100, 359]) + float(elevation[100, 0])) / 2
    assert bilinear(r, 180.0, 10.5) == pytest.approx(halfway)
    assert bilinear(r, -180.0, 10.5) == pytest.approx(halfway)


def test_rows_clamp_at_the_poles(degree_grid):
    nc, elevation = degree_grid
    r = read_window(nc, 0, 0, 360, 180)
    # North of the last row's centers (89.5°N) and south of the first, rows clamp.
    for lat, row in ((89.5, 179), (89.9, 179), (90.0, 179), (-89.9, 0), (-90.0, 0)):
        assert bilinear(r, 0.5, lat) == elevation[row, 180]


def test_a_window_across_the_dateline_samples_like_the_global_grid(degree_grid):
    nc, _ = degree_grid
    whole = read_window(nc, 0, 0, 360, 180)
    window = read_window(nc, 350, 60, 20, 10)
    lon = np.array([175.0, 179.9, 180.0, -179.6, -171.0])
    lat = np.array([-25.0, -26.5, -21.0, -28.2, -22.7])
    np.testing.assert_array_equal(bilinear(window, lon, lat), bilinear(whole, lon, lat))


def test_bilinear_refuses_points_outside_the_window(degree_grid):
    nc, _ = degree_grid
    window = read_window(nc, 350, 60, 20, 10)
    with pytest.raises(ValueError, match="outside the raster's window"):
        bilinear(window, 0.0, -25.0)


def test_crop_takes_a_window_of_a_global_raster(degree_grid):
    nc, _ = degree_grid
    whole = read_window(nc, 0, 0, 360, 180)
    np.testing.assert_array_equal(
        crop(whole, 358, 5, 4, 2).data, read_window(nc, 358, 5, 4, 2).data
    )


def test_crop_reads_a_global_raster_stored_from_any_column(degree_grid):
    nc, _ = degree_grid
    whole = read_window(nc, 0, 0, 360, 180)
    rotated = Raster(np.roll(whole.data, -5, axis=1), whole.cell_arcsec, 5, 0)
    assert rotated.is_global
    np.testing.assert_array_equal(
        crop(rotated, 358, 5, 4, 2).data, read_window(nc, 358, 5, 4, 2).data
    )


def test_crop_takes_a_window_inside_a_window(degree_grid):
    nc, _ = degree_grid
    window = read_window(nc, 350, 60, 20, 10)
    np.testing.assert_array_equal(
        crop(window, 358, 62, 4, 3).data, read_window(nc, 358, 62, 4, 3).data
    )
    with pytest.raises(ValueError, match="not inside"):
        crop(window, 358, 62, 13, 3)
    with pytest.raises(ValueError, match="not inside"):
        crop(window, 358, 59, 4, 3)


def test_overviews_are_exact_block_means_cached_on_first_use(tmp_path, write_grid):
    # 1125" cells, so every overview divides the grid: 1152x576 -> 288x144, 72x36, 18x9. At 576
    # rows, the overviews are built from a full 320-row strip and a 256-row partial one.
    rng = np.random.default_rng(11)
    elevation = rng.integers(-11000, 9000, (576, 1152)).astype(np.int16)
    nc = write_grid(elevation)
    cache = tmp_path / "cache"
    built = overviews(nc, cache)
    for name, k in OVERVIEWS.items():
        exact = elevation.astype(np.int64).reshape(576 // k, k, 1152 // k, k).sum(axis=(1, 3))
        np.testing.assert_array_equal(built[name].data, (exact / (k * k)).astype(np.float32))
        assert built[name].cell_arcsec == 1125 * k and built[name].is_global
    assert sorted(p.name for p in cache.iterdir()) == ["16m.npy", "1m.npy", "4m.npy"]


def test_overviews_are_read_back_from_the_cache(tmp_path, write_grid):
    elevation = np.arange(192 * 384, dtype=np.int64).reshape(192, 384) % 1000
    nc = write_grid(elevation.astype(np.int16))
    first = overviews(nc, tmp_path / "cache")
    stamp = (tmp_path / "cache" / "1m.npy").stat().st_mtime_ns
    second = overviews(nc, tmp_path / "cache")
    assert (tmp_path / "cache" / "1m.npy").stat().st_mtime_ns == stamp
    np.testing.assert_array_equal(first["16m"].data, second["16m"].data)


def test_block_means_average_aligned_blocks():
    r = Raster(np.arange(24, dtype=np.int16).reshape(4, 6), 1800, 6, 2)
    np.testing.assert_array_equal(block_means(r, 2), [[3.5, 5.5, 7.5], [15.5, 17.5, 19.5]])
    with pytest.raises(ValueError, match="align"):
        block_means(Raster(np.zeros((4, 6), np.int16), 1800, 1, 2), 2)


def test_an_excerpt_round_trips_with_its_sidecar(tmp_path):
    data = np.array([[-10931, 0, 8627], [1, -1, 2]], dtype=np.int16)
    r = Raster(data, 240, 5399, 7)
    meta = {"source": "demo", "file": "sources/demo/g.nc", "sha256": "0" * 64, "kind": "cells"}
    write_excerpt(tmp_path, "demo-4m", r, meta)
    back = read_excerpt(tmp_path, "demo-4m")
    np.testing.assert_array_equal(back.data, data)
    assert (back.cell_arcsec, back.i0, back.j0) == (240, 5399, 7)
    assert read_sidecar(tmp_path, "demo-4m") == {
        **meta,
        "cellArcsec": 240,
        "i0": 5399,
        "j0": 7,
        "w": 3,
        "h": 2,
    }


def test_an_excerpt_is_little_endian_int16_gzip_with_no_timestamp(tmp_path):
    r = Raster(np.array([[1, -2]], dtype=np.int16), 60, 0, 0)
    write_excerpt(tmp_path, "tiny", r, {})
    stored = (tmp_path / "tiny.i16.gz").read_bytes()
    assert stored[4:8] == b"\0\0\0\0"  # gzip mtime
    assert gzip.decompress(stored) == b"\x01\x00\xfe\xff"


def test_writing_an_excerpt_twice_gives_the_same_bytes(tmp_path):
    rng = np.random.default_rng(5)
    r = Raster(rng.integers(-500, 500, (40, 30)).astype(np.int16), 15, 100, 200)
    write_excerpt(tmp_path / "a", "x", r, {"kind": "cells"})
    write_excerpt(tmp_path / "b", "x", r, {"kind": "cells"})
    for name in ("x.i16.gz", "x.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_an_excerpt_must_hold_int16(tmp_path):
    with pytest.raises(TypeError, match="int16"):
        write_excerpt(tmp_path, "x", Raster(np.zeros((1, 1)), 15, 0, 0), {})


def test_a_raster_window_must_fit_the_globe():
    with pytest.raises(ValueError, match="rows"):
        Raster(np.zeros((3, 3), np.int16), 3600, 0, 178)
    with pytest.raises(ValueError, match="tile the globe"):
        Raster(np.zeros((3, 3), np.int16), 7, 0, 0)
