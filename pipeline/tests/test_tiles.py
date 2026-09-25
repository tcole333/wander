import time
from dataclasses import replace

import numpy as np
import pytest

from prebuild.codes import codes_to_meters, meters_to_codes, q_land_start
from prebuild.config import load_fixture
from prebuild.cube import EDGES, Neighbor, Tile, face_st, lonlat_to_dir, neighbor, texel_of, tile_of
from prebuild.expect import TAMBORA_SUMMIT
from prebuild.fields import Fields
from prebuild.footprint import tile_texels
from prebuild.height import texel_means
from prebuild.profiles import Profile, make_context
from prebuild.sources import SourceUnavailable
from prebuild.tiles import (
    build_tile,
    clamp_coastal,
    edge_profiles,
    height_bound,
    open_sources,
    surface,
)
from prebuild.wst import FLAG_ALL_SEA, FLAG_INLAND_WATER, MAX_OFFSET, E, N, S, W, from_file, to_file

FIXTURE_TILES = load_fixture().tiles
SUMBAWA_WEST = Tile(1, 7, 102, 50)
SUMBAWA_EAST = Tile(1, 7, 103, 50)  # holds the Tambora summit
KIRKUK_TOP = Tile(4, 7, 127, 0)  # its S and E edges belong to faces 0 and 1


@pytest.fixture(scope="module")
def built(fixture_surface):
    """A fixture tile's planes at its level's first qLand candidate, built once."""
    tiles = {}

    def get(tile: Tile):
        if tile not in tiles:
            tiles[tile] = build_tile(fixture_surface(tile), q_land_start(tile.level))
        return tiles[tile]

    return get


def edge(tile_planes, name: str) -> np.ndarray:
    return tile_planes.edges[EDGES.index(name)]


def stored_texel(tile: Tile, lon: float, lat: float) -> tuple[int, int]:
    """(row, column) of the stored texel holding a point inside the tile."""
    s, t = face_st(tile.face, lonlat_to_dir(lon, lat))
    assert (int(tile_of(s, tile.level)), int(tile_of(t, tile.level))) == (tile.x, tile.y)
    i, j = int(texel_of(s, tile.level, tile.x)), int(texel_of(t, tile.level, tile.y))
    return j + 4, i + 4


@pytest.mark.parametrize(
    ("h", "d", "clamped"),
    [
        (-3.0, 1.5, 0.0),  # land near the shore stands at sea level or above
        (12.0, 1.5, 12.0),
        (5.0, -2.0, 0.0),  # sea near the shore lies at sea level or below, 2 texels included
        (-40.0, -0.5, -40.0),
        (7.5, 0.0, 0.0),  # on the shore line
        (-7.5, 0.0, 0.0),
        (-430.0, 18.0, -430.0),  # an inland depression far from the sea keeps its height
        (-3.0, 2.5, -3.0),
        (25.0, -2.5, 25.0),  # a rock offshore past the reach keeps its height
        (-12.0, np.inf, -12.0),
        (3.0, -np.inf, 3.0),
    ],
)
def test_the_coastal_clamp(h, d, clamped):
    assert float(clamp_coastal(h, d)) == clamped


def test_heights_within_two_texels_of_the_shore_take_its_side(fixture_surface, fixture_sources):
    s = fixture_surface(SUMBAWA_EAST)
    raw = texel_means(*tile_texels(SUMBAWA_EAST), fixture_sources.heights.raster(SUMBAWA_EAST))
    d = s.fields.shore_d
    near = np.abs(d) <= 2
    assert (s.heights[near & (d > 0)] >= 0).all()
    assert (s.heights[near & (d < 0)] <= 0).all()
    assert (d == 0).any() and (s.heights[d == 0] == 0).all()
    np.testing.assert_array_equal(s.heights[~near], raw[~near])
    assert (s.heights != raw).any()


def test_the_dead_sea_keeps_its_depth(fixture_surface, built):
    tile = Tile(0, 3, 7, 7)
    row, col = stored_texel(tile, 35.5, 31.5)
    s = fixture_surface(tile)
    assert s.fields.shore_d[row, col] > 2  # the sea is farther than the clamp reaches
    assert s.heights[row, col] < -300
    assert codes_to_meters(built(tile).codes[row, col], q_land_start(3)) < -300


LAND, SEA, WATER, DRY = (255, 255), (0, 0), (0, 127), (129, 255)  # byte ranges


@pytest.mark.parametrize(
    ("tile", "lonlat", "plane", "expect"),
    [
        (SUMBAWA_EAST, TAMBORA_SUMMIT, "shore", LAND),
        (SUMBAWA_EAST, (117.90, -8.51), "shore", SEA),  # Saleh Bay
        (Tile(4, 5, 31, 0), (45.5119, 37.6977), "water", WATER),  # Lake Urmia, alkaline
        (Tile(0, 3, 7, 7), (35.5, 31.5), "water", WATER),  # the Dead Sea
        (Tile(0, 4, 15, 15), (43.4409, 33.3132), "water", WATER),  # Habbaniyah, allowlisted
        (Tile(0, 5, 31, 31), (43.2225, 34.0242), "water", DRY),  # Tharthar, a dropped reservoir
        (Tile(0, 5, 31, 31), (43.3088, 35.7944), "water", WATER),  # the Tigris above Tikrit
        (Tile(1, 7, 0, 127), (45.1, 35.3), "shore", LAND),  # the Kirkuk corner
    ],
    ids=["tambora", "saleh-bay", "urmia", "dead-sea", "habbaniyah", "tharthar", "tigris", "kirkuk"],
)
def test_field_bytes_at_known_places(built, tile, lonlat, plane, expect):
    row, col = stored_texel(tile, *lonlat)
    low, high = expect
    assert low <= int(getattr(built(tile), plane)[row, col]) <= high


def test_neighbors_on_a_face_share_their_border_texels_and_edge(built):
    west, east = built(SUMBAWA_WEST), built(SUMBAWA_EAST)
    for plane in ("codes", "shore", "water"):
        # West's texels i = 252..259 are east's i = -4..3.
        np.testing.assert_array_equal(getattr(west, plane)[:, 256:], getattr(east, plane)[:, :8])
    np.testing.assert_array_equal(edge(west, "E"), edge(east, "W"))


L1_PAIRS = [(Tile(f, 1, 0, y), Tile(f, 1, 1, y), "E") for f in range(6) for y in (0, 1)] + [
    (Tile(f, 1, x, 0), Tile(f, 1, x, 1), "N") for f in range(6) for x in (0, 1)
]


@pytest.mark.parametrize(
    ("a", "b", "side"), L1_PAIRS, ids=lambda v: v.key() if isinstance(v, Tile) else v
)
def test_l1_neighbors_on_a_face_match(built, a, b, side):
    first, second = built(a), built(b)
    other = {"E": "W", "N": "S"}[side]
    np.testing.assert_array_equal(edge(first, side), edge(second, other))
    for plane in ("codes", "shore", "water"):
        mine, theirs = getattr(first, plane), getattr(second, plane)
        if side == "E":
            np.testing.assert_array_equal(mine[:, 256:], theirs[:, :8])
        else:
            np.testing.assert_array_equal(mine[256:], theirs[:8])


@pytest.mark.parametrize("face", range(6))
def test_the_four_l1_tiles_agree_at_their_face_center(built, face):
    sw, se = built(Tile(face, 1, 0, 0)), built(Tile(face, 1, 1, 0))
    nw, ne = built(Tile(face, 1, 0, 1)), built(Tile(face, 1, 1, 1))
    entries = {
        int(edge(sw, "N")[256]),
        int(edge(sw, "E")[256]),
        int(edge(se, "N")[0]),
        int(edge(se, "W")[256]),
        int(edge(nw, "S")[256]),
        int(edge(nw, "E")[0]),
        int(edge(ne, "S")[0]),
        int(edge(ne, "W")[0]),
    }
    assert len(entries) == 1


@pytest.mark.parametrize("level", [0, 1])
def test_profiles_match_on_every_face_edge(built, level):
    side = range(1 << level)
    checked = 0
    for tile in (Tile(f, level, x, y) for f in range(6) for y in side for x in side):
        for name in EDGES:
            other = neighbor(tile, name)
            if other.tile.face == tile.face:
                continue
            theirs = edge(built(other.tile), other.edge)
            np.testing.assert_array_equal(
                edge(built(tile), name), theirs[::-1] if other.reversed else theirs
            )
            checked += 1
    assert checked == 24 << level  # each of the 12 face edges, from both sides, per tile along it


@pytest.mark.parametrize("level", range(2, 8))
def test_the_kirkuk_corner_tiles_share_every_entry_of_their_edges(built, level):
    n = 1 << level
    face0, face1, face4 = (
        Tile(0, level, n - 1, n - 1),
        Tile(1, level, 0, n - 1),
        Tile(4, level, n - 1, 0),
    )
    for a, a_edge, b, b_edge in (
        (face0, "N", face4, "S"),
        (face0, "E", face1, "W"),
        (face1, "N", face4, "E"),
    ):
        assert neighbor(a, a_edge) == Neighbor(b, b_edge, False)
        np.testing.assert_array_equal(edge(built(a), a_edge), edge(built(b), b_edge))
    vertex = {
        int(edge(built(face0), "N")[256]),
        int(edge(built(face1), "N")[0]),
        int(edge(built(face4), "E")[0]),
    }
    assert len(vertex) == 1


@pytest.mark.parametrize("tile", FIXTURE_TILES, ids=Tile.key)
def test_edge_profiles_agree_at_the_tile_corners(built, tile):
    edges = built(tile).edges
    assert edges[N, 0] == edges[W, 256]
    assert edges[N, 256] == edges[E, 256]
    assert edges[S, 0] == edges[W, 0]
    assert edges[S, 256] == edges[E, 0]


@pytest.mark.parametrize("tile", FIXTURE_TILES, ids=Tile.key)
def test_a_built_tile_centers_its_codes_and_round_trips(built, tile):
    planes = built(tile)
    assert planes.code_mid == (planes.code_min + planes.code_max) // 2
    stored = np.concatenate([planes.codes.ravel(), planes.edges.ravel()]).astype(np.int64)
    assert np.abs(stored - planes.code_mid).max() <= MAX_OFFSET
    back = from_file(to_file(planes), tile)
    for plane in ("codes", "shore", "water", "edges"):
        np.testing.assert_array_equal(getattr(back, plane), getattr(planes, plane))
    header = ("flags", "q_land", "code_mid", "code_min", "code_max")
    assert [getattr(back, name) for name in header] == [getattr(planes, name) for name in header]


def test_edge_entries_round_half_away_from_zero(fixture_surface):
    s = fixture_surface(SUMBAWA_EAST)  # its own face owns every entry
    j, i = np.indices(s.heights.shape)
    codes = 2 + 2 * (i % 2) * (j % 2)  # every 2x2 block of texels sums to 10
    for sign in (1, -1):
        edges = edge_profiles(replace(s, heights=sign * 2.0 * codes), 2.0)
        assert (edges == 3 * sign).all()  # 10 / 4 = 2.5 rounds away from zero
        assert np.round(2.5 * sign) == 2 * sign  # np.round would round it to even


def test_codes_and_bytes_round_half_away_from_zero(fixture_surface):
    s = fixture_surface(SUMBAWA_EAST)
    shape = s.heights.shape
    heights = np.where(np.indices(shape)[0] % 2 == 0, 5.0, -5.0)  # ±2.5 codes at qLand 2
    shore = np.full(shape, 1 / 32)  # 128 + 16/32 = 128.5
    tile = build_tile(replace(s, heights=heights, fields=Fields(shore, s.fields.water_d)), 2.0)
    assert set(tile.codes[0::2].ravel().tolist()) == {3}
    assert set(tile.codes[1::2].ravel().tolist()) == {-3}
    assert (tile.shore == 129).all()
    assert np.round(2.5) == 2 and np.round(128.5) == 128


def test_flags_mark_inland_water_and_all_sea(fixture_surface, built):
    assert built(Tile(4, 3, 7, 0)).flags == FLAG_INLAND_WATER  # Urmia, Van and the Tigris
    assert built(SUMBAWA_EAST).flags == 0
    s = fixture_surface(SUMBAWA_EAST)
    shape = s.heights.shape
    sea = Fields(np.full(shape, -np.inf), np.full(shape, np.inf))
    assert build_tile(replace(s, fields=sea), 2.0).flags == FLAG_ALL_SEA


def test_the_height_bound_holds_every_code_a_tile_stores(fixture_surface):
    s = fixture_surface(Tile(4, 3, 7, 0))  # reads owner strips on faces 0 and 1
    assert s.strips
    low, high = height_bound(s)
    assert low <= s.heights.min() and s.heights.max() <= high
    assert all(low <= p.heights.min() and p.heights.max() <= high for p in s.strips)
    for q in (q_land_start(3), 20.0):
        tile = build_tile(s, q)
        code_low, code_high = meters_to_codes([low, high], q)
        assert code_low <= tile.code_min and tile.code_max <= code_high


def test_a_tile_spanning_more_than_4096_codes_is_refused(fixture_surface):
    with pytest.raises(ValueError, match="more than 4096"):
        build_tile(fixture_surface(SUMBAWA_EAST), 0.5)  # -999 m to 2,586 m


def test_other_profiles_read_raw_data():
    with pytest.raises(SourceUnavailable, match="prebuild fetch"):
        open_sources(make_context(Profile.REGION, 1))


@pytest.mark.parametrize("tile", [SUMBAWA_EAST, KIRKUK_TOP], ids=Tile.key)
def test_a_tile_builds_well_within_a_second(fixture_sources, tile):
    # Measured at about 0.2 s with gzip on the M5: a coastal 15" tile, and one whose edges read
    # owner strips on two other faces.
    def seconds() -> float:
        start = time.perf_counter()
        to_file(build_tile(surface(tile, fixture_sources), q_land_start(tile.level)))
        return time.perf_counter() - start

    assert min(seconds(), seconds()) < 1.0
