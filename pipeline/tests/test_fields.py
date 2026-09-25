import math

import numpy as np
import pytest
import shapely

from prebuild.codes import field_bytes, texel_m
from prebuild.config import WaterConfig, load_fixture, load_water
from prebuild.cube import TILE, Tile, dir_to_lonlat, st_to_dir
from prebuild.excerpts import NEAR_LEVEL, boxes
from prebuild.fields import (
    SUBPIXELS,
    FieldVectors,
    Grid,
    clip_boxes,
    fields,
    fill,
    project,
    river_mask,
    shore_distance,
    signed_distance,
)
from prebuild.footprint import tile_texels
from prebuild.natural_earth import Layer, Vectors, lakes, land, load_vectors, rivers
from prebuild.profiles import Profile, make_context

WATER = WaterConfig(
    half_width_km={rank: 0.1 for rank in range(13)},
    rivers_max_scalerank={0: 2, 1: 2, 2: 4, 3: 6},
    river_classes=("River",),
    lake_classes=("Lake",),
    reservoir_allowlist=frozenset(),
)
SUMBAWA_L6 = Tile(1, 6, 51, 25)
SUMBAWA_WEST = Tile(1, 7, 102, 50)
SUMBAWA_EAST = Tile(1, 7, 103, 50)


def features(geoms, **attrs) -> Layer:
    return Layer(
        np.array(geoms, dtype=object), {k: np.array(v, dtype=object) for k, v in attrs.items()}
    )


def prepared(land_polygons=(), lake_polygons=(), river_lines=(), ranks=(), water=WATER):
    """FieldVectors from raw features, prepared as the loaders prepare Natural Earth."""
    empty_land = features([], featurecla=[])
    return FieldVectors.build(
        Vectors(
            land=land(
                features(list(land_polygons), featurecla=["Land"] * len(land_polygons))
                if land_polygons
                else empty_land,
                None,
            ),
            lakes=lakes(
                features(
                    list(lake_polygons),
                    featurecla=["Lake"] * len(lake_polygons),
                    ne_id=list(range(len(lake_polygons))),
                ),
                water,
            ),
            rivers=rivers(
                features(
                    list(river_lines),
                    featurecla=["River"] * len(river_lines),
                    scalerank=list(ranks),
                ),
                water,
            ),
        ),
        water,
    )


def texel_point(face: int, level: int, x: float, y: float) -> tuple[float, float]:
    """Lon/lat of the face-global texel-corner position (x, y), in texels."""
    s, t = -1 + x / (128 << level), -1 + y / (128 << level)
    lon, lat = dir_to_lonlat(st_to_dir(face, s, t))
    return float(lon), float(lat)


def texel_polygon(face: int, level: int, points) -> shapely.Polygon:
    return shapely.Polygon([texel_point(face, level, x, y) for x, y in points])


def disc(face: int, level: int, cx: float, cy: float, radius: float) -> shapely.Polygon:
    angles = np.linspace(0, 2 * math.pi, 2048, endpoint=False)
    return texel_polygon(
        face, level, zip(cx + radius * np.cos(angles), cy + radius * np.sin(angles), strict=True)
    )


def texel_centers(tile: Tile) -> tuple[np.ndarray, np.ndarray]:
    """Face-global texel coordinates (corner units) of the tile's 264² texel centers."""
    _, _, rows, cols = tile_texels(tile)
    return np.meshgrid(np.array(cols) + 0.5, np.array(rows) + 0.5)


@pytest.fixture(scope="module")
def excerpt_vectors() -> FieldVectors:
    water = load_water()
    return FieldVectors.build(load_vectors(make_context(Profile.FIXTURE, 1), water), water)


def test_a_disc_matches_the_analytic_distance_within_a_quarter_texel():
    tile = SUMBAWA_L6
    cx, cy = TILE * tile.x + 128.3, TILE * tile.y + 120.7
    vectors = prepared(land_polygons=[disc(1, 6, cx, cy, 40.2)], lake_polygons=[])
    shore = fields(*tile_texels(tile), vectors).shore_d
    x, y = texel_centers(tile)
    analytic = 40.2 - np.hypot(x - cx, y - cy)
    near = np.abs(analytic) < 8
    assert near.sum() > 3000
    assert np.abs(shore - analytic)[near].max() < 0.25


def test_land_is_positive_and_water_inside_is_negative():
    tile = SUMBAWA_L6
    cx, cy = TILE * tile.x + 60.0, TILE * tile.y + 60.0
    vectors = prepared(
        land_polygons=[disc(1, 6, cx, cy, 30.0)], lake_polygons=[disc(1, 6, cx, cy, 10.0)]
    )
    f = fields(*tile_texels(tile), vectors)
    x, y = texel_centers(tile)
    r = np.hypot(x - cx, y - cy)
    assert (f.shore_d[r < 25] > 0).all() and (f.shore_d[r > 35] < 0).all()
    assert (f.water_d[r < 5] < 0).all() and (f.water_d[r > 15] > 0).all()
    assert field_bytes(f.water_d[r < 1]).max() < 128 and field_bytes(f.shore_d[r < 1]).min() > 128


def test_one_class_gives_infinite_distances_and_extreme_bytes():
    everywhere = shapely.box(110.0, -15.0, 125.0, -2.0)
    covered = fields(*tile_texels(SUMBAWA_L6), prepared(land_polygons=[everywhere]))
    assert (covered.shore_d == np.inf).all() and (field_bytes(covered.shore_d) == 255).all()
    assert (covered.water_d == np.inf).all() and (field_bytes(covered.water_d) == 255).all()
    open_sea = fields(*tile_texels(SUMBAWA_L6), prepared(lake_polygons=[everywhere]))
    assert (open_sea.shore_d == -np.inf).all() and (field_bytes(open_sea.shore_d) == 0).all()
    assert (open_sea.water_d == -np.inf).all() and (field_bytes(open_sea.water_d) == 0).all()


def test_long_segments_give_neighbors_the_same_border_texels():
    # A coast whose source edges are 0.5° long zigzags across the shared edge of two L5 tiles
    # and closes far to the south, so each tile clips it differently.
    west, east = Tile(1, 5, 25, 12), Tile(1, 5, 26, 12)
    lon, lat = texel_point(1, 5, TILE * 26, TILE * 12.5)
    zigzag = [(lon - 1.5 + 0.35 * k, lat + (0.35 if k % 2 else -0.35)) for k in range(10)]
    coast = shapely.Polygon([*zigzag, (lon + 3.0, lat - 6.0), (lon - 3.0, lat - 6.0)])
    assert max(shapely.length(shapely.LineString(zigzag[k : k + 2])) for k in range(9)) > 0.49
    vectors = prepared(land_polygons=[coast])
    a = fields(*tile_texels(west), vectors).shore_d
    b = fields(*tile_texels(east), vectors).shore_d
    # West's texels i = 252..259 are east's i = -4..3.
    np.testing.assert_array_equal(field_bytes(a[:, 256:]), field_bytes(b[:, :8]))
    reach = np.abs(a[:, 256:]) <= 8
    assert reach.sum() > 100
    np.testing.assert_array_equal(a[:, 256:][reach], b[:, :8][reach])


def test_a_bay_drawn_over_its_lake_stays_water():
    tile = SUMBAWA_L6
    cx, cy = TILE * tile.x + 128.0, TILE * tile.y + 128.0
    lake = disc(1, 6, cx, cy, 80.0)
    bay = disc(1, 6, cx + 20, cy, 15.0)
    vectors = prepared(land_polygons=[disc(1, 6, cx, cy, 120.0)], lake_polygons=[lake, bay])
    water = fields(*tile_texels(tile), vectors).water_d
    x, y = texel_centers(tile)
    assert (water[np.hypot(x - cx - 20, y - cy) < 12] < 0).all()


def test_a_strip_equals_the_same_texels_inside_a_tile(excerpt_vectors):
    # Two rows across the Sumbawa coast, rasterized on their own with the same 12-texel margin.
    tile = SUMBAWA_EAST
    face, level, rows, cols = tile_texels(tile)
    whole = fields(face, level, rows, cols, excerpt_vectors)
    strip_rows = range(rows.start + 100, rows.start + 102)
    strip_cols = range(cols.start + 30, cols.start + 230)
    strip = fields(face, level, strip_rows, strip_cols, excerpt_vectors)
    inside = (slice(100, 102), slice(30, 230))
    for name in ("shore_d", "water_d"):
        mine, theirs = getattr(strip, name), getattr(whole, name)[inside]
        np.testing.assert_array_equal(field_bytes(mine), field_bytes(theirs))
        reach = np.abs(theirs) <= 8
        np.testing.assert_array_equal(mine[reach], theirs[reach])
    assert (np.abs(strip.shore_d) <= 2).any()  # the strip crosses the coast
    np.testing.assert_array_equal(
        shore_distance(face, level, strip_rows, strip_cols, excerpt_vectors), strip.shore_d
    )


def test_fields_depend_only_on_position(excerpt_vectors):
    west = fields(*tile_texels(SUMBAWA_WEST), excerpt_vectors)
    east = fields(*tile_texels(SUMBAWA_EAST), excerpt_vectors)
    for name in ("shore_d", "water_d"):
        a, b = getattr(west, name)[:, 256:], getattr(east, name)[:, :8]
        np.testing.assert_array_equal(field_bytes(a), field_bytes(b))
        reach = np.abs(a) <= 8
        np.testing.assert_array_equal(a[reach], b[reach])
    assert (np.abs(west.shore_d[:, 256:]) <= 8).sum() > 100  # the shared texels cross the coast


def test_each_level_draws_rivers_up_to_its_scalerank():
    # A river through the center of 2/1/3/1, which is the corner of four of its L3 children.
    lon, lat = texel_point(1, 2, TILE * 3.5, TILE * 1.5)
    line = shapely.LineString([(lon - 3, lat - 1), (lon + 3, lat + 1)])

    def drawn(rank: int, tile: Tile) -> bool:
        vectors = prepared(river_lines=[line], ranks=[rank])
        return bool((fields(*tile_texels(tile), vectors).water_d < 0).any())

    assert drawn(4, Tile(1, 2, 3, 1)) and not drawn(5, Tile(1, 2, 3, 1))
    assert drawn(6, Tile(1, 3, 7, 3)) and not drawn(7, Tile(1, 3, 7, 3))
    assert drawn(12, Tile(1, 4, 14, 6))


def test_river_level_filter_follows_rivers_max_scalerank():
    vectors = prepared()
    assert [vectors.max_river_rank(level) for level in range(6)] == [2, 2, 4, 6, 12, 12]


def test_a_river_draws_at_its_half_width():
    # halfWidthKm 3 at L4 is 3 km / 2.453 km = 1.22 texels; a narrow one takes the 0.35 floor.
    level, tile = 4, Tile(1, 4, 12, 6)
    water = WaterConfig(
        half_width_km={rank: (3.0 if rank == 0 else 0.01) for rank in range(13)},
        rivers_max_scalerank={},
        river_classes=("River",),
        lake_classes=("Lake",),
        reservoir_allowlist=frozenset(),
    )
    lon, lat = texel_point(1, level, TILE * 12.5, TILE * 6.5)
    for rank, half in ((0, 3.0 / (texel_m(level) / 1000)), (1, 0.35)):
        line = shapely.LineString([(lon - 2, lat - 0.5), (lon + 2, lat + 0.5)])
        vectors = prepared(river_lines=[line], ranks=[rank], water=water)
        assert vectors.river_radius_texels(level, [rank])[0] == pytest.approx(half)
        d = fields(*tile_texels(tile), vectors).water_d
        x, y = texel_centers(tile)
        coords = shapely.get_coordinates(shapely.segmentize(line, 0.1))
        px, py = project(coords[:, 0], coords[:, 1], 1, level)
        centerline = shapely.LineString(np.column_stack([(px + 0.5) / 4, (py + 0.5) / 4]))
        away = shapely.distance(shapely.points(x.ravel(), y.ravel()), centerline).reshape(x.shape)
        analytic = away - half
        near = np.abs(analytic) < 4
        assert np.abs(d - analytic)[near].max() < 0.3


def test_the_fill_is_even_odd_over_every_ring():
    grid = Grid(face=1, level=5, b0=100, a0=200, height=90, width=120)
    shell = [(190.3, 95.1), (330.7, 120.2), (300.2, 199.9), (210.4, 180.6)]
    hole = [(240.2, 130.3), (270.6, 128.9), (260.1, 160.4)]
    polygon = shapely.Polygon(shell, [hole])
    segments = []
    for ring in (shell, hole):
        closed = np.array([*ring, ring[0]])
        segments.append((closed[:-1, 0], closed[:-1, 1], closed[1:, 0], closed[1:, 1]))
    joined = tuple(np.concatenate([s[k] for s in segments]) for k in range(4))
    a, b = np.meshgrid(np.arange(200, 320), np.arange(100, 190))
    np.testing.assert_array_equal(fill(joined, grid), shapely.contains_xy(polygon, a, b))
    reversed_rings = (joined[2], joined[3], joined[0], joined[1])
    np.testing.assert_array_equal(fill(reversed_rings, grid), fill(joined, grid))


def test_the_river_test_is_an_exact_point_to_segment_distance():
    grid = Grid(face=1, level=5, b0=0, a0=0, height=60, width=80)
    rng = np.random.default_rng(5)
    ends = rng.uniform(-5, 85, (12, 4))
    radius = rng.uniform(0.5, 4.0, 12)
    segments = (ends[:, 0], ends[:, 1], ends[:, 2], ends[:, 3])
    mask = river_mask(segments, radius, grid)
    a, b = np.meshgrid(np.arange(80), np.arange(60))
    points = shapely.points(a.ravel(), b.ravel())
    expected = np.zeros(a.size, dtype=bool)
    for k in range(12):
        line = shapely.LineString([ends[k, :2], ends[k, 2:]])
        expected |= shapely.distance(points, line) <= radius[k]
    np.testing.assert_array_equal(mask.ravel(), expected)
    flipped = (ends[:, 2], ends[:, 3], ends[:, 0], ends[:, 1])
    np.testing.assert_array_equal(river_mask(flipped, radius, grid), mask)


def test_signed_distance_is_half_a_subpixel_off_the_boundary():
    mask = np.zeros((5, 7), dtype=bool)
    mask[:, 3:] = True
    d = signed_distance(mask)
    assert d[2].tolist() == [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]


def test_clip_boxes_split_at_the_dateline_and_open_around_a_pole():
    dateline = clip_boxes(Grid.around(*tile_texels(Tile(2, 1, 0, 1))), 1.0)
    assert len(dateline) == 2
    assert dateline[0][2] == 180.0 and dateline[1][0] == -180.0
    north = clip_boxes(Grid.around(*tile_texels(Tile(4, 2, 1, 2))), 1.0)
    assert len(north) == 1 and north[0][0] == -180 and north[0][2] == 180 and north[0][3] == 90
    south = clip_boxes(Grid.around(*tile_texels(Tile(5, 0, 0, 0))), 1.0)
    assert south == [(-180.0, -90.0, 180.0, south[0][3])]


def test_a_clip_box_pads_the_raster_by_a_tenth_of_a_degree_and_the_widest_river():
    grid = Grid.around(*tile_texels(SUMBAWA_EAST))
    ((west, south, east, north),) = clip_boxes(grid, 2.0)
    scale = (SUBPIXELS * TILE // 2) << grid.level
    s = -1 + np.array([grid.a0, grid.a0 + grid.width]) / scale
    t = -1 + np.array([grid.b0, grid.b0 + grid.height]) / scale
    lon, lat = dir_to_lonlat(st_to_dir(1, s[None, :], t[:, None]))
    assert west < lon.min() - 0.1 - 2.0 / 111.2 and east > lon.max() + 0.1 + 2.0 / 111.2
    assert south < lat.min() - 0.1 - 2.0 / 111.2 and north > lat.max() + 0.1 + 2.0 / 111.2


def test_the_ne_excerpts_hold_what_each_fixture_tile_clips():
    # Lakes and rivers are cut only around the fixture's L2-L7 tiles, and land in its finer tiers
    # there, so every clip box of those tiles must lie inside one of the excerpt's boxes.
    fixture = load_fixture()
    water = load_water()
    vectors = prepared(water=water)
    near = boxes(fixture, NEAR_LEVEL)
    for tile in fixture.tiles:
        if tile.level < NEAR_LEVEL:
            continue
        grid = Grid.around(*tile_texels(tile))
        for west, south, east, north in clip_boxes(grid, vectors.widest_river_km(tile.level)):
            assert any(
                w <= west and s <= south and east <= e and north <= n for w, s, e, n in near
            ), tile.key()
