import dataclasses
import gzip
import json

import numpy as np
import pytest
import shapely

from prebuild import border_fields, borders, cube, step_fields
from prebuild import cliopatria as clio
from prebuild.fields import SUBPIXELS
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record
from prebuild.sources import Source, SourceFile, load_sources

TEXELS = 64  # a small face: 56 texels across it and a 4-texel apron
CENTER = TEXELS // 2  # texel 32 is the first east of s = 0, 31 the last west of it


def square(west, south, east, north, name):
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {
        "type": "Feature",
        "properties": {"NAME": name, "SUBJECTO": name},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


# Two squares on face 0, one border between them along the prime meridian (s = 0), with sea
# around them.
SNAPSHOT = {
    "type": "FeatureCollection",
    "features": [square(-10, -10, 0, 10, "West"), square(0, -10, 10, 10, "East")],
}


def texels(field: np.ndarray) -> np.ndarray:
    return (field.astype(np.float64) - 128) / 16


@pytest.fixture(scope="module")
def face0():
    return texels(borders.face_field(0, borders.polities(SNAPSHOT), TEXELS))


def test_the_border_lies_half_a_texel_from_the_texels_either_side_of_it(face0):
    equator = face0[CENTER]
    assert equator[CENTER - 1] == pytest.approx(0.5, abs=1 / 16)
    assert equator[CENTER] == pytest.approx(-0.5, abs=1 / 16)
    assert equator[CENTER + 2] == pytest.approx(-2.5, abs=1 / 16)
    assert equator[CENTER - 5] == pytest.approx(4.5, abs=1 / 16)


def test_the_border_runs_on_across_the_sea_but_never_along_a_coast(face0):
    # The squares' coasts lie at 10° N, S, E and W, about 6 texels from the center; the sea
    # beyond them takes the nearer polity, so the meridian's is the only border, over land and sea.
    assert np.all(np.abs(face0[:, CENTER - 1 : CENTER + 1]) <= 0.5 + 1 / 16)
    near_a_border = np.argwhere(np.abs(face0) < 2)
    assert set(near_a_border[:, 1].tolist()) == set(range(CENTER - 2, CENTER + 2))


# A polygon of the Tsardom of Russia in the 1609 step with the land carried through the Time of
# Troubles, cut to two degrees about a thin spike whose two edges segmentizing makes cross, so GEOS
# returns it as three polygons.
SPIKED = shapely.Polygon(
    [
        (36.73762512207031, 55.63479995727539),
        (36.65000534057617, 55.63479995727539),
        (36.71207809448242, 55.90821838378906),
        (36.88772964477539, 55.90821838378906),
        (37.28913879394531, 56.86860656738281),
        (36.91434917580165, 55.97190672548055),
        (36.18, 55.92676973629439),
        (36.18, 57.62),
        (38.18, 57.62),
        (38.18, 55.62),
        (36.73050074892969, 55.62),
    ]
)


def test_a_polygon_segmentizing_splits_is_drawn_whole():
    assert shapely.get_type_id(shapely.segmentize(SPIKED, border_fields.SEGMENT_DEG)) == 6
    inside = [(37.7, 57.2), (36.5, 56.8), (37.9, 55.8)]
    face = int(cube.face_of(cube.lonlat_to_dir(*inside[0])))
    interior = 1016
    ids = border_fields.rasterize(face, [border_fields.Polity(2, SPIKED, 1.0)], interior)
    origin = SUBPIXELS * (border_fields.APRON + border_fields.MARGIN_TEXELS)
    for lon, lat in inside:
        s, t = cube.face_st(face, cube.lonlat_to_dir(lon, lat))
        row = int((t + 1) / 2 * interior * SUBPIXELS) + origin
        column = int((s + 1) / 2 * interior * SUBPIXELS) + origin
        assert ids[row, column] == 2


def test_a_correction_gives_one_part_of_a_polity_to_another():
    split = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"NAME": "Empire", "SUBJECTO": "Empire"},
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [
                        square(0, 0, 1, 1, "")["geometry"]["coordinates"],
                        square(5, 0, 6, 1, "")["geometry"]["coordinates"],
                    ],
                },
            },
            {**square(6, 0, 7, 1, "Kingdom"), "properties": {"NAME": " ", "SUBJECTO": "Kingdom"}},
        ],
    }
    fix = borders.Correction("Empire", "Kingdom", (5.5, 0.5), "why", {})
    fixed = borders.correct(split, [fix])
    empire, kingdom = fixed["features"]
    assert empire["geometry"]["coordinates"] == [square(0, 0, 1, 1, "")["geometry"]["coordinates"]]
    assert len(kingdom["geometry"]["coordinates"]) == 2
    assert split["features"][0]["geometry"]["type"] == "MultiPolygon"  # the source is untouched


# The stage, on the two squares, at 64 texels a face


@pytest.fixture
def built(monkeypatch, tmp_path):
    path = tmp_path / "world_1815.geojson"
    path.write_text(json.dumps(SNAPSHOT), encoding="utf-8")
    url = "https://example.org/da7a4b7/world_1815.geojson"
    source = Source(
        id=borders.SOURCE,
        name="historical-basemaps",
        version="da7a4b7",
        license="GPL-3.0",
        license_url="https://www.gnu.org/licenses/gpl-3.0.html",
        attribution="historical-basemaps, by its contributors",
        landing_page="https://example.org/historical-basemaps",
        retrieved="2026-09-27",
        files=(SourceFile(f"sources/{borders.SOURCE}/world_1815.geojson", 1, "0" * 64, url),),
        unzipped=(),
    )
    fix = borders.Correction(
        "West",
        "East",
        None,
        "It was never West's.",
        {
            "title": "A treaty",
            "publisher": "An archive",
            "url": "https://example.org/treaty",
        },
    )
    monkeypatch.setattr(borders, "FACE_TEXELS", TEXELS)
    monkeypatch.setattr(borders, "load_sources", lambda: {borders.SOURCE: source})
    monkeypatch.setattr(borders, "verified_path", lambda ctx, source, filename: path)
    monkeypatch.setattr(
        borders, "load_corrections", lambda stem: borders.Corrections("2026-09-27", (fix,))
    )
    ctx = make_context(Profile.REGION, 1, tmp_path)
    borders.run(ctx)
    return ctx, read_record(ctx, borders.STAGE)


def test_the_record_names_the_field_its_notice_and_its_corrected_source(built):
    ctx, record = built
    files = record["files"]["1815"]
    assert (record["stems"], record["years"]) == (["1815"], [1815])
    assert files["key"] == f"fd/borders/{record['ver']}/1815.bin"
    stored = (ctx.out / files["key"]).read_bytes()
    assert files["bytes"] == len(stored)
    year, faces = borders.from_file(stored)
    assert (year, faces.shape) == (1815, (6, TEXELS, TEXELS))
    corrected = json.loads((ctx.out / files["source"]).read_bytes())
    assert [f["properties"]["NAME"] for f in corrected["features"]] == ["East"]
    assert files["notice"].startswith("lic/") and files["source"].endswith(".geojson")


def test_the_notice_names_the_source_the_license_the_changes_and_the_build_scripts(built):
    ctx, record = built
    text = (ctx.out / record["files"]["1815"]["notice"]).read_text(encoding="utf-8")
    for line in (
        "https://example.org/da7a4b7/world_1815.geojson",
        "https://www.gnu.org/licenses/gpl-3.0.txt",
        "Changed for Wander on 2026-09-27:",
        "https://example.org/treaty",
        record["files"]["1815"]["source"],
        f"https://github.com/tcole333/wander/tree/borders-{record['ver']}/pipeline",
    ):
        assert line in text


def test_a_correction_that_joins_the_only_two_polities_leaves_no_border(built):
    ctx, record = built
    _, faces = borders.from_file((ctx.out / record["files"]["1815"]["key"]).read_bytes())
    assert np.all(faces == 255)


STEP_TEXELS = 64
RULES = clio.Rules(50_000, 100, 14, 100_000, 2_000, 0.5)
CITED = {"title": "A history", "publisher": "A press", "url": "https://example.org"}


def rename(years):
    op = clio.Rename("Duchy", "Grand Duchy")
    return clio.Correction("1800-1913", 1, years, "why", CITED, op)


# The border steps, on the fixture's excerpt at 64 texels a face


@pytest.fixture(scope="module")
def staged(tmp_path_factory):
    folder = tmp_path_factory.mktemp("borders")
    ctx = dataclasses.replace(
        make_context(Profile.FIXTURE, 1),
        out=folder / "out",
        stages_dir=folder / "stages",
        cache=folder / "cache",
    )
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(step_fields, "STEP_TEXELS", STEP_TEXELS)
        borders.run(ctx)
        first = read_record(ctx, borders.STAGE)
        borders.run(ctx)  # again, from the cache
    return ctx, first, read_record(ctx, borders.STAGE)


def test_the_stage_writes_the_fixtures_two_steps_their_previews_polities_and_notice(staged):
    ctx, record, _ = staged
    steps = record["steps"]
    assert steps["years"] == [1815, 1830]
    assert (steps["size"], steps["apron"]) == (STEP_TEXELS, 4)
    for key, size, year in zip(steps["keys"], steps["bytes"], steps["years"], strict=True):
        assert key.startswith("fd/borders/s/") and key.endswith(".bin")
        data = (ctx.out / key).read_bytes()
        assert len(data) == size
        stored_year, faces = step_fields.read_step(data)
        assert stored_year == year and faces.shape == (6, STEP_TEXELS, STEP_TEXELS, 2)
    assert steps["previews"]["per"] == step_fields.PER_CHUNK
    [chunk] = steps["previews"]["keys"]
    years, layers = step_fields.read_chunk((ctx.out / chunk).read_bytes())
    assert years == [1815, 1830] and layers.shape[0] == 2
    polities = json.loads((ctx.out / steps["polities"]).read_bytes())
    # The Indies British from 1812 to 1816 (1800-1913.yaml), and Sumbawa's states of 1815 Dutch
    # members all the same (owner decision 37)
    assert polities["Dutch East Indies"]["steps"] == [[1830, 1830, "(Netherlands)"]]
    assert polities["Kingdom of Tambora"]["steps"] == [[1815, 1815, "(Netherlands)"]]
    notice = (ctx.out / steps["notice"]).read_text(encoding="utf-8")
    for line in ("Cliopatria", "https://creativecommons.org/licenses/by/4.0/", "Bennett"):
        assert line in notice
    assert "files" not in record  # the fixture bakes no 1815 field


def test_the_stage_records_the_beats_steps_and_what_the_history_pass_owes(staged):
    ctx, record, _ = staged
    assert record["beats"] == {
        "tambora": {
            "world-1815": 1815,
            "europe-1816": 1815,
            "new-england-1816": 1815,
            "yunnan-bengal-1817": 1815,
        }
    }
    assert record["unacknowledged"] == []  # the era files settle the Cape's pair
    assert set(record["unclassified"]) == {"composites", "relations"}
    assert record["inputs"]["code"]
    queue = json.loads((ctx.stages_dir / clio.REVIEW).read_text(encoding="utf-8"))
    assert queue["steps"] == [1815, 1830]
    for name in (borders.SHORES, borders.LAND):
        faces = gzip.decompress((ctx.stages_dir / name).read_bytes())
        assert len(faces) == 6 * STEP_TEXELS * STEP_TEXELS
    assert "1800-1913.yaml correction 2 (give, 1812-1816)" in queue["byStep"]["1815"]["corrections"]


def test_a_second_run_takes_every_step_from_the_cache_and_writes_the_same_record(staged):
    _, first, second = staged
    assert first == second


def test_a_border_beat_before_the_first_step_fails(tmp_path):
    story = tmp_path / "stories" / "voyage"
    story.mkdir(parents=True)
    beat = '```beat\nid: sail\ndate: "1519-09-20"\nlayers: [relief, borders]\n```\n'
    (story / "story.md").write_text(beat, encoding="utf-8")
    assert borders.border_beats(tmp_path, [1500, 1520]) == {"voyage": {"sail": 1500}}
    with pytest.raises(borders.BordersError, match="before the first border step"):
        borders.border_beats(tmp_path, [1520])


def test_a_step_holds_from_its_first_of_january_in_the_historical_calendar():
    assert borders.first_day(1583) - borders.first_day(1582) == 365 - 10
    assert borders.first_day(1) == -2  # 1 January 1 CE (Julian) is 30 December 1 BCE


def test_each_correction_is_described_in_the_notice():
    config = clio.Config(
        clio.Hierarchy({}, {}, {}),
        RULES,
        (
            rename((1815, 1816)),
            clio.Correction("bce", 1, (-43, -43), "Checked.", None, clio.Overlap(("A", "B"), "A")),
            clio.Correction(
                "1800-1913",
                2,
                (1877, 1877),
                "Held.",
                CITED,
                clio.Pocket((-103.4, 47.5), to="United States of America"),
            ),
            clio.Correction(
                "1800-1913",
                3,
                (1900, 1900),
                "Treaties.",
                CITED,
                clio.Pocket((8.0, 8.0), to="British Africa", shape_from=("British Africa", 1905)),
            ),
            clio.Correction(
                "1800-1913", 4, (1677, 1677), "No state.", CITED, clio.Pocket((-74.7, 41.7), True)
            ),
        ),
        {"1800-1913.yaml": "2026-09-29"},
    )
    text = " ".join(borders.steps_notice(load_sources()[clio.SOURCE], config).split())
    assert "1815-1816: Duchy is named Grand Duchy. why Source: A history" in text
    assert "44 BCE: where A and B overlap, A keeps the land. Checked." in text
    assert "1877: the stateless land at -103.4, 47.5 is drawn as United States of America." in text
    assert (
        "1900: the part of the stateless land at 8.0, 8.0 inside British Africa's shape of 1905 "
        "is drawn as British Africa."
    ) in text
    assert "1677: the stateless land at -74.7, 41.7 stays stateless. No state." in text
    assert "last on 2026-09-29" in text
