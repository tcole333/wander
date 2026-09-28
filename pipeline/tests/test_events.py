import gzip
import json
import math

import pytest

from prebuild import events
from prebuild.config import load_event_classes
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record
from prebuild.sources import Source, SourceFile
from prebuild.wikidata import COLUMNS

BATTLE, WAR = "Q178561", "Q198"
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
    assert (tambora.t0, tambora.t1) == ((1813, 4, 7), (1815, 12, 31))
    assert tambora.score == pytest.approx(math.log2(11) * 1.0)


def test_a_war_dated_at_its_end_still_spans_its_years():
    war = indexed(
        row("Q361", "P580", "1914-07-28T00:00:00Z", 11, cls=WAR),
        row("Q361", "P585", "1918-11-11T00:00:00Z", 11, cls=WAR),
        row("Q361", "P582", "1918-11-11T00:00:00Z", 11, cls=WAR),
    )["Q361"]
    assert (war.day, war.t0, war.t1) == ((1918, 11, 11), (1914, 7, 28), (1918, 11, 11))


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
    ctx = make_context(Profile.GLOBAL, 1, tmp_path)
    events.run(ctx)
    table = gzip.decompress((ctx.out / events.KEY).read_bytes()).decode().splitlines()
    assert table[0].split("\t") == list(events.COLUMNS)
    assert [line.split("\t")[:3] for line in table[1:]] == [
        ["Q48314", "Battle", "Battle"],
        ["Q10", 'The "Peace"', 'The "Peace"'],
    ]
    assert table[1].split("\t")[4:] == [
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
