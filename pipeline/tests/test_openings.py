import gzip
import hashlib
import json

import pytest
import yaml

from prebuild import events, meanwhile
from prebuild import openings as o
from prebuild.paths import REPO_ROOT
from prebuild.profiles import Profile, make_context

SOURCE = {"title": "Battle of Waterloo (Wikipedia)", "url": "https://example.org/waterloo"}


def event(qid, date, *, until=None, precision=11, parents=(), cls="battle", label=None):
    day = meanwhile.iso_day(date)
    return meanwhile.Event(
        qid=qid,
        label=label or qid,
        enwiki=qid,
        date=day,
        precision=precision,
        t0=day,
        t1=meanwhile.iso_day(until) if until else day,
        at=(4.41, 50.68),
        inherited=False,
        score=1.0,
        parents=parents,
        cls=cls,
    )


def written(line="A line", **fields):
    return {"line": line, "source": SOURCE, **fields}


def test_the_lock_gives_each_opening_as_meanwhile_does_with_its_class_in_date_order():
    index = [
        event("Q48314", "1815-06-18", parents=("Q18643473",), label="Battle of Waterloo"),
        event("Q18643473", "1815-06-15", until="1815-07-08", cls="military campaign"),
        event("Q8094772", "1883-01-01", until="1883-12-31", precision=9, cls="natural disaster"),
    ]
    lines = {
        "Q8094772": written("Krakatoa explodes", date="1883-08-27"),
        "Q48314": written("At Waterloo, Wellington and Blücher defeat Napoleon"),
    }
    locked = o.openings(index, lines)
    assert [e["qid"] for e in locked] == ["Q48314", "Q8094772"]
    assert locked[0] == {
        "qid": "Q48314",
        "label": "Battle of Waterloo",
        "date": "1815-06-18",
        "precision": "day",
        "at": [4.41, 50.68],
        "line": "At Waterloo, Wellington and Blücher defeat Napoleon",
        "source": SOURCE,
        "class": "battle",
    }
    assert {k: locked[1][k] for k in ("date", "precision", "class")} == {
        "date": "1883-08-27",
        "precision": "day",
        "class": "natural disaster",
    }


def test_an_opening_the_index_lacks_is_refused():
    with pytest.raises(o.OpeningsError, match="Q2 not in the event index"):
        o.openings([event("Q1", "1815-06-18")], {"Q1": written(), "Q2": written()})


def test_an_opening_part_of_another_is_refused():
    index = [
        event("Q48314", "1815-06-18", parents=("Q18643473",)),
        event("Q18643473", "1815-06-15", until="1815-07-08", parents=("Q78994",)),
        event("Q78994", "1803-01-01", until="1815-12-31", precision=9, cls="war"),
    ]
    with pytest.raises(o.OpeningsError, match=r"Q48314 .* is part of Q78994"):
        o.openings(index, {"Q48314": written(), "Q78994": written()})


def test_an_opening_whose_parent_is_no_opening_is_taken():
    index = [
        event("Q48314", "1815-06-18", parents=("Q18643473",)),
        event("Q18643473", "1815-06-15", until="1815-07-08"),
    ]
    assert [e["qid"] for e in o.openings(index, {"Q48314": written()})] == ["Q48314"]


def test_a_written_date_within_the_index_span_centres_the_opening():
    beagle = event("Q1564366", "1831-12-27", until="1836-10-02", cls="expedition")
    [locked] = o.openings([beagle], {"Q1564366": written(date="1835-09-15")})
    assert (locked["date"], locked["precision"]) == ("1835-09-15", "day")


@pytest.mark.parametrize("date", ["1960-05-22", "1960-05"])
def test_a_written_date_outside_the_index_span_is_refused(date):
    valdivia = event("Q212618", "1960-05-21", cls="natural disaster")
    with pytest.raises(o.OpeningsError, match="outside the index's 1960-05-21 to 1960-05-21"):
        o.openings([valdivia], {"Q212618": written(date=date)})


def test_a_written_place_is_refused():
    lisbon = event("Q191055", "1755-11-01", cls="natural disaster")
    with pytest.raises(o.OpeningsError, match="its mark keeps the index's place"):
        o.openings([lisbon], {"Q191055": written(at=[-9.14, 38.71])})


def test_an_opening_that_starts_after_2000_is_refused():
    index = [event("Q1", "2001-01-01"), event("Q2", "1999-06-01", until="2003-01-01")]
    assert o.openings(index, {"Q2": written()})
    with pytest.raises(o.OpeningsError, match=r"Q1 .* starts after 2000"):
        o.openings(index, {"Q1": written()})


@pytest.mark.parametrize(
    ("date", "line"),
    [
        ("1066-10-20", "On 14 October, William of Normandy lands a blow at Hastings"),
        ("-0043-03-13", "On 15 March, senators stab Julius Caesar"),
        ("1815-06-18", "On June 18th Napoleon loses at Waterloo"),
        ("1815-06-18", "In June 1815, Napoleon loses at Waterloo"),
        ("1556-02-02", "On the 23 January an earthquake shakes Shaanxi"),
    ],
)
def test_a_line_may_name_the_day_its_sources_give(date, line):
    assert o.openings([event("Q1", date)], {"Q1": written(line)})


@pytest.mark.parametrize(
    ("date", "line", "message"),
    [
        ("1066-10-20", "On 20 October, William wins at Hastings", "20 October, but .* 14 October"),
        ("1815-06-18", "On June 17, Napoleon loses at Waterloo", "17 June, but .* 18 June"),
    ],
)
def test_a_line_naming_another_day_is_refused(date, line, message):
    with pytest.raises(o.OpeningsError, match=message):
        o.openings([event("Q1", date)], {"Q1": written(line)})


def test_a_line_naming_a_day_where_the_date_is_a_month_is_refused_until_the_list_dates_it():
    titanic = event("Q2577588", "1912-04-01", until="1912-04-30", precision=10)
    line = "On 15 April the Titanic sinks"
    with pytest.raises(o.OpeningsError, match="its date is a month: give the day as its date"):
        o.openings([titanic], {"Q2577588": written(line)})
    [locked] = o.openings([titanic], {"Q2577588": written(line, date="1912-04-15")})
    assert (locked["date"], locked["precision"]) == ("1912-04-15", "day")


def test_an_event_index_built_from_other_configs_is_refused(tmp_path):
    ctx = make_context(Profile.GLOBAL, 1, tmp_path)
    (ctx.out / "ev").mkdir(parents=True)
    (ctx.out / events.KEY).write_bytes(b"")
    ctx.stages_dir.mkdir(parents=True)
    stale = {**meanwhile.current_inputs(), "classes": "0" * 64}
    (ctx.stages_dir / "events.json").write_text(json.dumps({"inputs": stale}), encoding="utf-8")
    with pytest.raises(o.OpeningsError, match="run `uv run prebuild --profile global events`"):
        o.run(ctx)


def test_the_stage_writes_the_lock_with_the_sha256_of_the_index_it_checked(tmp_path, capsys):
    ctx = make_context(Profile.GLOBAL, 1, tmp_path)
    row = {
        "qid": "Q48314",
        "label": "Battle of Waterloo",
        "enwiki": "Battle of Waterloo",
        "class": "battle",
        "date": "1815-06-18",
        "precision": "11",
        "t0": "1815-06-18",
        "t1": "1815-06-18",
        "lon": "4.41222",
        "lat": "50.67806",
        "inherited": "0",
        "editions": "94",
        "score": "5.1134",
        "parents": "Q18643473",
    }
    table = "\t".join(events.COLUMNS) + "\n" + "\t".join(row[c] for c in events.COLUMNS) + "\n"
    (ctx.out / "ev").mkdir(parents=True)
    (ctx.out / events.KEY).write_bytes(gzip.compress(table.encode(), mtime=0))
    ctx.stages_dir.mkdir(parents=True)
    record = {"inputs": meanwhile.current_inputs()}
    (ctx.stages_dir / "events.json").write_text(json.dumps(record), encoding="utf-8")
    (tmp_path / o.FOLDER).mkdir()
    (tmp_path / o.FOLDER / o.LIST).write_text(
        yaml.safe_dump({"Q48314": written("At Waterloo, Napoleon falls")}), encoding="utf-8"
    )
    o.run(ctx)
    lock = json.loads((tmp_path / o.FOLDER / o.LOCK).read_text(encoding="utf-8"))
    assert lock["table"] == hashlib.sha256((ctx.out / events.KEY).read_bytes()).hexdigest()
    assert [(e["qid"], e["line"], e["class"]) for e in lock["openings"]] == [
        ("Q48314", "At Waterloo, Napoleon falls", "battle")
    ]
    assert "openings: 1 openings into explore/openings.lock.json" in capsys.readouterr().out


def test_a_list_without_a_source_is_refused(tmp_path):
    path = tmp_path / o.LIST
    path.write_text("Q48314:\n  line: At Waterloo, Napoleon falls\n", encoding="utf-8")
    with pytest.raises(o.OpeningsError, match="Q48314 needs a line and a source"):
        o.read_list(path)


def test_the_committed_lock_holds_the_committed_list():
    written_list = o.read_list(REPO_ROOT / o.FOLDER / o.LIST)
    lock = json.loads((REPO_ROOT / o.FOLDER / o.LOCK).read_text(encoding="utf-8"))
    locked = {e["qid"]: e for e in lock["openings"]}
    assert set(locked) == set(written_list)
    for qid, entry in written_list.items():
        assert (locked[qid]["line"], locked[qid]["source"]) == (entry["line"], entry["source"])
        assert locked[qid]["source"]["url"].startswith("https://")
    assert "Q48314" in locked


def test_the_committed_lock_holds_the_committed_dates():
    written_list = o.read_list(REPO_ROOT / o.FOLDER / o.LIST)
    lock = json.loads((REPO_ROOT / o.FOLDER / o.LOCK).read_text(encoding="utf-8"))
    locked = {e["qid"]: (e["date"], e["precision"]) for e in lock["openings"]}
    dated = {qid: str(entry["date"]) for qid, entry in written_list.items() if "date" in entry}
    expected = {}
    for qid, date in dated.items():
        first, _, precision = meanwhile.written_date(date)
        expected[qid] = (events.iso(events.civil(first)), meanwhile.precision_name(precision))
    assert {qid: locked[qid] for qid in dated} == expected
