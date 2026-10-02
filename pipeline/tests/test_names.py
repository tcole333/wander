import dataclasses
import gzip
import json
import math

import numpy as np
import pytest
import shapely

from prebuild import borders, names, step_fields
from prebuild.faces import Face, Subset
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record

RULES = names.load_rules()
# A face with every character up to U+2FFF, each 0.6 em wide, its capitals 0.625 em high: the
# stage's tests need no installed fonts (CI's pipeline job has no app/node_modules).
FACE = Face("Test", [Subset({c: 1 for c in range(0x20, 0x3000)}, (0, 600), 1000, 625)])
FACES = {"outer": FACE, "inner": FACE}


# Names


@pytest.mark.parametrize(
    ("name", "short"),
    [
        ("(British Empire)", "British Empire"),
        ("Kingdom of Bavaria", "Bavaria"),
        ("Kingdom of the Two Sicilies", "Two Sicilies"),
        ("Qing Dynasty", "Qing"),
        ("Muhammad Ali dynasty", "Muhammad Ali"),
        ("Kingdom of Naples (Napoleonic)", "Naples"),
        ("Republic of China", "China"),
        ("Commonwealth of Nations", "Commonwealth of Nations"),
        ("United States of America", "United States of America"),
        ("Ottoman Empire", "Ottoman Empire"),
    ],
)
def test_the_short_name_drops_a_leading_title_a_trailing_dynasty_and_a_qualifier(name, short):
    assert names.short_name(name, RULES) == short


def test_a_title_alone_or_dynasty_alone_stays_whole():
    assert names.short_name("Kingdom of", RULES) == "Kingdom of"
    assert names.short_name("Dynasty", RULES) == "Dynasty"
    assert names.short_name("Xi Dynasty", RULES) == "Xi Dynasty"


def test_outer_names_are_lettered_in_capitals_and_inner_ones_as_written():
    assert names.lettered("Kingdom of Bavaria", "outer") == "KINGDOM OF BAVARIA"
    assert names.lettered("Kingdom of Bavaria", "inner") == "Kingdom of Bavaria"


# Fitting


def box(lon0, lat0, lon1, lat1):
    return shapely.box(lon0, lat0, lon1, lat1)


def top(placed):
    """The full name's placement over the whole piece."""
    [found] = [p for p in placed if p["level"] == 0 and p["form"] == "full"]
    return found


def baseline_ends(p):
    """The two ends of a placement's span on the globe, lon/lat."""
    _, inverse = names.aeqd(p["lon"], p["lat"])
    a = math.radians(p["angle"])
    half = p["span"] / 2 * names.KM_PER_DEG
    ends = [[math.cos(a) * half * s, math.sin(a) * half * s] for s in (-1, 1)]
    return inverse(np.array(ends))


def test_a_name_runs_along_a_wide_state_and_stays_inside_it():
    shape = box(0, -2, 30, 2)
    placed = top(names.place(shape, "Long State", "Long State", "outer", 500_000, FACES, RULES))
    assert placed["level"] == 0 and placed["form"] == "full"
    assert abs(placed["angle"]) < 6
    assert placed["lon"] == pytest.approx(15, abs=1.5) and placed["lat"] == pytest.approx(0, abs=1)
    for lon, lat in baseline_ends(placed):
        assert shape.contains(shapely.Point(lon, lat))


def test_a_name_turns_to_run_along_a_tall_state():
    shape = box(0, -20, 3, 20)
    placed = top(names.place(shape, "Tall State", "Tall State", "outer", 500_000, FACES, RULES))
    assert abs(placed["angle"]) > 60


def test_a_name_shrinks_to_fit_a_state_smaller_than_its_letters():
    shape = box(0, 0, 0.5, 0.3)
    placed = top(
        names.place(shape, "Principality", "Principality", "inner", 2_000_000, FACES, RULES)
    )
    assert placed["fit"] < 0.5
    for lon, lat in baseline_ends(placed):
        assert shape.buffer(0.05).contains(shapely.Point(lon, lat))


def test_a_short_form_is_fitted_beside_the_full_one():
    shape = box(0, -2, 30, 2)
    placed = names.place(shape, "Kingdom of Bavaria", "Bavaria", "outer", 500_000, FACES, RULES)
    forms = {(p["form"], p["level"]) for p in placed}
    assert ("full", 0) in forms and ("short", 0) in forms
    short = next(p for p in placed if p["form"] == "short")
    full = next(p for p in placed if p["form"] == "full" and p["level"] == 0)
    assert short["span"] < full["span"]


def test_a_large_region_takes_its_name_again_in_smaller_windows():
    shape = box(40, 45, 140, 70)
    placed = names.place(shape, "Empire", "Empire", "outer", 15_000_000, FACES, RULES)
    levels = sorted({p["level"] for p in placed})
    assert levels[0] == 0 and len(levels) >= 2
    top = next(p for p in placed if p["level"] == 0)
    deeper = [p for p in placed if p["level"] == 1]
    assert len(deeper) >= 2
    assert all(p["em"] < top["em"] for p in deeper)


def test_nothing_fits_in_a_shape_with_no_area():
    assert names.place(shapely.Polygon(), "None", "None", "outer", 1, FACES, RULES) == []


# Jobs


def test_a_step_names_units_on_their_regions_and_members_inner():
    land = {
        "(Empire)": box(0, 0, 10, 10),
        "Member": box(20, 0, 24, 3),
        "Empire": box(10, 0, 12, 2),
        "Island": box(60, 0, 60.1, 0.1),
        "Lost": shapely.Polygon(),
    }
    outer = {
        "(Empire)": "(Empire)",
        "Member": "(Empire)",
        "Empire": "(Empire)",
        "Island": "Island",
        "Lost": "Lost",
    }
    jobs, unnamed = names.step_jobs(land, outer, RULES)
    by = {(j.polity, j.rank, j.piece): j for j in jobs}
    # The unit on its first region (two pieces within regionGapDeg), and its far member's region.
    assert by[("(Empire)", 0, 0)].plane == "outer"
    assert by[("(Empire)", 0, 0)].full == "Empire"
    # A member whose name is its unit's is named with the unit.
    assert not [j for j in jobs if j.polity == "Empire"]
    member = [j for j in jobs if j.polity == "Member"]
    assert member and all(j.plane == "inner" and j.kind == "member" for j in member)
    # A small independent state is on the inner plane, and a polity with no land is reported.
    assert by[("Island", 0, 0)].plane == "inner"
    assert unnamed == {"Lost": "no land on Natural Earth's coasts"}


def test_a_regions_second_piece_is_named_from_its_share_of_the_first():
    land = {"Two": shapely.union_all([box(0, 0, 10, 10), box(11, 0, 19, 8), box(0, 11, 1, 12)])}
    jobs, _ = names.step_jobs(land, {"Two": "Two"}, RULES)
    assert sorted(j.piece for j in jobs) == [0, 1]


# Records and chunks


def placed(name="State", lon=0, level=0, form="full", kind="outer", plane="outer"):
    return names.Placed(
        full=name,
        short=name,
        polity=name,
        kind=kind,
        plane=plane,
        km2=1000.0,
        rank=0,
        piece=0,
        form=form,
        level=level,
        lon=lon,
        lat=0,
        angle=0,
        em=100,
        span=1000,
    )


def test_consecutive_steps_drawing_an_equal_placement_share_one_record():
    a, b = placed("A"), placed("B")
    moved = placed("A", lon=5)
    records = names.merge([[a, b], [a, b], [moved, b], [a]])
    runs = sorted((r.placed.polity, r.placed.lon, r.first, r.last) for r in records)
    assert runs == [("A", 0, 0, 1), ("A", 0, 3, 3), ("A", 5, 2, 2), ("B", 0, 0, 2)]


def test_a_chunk_holds_each_record_it_meets_with_its_steps_inside_it():
    records = [
        names.Record(placed("A"), 0, 20),
        names.Record(placed("B", level=1), 17, 17),
        names.Record(placed("C", form="short", kind="member", plane="inner"), 3, 4),
    ]
    doc = names.chunk_document(16, list(range(1900, 1916)), records)
    assert doc["first"] == 16 and doc["fields"] == list(names.FIELDS)
    assert doc["names"] == [["A", "A"], ["B", "B"]]
    rows = [doc["place"][k : k + 11] for k in range(0, len(doc["place"]), 11)]
    assert [(r[0], r[1], r[2]) for r in rows] == [(0, 0, 4), (1, 1, 1)]
    assert rows[1][9] == 1 << names.LEVEL_SHIFT
    short = names.chunk_document(0, [1900, 1901, 1902, 1903, 1904], records)
    flags = short["place"][9 + 11 * 1]
    assert flags & names.FLAG_SHORT and flags & names.FLAG_INNER and flags & names.FLAG_MEMBER


def test_a_name_with_a_character_its_face_lacks_fails_naming_it():
    narrow = Face("Narrow", [Subset({c: 1 for c in range(0x20, 0x7F)}, (0, 600), 1000, 625)])
    step = [placed("Đại Việt")]
    with pytest.raises(names.NamesError, match="'Đại Việt' in Narrow: 'ĐẠỆ'"):
        names.check_glyphs([step], {"outer": narrow, "inner": narrow})


# The stage, on the fixture's two steps at 64 texels a face


@pytest.fixture(scope="module")
def staged(tmp_path_factory):
    folder = tmp_path_factory.mktemp("names")
    ctx = dataclasses.replace(
        make_context(Profile.FIXTURE, 1),
        out=folder / "out",
        stages_dir=folder / "stages",
        cache=folder / "cache",
    )
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(step_fields, "STEP_TEXELS", 64)
        patch.setattr(names, "load_faces", lambda repo, rules: FACES)
        patch.setattr(names, "faces_digest", lambda repo, rules: "test")
        borders.run(ctx)
        names.run(ctx)
        first = read_record(ctx, names.STAGE)
        names.run(ctx)  # again, from the cache
    return ctx, first, read_record(ctx, names.STAGE)


def test_the_stage_writes_a_chunk_of_both_steps_and_its_release_section(staged):
    ctx, record, _ = staged
    section = record["names"]
    steps = read_record(ctx, borders.STAGE)["steps"]
    assert section["steps"] == steps["ver"] and section["per"] == steps["previews"]["per"]
    assert len(section["keys"]) == 1
    data = (ctx.out / section["keys"][0]).read_bytes()
    assert len(data) == section["bytes"][0]
    doc = json.loads(gzip.decompress(data))
    assert doc["years"] == steps["years"]
    rows = [doc["place"][k : k + 11] for k in range(0, len(doc["place"]), 11)]
    assert len(rows) == section["placements"]
    assert {0, 1} <= {r[1] for r in rows} | {r[2] for r in rows}


def test_every_drawn_polity_is_named_or_reported(staged):
    ctx, record, _ = staged
    doc = json.loads(gzip.decompress((ctx.out / record["names"]["keys"][0]).read_bytes()))
    named = {full for full, _ in doc["names"]}
    reported = {entry["polity"] for entry in record["unnamed"]}
    polities = json.loads(
        (ctx.out / read_record(ctx, borders.STAGE)["steps"]["polities"]).read_text()
    )
    for raw in polities:
        if raw == "":
            continue
        shown = names.display(raw)
        assert (
            shown in named
            or raw in reported
            or any(names.display(run[2]) == shown for run in polities[raw]["steps"])
        ), raw


def test_a_rerun_from_the_cache_writes_the_same_chunks(staged):
    _, first, again = staged
    assert again == first


def test_the_record_lists_names_still_long_after_the_short_name_rule(staged):
    _, record, _ = staged
    for entry in record["longNames"]:
        assert entry["length"] == len(entry["name"]) > RULES.long_name
        assert entry["name"] == names.short_name(entry["full"], RULES)
