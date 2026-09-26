import time
from dataclasses import replace

import numpy as np
import pytest

from prebuild.codes import codes_to_meters, meters_to_codes, q_land_start
from prebuild.config import load_fixture
from prebuild.cube import (
    EDGES,
    Neighbor,
    Tile,
    edge_corner,
    face_edge_sides,
    face_st,
    lonlat_to_dir,
    neighbor,
    profile_owner,
    texel_of,
    tile_of,
)
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
from prebuild.wst import (
    ENTRY_CORNER,
    ENTRY_MIP,
    FLAG_ALL_SEA,
    FLAG_INLAND_WATER,
    MAX_OFFSET,
    E,
    N,
    S,
    W,
    from_file,
    grid33,
    mip_entries,
    mips,
    to_file,
)

FIXTURE_TILES = load_fixture().tiles
SUMBAWA_WEST = Tile(1, 7, 102, 50)
SUMBAWA_EAST = Tile(1, 7, 103, 50)  # holds the Tambora summit
KIRKUK_TOP = Tile(4, 7, 127, 0)  # its S and E edges belong to faces 0 and 1
KIRKUK_OWNER = Tile(0, 7, 127, 127)  # face 0 owns every entry of its N and E sides


@pytest.fixture(scope="module")
def built(fixture_surface):
    """A fixture tile's planes at its level's first qLand candidate, built once."""
    tiles = {}

    def get(tile: Tile):
        if tile not in tiles:
            tiles[tile] = build_tile(fixture_surface(tile), q_land_start(tile.level))
        return tiles[tile]

    return get


def profile(tile_planes, name: str, m: int) -> tuple[np.ndarray, np.ndarray]:
    """A side's mip-m entries, codes and shore bytes."""
    e = EDGES.index(name)
    return mip_entries(tile_planes.profiles[e], m), mip_entries(tile_planes.profile_shore[e], m)


def assert_same_entries(mine, theirs, reverse: bool = False) -> None:
    """Two sides' codes and shore bytes agree entry for entry, the second read backward when the
    face edge reverses."""
    for a, b in zip(mine, theirs, strict=True):
        np.testing.assert_array_equal(a, b[::-1] if reverse else b)


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


def test_neighbors_on_a_face_share_their_border_texels_and_store_no_profile(built):
    west, east = built(SUMBAWA_WEST), built(SUMBAWA_EAST)
    for plane in ("codes", "shore", "water"):
        # West's texels i = 252..259 are east's i = -4..3.
        np.testing.assert_array_equal(getattr(west, plane)[:, 256:], getattr(east, plane)[:, :8])
    for t in (west, east):
        assert not t.profiles.any() and not t.profile_shore.any()


L1_PAIRS = [(Tile(f, 1, 0, y), Tile(f, 1, 1, y), "E") for f in range(6) for y in (0, 1)] + [
    (Tile(f, 1, x, 0), Tile(f, 1, x, 1), "N") for f in range(6) for x in (0, 1)
]


@pytest.mark.parametrize(
    ("a", "b", "side"), L1_PAIRS, ids=lambda v: v.key() if isinstance(v, Tile) else v
)
def test_l1_neighbors_on_a_face_match(built, a, b, side):
    first, second = built(a), built(b)
    other = {"E": "W", "N": "S"}[side]
    # The side they share lies inside the face, so neither stores a profile there.
    assert not first.profiles[EDGES.index(side)].any()
    assert not second.profiles[EDGES.index(other)].any()
    for plane in ("codes", "shore", "water"):
        mine, theirs = getattr(first, plane), getattr(second, plane)
        if side == "E":
            np.testing.assert_array_equal(mine[:, 256:], theirs[:, :8])
        else:
            np.testing.assert_array_equal(mine[256:], theirs[:8])


@pytest.mark.parametrize("face", range(6))
def test_the_four_l1_grids_agree_at_their_face_center(built, face):
    # The face center is a corner of in-face sides, so each grid takes the mean of the four mip-2
    # codes around it, which border identity makes the same in all four tiles.
    sw, se = built(Tile(face, 1, 0, 0)), built(Tile(face, 1, 1, 0))
    nw, ne = built(Tile(face, 1, 0, 1)), built(Tile(face, 1, 1, 1))
    heights = {grid33(sw)[32, 32], grid33(se)[32, 0], grid33(nw)[0, 32], grid33(ne)[0, 0]}
    assert len(heights) == 1


@pytest.mark.parametrize("level", [0, 1])
def test_profiles_match_on_every_face_edge_at_every_mip(built, level):
    side = range(1 << level)
    checked = 0
    for tile in (Tile(f, level, x, y) for f in range(6) for y in side for x in side):
        for name in EDGES:
            other = neighbor(tile, name)
            if other.tile.face == tile.face:
                continue
            for m in range(3):
                assert_same_entries(
                    profile(built(tile), name, m),
                    profile(built(other.tile), other.edge, m),
                    other.reversed,
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
        for m in range(3):
            assert_same_entries(profile(built(a), a_edge, m), profile(built(b), b_edge, m))
    for m in range(3):
        vertex = {
            (int(codes[k]), int(shore[k]))
            for codes, shore, k in (
                (*profile(built(face0), "N", m), -1),
                (*profile(built(face1), "N", m), 0),
                (*profile(built(face4), "E", m), 0),
            )
        }
        assert len(vertex) == 1


def corner_mean(reader: Tile, planes, corner: tuple[int, int], m: int) -> tuple[int, int]:
    """Around the face-global corner (cs, ct), the rha mean of the four mip-m codes of a tile's own
    stored planes, sign(S)·((|S| + 2) >> 2) with S their sum, and (T + 2) >> 2 of their shore bytes,
    whose sum is T. The planes start at face-global texel 256·x - 4 (and 256·y - 4), a multiple of
    4."""
    cs, ct = corner
    row = (ct >> m) - 1 - ((256 * reader.y - 4) >> m)
    col = (cs >> m) - 1 - ((256 * reader.x - 4) >> m)
    codes, shore = mips(planes.codes)[m], mips(planes.shore)[m]
    code_sum = codes[row : row + 2, col : col + 2].sum()
    shore_sum = shore[row : row + 2, col : col + 2].sum()
    code_sum = int(code_sum)
    rha = (1 if code_sum >= 0 else -1) * ((abs(code_sum) + 2) >> 2)
    return rha, int((shore_sum + 2) >> 2)


def baked_reader(owner: Tile, corner: tuple[int, int]) -> Tile:
    """A fixture tile on the owner face whose stored texels hold the 8x8 around the corner: the
    owner tile itself when the fixture bakes it, else a neighbor that shares the corner."""
    cs, ct = corner
    for t in [owner, *FIXTURE_TILES]:
        if (t.face, t.level) != (owner.face, owner.level) or t not in FIXTURE_TILES:
            continue
        if 256 * t.x <= cs <= 256 * (t.x + 1) and 256 * t.y <= ct <= 256 * (t.y + 1):
            return t
    raise AssertionError(f"the fixture bakes no tile of face {owner.face} around {corner}")


@pytest.mark.parametrize("tile", [t for t in FIXTURE_TILES if face_edge_sides(t)], ids=Tile.key)
def test_each_entry_is_its_owner_faces_own_mip_corner_mean(built, tile):
    # The owner face's tiles are the L0-L1 tiles, the Kirkuk corner tiles and, for entries a tile's
    # own face owns, the tile itself.
    planes = built(tile)
    for e in face_edge_sides(tile):
        for k, (m, c) in enumerate(zip(ENTRY_MIP.tolist(), ENTRY_CORNER.tolist(), strict=True)):
            owner, owner_edge, owner_k = profile_owner(tile, EDGES[e], c)
            corner = edge_corner(owner, owner_edge, owner_k)
            reader = baked_reader(owner, corner)
            mean, shore = corner_mean(reader, built(reader), corner, m)
            assert planes.profiles[e, k] == mean, (EDGES[e], m, c)
            assert planes.profile_shore[e, k] == shore, (EDGES[e], m, c)


@pytest.mark.parametrize("tile", FIXTURE_TILES, ids=Tile.key)
def test_edge_profiles_agree_at_the_tile_corners_at_every_mip(built, tile):
    sides = face_edge_sides(tile)
    planes = built(tile)
    for m in range(3):
        for values in (mip_entries(planes.profiles, m), mip_entries(planes.profile_shore, m)):
            for a, at_a, b, at_b in ((N, 0, W, -1), (N, -1, E, -1), (S, 0, W, 0), (S, -1, E, 0)):
                if a in sides and b in sides:
                    assert values[a, at_a] == values[b, at_b]


@pytest.mark.parametrize("tile", FIXTURE_TILES, ids=Tile.key)
def test_in_face_sides_store_nothing(built, tile):
    planes = built(tile)
    inside = [e for e in range(4) if e not in face_edge_sides(tile)]
    assert not planes.profiles[inside].any() and not planes.profile_shore[inside].any()


@pytest.mark.parametrize("tile", FIXTURE_TILES, ids=Tile.key)
def test_a_built_tile_centers_its_codes_and_round_trips(built, tile):
    planes = built(tile)
    assert planes.code_mid == (planes.code_min + planes.code_max) // 2
    entries = planes.profiles[list(face_edge_sides(tile))]
    stored = np.concatenate([planes.codes.ravel(), entries.ravel()]).astype(np.int64)
    assert np.abs(stored - planes.code_mid).max() <= MAX_OFFSET
    back = from_file(to_file(planes), tile)
    for plane in ("codes", "shore", "water", "profiles", "profile_shore"):
        np.testing.assert_array_equal(getattr(back, plane), getattr(planes, plane))
    header = ("flags", "q_land", "code_mid", "code_min", "code_max")
    assert [getattr(back, name) for name in header] == [getattr(planes, name) for name in header]


def test_edge_entries_round_half_away_from_zero_over_mips_that_round_half_up(fixture_surface):
    s = fixture_surface(KIRKUK_OWNER)  # its own face owns every entry of its N and E sides
    j, i = np.indices(s.heights.shape)
    codes = 2 + 2 * (i % 2) * (j % 2)  # every 2x2 block of texels sums to 10
    for sign, mip1 in ((1, 3), (-1, -2)):
        profiles, _ = edge_profiles(replace(s, heights=sign * 2.0 * codes), 2.0)
        for e in (N, E):
            # Mip 0: 10 / 4 = 2.5 rounds away from zero, where np.round would round it to even.
            assert (mip_entries(profiles[e], 0) == 3 * sign).all()
            # Mip 1: each texel is (±10 + 2) >> 2, 3 or -2, and four equal texels keep it.
            assert (mip_entries(profiles[e], 1) == mip1).all()
    assert np.round(2.5) == 2 and np.round(-2.5) == -2


def test_shore_entries_round_half_up(fixture_surface):
    s = fixture_surface(KIRKUK_OWNER)
    j, i = np.indices(s.heights.shape)
    shore_d = (i % 2) * (j % 2) / 8  # bytes 128 and 130: every 2x2 block sums to 514
    _, shore = edge_profiles(replace(s, fields=Fields(shore_d, s.fields.water_d)), 2.0)
    assert (shore[[N, E]] == 129).all()  # (514 + 2) >> 2
    assert not shore[[S, W]].any()


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
