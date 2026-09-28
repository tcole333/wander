import json

import numpy as np
import pytest

from prebuild import borders
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record
from prebuild.sources import Source, SourceFile

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
