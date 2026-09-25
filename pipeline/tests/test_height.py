import numpy as np
import pytest

from prebuild.cube import TILE, Tile, dir_to_lonlat, st_to_dir, texel_center
from prebuild.expect import TAMBORA_SUMMIT
from prebuild.footprint import subsample_lonlat, tile_texels
from prebuild.gebco import OVERVIEWS, Raster, crop, overviews, read_excerpt, read_window
from prebuild.height import (
    GRID,
    PRODUCTION_SOURCES,
    ExcerptHeights,
    GebcoHeights,
    height_source,
    texel_means,
)
from prebuild.paths import excerpts_dir
from prebuild.profiles import Profile, make_context

GEBCO_DIR = excerpts_dir() / "gebco"
SUMBAWA_WEST = Tile(1, 7, 102, 50)
SUMBAWA_EAST = Tile(1, 7, 103, 50)  # holds the Tambora summit


@pytest.fixture(scope="module")
def excerpts():
    return height_source(make_context(Profile.FIXTURE, 1))


def tile_heights(tile: Tile, source) -> np.ndarray:
    return texel_means(*tile_texels(tile), source.raster(tile))


def test_texel_means_of_a_linear_raster_are_the_mean_of_its_sub_samples():
    # 1' cells around Sumbawa holding 3·lon - 7·lat + 11 at their centers, which bilinear sampling
    # reproduces exactly between them.
    i0, j0 = 17_800, 4_850
    lon = -180 + (i0 + np.arange(120) + 0.5) / 60
    lat = -90 + (j0 + np.arange(100) + 0.5) / 60
    raster = Raster(3 * lon[None, :] - 7 * lat[:, None] + 11, 60, i0, j0)
    rows, cols = range(12_810, 12_830), range(26_408, 26_440)
    sub_lon, sub_lat = subsample_lonlat(1, 7, rows, cols)
    analytic = (
        (3 * sub_lon - 7 * sub_lat + 11).reshape(len(rows), 4, len(cols), 4).mean(axis=(1, 3))
    )
    np.testing.assert_allclose(texel_means(1, 7, rows, cols, raster), analytic, rtol=0, atol=1e-9)


def test_a_border_texel_equals_the_neighbors_interior_bit_for_bit(excerpts):
    west = tile_heights(SUMBAWA_WEST, excerpts)
    east = tile_heights(SUMBAWA_EAST, excerpts)
    # West's texels i = 252..259 are east's i = -4..3: stored columns 256..263 and 0..7.
    np.testing.assert_array_equal(west[:, 256:], east[:, :8])


def test_the_tambora_tile_peaks_on_the_rim(excerpts):
    heights = tile_heights(SUMBAWA_EAST, excerpts)
    assert heights.max() == pytest.approx(2586.3, abs=0.1)
    # Row 0 is j = -4, the southern edge, and column 0 is i = -4: the peak texel's center must be
    # the summit, which a flipped axis would move across the tile.
    row, col = np.unravel_index(np.argmax(heights), heights.shape)
    s = texel_center(7, TILE * SUMBAWA_EAST.x + int(col) - 4)
    t = texel_center(7, TILE * SUMBAWA_EAST.y + int(row) - 4)
    lon, lat = dir_to_lonlat(st_to_dir(1, s, t))
    assert (float(lon), float(lat)) == pytest.approx(TAMBORA_SUMMIT, abs=0.005)


@pytest.mark.parametrize(("level", "cols"), [(0, range(124, 132)), (1, range(252, 260))])
def test_heights_wrap_across_the_dateline_at_face_2s_center(level, cols):
    # Face 2's center column (s = 0) is 180°, at L0 the middle of the face and at L1 the x = 0|1
    # tile boundary. A window cropped across the dateline holds the same cells unwrapped.
    world = read_excerpt(GEBCO_DIR, "global-30m")
    straddling = crop(world, 700, 0, 40, 360)
    rows = range(-60 + (TILE << level) // 2, 60 + (TILE << level) // 2)
    lon, _ = subsample_lonlat(2, level, rows, cols)
    assert lon.min() < -179 and lon.max() > 179
    np.testing.assert_array_equal(
        texel_means(2, level, rows, cols, world), texel_means(2, level, rows, cols, straddling)
    )


def test_tiles_meet_across_the_dateline_bit_for_bit():
    world = read_excerpt(GEBCO_DIR, "global-30m")
    west = texel_means(*tile_texels(Tile(2, 1, 0, 1)), world)
    east = texel_means(*tile_texels(Tile(2, 1, 1, 1)), world)
    np.testing.assert_array_equal(west[:, 256:], east[:, :8])


def test_each_production_level_reads_the_coarsest_source_no_larger_than_its_texel():
    cells = {GRID: 15, **{name: 15 * k for name, k in OVERVIEWS.items()}}
    assert sorted(PRODUCTION_SOURCES) == list(range(8))
    for level, name in PRODUCTION_SOURCES.items():
        texel_arcsec = 90 * 3600 / (TILE << level)  # a nominal texel, as an arc
        fitting = [n for n, cell in cells.items() if cell <= texel_arcsec]
        assert name == max(fitting, key=cells.__getitem__, default=GRID)


def test_the_production_source_reads_the_grid_per_tile_and_overviews_above_l5(tmp_path, write_grid):
    # 2025" cells: 320 rows divide into the 16' overview's 64-row blocks.
    rng = np.random.default_rng(11)
    elevation = rng.integers(-6000, 6000, (320, 640)).astype(np.int16)
    nc = write_grid(elevation)
    source = GebcoHeights(nc, overviews(nc, tmp_path / "cache"))
    tile = Tile(3, 5, 9, 20)
    window = source.raster(tile)
    assert window.cell_arcsec == 2025 and not window.is_global
    whole = read_window(nc, 0, 0, 640, 320)
    np.testing.assert_array_equal(
        tile_heights(tile, source), texel_means(*tile_texels(tile), whole)
    )
    for level, name in PRODUCTION_SOURCES.items():
        if name != GRID:
            assert source.raster(Tile(0, level, 0, 0)).cell_arcsec == 2025 * OVERVIEWS[name]


def test_the_production_source_has_no_grid_past_l7(write_grid):
    nc = write_grid(np.zeros((320, 640), dtype=np.int16))
    with pytest.raises(ValueError, match="level 8"):
        GebcoHeights(nc, {}).raster(Tile(0, 8, 0, 0))


def test_the_fixture_reads_the_excerpt_fixture_yaml_names(excerpts):
    assert isinstance(excerpts, ExcerptHeights)
    assert excerpts.raster(SUMBAWA_EAST).cell_arcsec == 15
    assert excerpts.raster(Tile(4, 3, 7, 0)).cell_arcsec == 240
    assert excerpts.raster(Tile(0, 0, 0, 0)).is_global
    with pytest.raises(ValueError, match="no tile 7/1/104/50"):
        excerpts.raster(Tile(1, 7, 104, 50))
