import gzip
import json
import math
from dataclasses import replace

import pytest
import shapely

from prebuild import cliopatria as clio
from prebuild.config import ConfigError
from prebuild.paths import config_dir
from prebuild.profiles import Profile, make_context

YEAR = 1815
SOURCE = {"title": "A history", "publisher": "A press", "url": "https://example.org"}
# Generous thresholds, so each test's shapes are plainly on one side of them.
RULES = clio.Rules(
    minor_km2=50_000,
    leftover_km2=100,
    sliver_km=14,
    pocket_km2=100_000,
    review_km2=2_000,
    duplicate_share=0.5,
)
# A continent 40° by 20° around the equator, with a lake 2° square at its center.
LAND = shapely.box(-20, -10, 20, 10)
LAKE = shapely.box(-1, -1, 1, 1)


def box(west, south, east, north):
    return shapely.box(west, south, east, north)


def row(name, shape, first=YEAR, last=YEAR, **links):
    return clio.make_row(name, first, last, shape, **links)


def relation(name, first=YEAR, last=YEAR):
    return clio.make_row(name, first, last, shapely.Polygon(), polity=False)


def config(composites=None, relations=None, corrections=(), rules=RULES):
    hierarchy = clio.Hierarchy(composites or {}, relations or {}, {})
    return clio.Config(hierarchy, rules, tuple(corrections), {})


def correction(op, years=(YEAR, YEAR), source=SOURCE):
    return clio.Correction("1800-1913", 1, years, "why", source, op)


@pytest.fixture(scope="module")
def terrain():
    return clio.Terrain.of(LAND, LAKE)


def select(rows, terrain, year=YEAR, **settings):
    return clio.select(year, clio.Cliopatria(tuple(rows), None), config(**settings), terrain)


def area_of(selection, polity):
    return sum(clio.km2(p.geometry) for p in selection.parts if p.polity == polity)


# Years -----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cliopatria", "astronomical"),
    [(-3400, -3399), (-44, -43), (-1, 0), (0, 0), (1, 1), (1815, 1815)],
)
def test_cliopatria_years_before_1_ce_read_as_astronomical_years(cliopatria, astronomical):
    assert clio.astronomical(cliopatria) == astronomical


def test_rows_read_from_geojson_carry_astronomical_years_and_their_links(tmp_path):
    feature = {
        "type": "Feature",
        "properties": {
            "Name": "Roman Republic",
            "FromYear": -44,
            "ToYear": 0,
            "Area": 1.0,
            "Type": "POLITY",
            "Wikipedia": "",
            "Wikidata": "Q17167",
            "SeshatID": "",
            "Components": "",
            "MemberOf": "(Mediterranean);(Italy)",
        },
        "geometry": json.loads(shapely.to_geojson(box(10, 40, 12, 42))),
    }
    path = tmp_path / "rows.geojson.gz"
    path.write_bytes(
        gzip.compress(json.dumps({"type": "FeatureCollection", "features": [feature]}).encode())
    )
    (found,) = clio.read_rows(f"/vsigzip/{path}")
    assert (found.name, found.first, found.last) == ("Roman Republic", -43, 0)
    assert found.member_of == ("(Mediterranean)", "(Italy)")
    assert found.wikidata == "Q17167"
    band = math.sin(math.radians(42)) - math.sin(math.radians(40))
    assert found.km2 == pytest.approx(6371**2 * math.radians(2) * band)


def test_a_step_begins_in_every_change_year_unless_nothing_changes():
    same = box(0, 0, 5, 5)
    rows = [
        row("Kingdom", same, 1800, 1809),
        row("Kingdom", same, 1810, 1829),  # Cliopatria splits a row where nothing changes
        row("Duchy", box(6, 0, 8, 2), 1820, 1824),
    ]
    source = clio.Cliopatria(tuple(rows), None)
    fix = correction(clio.Rename("Kingdom", "Realm"), (1826, 1827))
    assert clio.change_years(source, config()) == [1800, 1810, 1820, 1825, 1830]
    assert clio.step_years(source, config()) == [1800, 1820, 1825, 1830]
    assert clio.step_years(source, config(corrections=[fix])) == [
        1800,
        1820,
        1825,
        1826,
        1828,
        1830,
    ]


def test_the_fixture_selects_only_its_excerpts_years():
    source = clio.load_cliopatria(make_context(Profile.FIXTURE, 1))
    assert clio.step_years(source, clio.load_config()) == [1815, 1830]


def test_ids_number_the_sorted_names_after_stateless_land():
    rows = [row("Zeta", box(0, 0, 1, 1)), row("Alpha", box(2, 0, 3, 1)), row("(Union)", LAND)]
    fix = correction(clio.Rename("Zeta", "Omega"))
    ids = clio.polity_ids(clio.Cliopatria(tuple(rows), None), config(corrections=[fix]))
    assert ids == {"": 1, "(Union)": 2, "Alpha": 3, "Omega": 4, "Zeta": 5}


# Hierarchy -------------------------------------------------------------------------------------


def outers(selection):
    return selection.outers()


def test_an_empires_members_share_its_outer_unit(terrain):
    rows = [
        row("West", box(-10, -5, 0, 5)),
        row("East", box(0, -5, 10, 5)),
        row("(Empire)", box(-10, -5, 10, 5), components=["West", "East"]),
    ]
    chosen = select(rows, terrain, composites={"(Empire)": "empire"})
    assert outers(chosen) == {"West": "(Empire)", "East": "(Empire)"}


def test_a_groupings_members_stay_apart_and_so_do_an_unclassified_composites(terrain):
    rows = [
        row("West", box(-10, -5, 0, 5)),
        row("East", box(0, -5, 10, 5)),
        row("(States)", box(-10, -5, 10, 5), components=["West", "East"]),
    ]
    grouped = select(rows, terrain, composites={"(States)": "grouping"})
    unclassified = select(rows, terrain)
    assert outers(grouped) == outers(unclassified) == {"West": "West", "East": "East"}
    assert grouped.report["unclassified"]["composites"] == []
    assert unclassified.report["unclassified"]["composites"] == ["(States)"]


def test_memberof_joins_a_valid_composite_its_components_do_not_list(terrain):
    rows = [
        row("West", box(-10, -5, 0, 5)),
        row("East", box(0, -5, 10, 5), member_of=["(Empire)"]),
        row("North", box(-10, 5, 0, 8), member_of=["(Old Empire)"]),
        row("(Empire)", box(-10, -5, 0, 5), components=["West"]),
    ]
    chosen = select(rows, terrain, composites={"(Empire)": "empire"})
    assert outers(chosen)["East"] == "(Empire)"
    assert outers(chosen)["North"] == "North"
    assert chosen.report["unsettled"] == [{"polity": "North", "memberOf": ["(Old Empire)"]}]


def test_a_vassal_joins_its_paramount_only_where_the_hierarchy_says_so(terrain):
    rows = [
        row("Paramount", box(-10, -5, 0, 5)),
        row("Vassal", box(0, -5, 10, 5)),
        relation("(Vassalage of Vassal to Paramount)"),
    ]
    name = "(Vassalage of Vassal to Paramount)"
    member = select(rows, terrain, relations={name: True})
    tributary = select(rows, terrain, relations={name: False})
    unclassified = select(rows, terrain)
    assert outers(member)["Vassal"] == "Paramount"
    assert outers(tributary)["Vassal"] == outers(unclassified)["Vassal"] == "Vassal"
    assert unclassified.report["unclassified"]["relations"] == [name]


def test_a_vassal_composite_joins_with_its_members(terrain):
    rows = [
        row("Paramount", box(-10, -5, 0, 5)),
        row("Kingdom", box(0, -5, 10, 5)),
        row("March", box(10, -5, 15, 5)),
        row("(Kingdom)", box(0, -5, 15, 5), components=["Kingdom", "March"]),
        row("(Paramount)", box(-10, -5, 0, 5), components=["Paramount"]),
        relation("(Vassalage of Kingdom to Paramount)"),
    ]
    chosen = select(
        rows,
        terrain,
        composites={"(Kingdom)": "empire", "(Paramount)": "empire"},
        relations={"(Vassalage of Kingdom to Paramount)": True},
    )
    assert set(outers(chosen).values()) == {"(Paramount)"}


def test_a_leaf_that_reaches_two_roots_fails_the_step(terrain):
    rows = [
        row("Borderland", box(0, -5, 5, 5)),
        row("(North)", box(0, -5, 5, 5), components=["Borderland"]),
        row("(South)", box(0, -5, 5, 5), components=["Borderland"]),
    ]
    with pytest.raises(clio.SelectionError, match="two roots"):
        select(rows, terrain, composites={"(North)": "empire", "(South)": "empire"})


def test_a_composites_land_no_polity_holds_is_drawn_in_its_root_when_large_enough(terrain):
    rows = [
        row("Core", box(-10, -5, 0, 5)),
        row("Rival", box(3, -5, 5, 5)),  # no member, though the empire's shape reaches it
        row("(Empire)", box(-10, -5, 5, 5), components=["Core"]),
        row("Town", box(8, 0, 9, 1)),
        row("(League)", box(8, 0, 9.0005, 1), components=["Town"]),
    ]
    chosen = select(rows, terrain, composites={"(Empire)": "empire", "(League)": "grouping"})
    assert outers(chosen)["(Empire)"] == "(Empire)"
    assert area_of(chosen, "(Empire)") == pytest.approx(clio.km2(box(0, -5, 3, 5)), rel=0.01)
    assert "(League)" not in outers(chosen)  # about 6 km² beyond its town, under leftoverKm2
    assert chosen.report["leftovers"] == [
        {"composite": "(Empire)", "km2": pytest.approx(clio.km2(box(0, -5, 3, 5)), rel=0.01)}
    ]
    assert chosen.report["overlaps"] == []


# Size tier -------------------------------------------------------------------------------------


def test_a_small_state_and_a_small_detached_piece_of_a_large_one_are_minor(terrain):
    rows = [
        row("Empire", shapely.union(box(-15, -8, 0, 8), box(4, 0, 5, 1))),  # and a 12,000 km² piece
        row("Duchy", box(0, 0, 1, 1)),  # about 12,000 km²
        row("Kingdom", box(0, 1, 10, 8)),
    ]
    chosen = select(rows, terrain)
    minor = {(p.polity, p.minor): round(clio.km2(p.geometry), -3) for p in chosen.parts}
    assert ("Duchy", True) in minor and ("Duchy", False) not in minor
    assert ("Kingdom", False) in minor and ("Kingdom", True) not in minor
    assert minor[("Empire", True)] == pytest.approx(12_000, abs=1_000)
    assert minor[("Empire", False)] > 2_000_000


def test_members_count_toward_their_outer_units_pieces(terrain):
    rows = [
        row("Duchy", box(0, 0, 1, 1)),
        row("Kingdom", box(1, 0, 10, 8)),
        row("(Empire)", box(0, 0, 10, 8), components=["Duchy", "Kingdom"]),
    ]
    chosen = select(rows, terrain, composites={"(Empire)": "empire"})
    assert not any(p.minor for p in chosen.parts)


# Stateless land --------------------------------------------------------------------------------


def stateless_at(selection, lon, lat):
    return bool(shapely.intersects(selection.stateless, shapely.Point(lon, lat)))


def test_a_wide_coast_stays_stateless_and_its_slivers_go(terrain):
    # A polity covers the continent but for a strip 0.2° (22 km) wide along its north coast and a
    # block 5° wide in the east.
    rows = [row("Realm", box(-20, -10, 15, 9.8))]
    chosen = select(rows, terrain)
    assert stateless_at(chosen, 17, 0)
    assert not stateless_at(chosen, 0, 9.9)
    assert chosen.report["stateless"]["sliverKm2"] > 0


def split(shape, at=0):
    """Two states holding `shape` west and east of the meridian `at`."""
    return [
        row("West", shapely.intersection(shape, box(-20, -10, at, 10))),
        row("East", shapely.intersection(shape, box(at, -10, 20, 10))),
    ]


def test_a_hole_inside_one_state_is_that_states_land_whatever_its_size(terrain):
    small = box(-15, -3, -14.5, -2.5)  # about 3,100 km², far wider than 2·sliverKm
    large = box(5, -4, 15, 4)  # about 990,000 km², past pocketKm2
    rows = [row("Realm", shapely.difference(shapely.difference(LAND, small), large))]
    chosen = select(rows, terrain)
    assert not stateless_at(chosen, -14.75, -2.75)
    assert not stateless_at(chosen, 10, 0)
    [(state, holes)] = chosen.holes
    assert state == "Realm"
    assert shapely.intersects(holes, shapely.Point(-14.75, -2.75))
    assert shapely.intersects(holes, shapely.Point(10, 0))
    assert shapely.is_empty(chosen.pockets)
    assert chosen.report["stateless"]["enclosed"] == []
    assert chosen.report["stateless"]["byRule"]["state"] == 2
    assert [(p["rule"], p["state"]) for p in chosen.report["stateless"]["largePockets"]] == [
        ("state", "Realm"),
        ("state", "Realm"),
    ]


def test_a_hole_among_one_empires_members_is_the_empires_land(terrain):
    hole = box(-1, 3, 1, 5)  # on the line between the empire's two members
    rows = [
        row("Duchy", shapely.difference(box(-20, -10, 0, 10), hole)),
        row("Kingdom", shapely.difference(box(0, -10, 20, 10), hole)),
        row("(Empire)", shapely.difference(LAND, hole), components=["Duchy", "Kingdom"]),
    ]
    chosen = select(rows, terrain, composites={"(Empire)": "empire"})
    assert not stateless_at(chosen, 0, 4)
    (filled,) = chosen.report["stateless"]["largePockets"]
    assert (filled["rule"], filled["state"]) == ("state", "(Empire)")


def test_a_hole_inside_one_state_by_a_lake_is_its_land_though_another_holds_the_far_shore(
    terrain,
):
    # Realm leaves a hole on the lake's west shore, and Other holds a block on its east shore.
    hole, other = box(-3, -1, -1, 1), box(1, -1, 3, 1)
    rows = [row("Realm", shapely.difference(LAND, shapely.union(hole, other))), row("Other", other)]
    chosen = select(rows, terrain)
    [(state, holes)] = chosen.holes
    assert state == "Realm" and shapely.intersects(holes, shapely.Point(-2, 0))
    assert not shapely.intersects(chosen.pockets, shapely.Point(-2, 0))


def test_a_cited_correction_keeps_a_hole_inside_one_state_stateless(terrain):
    hole = box(-15, -3, -13, -1)
    rows = [row("Realm", shapely.difference(LAND, hole))]
    keep = correction(clio.Pocket((-14, -2), stateless=True))
    chosen = select(rows, terrain, corrections=[keep])
    assert stateless_at(chosen, -14, -2)
    assert chosen.applied == {0}
    (kept,) = chosen.report["stateless"]["enclosed"]
    assert kept["states"] == ["Realm"] and kept["correction"] is True


def test_a_cited_correction_keeps_a_hole_between_states_stateless_as_the_rules_do(terrain):
    rows = split(shapely.difference(LAND, box(-15, -3, -13, -1)), at=-14)
    keep = correction(clio.Pocket((-14, -2), stateless=True))
    chosen = select(rows, terrain, corrections=[keep])
    assert stateless_at(chosen, -14, -2)
    assert chosen.applied == {0}
    (kept,) = chosen.report["stateless"]["enclosed"]
    assert kept["correction"] is True


def test_a_pocket_correction_draws_a_hole_between_states_as_the_polity_it_names(terrain):
    # A hole of about 990,000 km², past pocketKm2, around the lake between West and East.
    rows = split(shapely.difference(LAND, box(-5, -4, 5, 4)))
    fill = correction(clio.Pocket((-3, 0), to="East"))
    chosen = select(rows, terrain, corrections=[fill])
    east = shapely.union_all([p.geometry for p in chosen.parts if p.polity == "East"])
    assert shapely.contains(east, shapely.Point(-3, 0))
    assert not shapely.contains(east, shapely.Point(0, 0))  # the lake stays empty
    assert chosen.applied == {0}
    assert chosen.report["stateless"]["enclosed"] == []
    (given,) = chosen.report["stateless"]["largePockets"]
    assert (given["rule"], given["polity"]) == ("correction", "East")


def test_a_pocket_correction_draws_a_polity_the_step_lacks_from_the_hole_alone(terrain):
    # Cliopatria's Duchy begins only in 1830; the hole is its land in 1815.
    hole = box(-15, -3, -13, -1)
    rows = [*split(shapely.difference(LAND, hole), at=-14), row("Duchy", hole, 1830, 1840)]
    fill = correction(clio.Pocket((-14, -2), to="Duchy"))
    chosen = select(rows, terrain, corrections=[fill])
    assert outers(chosen)["Duchy"] == "Duchy"
    assert area_of(chosen, "Duchy") == pytest.approx(clio.km2(hole), rel=0.01)
    assert (chosen.report["added"], chosen.report["unexplained"]) == (["Duchy"], [])
    slip = correction(clio.Pocket((-14, -2), to="Duchie"))
    with pytest.raises(clio.SelectionError, match="no polity named Duchie"):
        select(rows, terrain, corrections=[slip])


def test_a_pocket_correction_draws_only_the_part_inside_another_years_shape_or_a_cited_one(
    terrain,
):
    # West held the hole's western half in 1816; its eastern half stays stateless.
    hole = box(-15, -3, -13, -1)
    rows = [
        *split(shapely.difference(LAND, hole), at=-14),
        row("West", box(-20, -10, -14, 10), first=1816, last=1816),
    ]
    fill = correction(clio.Pocket((-14.5, -2), to="West", shape_from=("West", 1816)))
    chosen = select(rows, terrain, corrections=[fill])
    assert not stateless_at(chosen, -14.5, -2)
    assert stateless_at(chosen, -13.5, -2)
    assert chosen.applied == {0}
    cited = correction(clio.Pocket((-14.5, -2), to="West", shape=box(-20, -10, -14, 10)))
    drawn = select(rows, terrain, corrections=[cited])
    assert not stateless_at(drawn, -14.5, -2) and stateless_at(drawn, -13.5, -2)
    missed = correction(clio.Pocket((0, 5), to="West", shape_from=("West", 1816)))
    assert select(rows, terrain, corrections=[missed]).applied == set()


def test_a_hole_between_two_states_stays_stateless_however_small(terrain):
    small = box(-15, -3, -14.5, -2.5)  # about 3,100 km², across the line at -14.75°
    rows = split(shapely.difference(LAND, small), at=-14.75)
    chosen = select(rows, terrain)
    assert stateless_at(chosen, -14.75, -2.75)
    (kept,) = chosen.report["stateless"]["enclosed"]
    assert kept["km2"] == pytest.approx(3_100, rel=0.02)
    assert kept["states"] == ["East", "West"] and kept["lake"] is False
    assert chosen.report["stateless"]["pockets"] == 0


def test_a_pocket_between_states_by_a_lake_goes_to_its_neighbours_and_the_lake_stays_empty(
    terrain,
):
    # Two states leave a ring half a degree wide around the lake, about 62,000 km².
    rows = split(shapely.difference(LAND, box(-1.5, -1.5, 1.5, 1.5)))
    chosen = select(rows, terrain)
    assert not stateless_at(chosen, 1.25, 0)
    assert not shapely.intersects(chosen.stateless, box(-0.9, -0.9, 0.9, 0.9))
    (pocket,) = chosen.report["stateless"]["largePockets"]
    assert pocket["rule"] == "lake"


def test_a_hole_between_states_beside_a_lake_past_the_cap_stays_stateless(terrain):
    # Two states leave a ring 3° wide around the lake, about 740,000 km².
    rows = split(shapely.difference(LAND, box(-4, -4, 4, 4)))
    chosen = select(rows, terrain)
    assert stateless_at(chosen, 3, 0)
    (kept,) = chosen.report["stateless"]["enclosed"]
    assert kept["lake"] is True


def test_a_hole_between_states_past_the_cap_goes_when_it_is_narrow_throughout(terrain):
    narrow = box(-15, 5, 15, 5.15)  # 17 km wide, about 50,000 km²
    rows = split(shapely.difference(LAND, narrow))
    capped = replace(RULES, pocket_km2=10_000)
    chosen = select(rows, terrain, rules=capped)
    assert not stateless_at(chosen, 0, 5.07)
    assert chosen.report["stateless"]["largePockets"][0]["rule"] == "narrow"


def test_a_pocket_correction_overrides_the_rule(terrain):
    # A hole between two states that touches no lake is given, and a pocket by the lake kept.
    hole = split(shapely.difference(LAND, box(-15, -3, -13, -1)), at=-14)
    give = correction(clio.Pocket((-14, -2), stateless=False))
    given = select(hole, terrain, corrections=[give])
    assert not stateless_at(given, -14, -2)
    assert given.applied == {0}
    ring = split(shapely.difference(LAND, box(-1.5, -1.5, 1.5, 1.5)))
    keep = correction(clio.Pocket((1.25, 0), stateless=True))
    kept = select(ring, terrain, corrections=[keep])
    assert stateless_at(kept, 1.25, 0)
    assert kept.applied == {0}


def test_a_pocket_between_states_that_touches_a_polity_is_filled_from_the_polities(terrain):
    # A ring around the lake is a pocket between West and East; an island in a second lake, in
    # stateless land, touches no polity and is left to the fill.
    lakes = shapely.union(LAKE, box(14, -1, 16, 1))
    land = shapely.difference(LAND, box(14.3, -0.3, 15.7, 0.3))
    islands = clio.Terrain.of(shapely.union(land, box(14.8, -0.2, 15.2, 0.2)), lakes)
    rows = split(shapely.difference(box(-20, -10, 10, 10), box(-1.5, -1.5, 1.5, 1.5)))
    chosen = select(rows, islands)
    assert chosen.holes == ()
    assert shapely.intersects(chosen.pockets, shapely.Point(1.25, 0))
    assert not shapely.intersects(chosen.pockets, shapely.Point(15, 0))
    assert not stateless_at(chosen, 15, 0)


def test_a_pocket_correction_keeps_or_gives_a_coastal_piece_whole(terrain):
    # Realm holds all but a block 2° square on the north coast, about 49,000 km².
    bay = box(-2, 8, 0, 10)
    rows = [row("Realm", shapely.difference(LAND, bay))]
    give = correction(clio.Pocket((-1, 9), stateless=False))
    chosen = select(rows, terrain, corrections=[give])
    assert not stateless_at(chosen, -1, 9)
    assert shapely.intersects(chosen.pockets, shapely.Point(-1, 9))
    assert chosen.applied == {0}
    assert stateless_at(select(rows, terrain), -1, 9)


def test_a_pocket_correction_past_the_cap_fails_the_step(terrain):
    rows = [row("Realm", box(-20, -10, 0, 10))]
    give = correction(clio.Pocket((10, 0), stateless=False))
    with pytest.raises(clio.SelectionError, match="past pocketKm2"):
        select(rows, terrain, corrections=[give])


# The antimeridian ------------------------------------------------------------------------------


def test_land_across_the_antimeridian_goes_to_the_polity_along_it():
    # A peninsula from 170° E to 170° W, which the source draws only to 180°.
    seam = clio.Terrain.of(
        shapely.union(box(170, 60, 180, 70), box(-180, 60, -170, 70)), shapely.Polygon()
    )
    chosen = select([row("Russia", box(170, 60, 180, 70))], seam)
    assert not stateless_at(chosen, -175, 65)
    assert area_of(chosen, "Russia") == pytest.approx(2 * clio.km2(box(170, 60, 180, 70)), rel=0.01)


def test_land_across_the_antimeridian_stays_stateless_where_no_polity_runs_along_it():
    seam = clio.Terrain.of(
        shapely.union(box(170, 60, 180, 70), box(-180, 60, -170, 70)), shapely.Polygon()
    )
    chosen = select([row("Russia", box(170, 60, 175, 70))], seam)
    assert stateless_at(chosen, -175, 65)


# Overlaps --------------------------------------------------------------------------------------


def test_the_smaller_of_two_overlapping_polities_keeps_the_land_they_share(terrain):
    rows = [row("Empire", box(-10, -5, 10, 5)), row("Enclave", box(0, 0, 1, 1))]
    chosen = select(rows, terrain)
    assert area_of(chosen, "Enclave") == pytest.approx(12_360, rel=0.01)
    assert area_of(chosen, "Empire") == pytest.approx(
        clio.km2(box(-10, -5, 10, 5)) - 12_360, rel=0.01
    )
    (overlap,) = chosen.report["overlaps"]
    assert overlap["winner"] == "Enclave" and not overlap["duplicate"]
    assert chosen.unacknowledged == ()


def test_a_near_duplicate_pair_needs_an_overlap_correction(terrain):
    rows = [row("Colony", box(0, 0, 4, 4)), row("Republic", box(0, 0, 4, 4.5))]
    unnamed = select(rows, terrain)
    checked = select(
        rows,
        terrain,
        corrections=[correction(clio.Overlap(("Republic", "Colony"), "Colony"), source=None)],
    )
    assert unnamed.unacknowledged == (("Colony", "Republic"),)
    assert checked.unacknowledged == ()
    assert checked.report["overlaps"][0]["acknowledged"]


def test_an_overlap_correction_that_overrides_the_smaller_cites_a_source(terrain):
    rows = [row("Colony", box(0, 0, 4, 4)), row("Republic", box(0, 0, 4, 4.5))]
    larger = clio.Overlap(("Colony", "Republic"), "Republic")
    with pytest.raises(clio.SelectionError, match="needs a source"):
        select(rows, terrain, corrections=[correction(larger, source=None)])
    chosen = select(rows, terrain, corrections=[correction(larger)])
    assert area_of(chosen, "Colony") == 0
    assert area_of(chosen, "Republic") == pytest.approx(clio.km2(box(0, 0, 4, 4.5)), rel=0.01)


# Corrections -----------------------------------------------------------------------------------


def test_give_moves_all_of_a_polity_or_the_part_holding_a_point(terrain):
    rows = [
        row("Empire", shapely.union(box(-10, -5, 0, 5), box(5, -5, 8, 5))),
        row("Kingdom", box(8, -5, 12, 5)),
    ]
    part = select(
        rows, terrain, corrections=[correction(clio.Give("Empire", "Kingdom", at=(6, 0)))]
    )
    whole = select(rows, terrain, corrections=[correction(clio.Give("Empire", "Kingdom"))])
    assert area_of(part, "Kingdom") == pytest.approx(clio.km2(box(5, -5, 12, 5)), rel=0.01)
    assert area_of(whole, "Empire") == 0


def test_give_takes_the_part_inside_another_shape_and_can_make_a_new_member(terrain):
    rows = [
        row("Dutch East Indies", box(0, -5, 10, 5)),
        row("British Java", box(4, -3, 6, -1), first=1811, last=1813),
        row("British Empire", box(-15, -5, -10, 5)),
    ]
    give = clio.Give(
        "Dutch East Indies", "Java", shape_from=("British Java", 1812), member_of="British Empire"
    )
    chosen = select(rows, terrain, corrections=[correction(give)])
    assert area_of(chosen, "Java") == pytest.approx(clio.km2(box(4, -3, 6, -1)), rel=0.01)
    assert outers(chosen)["Java"] == "British Empire"


def test_carry_draws_a_polity_with_its_shape_from_another_year(terrain):
    rows = [row("Mexico", box(-10, -5, 0, 5), first=1900, last=1912)]
    carry = correction(clio.Carry("Mexico", 1912), (1913, 1919))
    chosen = select(rows, terrain, year=1915, corrections=[carry])
    assert area_of(chosen, "Mexico") == pytest.approx(clio.km2(box(-10, -5, 0, 5)), rel=0.01)


def test_add_draws_a_cited_shape_and_member_makes_a_member(terrain):
    rows = [
        row("Dutch East Indies", box(0, -5, 10, 5)),
        row("Sultanate of Bima", box(10, -5, 12, 5)),
    ]
    add = clio.Add("Sanggar", box(9, -1, 10, 1), wikidata="Q1", member_of="Dutch East Indies")
    member = clio.Member("Sultanate of Bima", "Dutch East Indies")
    chosen = select(rows, terrain, corrections=[correction(add), correction(member)])
    assert outers(chosen) == {
        "Dutch East Indies": "Dutch East Indies",
        "Sanggar": "Dutch East Indies",
        "Sultanate of Bima": "Dutch East Indies",
    }
    assert area_of(chosen, "Sanggar") == pytest.approx(clio.km2(box(9, -1, 10, 1)), rel=0.01)
    assert chosen.applied == {0, 1}


def test_drop_takes_away_a_politys_pieces_inside_a_shape(terrain):
    # The Reich's row carries a scrap far from its body, inside a neighbour's land; the shape also
    # reaches its body, which it does not hold whole.
    rows = [
        row("Reich", shapely.union(box(-10, -5, 0, 5), box(12, 2, 12.5, 2.5))),
        row("Neighbour", box(10, -5, 20, 5)),
    ]
    drop = correction(clio.Drop("Reich", box(-1, 1, 14, 4)))
    chosen = select(rows, terrain, corrections=[drop])
    assert area_of(chosen, "Reich") == pytest.approx(clio.km2(box(-10, -5, 0, 5)), rel=0.01)
    assert area_of(chosen, "Neighbour") == pytest.approx(clio.km2(box(10, -5, 20, 5)), rel=0.01)
    assert chosen.applied == {0}


def test_rename_renames_a_polity_and_what_names_it(terrain):
    rows = [
        row("German Empire", box(-10, -5, 0, 5)),
        row("(Empire)", box(-10, -5, 0, 5), components=["German Empire"]),
    ]
    rename = correction(clio.Rename("German Empire", "Germany"))
    chosen = select(rows, terrain, composites={"(Empire)": "empire"}, corrections=[rename])
    assert outers(chosen) == {"Germany": "(Empire)"}


def test_a_step_records_the_leaves_its_corrections_add_and_take_away(terrain):
    rows = [
        row("Realm", box(-20, -10, 0, 10)),
        row("Duchy", box(0, -10, 10, 10)),
        row("March", box(10, -10, 20, 10), first=1800, last=1800),
    ]
    fixes = [correction(clio.Carry("March", 1800)), correction(clio.Give("Duchy", "Realm"))]
    report = select(rows, terrain, corrections=fixes).report
    assert (report["leaves"], report["added"], report["removed"]) == (2, ["March"], ["Duchy"])
    assert report["unexplained"] == []


def test_a_leaf_no_correction_takes_away_is_unexplained(terrain):
    # Two rows of one shape: the one whose name sorts later loses all of it to the other.
    rows = [row("Alpha", box(0, 0, 4, 4)), row("Beta", box(0, 0, 4, 4))]
    report = select(rows, terrain).report
    assert (report["removed"], report["unexplained"]) == (["Beta"], ["Beta"])


def test_a_correction_that_leaves_a_step_unchanged_is_named_with_the_steps(terrain):
    rows = [row("Mexico", box(-10, -5, 0, 5), first=1900, last=1914)]
    source = clio.Cliopatria(tuple(rows), None)
    carry = correction(clio.Carry("Mexico", 1912), (1913, 1919))
    settings = config(corrections=[carry])
    years = clio.step_years(source, settings)
    applied = {y: clio.select(y, source, settings, terrain).applied for y in years}
    assert years == [1900, 1913, 1915, 1920]
    assert clio.unchanged(settings, years, applied) == [
        "1800-1913.yaml correction 1 (carry, 1913-1919) changes nothing in the steps 1913"
    ]


# Config ----------------------------------------------------------------------------------------


def test_the_committed_config_loads_and_cites_every_hierarchy_entry():
    loaded = clio.load_config()
    assert loaded.rules.minor_km2 == 50_000
    assert loaded.rules.pocket_km2 == 100_000
    names = [*loaded.hierarchy.composites, *loaded.hierarchy.relations]
    assert names and all(loaded.hierarchy.citations[n].source for n in names)


def write_config(folder, corrections, era="1800-1913"):
    folder.mkdir(exist_ok=True)
    for name in (clio.HIERARCHY, clio.RULES):
        (folder / name).write_text((config_dir() / clio.CONFIG / name).read_text())
    doc = {"modified": "2026-09-29", "corrections": corrections}
    (folder / f"{era}.yaml").write_text(json.dumps(doc))
    return folder


def test_an_era_file_loads_every_operation(tmp_path):
    shape = tmp_path / "borders" / "shapes" / "sanggar.geojson"
    shape.parent.mkdir(parents=True)
    shape.write_text(shapely.to_geojson(box(118, -8.4, 118.4, -8.1)))
    cited = {"why": "Because.", "source": SOURCE}
    rows = [
        {**cited, "years": [1815, 1815], "give": {"polity": "A", "to": "B", "at": [1, 2]}},
        {**cited, "years": [1815, 1816], "carry": {"polity": "A", "from": 1812}},
        {
            **cited,
            "years": [1815, 1815],
            "add": {"polity": "Sanggar", "shape": "shapes/sanggar.geojson"},
        },
        {
            **cited,
            "years": [1815, 1815],
            "drop": {"polity": "A", "shape": "shapes/sanggar.geojson"},
        },
        {**cited, "years": [1815, 1815], "member": {"polity": "A", "of": "B"}},
        {**cited, "years": [1815, 1815], "rename": {"polity": "A", "to": "C"}},
        {**cited, "years": [1815, 1815], "pocket": {"at": [1, 2], "stateless": True}},
        {
            "why": "Smaller wins, checked.",
            "years": [1815, 1815],
            "overlap": {"polities": ["A", "B"], "winner": "B"},
        },
    ]
    loaded = clio.load_config(write_config(tmp_path / "borders", rows))
    ops = [type(c.op).__name__ for c in loaded.corrections]
    assert ops == ["Give", "Carry", "Add", "Drop", "Member", "Rename", "Pocket", "Overlap"]
    assert loaded.corrections[2].op.shape.bounds == pytest.approx((118, -8.4, 118.4, -8.1))
    assert loaded.corrections[3].op.shape.bounds == pytest.approx((118, -8.4, 118.4, -8.1))
    assert loaded.corrections[7].source is None


def pocket_entry(**pocket):
    return {"years": [1815, 1815], "why": "w", "source": SOURCE, "pocket": pocket}


def test_a_pocket_names_the_polity_it_draws_and_the_shape_it_takes_the_part_inside(tmp_path):
    shape = tmp_path / "borders" / "hole.geojson"
    shape.parent.mkdir(parents=True)
    shape.write_text(shapely.to_geojson(box(1, 2, 3, 4)))
    rows = [
        pocket_entry(at=[1, 2], to="A"),
        pocket_entry(at=[1, 2], to="A", shape_from={"polity": "B", "year": 1820}),
        pocket_entry(at=[1, 2], to="A", shape="hole.geojson"),
    ]
    whole, inside_row, inside_shape = clio.load_config(write_config(shape.parent, rows)).corrections
    assert whole.op == clio.Pocket((1.0, 2.0), to="A")
    assert inside_row.op == clio.Pocket((1.0, 2.0), to="A", shape_from=("B", 1820))
    assert inside_shape.op.shape.bounds == pytest.approx((1, 2, 3, 4))


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        (pocket_entry(at=[1, 2]), "stateless or to"),
        (pocket_entry(at=[1, 2], stateless=True, to="A"), "stateless or to"),
        (
            pocket_entry(at=[1, 2], stateless=False, shape_from={"polity": "B", "year": 1820}),
            "only with to",
        ),
        (
            pocket_entry(at=[1, 2], to="A", shape_from={"polity": "B", "year": 1820}, shape="x"),
            "not both",
        ),
        (pocket_entry(at=[1, 2], to="A", shape_from={"polity": "B"}), "needs"),
        (
            {
                "years": [1815, 1815],
                "why": "w",
                "source": SOURCE,
                "rename": {"polity": "A", "to": "B"},
                "note": 1,
            },
            "needs",
        ),
        (
            {"years": [1815, 1815], "why": "w", "rename": {"polity": "A", "to": "B"}},
            "needs a source",
        ),
        (
            {
                "years": [1790, 1815],
                "why": "w",
                "source": SOURCE,
                "rename": {"polity": "A", "to": "B"},
            },
            "outside its era",
        ),
        (
            {
                "years": [1815, 1815],
                "why": "",
                "source": SOURCE,
                "rename": {"polity": "A", "to": "B"},
            },
            "needs a why",
        ),
        (
            {
                "years": [1815, 1815],
                "why": "w",
                "source": {"title": "t"},
                "rename": {"polity": "A", "to": "B"},
            },
            "source needs",
        ),
        ({"years": [1815, 1815], "why": "w", "source": SOURCE, "rename": {"polity": "A"}}, "needs"),
        (
            {
                "years": [1815, 1815],
                "why": "w",
                "source": SOURCE,
                "overlap": {"polities": ["A", "B"], "winner": "C"},
            },
            "winner",
        ),
    ],
)
def test_a_correction_the_format_does_not_allow_fails(tmp_path, entry, message):
    with pytest.raises(ConfigError, match=message):
        clio.load_config(write_config(tmp_path / "borders", [entry]))


def test_a_file_the_borders_do_not_read_fails(tmp_path):
    folder = write_config(tmp_path / "borders", [])
    (folder / "1500-1800.yaml").write_text("modified: 2026-09-29\ncorrections: []\n")
    with pytest.raises(ConfigError, match=r"1500-1800\.yaml"):
        clio.load_config(folder)


# The fixture's steps, the polities and the review queue ----------------------------------------


@pytest.fixture(scope="module")
def fixture_steps():
    ctx = make_context(Profile.FIXTURE, 1)
    source, settings = clio.load_cliopatria(ctx), clio.load_config()
    terrain = clio.load_terrain(ctx)
    return source, settings, {y: clio.select(y, source, settings, terrain) for y in source.years}


def test_each_fixture_step_draws_every_polity_row_valid_in_its_year():
    ctx = make_context(Profile.FIXTURE, 1)
    source, terrain = clio.load_cliopatria(ctx), clio.load_terrain(ctx)
    uncorrected = replace(clio.load_config(), corrections=())
    for year in source.years:
        chosen = clio.select(year, source, uncorrected, terrain)
        valid = {r.name for r in source.rows if r.holds(year) and not r.composite}
        assert chosen.report["leaves"] == len(valid)
        assert valid <= set(chosen.outers())
        if year == 1815:
            assert chosen.report["leaves"] == 139


def test_the_fixture_draws_its_polities_with_their_ids_wikidata_and_outer_units(fixture_steps):
    source, settings, steps = fixture_steps
    document = clio.polities_document(
        source, settings, [(y, chosen.outers()) for y, chosen in sorted(steps.items())]
    )
    indies = document["Dutch East Indies"]
    assert indies["id"] == clio.polity_ids(source, settings)["Dutch East Indies"]
    assert indies["wikidata"] == ["Q188161"]
    assert indies["steps"] == [[1830, 1830, "(Netherlands)"]]  # British until 1816
    assert document["(Netherlands)"]["steps"] == [[1815, 1830, "(Netherlands)"]]
    assert "" not in document


def test_the_fixture_draws_sumbawas_states_of_1815_as_dutch_members(fixture_steps):
    # Owner decision 37: Dutch members, while the rest of the Indies is British.
    source, settings, steps = fixture_steps
    document = clio.polities_document(
        source, settings, [(y, chosen.outers()) for y, chosen in sorted(steps.items())]
    )
    assert document["Kingdom of Sanggar"]["wikidata"] == ["Q20427303"]
    for state in ("Kingdom of Tambora", "Kingdom of Sanggar", "Sultanate of Bima"):
        assert document[state]["steps"][0] == [1815, 1815, "(Netherlands)"]


def test_a_polity_lists_a_run_of_steps_for_each_outer_unit_it_is_drawn_in():
    rows = [row("Duchy", box(0, 0, 1, 1)), row("(Empire)", box(0, 0, 1, 1))]
    steps = [
        (1800, {"Duchy": "Duchy"}),
        (1810, {"Duchy": "(Empire)"}),
        (1820, {"Duchy": "(Empire)"}),
        (1830, {}),
        (1840, {"Duchy": "(Empire)"}),
    ]
    document = clio.polities_document(clio.Cliopatria(tuple(rows), None), config(), steps)
    assert document["Duchy"]["steps"] == [
        [1800, 1800, "Duchy"],
        [1810, 1820, "(Empire)"],
        [1840, 1840, "(Empire)"],
    ]
    assert document["(Empire)"]["steps"] == [[1810, 1820, "(Empire)"], [1840, 1840, "(Empire)"]]


def test_names_that_vanish_and_return_are_listed_with_the_years_they_are_gone():
    rows = [
        row("Duchy", box(0, 0, 1, 1), 1500, 1509),
        row("Duchy", box(0, 0, 1, 1), 1520, 1530),
        row("Duchy", box(0, 0, 1, 1), 1531, 1540),
        row("(League)", box(0, 0, 1, 1), 1500, 1501),
        row("(League)", box(0, 0, 1, 1), 1510, 1520),
    ]
    assert clio.returns(clio.Cliopatria(tuple(rows), None)) == [
        {"polity": "Duchy", "gone": [1510, 1519]}
    ]


def test_the_review_queue_gathers_the_pairs_and_unclassified_entries_over_the_steps(terrain):
    rows = [
        row("Colony", box(0, 0, 4, 4), 1800, 1815),
        row("Republic", box(0, 0, 4, 4.5), 1800, 1815),
        row("(States)", box(0, 0, 4, 4.5), 1810, 1815, components=["Colony"]),
    ]
    source = clio.Cliopatria(tuple(rows), None)
    settings = config()
    years = clio.step_years(source, settings)
    reports = {y: clio.select(y, source, settings, terrain).report for y in years}
    queue = clio.review_queue(source, settings, years, reports, {1816: "fails"}, [])
    assert queue["steps"] == [1800, 1810, 1816]
    assert queue["failed"] == [{"year": 1816, "error": "fails"}]
    assert queue["unclassified"]["composites"] == [{"name": "(States)", "steps": [[1810, 1810]]}]
    (pair,) = queue["overlaps"]["unacknowledged"]
    assert pair["polities"] == ["Colony", "Republic"]
    assert pair["steps"] == pair["duplicate"] == pair["unacknowledged"] == [1800, 1810]
