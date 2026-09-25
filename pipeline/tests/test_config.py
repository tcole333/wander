import math

import pytest

from prebuild.config import (
    CONFIG_DIR,
    SCALERANKS,
    ConfigError,
    load_fixture,
    load_regions,
    load_water,
)
from prebuild.cube import Tile, face_st, lonlat_to_dir

KIRKUK = (45.0, math.degrees(math.atan(math.sqrt(0.5))))
SUMBAWA = (118.0, -8.25)


def test_the_fixture_lists_55_tiles_closed_upward():
    tiles = load_fixture().tiles
    assert len(tiles) == len(set(tiles)) == 55
    assert all(t.level == 0 or t.parent() in tiles for t in tiles)
    assert sum(t.level <= 1 for t in tiles) == 30


def corners(tile: Tile) -> set[tuple[float, float]]:
    n = 1 << tile.level
    return {(-1 + 2 * (tile.x + i) / n, -1 + 2 * (tile.y + j) / n) for i in (0, 1) for j in (0, 1)}


def test_the_kirkuk_tiles_are_the_three_tiles_at_the_cube_vertex_per_level():
    at_vertex = []
    for tile in load_fixture().tiles:
        s, t = face_st(tile.face, lonlat_to_dir(*KIRKUK))
        if tile.level >= 2 and any(
            math.isclose(a, s, abs_tol=1e-9) and math.isclose(b, t, abs_tol=1e-9)
            for a, b in corners(tile)
        ):
            at_vertex.append((tile.level, tile.face))
    assert sorted(at_vertex) == [(level, face) for level in range(2, 8) for face in (0, 1, 4)]


def test_the_sumbawa_chain_holds_sumbawa_at_every_level():
    fixture = load_fixture()
    chain = [t for t in fixture.tiles if t.face == 1 and t.x > 0 and t.level >= 2]
    s, t = face_st(1, lonlat_to_dir(*SUMBAWA))
    for tile in chain:
        n = 1 << tile.level
        x, y = int((s + 1) / 2 * n), int((t + 1) / 2 * n)
        assert (tile.x, tile.y) == (x, y) or tile.key() == "7/1/102/50"
    assert [t.level for t in chain] == [2, 3, 4, 5, 6, 7, 7]


def test_every_fixture_tile_reads_an_excerpt_at_its_level():
    fixture = load_fixture()
    assert fixture.rasters[Tile(1, 7, 103, 50)] == "sumbawa-15s"
    assert fixture.rasters[Tile(4, 2, 3, 0)] == "global-30m"
    assert fixture.rasters[Tile(0, 4, 15, 15)] == "kirkuk-4m"
    assert {fixture.excerpts[name] for name in fixture.rasters.values()} == {15, 60, 240, 1800}


def write(tmp_path, text):
    path = tmp_path / "config.yaml"
    path.write_text(text, encoding="utf-8")
    return path


FIXTURE = """
excerpts: {a-30m: 1800}
groups:
  g:
    rasters: {0: a-30m, 1: a-30m}
    tiles: [all-L0, 1/2/0/1]
"""


def test_a_fixture_group_expands_whole_levels(tmp_path):
    fixture = load_fixture(write(tmp_path, FIXTURE))
    assert len(fixture.tiles) == 7
    assert fixture.tiles_reading("a-30m") == fixture.tiles


@pytest.mark.parametrize(
    ("old", "new", "complaint"),
    [
        ("tiles: [all-L0, 1/2/0/1]", "tiles: [1/2/0/1]", "without its parent"),
        ("tiles: [all-L0, 1/2/0/1]", "tiles: [all-L0, 0/2/0/0]", "listed twice"),
        ("{0: a-30m, 1: a-30m}", "{0: a-30m}", "no raster for level 1"),
        ("{0: a-30m, 1: a-30m}", "{0: a-30m, 1: b-4m}", "b-4m, which excerpts does not list"),
        ("{a-30m: 1800}", "{a-30m: 1800, c-1m: 60}", "no tile reads c-1m"),
        ("1/2/0/1", "1/2/0/9", "no tile 1/2/0/9"),
    ],
)
def test_a_malformed_fixture_is_refused(tmp_path, old, new, complaint):
    with pytest.raises(ConfigError, match=complaint):
        load_fixture(write(tmp_path, FIXTURE.replace(old, new)))


def test_the_water_set_follows_owner_decision_13():
    water = load_water()
    assert sorted(water.half_width_km) == list(SCALERANKS)
    assert "Canal" not in water.river_classes
    assert "Lake Centerline" in water.river_classes
    assert "Reservoir" not in water.lake_classes
    assert water.rivers_max_scalerank == {0: 2, 1: 2, 2: 4, 3: 6}


def test_the_allowlist_keeps_the_owners_lakes_by_ne_id():
    owners = {1159123281, 1159123839, 1159123091, 1159123217, 1159123765, 1159123795}
    owners |= {1159123651, 1159123681}  # Il'men' to Cedar, as listed in water.yaml
    assert owners <= load_water().reservoir_allowlist


def test_a_repeated_allowlist_id_is_refused(tmp_path):
    text = (CONFIG_DIR / "water.yaml").read_text(encoding="utf-8")
    text = text.replace("{ne_id: 1159123839,", "{ne_id: 1159123281,")
    with pytest.raises(ConfigError, match="twice"):
        load_water(write(tmp_path, text))


def test_the_regions_have_a_radius_per_level():
    (sumbawa,) = load_regions(CONFIG_DIR / "l7.yaml")
    assert (sumbawa.lon, sumbawa.lat, dict(sumbawa.radius_km)) == (118.0, -8.25, {7: 150.0})
    regions = {r.name: r for r in load_regions(CONFIG_DIR / "regions-milestone1.yaml")}
    assert set(regions) == {"sunda", "java-bali", "new-england", "kirkuk-corner"}
    assert all(set(r.radius_km) == {5, 6} for r in regions.values())
    assert all(r.radius_km[6] <= r.radius_km[5] for r in regions.values())
    corner = regions["kirkuk-corner"]
    assert (corner.lon, corner.lat) == pytest.approx(KIRKUK, abs=1e-5)


def test_a_region_off_the_globe_is_refused(tmp_path):
    with pytest.raises(ConfigError, match="not at a lon/lat"):
        load_regions(write(tmp_path, "- {name: x, lon: 200, lat: 0, radiusKm: {5: 10}}\n"))
