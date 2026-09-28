import json

import pytest

from prebuild import meanwhile as m
from prebuild.profiles import Profile, make_context

TAMBORA = (118.0, -8.25)
WATERLOO = (4.41, 50.68)


def event(qid, score, at, date, *, until=None, precision=11, parents=()):
    day = m.iso_day(date)
    return m.Event(
        qid=qid,
        label=qid,
        enwiki="",
        date=day,
        precision=precision,
        t0=day,
        t1=m.iso_day(until) if until else day,
        at=at,
        inherited=False,
        score=score,
        parents=parents,
    )


def frame(date, excluded=()):
    day = m.iso_day(date)
    return m.Frame(
        day=day,
        start=day - m.PAD_DAYS,
        end=day + m.PAD_DAYS,
        longest=m.SHORTEST_DAYS,
        target=TAMBORA,
        excluded=frozenset(excluded),
    )


def test_a_list_takes_the_best_events_far_apart_never_a_parent_with_its_child():
    index = [
        event("Q1", 9.0, (112.0, -7.5), "1815-06-10"),  # Java: too near the beat's target
        event("Q2", 8.0, WATERLOO, "1814-01-01", until="1815-12-31"),  # spans two years
        event("Q3", 7.0, WATERLOO, "1815-06-15", until="1815-07-08"),  # the campaign
        event("Q4", 6.0, (80.6, 7.3), "1816-01-01"),  # outside the window
        event("Q5", 5.0, (4.5, 50.5), "1815-06-18", parents=("Q3",)),  # the campaign's battle
        event("Q6", 4.0, (2.35, 48.86), "1815-07-07"),  # Paris: under 2,000 km from Waterloo
        event("Q7", 3.0, (-65.2, -26.8), "1815-06-01"),
        event("Q8", 2.0, (79.7, 29.6), "1815-05-15"),
        event("Q9", 1.0, (-97.1, 49.9), "1815-06-19"),
        event("Q10", 0.5, (150.0, -33.9), "1815-06-20"),
    ]
    chosen = m.choose(index, frame("1815-06-18"), m.lineage(index))
    assert [e.qid for e in chosen] == ["Q3", "Q7", "Q8"]


def test_an_event_goes_to_the_neighbour_dated_nearer_it_and_neighbours_repeat_what_they_must():
    index = [
        event("Q1", 9.0, WATERLOO, "1815-06-18"),
        event("Q2", 3.0, (-65.2, -26.8), "1815-06-01"),
        event("Q3", 2.0, (80.6, 7.3), "1815-05-25"),
        event("Q4", 1.0, (150.0, -33.9), "1815-06-05"),
    ]
    may, june = frame("1815-05-20"), frame("1815-06-28")
    lists = m.in_turn([may, june], index, m.lineage(index))
    assert [[e.qid for e in chosen] for chosen in lists] == [["Q2", "Q3", "Q4"], ["Q1", "Q2", "Q3"]]


def test_scrubbing_covers_the_years_of_the_story_s_windows():
    beat = m.Beat(
        id="strait",
        date=m.iso_day("1520-11-01"),
        window=(m.iso_day("1519-09-20"), m.iso_day("1522-09-06")),
        target=(-70.0, -53.0),
        focal="Q1",
        pins=(),
        hides=(),
    )
    months = list(m.month_lists([beat], []))
    assert (months[0], months[-1], len(months)) == ((1519, 1), (1522, 12), 48)


def test_an_event_index_built_from_other_configs_is_refused(tmp_path):
    ctx = make_context(Profile.GLOBAL, 1, tmp_path, story="tambora")
    (tmp_path / "stories" / "tambora").mkdir(parents=True)
    (tmp_path / "stories" / "tambora" / "story.md").write_text("", encoding="utf-8")
    (ctx.out / "ev").mkdir(parents=True)
    (ctx.out / "ev" / "events.tsv.gz").write_bytes(b"")
    ctx.stages_dir.mkdir(parents=True)
    stale = {**m.current_inputs(), "curated": "0" * 64}
    (ctx.stages_dir / "events.json").write_text(json.dumps({"inputs": stale}), encoding="utf-8")
    with pytest.raises(m.MeanwhileError, match="run `uv run prebuild --profile global events`"):
        m.run(ctx)


def test_an_entry_gives_its_date_with_its_precision():
    war = event("Q617210", 4.8, (75.7, 19.8), "1817-11-01", precision=10)
    assert {k: m.entry(war)[k] for k in ("date", "precision")} == {
        "date": "1817-11-01",
        "precision": "month",
    }


def test_a_written_date_and_place_stand_in_for_the_index_s():
    rising = event("Q5010928", 2.0, (18.0, -33.0), "1815-01-01", until="1815-12-31", precision=9)
    written = {"line": "On the Cape frontier…", "date": "1815-11-18", "at": [25.8, -32.8]}
    moved = m.as_written(rising, written)
    assert (moved.date, moved.precision, moved.at) == (m.iso_day("1815-11-18"), 11, (25.8, -32.8))
    assert moved.dated == (moved.date, moved.date)
