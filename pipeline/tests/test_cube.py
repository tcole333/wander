import itertools
import re
from fractions import Fraction

import numpy as np
import pytest

from prebuild.cube import (
    EDGES,
    FACE_EDGES,
    FACES,
    TILE,
    Neighbor,
    Tile,
    avail_get,
    avail_set,
    corner,
    dir_to_lonlat,
    face_of,
    face_st,
    lonlat_to_dir,
    neighbor,
    node_count,
    node_from_index,
    node_index,
    parse_tile_key,
    profile_owner,
    st_to_dir,
    subpixel_center,
    subsample,
    texel_center,
    texel_of,
    tile_of,
    to_three,
)
from prebuild.paths import REPO_ROOT

DESIGN_DOC = (REPO_ROOT / "docs" / "design" / "streaming.md").read_text(encoding="utf-8")
LEVELS = range(8)


def random_directions(count: int, seed: int) -> np.ndarray:
    p = np.random.default_rng(seed).normal(size=(count, 3))
    return p / np.linalg.norm(p, axis=-1, keepdims=True)


def all_tiles(max_level: int):
    for level in range(max_level + 1):
        side = 1 << level
        for face, y, x in itertools.product(range(6), range(side), range(side)):
            yield Tile(face, level, x, y)


def edge_tiles(face: int, edge: str, level: int) -> list[Tile]:
    last = (1 << level) - 1
    along = range(last + 1)
    match edge:
        case "N":
            return [Tile(face, level, a, last) for a in along]
        case "S":
            return [Tile(face, level, a, 0) for a in along]
        case "E":
            return [Tile(face, level, last, a) for a in along]
        case _:
            return [Tile(face, level, 0, a) for a in along]


def edge_point(edge: str, along: np.ndarray, across: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(s-like, t-like) values: N and S edges run along s, E and W along t."""
    return (along, across) if edge in ("N", "S") else (across, along)


# Face frames and projection


@pytest.mark.parametrize("face", range(6))
def test_face_frames_are_orthonormal(face):
    frame = FACES[face]
    assert np.array_equal(frame @ frame.T, np.eye(3))


@pytest.mark.parametrize("face", range(6))
def test_u_cross_v_is_the_face_center(face):
    c, u, v = FACES[face]
    assert np.array_equal(np.cross(u, v), c)


def test_lonlat_round_trips_through_a_direction():
    rng = np.random.default_rng(1)
    lon = rng.uniform(-180, 180, 100_000)
    lat = np.degrees(np.arcsin(rng.uniform(-1, 1, 100_000)))
    lon2, lat2 = dir_to_lonlat(lonlat_to_dir(lon, lat))
    assert np.max(np.abs((lon2 - lon + 180) % 360 - 180)) <= 1e-12
    assert np.max(np.abs(lat2 - lat)) <= 1e-12


def test_directions_round_trip_through_face_st():
    p = random_directions(100_000, seed=2)
    face = face_of(p)
    s, t = face_st(face, p)
    assert np.max(np.abs(st_to_dir(face, s, t) - p)) <= 1e-12


def test_face_st_round_trips_through_a_direction():
    rng = np.random.default_rng(3)
    face = rng.integers(0, 6, 100_000)
    s, t = rng.uniform(-1, 1, (2, 100_000))
    s2, t2 = face_st(face, st_to_dir(face, s, t))
    assert max(np.max(np.abs(s2 - s)), np.max(np.abs(t2 - t))) <= 1e-12


def test_points_inside_a_face_belong_to_it():
    rng = np.random.default_rng(4)
    face = rng.integers(0, 6, 100_000)
    s, t = rng.uniform(-0.999999, 0.999999, (2, 100_000))
    assert np.array_equal(face_of(st_to_dir(face, s, t)), face)


@pytest.mark.parametrize(
    ("p", "face"),
    [
        ((1, 1, 0), 0),
        ((-1, 1, 0), 1),
        ((1, 1, 1), 0),
        ((-1, -1, 0), 2),
        ((0, -1, -1), 3),
        ((0, 1, 1), 1),
        ((-1, 0, 1), 2),
        ((0, 0, -1), 5),
    ],
)
def test_face_ties_go_to_the_lowest_face(p, face):
    assert face_of(np.array(p, dtype=np.float64)) == face


def test_to_three_puts_north_up_and_longitude_zero_toward_z():
    g = np.eye(3)  # +X (0N 0E), +Y (0N 90E), +Z (north pole)
    assert to_three(g).tolist() == [[0, 0, 1], [1, 0, 0], [0, 1, 0]]


# Exact positions


@pytest.mark.parametrize("level", LEVELS)
def test_positions_are_exact_binary_fractions(level):
    n = 1 << level
    g = np.arange(-4, 256 * n + 4, max(1, n // 8))
    a = np.arange(-16, 1024 * n + 16, max(1, n // 2))
    c = np.arange(0, 256 * n + 1, max(1, n // 8))
    assert [Fraction(v) for v in texel_center(level, g)] == [
        -1 + Fraction(2 * int(v) + 1, 256 * n) for v in g
    ]
    for sub in range(4):
        assert [Fraction(v) for v in subsample(level, g, sub)] == [
            -1 + Fraction(8 * int(v) + 2 * sub + 1, 1024 * n) for v in g
        ]
    assert [Fraction(v) for v in corner(level, c)] == [-1 + Fraction(int(v), 128 * n) for v in c]
    assert [Fraction(v) for v in subpixel_center(level, a)] == [
        -1 + Fraction(2 * int(v) + 1, 1024 * n) for v in a
    ]


def test_subsamples_are_the_subpixel_centers():
    g = np.arange(-4, 260)
    for sub in range(4):
        assert np.array_equal(subsample(5, g, sub), subpixel_center(5, 4 * g + sub))


@pytest.mark.parametrize("level", LEVELS)
def test_border_texels_equal_the_next_tiles_interior(level):
    n = 1 << level
    for x in range(n - 1):
        next_s0 = -1 + Fraction(2 * (x + 1), n)  # where tile x + 1 starts (streaming.md 3.0)
        border = texel_center(level, TILE * x + np.arange(256, 260))
        assert [Fraction(v) for v in border] == [
            next_s0 + Fraction(2 * k + 1, 256 * n) for k in range(4)
        ]
        assert Fraction(corner(level, TILE * x + 256)) == next_s0


def test_positions_reject_non_integer_indices():
    with pytest.raises(TypeError):
        texel_center(3, 1.5)


# Tiles, texels and keys


@pytest.mark.parametrize("level", LEVELS)
def test_tile_and_texel_of_a_texel_center(level):
    n = 1 << level
    g = np.arange(256 * n)
    s = texel_center(level, g)
    x = tile_of(s, level)
    assert np.array_equal(x, g // 256)
    assert np.array_equal(texel_of(s, level, x), g % 256)


def test_tile_and_texel_clamp_to_the_face_and_tile():
    assert tile_of(np.array([-1.0, 1.0, 1.0 + 1e-15]), 3).tolist() == [0, 7, 7]
    assert texel_of(np.array([-1.0, 1.0]), 3, 7).tolist() == [0, 255]


def test_node_index_is_a_bijection_through_level_7():
    tiles = list(all_tiles(7))
    assert len(tiles) == node_count(7) == 131_070
    assert [node_index(t) for t in tiles] == list(range(131_070))
    assert all(node_from_index(k) == t for k, t in enumerate(tiles))


def test_node_index_of_the_sumbawa_l7_tile():
    assert node_index(Tile(1, 7, 103, 50)) == 55_653


def test_tile_keys_round_trip():
    for t in all_tiles(3):
        assert parse_tile_key(t.key()) == t


@pytest.mark.parametrize("key", ["1/6/0/0", "1/0/2/0", "0/0/0", "01/0/0/0", "1/0/0/0 ", "a/b/c/d"])
def test_parse_tile_key_rejects_what_is_not_a_tile(key):
    with pytest.raises(ValueError):
        parse_tile_key(key)


def test_parent_halves_the_tile_indices():
    assert Tile(1, 7, 103, 50).parent() == Tile(1, 6, 51, 25)
    with pytest.raises(ValueError):
        Tile(0, 0, 0, 0).parent()


def test_availability_bits_are_least_significant_first():
    bitmap = bytearray(2)
    avail_set(bitmap, 0)
    avail_set(bitmap, 9)
    assert bitmap == b"\x01\x02"
    assert [avail_get(bitmap, k) for k in range(16)] == [k in (0, 9) for k in range(16)]


# The face-edge table


def test_face_edge_table_matches_the_design_doc():
    section = DESIGN_DOC.split("Across a face edge, each face meets this neighbor edge:")[1]
    rows = re.findall(r"^\s*\| (\d) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$", section, re.M)
    documented = {}
    for face, *cells in rows[:6]:
        for edge, cell in zip(EDGES, cells, strict=True):
            match = re.fullmatch(r"(\d) ([NESW])(, rev)?", cell.strip())
            assert match, cell
            documented[(int(face), edge)] = (int(match[1]), match[2], match[3] is not None)
    assert documented == FACE_EDGES


def test_face_edge_table_is_symmetric():
    for (face, edge), (other, facing, reverse) in FACE_EDGES.items():
        assert FACE_EDGES[(other, facing)] == (face, edge, reverse)


def test_face_edge_table_lists_twelve_edges_four_reversed():
    edges = {frozenset({(f, e), FACE_EDGES[(f, e)][:2]}) for f, e in FACE_EDGES}
    assert len(edges) == 12
    assert sum(reverse for *_, reverse in FACE_EDGES.values()) == 8


@pytest.mark.parametrize(("face", "edge"), list(FACE_EDGES))
def test_face_edge_table_matches_geometry(face, edge):
    level = 3
    full = TILE << level
    other, facing, reverse = FACE_EDGES[(face, edge)]
    along = np.arange(full + 1)
    across = np.full_like(along, full if edge in ("N", "E") else 0)
    s, t = (corner(level, v) for v in edge_point(edge, along, across))
    s2, t2 = face_st(other, st_to_dir(face, s, t))
    mapped = full - along if reverse else along
    expected_across = np.full_like(along, full if facing in ("N", "E") else 0)
    es, et = (corner(level, v) for v in edge_point(facing, mapped, expected_across))
    assert np.max(np.abs(s2 - es)) <= 1e-12
    assert np.max(np.abs(t2 - et)) <= 1e-12


@pytest.mark.parametrize("level", LEVELS)
@pytest.mark.parametrize(("face", "edge"), list(FACE_EDGES))
def test_border_texels_map_into_the_neighbors_column(level, face, edge):
    """Border texel 256 + k past a face edge lands in the neighbor's texel column k."""
    full = TILE << level
    other, facing, reverse = FACE_EDGES[(face, edge)]
    along = np.arange(-4, full + 4)
    for k in range(4):
        across = np.full_like(along, full + k if edge in ("N", "E") else -1 - k)
        s, t = (texel_center(level, v) for v in edge_point(edge, along, across))
        s2, t2 = face_st(other, st_to_dir(face, s, t))
        gs, gt = (np.floor((v + 1) * (full / 2)).astype(np.int64) for v in (s2, t2))
        got_along, got_across = edge_point(facing, gs, gt)
        assert np.all(got_across == (full - 1 - k if facing in ("N", "E") else k))
        mapped = full - 1 - along if reverse else along
        assert np.max(np.abs(got_along - mapped)) <= 4


# Neighbors and edge-profile owners


def test_neighbors_are_mutual():
    for t in all_tiles(3):
        for edge in EDGES:
            across = neighbor(t, edge)
            assert neighbor(across.tile, across.edge) == Neighbor(t, edge, across.reversed)


@pytest.mark.parametrize("level", LEVELS)
def test_neighbors_at_the_kirkuk_corner(level):
    last = (1 << level) - 1
    assert neighbor(Tile(0, level, last, last), "E") == Neighbor(
        Tile(1, level, 0, last), "W", False
    )
    assert neighbor(Tile(0, level, last, last), "N") == Neighbor(
        Tile(4, level, last, 0), "S", False
    )
    assert neighbor(Tile(1, level, 0, last), "N") == Neighbor(Tile(4, level, last, 0), "E", False)


@pytest.mark.parametrize("level", LEVELS)
def test_profile_owner_at_the_kirkuk_vertex_is_face_0_from_all_three_faces(level):
    last = (1 << level) - 1
    asks = [
        (Tile(0, level, last, last), "N", 256),
        (Tile(0, level, last, last), "E", 256),
        (Tile(1, level, 0, last), "N", 0),
        (Tile(1, level, 0, last), "W", 256),
        (Tile(4, level, last, 0), "S", 256),
        (Tile(4, level, last, 0), "E", 0),
    ]
    owners = {profile_owner(*ask) for ask in asks}
    assert owners == {(Tile(0, level, last, last), "N", 256)}


@pytest.mark.parametrize(("face", "edge"), list(FACE_EDGES))
def test_profile_owner_on_a_face_edge_is_the_lower_face_and_agrees_across_it(face, edge):
    level = 2
    for t in edge_tiles(face, edge, level):
        across = neighbor(t, edge)
        for k in range(TILE + 1):
            owner = profile_owner(t, edge, k)
            k2 = TILE - k if across.reversed else k
            assert profile_owner(across.tile, across.edge, k2) == owner
            if 0 < k < TILE:
                assert owner[0].face == min(face, across.tile.face)


def test_profile_owner_inside_a_face_is_the_face_itself():
    t = Tile(1, 7, 103, 50)
    for edge in EDGES:
        across = neighbor(t, edge)
        for k in range(TILE + 1):
            owner = profile_owner(t, edge, k)
            assert owner[0].face == 1
            assert profile_owner(across.tile, across.edge, k) == owner


def edge_entry_corner(t: Tile, edge: str, k: int) -> tuple[int, int]:
    """Face-global texel corner (cs, ct) of entry k: N and S edges run along s, E and W along t."""
    x0, y0 = TILE * t.x, TILE * t.y
    match edge:
        case "N":
            return x0 + k, y0 + TILE
        case "E":
            return x0 + TILE, y0 + k
        case "S":
            return x0 + k, y0
        case _:
            return x0, y0 + k


def corner_directions(level: int, corners: list[tuple[int, int, int]]) -> np.ndarray:
    face, cs, ct = np.array(corners).T
    return st_to_dir(face, corner(level, cs), corner(level, ct))


@pytest.mark.parametrize("level", range(4))
def test_profile_owner_addresses_the_same_point_as_the_asked_entry(level):
    side = 1 << level
    asked, owned = [], []
    for face, x, y, edge in itertools.product(range(6), range(side), range(side), EDGES):
        t = Tile(face, level, x, y)
        for k in [*range(0, TILE + 1, 8), 1, TILE - 1]:
            owner, owner_edge, owner_k = profile_owner(t, edge, k)
            assert 0 <= owner_k <= TILE, (t, edge, k)
            asked.append((face, *edge_entry_corner(t, edge, k)))
            owned.append((owner.face, *edge_entry_corner(owner, owner_edge, owner_k)))
    gap = corner_directions(level, asked) - corner_directions(level, owned)
    assert np.max(np.abs(gap)) <= 1e-12


@pytest.mark.parametrize(
    ("ask", "owner"),
    [
        ((Tile(1, 7, 103, 50), "W", 1), (Tile(1, 7, 103, 50), "W", 1)),
        ((Tile(1, 7, 103, 50), "E", 1), (Tile(1, 7, 104, 50), "W", 1)),
        ((Tile(0, 1, 0, 0), "E", 1), (Tile(0, 1, 1, 0), "W", 1)),
        ((Tile(1, 2, 0, 0), "W", 128), (Tile(0, 2, 3, 0), "E", 128)),
    ],
)
def test_profile_owner_of_an_entry_along_an_east_or_west_edge(ask, owner):
    assert profile_owner(*ask) == owner


def test_profile_owner_rejects_an_entry_off_the_edge():
    with pytest.raises(ValueError):
        profile_owner(Tile(0, 1, 0, 0), "N", 257)
