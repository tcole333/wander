import math

import numpy as np
import pytest
import shapely

from prebuild.config import load_fixture
from prebuild.cube import TILE, Tile, corner, dir_to_lonlat, st_to_dir
from prebuild.excerpts import (
    DETAIL_LEVEL,
    NEAR_LEVEL,
    WORLD_MIN_PART_DEG2,
    boxes,
    clip_tiers,
    coarsened,
    field_box,
    land_tiers,
    run,
)
from prebuild.gebco import Raster
from prebuild.natural_earth import Layer
from prebuild.profiles import Profile, make_context
from prebuild.sources import SourceUnavailable


def test_block_means_round_half_away_from_zero():
    view = Raster(np.zeros((360, 720), np.float32), 1800, 0, 0)
    # 2x2 blocks with means -2.5, 2.5 and -0.25 above 1.5, 5 and 7.
    view.data[:4, :6] = [
        [-2, -3, 2, 3, 0, -1],
        [-2, -3, 2, 3, 0, 0],
        [1, 2, 5, 5, 7, 7],
        [1, 2, 5, 5, 7, 7],
    ]
    out = coarsened([view], 3600, (0, 0, 3, 2))
    np.testing.assert_array_equal(out.data, [[-3, 3, 0], [2, 5, 7]])
    assert out.data.dtype == np.int16 and out.cell_arcsec == 3600


def test_coarsening_takes_the_coarsest_overview_that_divides_the_cell():
    fine = Raster(np.zeros((360, 720), np.float32), 1800, 0, 0)
    coarse = Raster(np.ones((180, 360), np.float32), 3600, 0, 0)
    assert coarsened([fine, coarse], 3600, (0, 0, 2, 2)).data.tolist() == [[1, 1], [1, 1]]
    assert coarsened([fine, coarse], 5400, (0, 0, 2, 2)).data.tolist() == [[0, 0], [0, 0]]


def test_a_field_box_holds_the_tiles_field_raster():
    tile = Tile(1, 5, 25, 12)
    west, south, east, north = field_box(tile)
    c = np.arange(TILE * 25 - 16, TILE * 26 + 17, 8)
    r = np.arange(TILE * 12 - 16, TILE * 13 + 17, 8)
    s, t = np.meshgrid(corner(5, c), corner(5, r))
    lon, lat = dir_to_lonlat(st_to_dir(1, s, t))
    assert west < lon.min() and lon.max() < east and south < lat.min() and lat.max() < north
    assert all(math.isclose(v * 100, round(v * 100)) for v in (west, south, east, north))


def test_boxes_leave_out_boxes_inside_another():
    fixture = load_fixture()
    near = boxes(fixture, NEAR_LEVEL)
    assert len(near) == 4  # Sumbawa's L2 tile and the three at the Kirkuk corner
    assert len(boxes(fixture, DETAIL_LEVEL)) == 4


def square(x0, y0, size):
    return shapely.box(x0, y0, x0 + size, y0 + size)


def test_land_tiers_simplify_away_from_the_fixture_and_keep_detail_near_it():
    near = square(0, 0, 10)
    detail = square(4, 4, 2)
    holed = shapely.difference(square(4.5, 4.5, 1), square(4.9, 4.9, 0.002))  # a 0.002° lake
    land = Layer(
        np.array([square(20, 20, 0.2), square(30, 30, 2), holed, square(1, 1, 0.05)]),
        {"featurecla": np.array(["Land"] * 4, dtype=object)},
    )
    out = land_tiers(land, near, detail)
    assert out.attrs["tier"].tolist() == ["world", "near", "detail"]
    world, near_piece, detail_piece = out.geoms
    assert shapely.area(square(20, 20, 0.2)) < WORLD_MIN_PART_DEG2
    assert not shapely.intersects(world, square(20, 20, 0.2))  # a small part far away goes
    assert shapely.contains_xy(world, 31, 31)
    assert shapely.contains_xy(near_piece, 1.02, 1.02)  # small parts stay near the fixture
    assert shapely.equals(detail_piece, holed)  # the hole survives in full detail


def test_clipped_tiers_keep_each_features_attributes():
    lakes = Layer(
        np.array([square(1, 1, 1), square(4.5, 4.5, 1), square(50, 50, 1)]),
        {
            "featurecla": np.array(["Lake", "Reservoir", "Lake"], dtype=object),
            "ne_id": np.array([1, 2, 3], dtype=object),
        },
    )
    near, detail = square(0, 0, 10), square(4, 4, 2)
    cuts = [("detail", detail, 0.0), ("near", shapely.difference(near, detail), 0.01)]
    out = clip_tiers(lakes, cuts, 2, ("featurecla", "ne_id"))
    assert out.attrs["ne_id"].tolist() == [2, 1]
    assert out.attrs["tier"].tolist() == ["detail", "near"]
    assert out.attrs["featurecla"].tolist() == ["Reservoir", "Lake"]


def test_the_excerpts_stage_never_runs_under_the_fixture_profile(tmp_path):
    with pytest.raises(SourceUnavailable):
        run(make_context(Profile.FIXTURE, 1, tmp_path))
