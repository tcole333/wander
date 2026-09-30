import csv
import gzip
import json
import math
from dataclasses import replace

import pytest

from prebuild import events
from prebuild.config import CuratedDays, load_event_classes
from prebuild.excerpts import select_events
from prebuild.hashing import sha256_file
from prebuild.paths import excerpts_dir
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record
from prebuild.sources import Source, SourceFile
from prebuild.wikidata import COLUMNS

BATTLE, WAR = "Q178561", "Q198"
DISASTER, ERUPTION, EARTHQUAKE = "Q8065", "Q7692360", "Q7944"
RIOT, MASSACRE, SHIPWRECK = "Q124757", "Q3199915", "Q906512"
CONFLAGRATION, WILDFIRE = "Q168983", "Q169950"
HEADER = "\t".join(("?class", *COLUMNS))


def row(
    qid: str,
    prop: str,
    date: str,
    precision: int,
    *,
    cls: str = BATTLE,
    label: str = '"Battle"@en',
    coord: str = "POINT(4.412222 50.678056)",
    place: str = "",
    editions: int = 10,
    parents: str = "",
) -> str:
    """One line of an export, as QLever writes its TSV terms."""
    return "\t".join(
        (
            cls,
            f"<http://www.wikidata.org/entity/{qid}>",
            label,
            label,
            f'"{prop}"',
            date,
            str(precision),
            coord,
            place,
            str(editions),
            f'"{parents}"' if parents else "",
        )
    )


def indexed(*rows: str) -> dict[str, events.Event]:
    statements = events.read_export([HEADER, *rows])
    return {e.qid: e for e in events.index(statements, load_event_classes(), {})}


def test_an_event_takes_its_heaviest_class_and_its_point_in_time_within_its_span():
    tambora = indexed(
        row("Q3591483", "P580", "1813-04-07T00:00:00Z", 11),
        row("Q3591483", "P585", "1815-01-01T00:00:00Z", 9),
        row("Q3591483", "P582", "1815-07-15T00:00:00Z", 11),
        row("Q3591483", "P585", "1815-01-01T00:00:00Z", 9, cls=WAR),
    )["Q3591483"]
    assert (tambora.cls, tambora.day, tambora.precision) == ("war", (1815, 1, 1), 9)
    assert tambora.display == "war"  # its two classes hold one event each: the heavier shows
    assert (tambora.t0, tambora.t1) == ((1813, 4, 7), (1815, 12, 31))
    assert tambora.score == pytest.approx(math.log2(11) * 1.0)


def test_an_event_is_displayed_as_its_most_specific_class_and_scored_by_its_heaviest():
    kept = indexed(
        row("Q3591483", "P585", "1815-04-10T00:00:00Z", 11, cls=DISASTER, editions=40),
        row("Q3591483", "P585", "1815-04-10T00:00:00Z", 11, cls=ERUPTION, editions=40),
        row("Q212618", "P585", "1960-05-22T00:00:00Z", 11, cls=DISASTER),
        row("Q212618", "P585", "1960-05-22T00:00:00Z", 11, cls=EARTHQUAKE),
        row("Q1", "P585", "1816-06-01T00:00:00Z", 11, cls=DISASTER),
    )
    tambora = kept["Q3591483"]
    assert (tambora.cls, tambora.display) == ("natural disaster", "volcanic eruption")
    assert tambora.score == pytest.approx(math.log2(41) * 0.75)
    assert (kept["Q212618"].cls, kept["Q212618"].display) == ("natural disaster", "earthquake")
    assert (kept["Q1"].cls, kept["Q1"].display) == ("natural disaster", "natural disaster")


def sharing(heavier: str, rarer: str) -> events.Event:
    """Q1, exported under both classes, in an export that gives the rarer class one event the
    heavier lacks: they share events, but neither holds the other's."""
    day = "1900-01-01T00:00:00Z"
    return indexed(
        row("Q1", "P585", day, 11, cls=heavier),
        row("Q1", "P585", day, 11, cls=rarer),
        row("Q2", "P585", day, 11, cls=rarer),
        row("Q3", "P585", day, 11, cls=heavier),
        row("Q4", "P585", day, 11, cls=heavier),
    )["Q1"]


def test_a_riot_that_is_also_a_massacre_keeps_its_heaviest_class_s_glyph():
    riot = sharing(heavier=MASSACRE, rarer=RIOT)
    assert (riot.cls, riot.display) == ("massacre", "massacre")


def test_a_battle_that_is_also_a_shipwreck_keeps_its_heaviest_class_s_glyph():
    battle = sharing(heavier=BATTLE, rarer=SHIPWRECK)
    assert (battle.cls, battle.display) == ("battle", "battle")


def test_a_class_nested_within_another_than_the_heaviest_is_not_displayed():
    # Wildfires are conflagrations, but not natural disasters: a fire exported as all three is
    # scored and displayed as the natural disaster.
    day = "1900-01-01T00:00:00Z"
    kept = indexed(
        *(row("Q1", "P585", day, 11, cls=c) for c in (DISASTER, CONFLAGRATION, WILDFIRE)),
        row("Q2", "P585", day, 11, cls=CONFLAGRATION),
        row("Q2", "P585", day, 11, cls=WILDFIRE),
        row("Q3", "P585", day, 11, cls=CONFLAGRATION),
        *(row(qid, "P585", day, 11, cls=DISASTER) for qid in ("Q4", "Q5")),
    )
    assert (kept["Q1"].cls, kept["Q1"].display) == ("natural disaster", "natural disaster")
    assert (kept["Q2"].cls, kept["Q2"].display) == ("conflagration", "wildfire")


def test_a_war_dated_at_its_end_still_spans_its_years():
    war = indexed(
        row("Q361", "P580", "1914-07-28T00:00:00Z", 11, cls=WAR),
        row("Q361", "P585", "1918-11-11T00:00:00Z", 11, cls=WAR),
        row("Q361", "P582", "1918-11-11T00:00:00Z", 11, cls=WAR),
    )["Q361"]
    assert (war.day, war.t0, war.t1) == ((1918, 11, 11), (1914, 7, 28), (1918, 11, 11))


def test_a_curated_date_stands_in_for_wikidata_s_and_the_span_widens_to_hold_it():
    statements = events.read_export(
        [
            HEADER,
            row("Q3656338", "P580", "1817-09-29T00:00:00Z", 11, cls=WAR),
            row("Q3656338", "P582", "1818-09-09T00:00:00Z", 11, cls=WAR),
        ]
    )
    [nejd] = events.index(
        statements, load_event_classes(), {}, {"Q3656338": CuratedDays("1816-09-30")}
    )
    assert (nejd.day, nejd.precision) == ((1816, 9, 30), 11)
    assert (nejd.t0, nejd.t1) == ((1816, 9, 30), (1818, 9, 9))


def test_a_curated_date_leaves_the_date_it_corrects_out_of_the_span():
    statements = events.read_export(
        [
            HEADER,
            row("Q4870957", "P585", "1815-10-17T00:00:00Z", 11),
            row("Q4870957", "P585", "1815-10-17T00:00:00Z", 11, cls=WAR),
        ]
    )
    [roble] = events.index(
        statements, load_event_classes(), {}, {"Q4870957": CuratedDays("1813-10-17")}
    )
    assert (roble.day, roble.t0, roble.t1) == ((1813, 10, 17), (1813, 10, 17), (1813, 10, 17))


def test_a_curated_day_before_the_reform_is_read_in_the_julian_calendar():
    statements = events.read_export([HEADER, row("Q1", "P585", "1453-06-01T00:00:00Z", 11)])
    [fall] = events.index(statements, load_event_classes(), {}, {"Q1": CuratedDays("1453-05-29")})
    assert (fall.day, events.format_historical(fall.day)) == ((1453, 6, 7), "29 May 1453")


def test_a_curated_end_stands_in_for_wikidata_s_end_times():
    statements = events.read_export(
        [
            HEADER,
            row("Q160077", "P580", "1453-04-15T00:00:00Z", 11),
            row("Q160077", "P582", "1453-05-29T00:00:00Z", 11),  # unconverted
            row("Q160077", "P582", "1453-05-20T00:00:00Z", 11),
        ]
    )
    curated = {"Q160077": CuratedDays(end="1453-05-29")}
    [fall] = events.index(statements, load_event_classes(), {}, curated)
    assert (events.format_historical(fall.t0), events.format_historical(fall.t1)) == (
        "6 April 1453",
        "29 May 1453",
    )


def test_a_curated_place_stands_in_for_an_event_s_coordinates_and_its_location_s():
    statements = events.read_export(
        [
            HEADER,
            row(
                "Q191055",
                "P585",
                "1755-11-01T00:00:00Z",
                11,
                cls=EARTHQUAKE,
                coord="POINT(-11.000000 36.000000)",
                place="POINT(-9.139016 38.708042)",
            ),
            row("Q2", "P585", "1755-11-01T00:00:00Z", 11, coord="", place="POINT(1 2)"),
        ]
    )
    places = {"Q191055": (-9.14, 38.71), "Q2": (3.0, 4.0)}
    kept = {e.qid: e for e in events.index(statements, load_event_classes(), {}, places=places)}
    assert (kept["Q191055"].lon, kept["Q191055"].lat, kept["Q191055"].inherited) == (
        -9.14,
        38.71,
        False,
    )
    assert (kept["Q2"].lon, kept["Q2"].lat, kept["Q2"].inherited) == (3.0, 4.0, False)


def test_of_several_dates_the_most_precise_wins_then_the_earliest():
    kept = indexed(
        row("Q1", "P585", "1816-06-01T00:00:00Z", 10),
        row("Q1", "P585", "1816-06-19T00:00:00Z", 11),
        row("Q2", "P580", "-0480-08-20T00:00:00Z", 11),
        row("Q2", "P580", "-0480-08-11T00:00:00Z", 11),
    )
    assert kept["Q1"].day == (1816, 6, 19)
    assert kept["Q2"].day == (-480, 8, 11)
    assert events.iso(kept["Q2"].day) == "-0480-08-11"


# Proleptic Gregorian days, as the export holds them, and the dates history writes for them, as
# app/src/story/dates.test.ts has them.
HISTORICAL_DATES = [
    ((1066, 10, 20), (1066, 10, 14)),  # Hastings
    ((-43, 3, 13), (-43, 3, 15)),  # Caesar's death
    ((-30, 8, 31), (-30, 9, 2)),  # Actium
    ((1571, 10, 17), (1571, 10, 7)),  # Lepanto
    ((1500, 3, 10), (1500, 2, 29)),  # a Julian leap day
    ((0, 12, 30), (1, 1, 1)),
    ((1, 1, 1), (1, 1, 3)),
    ((-9999, 1, 1), (-9999, 3, 19)),
    ((1582, 10, 14), (1582, 10, 4)),  # the last Julian day
    ((1582, 10, 15), (1582, 10, 15)),  # the first Gregorian day
    ((1815, 6, 18), (1815, 6, 18)),  # Waterloo
    ((2000, 12, 31), (2000, 12, 31)),
]


@pytest.mark.parametrize(("day", "written"), HISTORICAL_DATES)
def test_history_writes_the_days_before_the_reform_in_the_julian_calendar(day, written):
    assert events.historical(day) == written
    assert events.from_historical(written) == day


def test_the_day_numbers_count_from_1_january_1_ce_in_both_calendars():
    assert events.day_number(1, 1, 1) == events.julian_day_number(1, 1, 3) == 0
    assert events.day_number(1066, 10, 20) == events.julian_day_number(1066, 10, 14)
    for number in range(-800_000, 800_000, 997):
        assert events.day_number(*events.civil(number)) == number
        assert events.julian_day_number(*events.julian_civil(number)) == number


def test_hastings_and_caesar_s_death_read_as_history_dates_them():
    assert events.format_historical((1066, 10, 20)) == "14 October 1066"
    assert events.format_historical((-43, 3, 13)) == "15 March 44 BCE"
    assert events.format_historical((-43, 3, 13), events.MONTH) == "March 44 BCE"
    assert events.format_historical(events.from_historical((-700, 1, 1)), events.YEAR) == "701 BCE"


def test_the_calendar_switches_from_4_to_15_october_1582():
    assert events.format_historical((1582, 10, 14)) == "4 October 1582"
    assert events.format_historical((1582, 10, 15)) == "15 October 1582"
    for day in (5, 10, 14):
        with pytest.raises(ValueError, match="gap"):
            events.from_historical((1582, 10, day))


@pytest.mark.parametrize(
    ("date", "precision", "first", "last"),
    [
        ((1066, 1, 1), events.YEAR, (1066, 1, 7), (1067, 1, 6)),
        ((-700, 1, 1), events.YEAR, (-701, 12, 24), (-700, 12, 24)),  # a Julian leap year
        ((1500, 2, 1), events.MONTH, (1500, 2, 10), (1500, 3, 10)),  # 29 days
        ((1582, 10, 1), events.MONTH, (1582, 10, 11), (1582, 10, 31)),
        ((1582, 1, 1), events.YEAR, (1582, 1, 11), (1582, 12, 31)),
        ((1815, 1, 1), events.YEAR, (1815, 1, 1), (1815, 12, 31)),
        ((1066, 10, 14), events.DAY, (1066, 10, 20), (1066, 10, 20)),
    ],
)
def test_a_year_or_month_names_its_days_in_the_historical_calendar(date, precision, first, last):
    assert events.named_days(date, precision) == (first, last)


def test_a_year_or_month_before_the_reform_spans_it_as_its_sources_write_it():
    kept = indexed(
        row("Q1", "P585", "1066-01-01T00:00:00Z", 9),
        row("Q2", "P585", "1520-12-01T00:00:00Z", 10),
        row("Q3", "P585", "-0700-01-01T00:00:00Z", 9),
        row("Q4", "P585", "1066-10-20T00:00:00Z", 11),
        row("Q5", "P580", "1337-05-24T00:00:00Z", 11),
        row("Q5", "P582", "1453-01-01T00:00:00Z", 9),
    )
    assert (kept["Q1"].day, kept["Q1"].t0, kept["Q1"].t1) == (
        (1066, 1, 7),
        (1066, 1, 7),
        (1067, 1, 6),
    )
    assert (kept["Q2"].day, kept["Q2"].t1) == ((1520, 12, 11), (1521, 1, 10))
    assert events.format_historical(kept["Q3"].day, kept["Q3"].precision) == "701 BCE"
    assert events.format_historical(kept["Q3"].t1, kept["Q3"].precision) == "701 BCE"
    # A day is exported in the Gregorian calendar already, and stays as it is.
    assert (kept["Q4"].day, kept["Q4"].t0, kept["Q4"].t1) == ((1066, 10, 20),) * 3
    assert (kept["Q5"].t0, kept["Q5"].t1) == ((1337, 5, 24), (1454, 1, 9))
    assert events.iso(kept["Q2"].day) == "1520-12-11"


def test_events_without_a_label_a_place_a_year_or_an_edition_are_dropped():
    kept = indexed(
        row("Q1", "P585", "1815-06-18T00:00:00Z", 11, label=""),
        row("Q2", "P585", "1815-06-18T00:00:00Z", 11, coord="POINT(0 0)"),
        row("Q3", "P585", "1810-01-01T00:00:00Z", 8),
        row("Q4", "P585", "1815-06-18T00:00:00Z", 11, editions=0),
        row("Q5", "P585", "1815-06-18T00:00:00Z", 11, coord="", place="POINT(118.0 -8.25)"),
        row(
            "Q6",
            "P585",
            "1815-06-18T00:00:00Z",
            11,
            coord="<http://www.wikidata.org/entity/Q405> POINT(1 2)",
        ),
    )
    assert list(kept) == ["Q5"]
    assert (kept["Q5"].lon, kept["Q5"].lat, kept["Q5"].inherited) == (118.0, -8.25, True)


def test_the_stage_writes_the_table_in_score_order_with_its_record(monkeypatch, tmp_path):
    export = tmp_path / "events.tsv.gz"
    lines = [
        HEADER,
        row("Q10", "P585", "1815-02-17T00:00:00Z", 11, label='"The \\"Peace\\""@en', editions=3),
        row("Q48314", "P585", "1815-06-18T00:00:00Z", 11, editions=94, parents="Q18643473 Q7"),
    ]
    export.write_bytes(gzip.compress(("\n".join(lines) + "\n").encode()))
    meta = tmp_path / "export.json"
    classes = {c.qid: 1 for c in load_event_classes()}
    meta.write_text(json.dumps({"exported": "2026-09-27T20:00:00Z", "rows": classes}))
    pin = SourceFile(
        path="sources/wikidata-events-20260927/x", bytes=1, sha256="0" * 64, source_url=None
    )
    source = Source("wikidata-events-20260927", "", "", "", "", "", None, "", (pin,), ())
    monkeypatch.setattr(events, "load_sources", lambda: {source.id: source})
    paths = {"events.tsv.gz": export, "export.json": meta}
    monkeypatch.setattr(events, "verified_path", lambda ctx, source_id, name: paths[name])
    monkeypatch.setattr(events, "load_event_boosts", lambda **_: {})  # ignore Waterloo's boost
    ctx = make_context(Profile.GLOBAL, 1, tmp_path)
    events.run(ctx)
    table = gzip.decompress((ctx.out / events.KEY).read_bytes()).decode().splitlines()
    assert table[0].split("\t") == list(events.COLUMNS)
    assert [line.split("\t")[:3] for line in table[1:]] == [
        ["Q48314", "Battle", "Battle"],
        ["Q10", 'The "Peace"', 'The "Peace"'],
    ]
    assert table[1].split("\t")[3:] == [
        "battle",
        "battle",
        "1815-06-18",
        "11",
        "1815-06-18",
        "1815-06-18",
        "4.41222",
        "50.67806",
        "0",
        "94",
        "3.6134",
        "Q7 Q18643473",
    ]
    record = read_record(ctx, events.STAGE)
    assert {k: record[k] for k in ("export", "exported", "rows")} == {
        "export": "wikidata-events-20260927",
        "exported": "2026-09-27T20:00:00Z",
        "rows": 2,
    }
    assert record["bytes"] == (ctx.out / events.KEY).stat().st_size
    assert record["inputs"] == events.inputs("wikidata-events-20260927")


def test_excerpt_keeps_all_statements_and_exported_ancestors_in_source_order():
    lines = [
        HEADER + "\n",
        *[
            r + "\n"
            for r in (
                row("Q1", "P580", "1800-01-01T00:00:00Z", 9, parents="Q2"),
                row("Q1", "P582", "1815-06-18T00:00:00Z", 11, cls=WAR),
                row("Q2", "P585", "1790-01-01T00:00:00Z", 9, parents="Q3 Q99"),
                row("Q3", "P585", "1780-01-01T00:00:00Z", 9, parents="Q1"),
                row("Q4", "P585", "1900-01-01T00:00:00Z", 9),
            )
        ],
    ]
    assert select_events(lines, (1815, 1817)) == lines[:-1]


def test_fixture_scores_real_events_with_dates_places_classes_and_parents(tmp_path):
    ctx = replace(
        make_context(Profile.FIXTURE, 1), out=tmp_path / "out", stages_dir=tmp_path / "stages"
    )
    events.run(ctx)
    with gzip.open(ctx.out / events.KEY, "rt", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    by_qid = {row["qid"]: row for row in rows}
    waterloo = by_qid["Q48314"]
    assert (waterloo["date"], waterloo["precision"], waterloo["class"], waterloo["display"]) == (
        "1815-06-18",
        "11",
        "battle",
        "battle",
    )
    # Tambora is scored as the heavier natural disaster and drawn as the eruption it is.
    assert (by_qid["Q3591483"]["class"], by_qid["Q3591483"]["display"]) == (
        "natural disaster",
        "volcanic eruption",
    )
    assert (float(waterloo["lon"]), float(waterloo["lat"])) == pytest.approx((4.41222, 50.67806))
    assert waterloo["inherited"] == "0"
    assert waterloo["parents"] == "Q18643473"
    assert by_qid["Q18643473"]["parents"] == "Q199955"
    assert float(waterloo["score"]) == pytest.approx(math.log2(95) * 0.55 + 1.5, abs=0.00005)
    # Its war's start is outside the date slice; keep it and the complete span anyway.
    napoleonic = by_qid["Q78994"]
    assert (napoleonic["t0"], napoleonic["t1"], napoleonic["inherited"]) == (
        "1803-01-01",
        "1815-12-31",
        "1",
    )
    # A real curated correction replaces the bad source date even though it leaves the slice.
    roble = by_qid["Q4870957"]
    assert roble["date"] == roble["t0"] == roble["t1"] == "1813-10-17"
    assert [float(row["score"]) for row in rows] == sorted(
        (float(row["score"]) for row in rows), reverse=True
    )
    record = read_record(ctx, events.STAGE)
    assert record["export"] == "wikidata-events-20260928"
    assert record["rows"] == len(rows) == sum(record["classes"].values())
    assert record["inputs"][events.TABLE] == sha256_file(excerpts_dir() / "events" / events.TABLE)
    before = (ctx.out / events.KEY).read_bytes()
    events.run(ctx)
    assert (ctx.out / events.KEY).read_bytes() == before
