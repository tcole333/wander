import dataclasses
import gzip

import numpy as np
import pytest
import shapely

from prebuild import cliopatria as clio
from prebuild import step_fields

TEXELS = 64  # a small face: 56 texels across it and a 4-texel apron, 1.6° a texel at its center
EQUATOR = 32  # the row just north of the equator on face 0
IDS = {"": 1, "(Empire)": 2, "County": 3, "Duchy": 4, "West": 5}


def box(west, south, east, north):
    return shapely.box(west, south, east, north)


def part(name, outer, shape, minor=False):
    return clio.Part(name, outer, minor, shapely.multipolygons([shape]))


def selection(parts, stateless=None, pockets=None, holes=()):
    empty = shapely.MultiPolygon()
    state = empty if stateless is None else shapely.multipolygons([stateless])
    given = empty if pockets is None else shapely.multipolygons([pockets])
    inside = tuple((unit, shapely.multipolygons([hole])) for unit, hole in holes)
    return clio.Selection(1815, tuple(parts), state, frozenset(), (), {}, given, inside)


# On face 0, from west to east along the equator: stateless land (30° W to 20° W), West (to the
# prime meridian), then Duchy and County, members of one empire, with sea past 20° E.
LAND = box(-30, -10, 20, 10)
PARTS = [
    part("West", "West", box(-20, -10, 0, 10)),
    part("Duchy", "(Empire)", box(0, -10, 10, 10)),
    part("County", "(Empire)", box(10, -10, 20, 10)),
]
STATELESS = box(-30, -10, -20, 10)


def column(lon: float) -> float:
    """The stored texel column holding a longitude on face 0's equator."""
    s = lon / 45
    return (s + 1) / 2 * (TEXELS - 2 * step_fields.APRON) + step_fields.APRON


def planes(chosen, ids=IDS, land=LAND):
    raster = step_fields.step_raster(chosen, ids)
    dry = step_fields.face_dry(0, land, TEXELS)
    stored = step_fields.face_planes(0, raster, dry, np.zeros_like(dry), 0, TEXELS)
    r = stored[..., 0].astype(np.float64) / 16 - 8
    g = (stored[..., 1] & 127).astype(np.float64) / 8 - 8
    soft = stored[..., 1] >= 128
    return stored, r, g, soft


@pytest.fixture(scope="module")
def face0():
    return planes(selection(PARTS, STATELESS))


def test_outer_borders_draw_in_r_signed_on_the_higher_outer_id(face0):
    _, r, g, _ = face0
    row = r[EQUATOR]
    west, east = int(column(-0.1)), int(column(0.1))
    assert row[west] == pytest.approx(0.5, abs=1 / 16)  # West, id 5, is higher than (Empire), 2
    assert row[east] == pytest.approx(-0.5, abs=1 / 16)
    assert abs(g[EQUATOR, west]) >= 4 and abs(g[EQUATOR, east]) >= 4


def test_borders_inside_an_outer_unit_draw_in_g_and_r_keeps_its_sign_across_them(face0):
    _, r, g, _ = face0
    border = int(column(10))
    assert abs(g[EQUATOR, border]) < 1
    assert g[EQUATOR, border - 2] > 0  # Duchy, 4, is higher than County, 3
    assert g[EQUATOR, border + 2] < 0
    empire = slice(int(column(0.1)), int(column(19)))
    assert np.all(r[EQUATOR, empire] < 0)


def test_edges_against_stateless_land_draw_in_r_and_are_soft(face0):
    _, r, _, soft = face0
    edge = int(column(-20))
    assert abs(r[EQUATOR, edge]) < 1
    assert soft[EQUATOR, edge - 2 : edge + 3].all()
    assert not soft[EQUATOR, int(column(-0.1)) : int(column(0.1)) + 1].any()


def test_no_border_follows_a_coast(face0):
    _, r, g, _ = face0
    coast = int(column(20))
    assert np.all(np.abs(r[EQUATOR, coast - 1 : coast + 3]) > 3)
    assert np.all(np.abs(g[EQUATOR, coast - 1 : coast + 3]) > 3)


def test_a_strip_of_the_far_shore_is_filled_so_the_border_crosses_the_lake():
    # East's shape reaches over the lake onto a 1° strip of its west shore, as a coarse source
    # draws it; the strip lies within reach of the lake and of West, so the fill takes it.
    lake = box(-5, -8, 5, 8)
    land = shapely.difference(box(-30, -10, 30, 10), lake)
    chosen = selection(
        [part("West", "West", box(-30, -10, -6, 10)), part("East", "East", box(-6, -10, 30, 10))]
    )
    raster = step_fields.step_raster(chosen, {"": 1, "East": 2, "West": 3})
    dry = step_fields.face_dry(0, land, TEXELS)
    _, beside = step_fields.lake_masks(0, lake, TEXELS, 4)

    def crossing(reach):
        stored = step_fields.face_planes(0, raster, dry, beside, reach, TEXELS)
        row = stored[EQUATOR, :, 0].astype(np.float64) / 16 - 8
        [column] = np.flatnonzero(np.diff(row > 0))
        return column

    assert crossing(0) < column(-5)  # along the west shore
    assert crossing(4) > column(-4)  # across the lake


def test_a_pocket_takes_its_polity_though_stateless_land_lies_nearer_across_a_lake():
    # West's pocket, 16° to 6° W, runs to a lake whose far shore is stateless: the pocket's east is
    # nearer that shore than West's land, so the nearest id would split it at 10° W, but it goes
    # to West, and the border runs by the lake, within the texel of its west shore.
    lake = box(-6, -8, -4, 8)
    land = shapely.difference(box(-30, -10, 0, 10), lake)
    pocket = box(-16, -10, -6, 10)
    chosen = selection(
        [part("West", "West", box(-30, -10, -16, 10))],
        stateless=box(-4, -10, 0, 10),
        pockets=pocket,
    )
    _, r, _, _ = planes(chosen, land=land)
    row = r[EQUATOR]
    [crossing] = np.flatnonzero(np.diff(row > 0))
    assert column(-7) < crossing < column(-4)


# West's hole, 16° to 6° W, runs to a lake whose far shore is East's: the hole's east is nearer
# East's land than West's, so the nearest polity would split it at 10° W, but it is all West's.
HOLE_LAKE = box(-6, -8, -4, 8)
HOLE_LAND = shapely.difference(box(-30, -10, 0, 10), HOLE_LAKE)
HOLE = selection(
    [part("West", "West", box(-30, -10, -16, 10)), part("East", "East", box(-4, -10, 0, 10))],
    holes=[("West", box(-16, -10, -6, 10))],
)


def test_a_hole_inside_one_state_is_its_land_though_another_state_lies_nearer_across_a_lake():
    _, r, _, _ = planes(HOLE, IDS | {"East": 6}, HOLE_LAND)
    [crossing] = np.flatnonzero(np.diff(r[EQUATOR] > 0))
    assert column(-7) < crossing < column(-4)  # through the lake, not at 10° W


def test_a_hole_among_an_empires_members_goes_to_the_member_nearest_each_part():
    chosen = selection(
        [
            part("Duchy", "(Empire)", box(0, -10, 5, 10)),
            part("County", "(Empire)", box(15, -10, 20, 10)),
        ],
        holes=[("(Empire)", box(5, -10, 15, 10))],
    )
    _, r, g, _ = planes(chosen, land=box(0, -10, 20, 10))
    assert abs(g[EQUATOR, int(column(10))]) < 1
    assert np.all(r[EQUATOR] > 7.9)  # the face holds no outer border at all


def test_the_border_of_a_minor_piece_draws_in_g():
    ids = {"": 1, "Isle": 2, "Realm": 3}
    chosen = selection(
        [
            part("Realm", "Realm", box(-20, -10, 0, 10)),
            part("Isle", "Isle", box(0, -10, 5, 10), minor=True),
        ]
    )
    _, r, g, _ = planes(chosen, ids, box(-20, -10, 5, 10))
    border = int(column(0.1))
    assert abs(g[EQUATOR, border]) < 1
    assert r[EQUATOR, border] > 7.9  # the face holds no R border at all


def test_a_border_takes_its_sign_from_the_names_on_it_so_a_new_name_changes_no_bytes(face0):
    stored, *_ = face0
    more = {"": 1, "(Empire)": 2, "Castile": 3, "County": 4, "Duchy": 5, "Venice": 6, "West": 7}
    again, *_ = planes(selection(PARTS, STATELESS), more)
    assert np.array_equal(stored, again)


# Previews ----------------------------------------------------------------------------------------


def preview(chosen, land):
    raster = step_fields.step_raster(chosen, IDS | {"East": 6, "Other": 7})
    dry = step_fields.preview_dry(land)
    layer = step_fields.preview_layer(raster, dry, np.zeros_like(dry), 0)
    return (layer >> 1).astype(np.float64) / 8 - 8, (layer & 1) == 1


PREVIEW_EQUATOR = step_fields.PREVIEW_HEIGHT // 2 - 1


def preview_column(lon: float) -> int:
    return int((lon + 180) / 360 * step_fields.PREVIEW_WIDTH)


def test_a_preview_holds_the_outer_borders_and_their_softness():
    d, soft = preview(selection(PARTS, STATELESS), LAND)
    row = d[PREVIEW_EQUATOR]
    assert row[preview_column(-0.3)] == pytest.approx(0.5, abs=1 / 8)
    assert row[preview_column(0.3)] == pytest.approx(-0.5, abs=1 / 8)
    assert abs(row[preview_column(10)]) >= 7  # an inner border is no preview's
    edge = preview_column(-20)
    assert abs(row[edge]) < 1 and soft[PREVIEW_EQUATOR, edge]
    assert not soft[PREVIEW_EQUATOR, preview_column(-0.3)]


def test_a_previews_pocket_takes_its_polity_too():
    lake = box(-6, -8, -4, 8)
    land = shapely.difference(box(-30, -10, 0, 10), lake)
    chosen = selection(
        [part("West", "West", box(-30, -10, -16, 10))],
        stateless=box(-4, -10, 0, 10),
        pockets=box(-16, -10, -6, 10),
    )
    d, _ = preview(chosen, land)
    row = d[PREVIEW_EQUATOR, preview_column(-30) : preview_column(0)]
    [crossing] = np.flatnonzero(np.diff(row > 0))
    assert preview_column(-7) <= preview_column(-30) + crossing <= preview_column(-4)


def test_a_previews_hole_inside_one_state_is_its_land_too():
    d, _ = preview(HOLE, HOLE_LAND)
    row = d[PREVIEW_EQUATOR, preview_column(-30) : preview_column(0)]
    [crossing] = np.flatnonzero(np.diff(row > 0))
    assert preview_column(-7) <= preview_column(-30) + crossing <= preview_column(-4)


def test_a_preview_wraps_at_the_antimeridian():
    east = shapely.MultiPolygon([box(170, -10, 180, 10), box(-180, -10, -170, 10)])
    chosen = selection(
        [clio.Part("East", "East", False, east), part("Other", "Other", box(160, -10, 170, 10))]
    )
    land = shapely.union_all([east, box(160, -10, 170, 10)])
    d, _ = preview(chosen, land)
    seam = d[PREVIEW_EQUATOR, [0, 1, -2, -1]]
    assert np.all(np.abs(seam) >= 7)  # the nearest border lies at 170° E, 14 texels away
    assert abs(d[PREVIEW_EQUATOR, preview_column(169.9)]) < 1


# Files -------------------------------------------------------------------------------------------


def test_a_step_round_trips_through_its_file():
    rng = np.random.default_rng(1)
    faces = rng.integers(0, 256, (6, 8, 8, 2), dtype=np.uint8)
    data = step_fields.step_file(faces, -3399)
    assert data[:2] == b"\x1f\x8b" and gzip.decompress(data)[:4] == b"WBF2"
    year, back = step_fields.read_step(data)
    assert year == -3399 and np.array_equal(back, faces)


def test_a_preview_chunk_stores_each_layer_after_the_first_as_a_difference():
    rng = np.random.default_rng(2)
    shape = (step_fields.PREVIEW_HEIGHT, step_fields.PREVIEW_WIDTH)
    layers = [rng.integers(0, 256, shape, dtype=np.uint8) for _ in range(3)]
    data = step_fields.chunk_file([1800, 1815, 1830], layers)
    raw = gzip.decompress(data)
    assert raw[:4] == b"WBP2"
    body = np.frombuffer(raw, np.uint8, offset=12 + 4 * 3).reshape(3, *shape)
    assert np.array_equal(body[0], layers[0])
    assert np.array_equal(body[1], layers[1] - layers[0])
    years, back = step_fields.read_chunk(data)
    assert years == [1800, 1815, 1830] and np.array_equal(back, np.stack(layers))


def test_a_chunk_holds_at_most_sixteen_previews():
    layer = np.zeros((step_fields.PREVIEW_HEIGHT, step_fields.PREVIEW_WIDTH), np.uint8)
    with pytest.raises(step_fields.StepError):
        step_fields.chunk_file(list(range(17)), [layer] * 17)


# Keys --------------------------------------------------------------------------------------------


SOURCE = {"title": "A history", "publisher": "A press", "url": "https://example.org"}


def keyed(corrections):
    rows = (
        clio.make_row("West", 1800, 1850, box(-20, -10, 0, 10)),
        clio.make_row("Duchy", 1810, 1850, box(0, -10, 10, 10)),
    )
    source = clio.Cliopatria(rows, None)
    hierarchy = clio.Hierarchy({}, {}, {})
    rules = clio.Rules(50_000, 100, 14, 100_000, 2_000, 0.5)
    config = clio.Config(hierarchy, rules, tuple(corrections), {})
    return lambda year: step_fields.step_key(year, source, config, "identity")


def rename(years):
    op = clio.Rename("Duchy", "Grand Duchy")
    return clio.Correction("1800-1913", 1, years, "why", SOURCE, op)


def test_a_steps_key_holds_through_a_correction_in_another_step():
    plain, corrected = keyed([]), keyed([rename((1830, 1850))])
    assert plain(1815) == corrected(1815)
    assert plain(1830) != corrected(1830)


def test_a_steps_key_ignores_why_and_source_but_not_what_a_correction_does():
    first = keyed([rename((1815, 1815))])
    reworded = keyed([dataclasses.replace(rename((1815, 1815)), why="another reason")])
    assert first(1815) == reworded(1815)
    other = dataclasses.replace(rename((1815, 1815)), op=clio.Rename("Duchy", "Margraviate"))
    assert first(1815) != keyed([other])(1815)
