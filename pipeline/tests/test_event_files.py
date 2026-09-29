import gzip
import json
from dataclasses import replace

import pytest

from prebuild import event_files as wev
from prebuild import events
from prebuild.config import load_event_classes
from prebuild.meanwhile import day_number
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record


def event(qid, *, year=1815, editions=10, parent=(), at=(4.4, 50.7)):
    return events.Event(
        f"Q{qid}",
        f"Event {qid}",
        "",
        "battle",
        (year, 1, 1),
        9,
        (year, 1, 1),
        (year, 12, 31),
        *at,
        False,
        editions,
        1,
        parent,
    )


def test_fixture_build_is_deterministic_and_carries_the_real_hierarchy(tmp_path):
    ctx = replace(
        make_context(Profile.FIXTURE, 1), out=tmp_path / "out", stages_dir=tmp_path / "stages"
    )
    events.run(ctx)
    wev.run(ctx)
    record = read_record(ctx, wev.STAGE)
    docs = {
        f["key"]: json.loads(gzip.decompress((ctx.out / f["key"]).read_bytes()))
        for f in record["files"]
    }
    overview = docs[record["overview"]]
    assert overview["classes"] == [c.name for c in load_event_classes()]
    assert record["rows"] == sum(d["rows"] for d in docs.values())
    rows = {qid: i for i, qid in enumerate(overview["qid"])}
    waterloo = rows[48314]
    assert overview["t0"][waterloo] == day_number(1815, 6, 18)
    assert overview["lon"][waterloo] == 441222
    assert overview["flags"][waterloo] & 16
    assert overview["parent"][waterloo] == overview["row"][rows[18643473]]
    assert overview["score"] == sorted(overview["score"], reverse=True)
    assert all(0 <= s <= 1000 for s in overview["score"])
    assert any(e[0] == overview["row"][rows[18643473]] for e in overview["ext"])
    for f in record["files"]:
        data = (ctx.out / f["key"]).read_bytes()
        assert len(data) == f["bytes"]
        assert len(gzip.decompress(data)) == f["jsonBytes"]
        assert wev.decoded_bytes(docs[f["key"]]) == f["decoded"]
    wev.run(ctx)
    assert read_record(ctx, wev.STAGE) == record


def test_unlocated_ancestors_take_children_across_the_dateline_and_cycles_end():
    parent = event(10, at=(float("nan"), float("nan")), parent=("Q1",))
    children = [event(1, at=(179, 20), parent=("Q10",)), event(2, at=(-179, 20), parent=("Q10",))]
    s = events.Statement(
        "Q198",
        parent.qid,
        "Parent",
        "Parent",
        "P585",
        parent.day,
        9,
        None,
        None,
        10,
        parent.parents,
    )
    rows = wev.prepare(children, [s])
    by_qid = {r.event.qid: r for r in rows}
    derived = by_qid["Q10"]
    assert abs(derived.event.lon) == pytest.approx(180)
    assert derived.flags & 2
    assert derived.unc > 0
    for r in rows:
        seen = set()
        while r.parent != -1:
            assert r.row not in seen
            seen.add(r.row)
            r = rows[r.parent]
    assert wev.extent([(179, 20), (-179, 22)]) == (17900000, 2000000, 18100000, 2200000)


def test_percentiles_are_per_era_and_ties_share_a_score():
    rows = wev.prepare(
        [
            event(1, year=-5000, editions=2),
            event(2, editions=1),
            event(3, editions=50),
            event(4, editions=50),
        ],
        [],
    )
    scores = {r.event.qid: r.score for r in rows}
    assert scores["Q1"] == scores["Q3"] == scores["Q4"] == 550
    assert scores["Q2"] == 183


def test_display_parent_prefers_the_nearest_containing_span():
    child = event(1, parent=("Q2", "Q3", "Q999"))
    broad = replace(event(2), t0=(1800, 1, 1), t1=(1850, 1, 1))
    narrow = replace(event(3), t0=(1814, 1, 1), t1=(1816, 1, 1))
    rows = wev.prepare([child, broad, narrow], [])
    by_qid = {r.event.qid: r for r in rows}
    assert by_qid["Q1"].parent == by_qid["Q3"].row


def test_quota_keeps_low_scored_cells_then_fills_by_score():
    rows = wev.prepare(
        [event(i, editions=i) for i in range(1, 301)] + [event(999, year=-5000, at=(-100, 40))], []
    )
    picked = wev.overview(rows, 192)
    assert len(picked) == 192
    assert 999 in [int(r.event.qid[1:]) for r in picked]
    assert picked == sorted(picked, key=lambda r: r.row)


@pytest.mark.parametrize("threshold", [{"all_rows": 0}, {"all_bytes": 0}])
def test_paging_overlaps_and_long_rows_without_overview_duplicates(
    tmp_path, monkeypatch, threshold
):
    deep = event(1, year=-15_000_000)
    crossing = replace(event(2, year=1800), t0=(1799, 12, 31), t1=(1800, 1, 1))
    long = replace(event(3), t0=(-1000, 1, 1), t1=(2000, 1, 1))
    rows = wev.prepare([deep, crossing, long], [])
    monkeypatch.setattr(
        wev, "overview", lambda rows: [next(r for r in rows if r.event.qid == "Q1")]
    )
    record = wev.build(rows, tmp_path, **threshold)
    docs = {
        f["key"].split("/")[-1]: json.loads(gzip.decompress((tmp_path / f["key"]).read_bytes()))
        for f in record["files"]
    }
    assert docs["overview.wev"]["t0"] == [day_number(-15_000_000, 1, 1)]
    assert docs["overview.wev"]["t0"][0] < -(2**31)
    assert docs["p18.wev"]["qid"] == docs["p19.wev"]["qid"] == [2]
    assert docs["long.wev"]["qid"] == [3]
    assert sum(d["qid"].count(1) for d in docs.values()) == 1


def test_no_country_or_override_is_used_when_children_place_a_parent(monkeypatch):
    monkeypatch.setattr(
        wev, "load_event_places", lambda: {"Q10": {"countryCentroid": (40, 30), "at": (60, 20)}}
    )
    statement = events.Statement(
        "Q198", "Q10", "Parent", "Parent", "P585", (1815, 1, 1), 9, None, None, 10, ()
    )
    rows = wev.prepare([event(1, parent=("Q10",))], [statement])
    parent = next(r for r in rows if r.event.qid == "Q10")
    assert (parent.event.lon, parent.event.lat) == pytest.approx((4.4, 50.7))
