import base64
import dataclasses
import json

import numpy as np
import pytest
import shapely

from prebuild import coverage, workers
from prebuild.codes import Q_STEP, c200, q_land_start
from prebuild.config import Region, load_fixture, load_regions
from prebuild.cube import (
    TILE,
    Tile,
    available_nodes,
    dir_to_lonlat,
    node_count,
    node_index,
    st_to_dir,
    texel_center,
)
from prebuild.footprint import Window
from prebuild.gebco import GEBCO, GEBCO_NC, Raster, crop
from prebuild.hashing import CODE_PATHS, tree_sha
from prebuild.natural_earth import ZIPS
from prebuild.paths import REPO_ROOT, config_dir
from prebuild.profiles import Profile, make_context
from prebuild.records import record_path
from prebuild.sources import load_sources, pinned_file
from prebuild.tiles import TileSources, height_bound, surface

SUMBAWA = (118.0, -8.25)
SUMBAWA_L5 = Tile(1, 5, 25, 12)
SUMBAWA_L7 = Tile(1, 7, 103, 50)
PACIFIC_L5 = Tile(2, 5, 26, 11)  # open sea around 150°W 10°S
LEVEL_SIZES = [6 * 4**level for level in range(5)]


@pytest.fixture(scope="module")
def fixture_record(tmp_path_factory):
    """The coverage stage run on the fixture profile, into a temporary build folder."""
    build = tmp_path_factory.mktemp("build")
    ctx = dataclasses.replace(
        make_context(Profile.FIXTURE, 2),
        out=build / "fixture",
        stages_dir=build / "stages",
        cache=build / "cache",
    )
    coverage.run(ctx)
    return json.loads(record_path(ctx, "coverage").read_text())


def some_land(tiles: list[Tile]) -> list[bool]:
    """A stand-in land-or-shelf test that keeps two tiles in three."""
    return [node_index(t) % 3 != 0 for t in tiles]


def tile_at(lon: float, lat: float, level: int) -> Tile:
    return coverage._tile_at(lon, lat, level)


def texel_lonlat(tile: Tile, i: int, j: int) -> tuple[float, float]:
    """Lon/lat of the center of tile-local texel (i, j)."""
    s = texel_center(tile.level, TILE * tile.x + i)
    t = texel_center(tile.level, TILE * tile.y + j)
    lon, lat = dir_to_lonlat(st_to_dir(tile.face, s, t))
    return float(lon), float(lat)


# Availability


def test_levels_0_to_4_are_complete_and_deeper_levels_closed_upward():
    milestone = load_regions(config_dir() / "regions-milestone1.yaml")
    l7 = load_regions(config_dir() / "l7.yaml")
    tiles = coverage.grow({5: milestone, 6: milestone, 7: l7}, some_land)
    counts = [sum(t.level == level for t in tiles) for level in range(8)]
    assert counts[:5] == LEVEL_SIZES
    assert all(count > 0 for count in counts[5:])
    present = set(tiles)
    assert all(t.parent() in present for t in tiles if t.level > 0)
    assert [node_index(t) for t in tiles] == sorted(node_index(t) for t in tiles)


def test_deeper_tiles_lie_in_their_level_s_regions_and_pass_the_land_test():
    milestone = load_regions(config_dir() / "regions-milestone1.yaml")
    l7 = load_regions(config_dir() / "l7.yaml")
    regions = {5: milestone, 6: milestone, 7: l7}
    tiles = coverage.grow(regions, some_land)
    for level, bound in regions.items():
        deep = [t for t in tiles if t.level == level]
        assert all(coverage.in_regions(deep, bound))
        assert all(some_land(deep))


def test_without_regions_every_tile_on_land_or_shelf_bakes():
    side = range(1 << 5)
    level5 = [Tile(face, 5, x, y) for face in range(6) for y in side for x in side]
    tiles = coverage.grow({5: None}, some_land)
    assert [t for t in tiles if t.level == 5] == [t for t in level5 if some_land([t])[0]]


def test_a_missing_parent_is_refused():
    with pytest.raises(ValueError, match="without its parent"):
        coverage.check_closed_upward([Tile(0, 0, 0, 0), Tile(0, 2, 0, 0)])


@pytest.mark.parametrize(
    ("profile", "levels"),
    [("region", {5: "milestone", 6: "milestone", 7: "l7"}), ("global", {7: "l7"})],
)
def test_each_profile_bounds_its_deep_levels(profile, levels):
    regions = coverage.level_regions(make_context(Profile(profile), 1))
    milestone = load_regions(config_dir() / "regions-milestone1.yaml")
    l7 = load_regions(config_dir() / "l7.yaml")
    named = {"milestone": milestone, "l7": l7}
    assert regions == {level: named.get(levels.get(level, "")) for level in (5, 6, 7)}


# Regions


def test_a_per_level_radius_admits_a_tile_at_l5_and_rejects_its_child_at_l6():
    region = Region("near", *SUMBAWA, {5: 300.0, 6: 50.0})
    east = tile_at(120.0, -8.25, 5)  # its west edge runs about 14 km east of the center
    assert east != tile_at(*SUMBAWA, 5)
    assert coverage.in_regions([east], [region]) == [True]
    # Its children in the center's row: the west one along the same edge, the east one about
    # 170 km out.
    west, east_child = (Tile(east.face, 6, 2 * east.x + dx, 2 * east.y + 1) for dx in (0, 1))
    assert coverage.in_regions([west, east_child], [region]) == [True, False]


def test_a_region_takes_the_tile_that_holds_its_center():
    region = Region("dot", *SUMBAWA, {7: 0.001})  # no mesh corner lies within a meter
    assert tile_at(*SUMBAWA, 7) == SUMBAWA_L7
    two_east = Tile(1, 7, SUMBAWA_L7.x + 2, SUMBAWA_L7.y)
    assert coverage.in_regions([SUMBAWA_L7, two_east], [region]) == [True, False]


def test_a_region_without_a_radius_at_the_level_admits_nothing():
    region = Region("l5-only", *SUMBAWA, {5: 5000.0})
    assert coverage.in_regions([tile_at(*SUMBAWA, 6)], [region]) == [False]


def test_distances_are_great_circle_meters():
    quarter = coverage.great_circle_m(np.array(90.0), np.array(0.0), 0.0, 0.0)
    assert float(quarter) == pytest.approx(np.pi / 2 * 6_371_008.8)
    assert float(coverage.great_circle_m(np.array(10.0), np.array(20.0), 10.0, 20.0)) == 0


# Land and shelf


def test_land_touches_the_sumbawa_tiles(fixture_sources):
    land, tree = fixture_sources.vectors.land, fixture_sources.vectors.land_tree
    assert coverage.touches_land(SUMBAWA_L7, land, tree)
    assert coverage.touches_land(SUMBAWA_L5, land, tree)
    assert not coverage.touches_land(PACIFIC_L5, land, tree)


def islet(lon: float, lat: float, half_deg: float = 2e-4) -> np.ndarray:
    return np.array([shapely.box(lon - half_deg, lat - half_deg, lon + half_deg, lat + half_deg)])


@pytest.mark.parametrize(("i", "touches"), [(-5, True), (-6, False), (260, True), (261, False)])
def test_land_counts_within_one_texel_past_the_border(i, touches):
    """Texels -5 and 260 are the dilation; -6 and 261 lie past it."""
    land = islet(*texel_lonlat(SUMBAWA_L7, i, 128))
    assert coverage.touches_land(SUMBAWA_L7, land, shapely.STRtree(land)) is touches


def shelf_cells(tile: Tile, shallow: list[tuple[float, float]]) -> Raster:
    """15" cells over the tile's shelf window at -500 m, but -150 m in the cells holding the given
    points."""
    i0, j0, w, h = coverage.shelf_window(tile, 15)
    data = np.full((h, w), -500, dtype=np.int16)
    for lon, lat in shallow:
        i = (int(np.floor((lon + 180) * 240)) - i0) % (360 * 240)
        j = int(np.floor((lat + 90) * 240)) - j0
        data[j, i] = -150
    return Raster(data, 15, i0, j0)


@pytest.mark.parametrize(
    ("i", "touches"), [(-5, True), (-6, False), (128, True), (260, True), (261, False)]
)
def test_shelf_counts_cells_centered_within_one_texel_past_the_border(i, touches):
    """An L5 texel spans about 2.6 cells, so the cell holding a texel's center has its own center
    in that texel."""
    cells = shelf_cells(SUMBAWA_L5, [texel_lonlat(SUMBAWA_L5, i, 100)])
    assert coverage.touches_shelf(SUMBAWA_L5, cells) is touches


def test_deep_sea_is_not_shelf():
    assert not coverage.touches_shelf(SUMBAWA_L5, shelf_cells(SUMBAWA_L5, []))


class ShelfCells:
    """GEBCO cells at -4000 m, but at -150 m in the cells holding `shallow`."""

    grid_cell = 15

    def __init__(self, tile: Tile, shallow: list[tuple[float, float]]) -> None:
        self.tile = tile
        self.shallow = shallow

    def raster(self, tile: Tile) -> Raster:
        raise AssertionError("the land-or-shelf test reads no tile raster")

    def grid_cells(self, window: Window) -> Raster:
        assert window == coverage.shelf_window(self.tile, self.grid_cell)
        cells = shelf_cells(self.tile, self.shallow)
        return Raster(np.where(cells.data == -500, -4000, cells.data), 15, cells.i0, cells.j0)


@pytest.mark.parametrize(
    ("tile", "shallow", "kept"),
    [
        (SUMBAWA_L7, [], True),  # land, whatever the sea does
        (PACIFIC_L5, [], False),
        (PACIFIC_L5, [(-150.0, -10.0)], True),  # a seamount
    ],
    ids=["land", "open-sea", "seamount"],
)
def test_a_worker_keeps_tiles_on_land_or_shelf(monkeypatch, fixture_sources, tile, shallow, kept):
    sources = TileSources(ShelfCells(tile, shallow), fixture_sources.vectors)
    monkeypatch.setattr(workers, "_sources", sources)
    assert coverage._land_or_shelf(tile) is kept


def test_the_shelf_window_holds_the_dilated_texels():
    i0, j0, w, h = coverage.shelf_window(SUMBAWA_L5, 15)
    for i, j in [(-5, -5), (260, 260), (-5, 260), (128, 128)]:
        lon, lat = texel_lonlat(SUMBAWA_L5, i, j)
        column = (int(np.floor((lon + 180) * 240)) - i0) % (360 * 240)
        row = int(np.floor((lat + 90) * 240)) - j0
        assert 0 <= column < w and 0 <= row < h


# qLand


def exact_as_given(bounds):
    calls: list[list[int]] = []

    def exact(indices: list[int]) -> list[tuple[float, float]]:
        calls.append(indices)
        return [bounds[k] for k in indices]

    return exact, calls


def test_q_land_steps_between_4096_and_4097_codes():
    start = q_land_start(5)
    assert start == 2.0
    fits = [(0.0, 4096 * start)]
    exact, _ = exact_as_given(fits)
    assert coverage.choose_q_land(5, fits, exact) == start
    over = [(0.0, 4097 * start)]
    exact, _ = exact_as_given(over)
    assert coverage.choose_q_land(5, over, exact) == start + Q_STEP


def test_the_exact_bound_is_asked_only_where_the_cheap_one_fails():
    cheap = [(-100.0, 900.0), (0.0, 9000.0), (-50.0, 50.0)]
    exact_bounds = [(-100.0, 900.0), (0.0, 8000.0), (-50.0, 50.0)]
    exact, calls = exact_as_given(exact_bounds)
    assert coverage.choose_q_land(6, cheap, exact) == q_land_start(6)
    assert calls == [[1]]


def test_a_level_with_no_tiles_keeps_its_first_candidate():
    assert coverage.choose_q_land(3, [], exact_as_given([])[0]) == q_land_start(3)


def test_a_bound_spans_codes_below_minus_200_meters_at_four_times_the_step():
    assert coverage.code_span((-200.0, 0.0), 2.0) == 100
    assert coverage.code_span((-1000.0, 0.0), 2.0) == 200  # 100 codes to -200 m, 100 below


class GlobalRaster:
    """A height source whose every tile reads one global raster."""

    def __init__(self, data: np.ndarray) -> None:
        self.data = Raster(data, 1800, 0, 0)

    @property
    def grid_cell(self) -> int:
        return 1800

    def raster(self, tile: Tile) -> Raster:
        return self.data

    def grid_cells(self, window: Window) -> Raster:
        return crop(self.data, *window)


@pytest.mark.parametrize("tile", [Tile(1, 2, 3, 1), Tile(4, 2, 3, 0)], ids=Tile.key)
def test_the_cheap_bound_holds_the_exact_bound(fixture_sources, tile):
    rng = np.random.default_rng(5)
    rough = rng.integers(-6000, 3000, (360, 720)).astype(np.int16)
    for data in (rough, np.full((360, 720), -50, dtype=np.int16)):
        heights = GlobalRaster(data)
        low, high = coverage.cheap_bound(tile, heights)
        exact_low, exact_high = height_bound(
            surface(tile, TileSources(heights, fixture_sources.vectors))
        )
        assert low <= exact_low and exact_high <= high


def test_the_cheap_bound_takes_in_sea_level_for_the_clamp(fixture_sources):
    """Under a sea 50 m deep everywhere, the clamp lifts coastal land to 0 m."""
    heights = GlobalRaster(np.full((360, 720), -50, dtype=np.int16))
    tile = Tile(1, 2, 3, 1)
    exact = height_bound(surface(tile, TileSources(heights, fixture_sources.vectors)))
    assert exact == (-50.0, 0.0)
    assert coverage.cheap_bound(tile, heights) == (-50.0, 0.0)


# The fixture's record


def test_fixture_availability_is_the_fixture_yaml_tiles(fixture_record):
    avail = base64.b64decode(fixture_record["avail"])
    assert len(avail) == (node_count(7) + 7) // 8
    tiles = load_fixture().tiles
    assert available_nodes(avail) == sorted(node_index(t) for t in tiles)
    assert fixture_record["counts"] == [sum(t.level == L for t in tiles) for L in range(8)]


def test_the_fixture_record_keeps_q_land_and_c200_per_level(fixture_record):
    # Every fixture tile spans well under 4,096 codes at its level's first candidate.
    assert fixture_record["qLand"] == [q_land_start(level) for level in range(8)]
    assert fixture_record["c200"] == [c200(q) for q in fixture_record["qLand"]]


def test_the_record_keeps_what_the_stage_read(fixture_record):
    assert set(fixture_record) == {"qLand", "c200", "counts", "avail", "inputs"}
    inputs = fixture_record["inputs"]
    assert set(inputs) == {"gebco", "ne", "configs", "code"}
    assert inputs["code"] == tree_sha(CODE_PATHS, REPO_ROOT)
    assert set(inputs["ne"]) == {"land", "minor_islands", "lakes", "rivers"}
    assert set(inputs["configs"]) == {"fixture.yaml", "water.yaml"}


def test_the_production_inputs_are_the_pinned_hashes():
    inputs = coverage.inputs(make_context(Profile.REGION, 1))
    registry = load_sources()
    assert inputs["gebco"] == pinned_file(registry[GEBCO], GEBCO_NC).sha256
    assert inputs["ne"] == {
        name: pinned_file(registry[source], file).sha256 for name, (source, file) in ZIPS.items()
    }
    assert set(inputs["configs"]) == {"l7.yaml", "regions-milestone1.yaml", "water.yaml"}
