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


def frame(date, until=None, excluded=()):
    day = m.iso_day(date)
    return m.Frame(
        day=day,
        near=(day - m.PAD_DAYS, day + m.PAD_DAYS),
        start=day - m.PAD_DAYS,
        end=m.iso_day(until) if until else day + m.PAD_DAYS,
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


def test_a_list_repeats_an_earlier_list_s_entry_only_when_it_must_and_then_the_least_shown():
    places = [WATERLOO, (-65.2, -26.8), (-97.1, 49.9), (150.0, -33.9), (30.0, -1.0)]
    index = [event(f"Q{i}", 6.0 - i, at, "1815-03-20") for i, at in enumerate(places, start=1)]
    frames = [frame("1815-04-01"), frame("1815-04-05"), frame("1815-04-10")]
    lists = m.in_turn(frames, index, m.lineage(index))
    assert [sorted(e.qid for e in chosen) for chosen in lists] == [
        ["Q1", "Q2", "Q3"],
        ["Q1", "Q4", "Q5"],
        ["Q2", "Q3", "Q4"],
    ]


def test_a_sparse_month_relaxes_the_spacing_between_its_entries_then_its_reach():
    beat = m.Beat(
        id="veil",
        date=m.iso_day("1816-09-15"),
        window=(m.iso_day("1816-09-01"), m.iso_day("1816-09-30")),
        target=TAMBORA,
        focal="Q0",
        pins=(),
        hides=(),
    )
    index = [
        m.replace(event("Q1", 3.0, (80.0, 20.0), "1816-09-10"), enwiki="One"),
        m.replace(event("Q2", 2.0, (75.0, 19.0), "1816-09-20"), enwiki="Two"),  # 530 km from Q1
        m.replace(event("Q3", 1.0, (-60.0, -30.0), "1816-11-20"), enwiki="Three"),  # 66 days on
    ]
    september = m.month_lists([beat], index)[(1816, 9)]
    assert [e.qid for e in september] == ["Q1", "Q2", "Q3"]


def test_an_event_whose_date_the_sources_dispute_is_left_out():
    beat = m.Beat(
        id="summer",
        date=m.iso_day("1816-09-05"),
        window=(m.iso_day("1816-09-01"), m.iso_day("1816-09-30")),
        target=(-72.0, 43.0),
        focal="Q0",
        pins=(),
        hides=(),
    )
    index = [
        m.replace(event("Q12241904", 2.0, (20.07, 32.12), "1816-09-05"), enwiki="Al-Jawazi"),
        m.replace(event("Q2", 1.0, (80.0, 20.0), "1816-09-10"), enwiki="Two"),
    ]
    lists = m.beat_lists([beat], index, contested={"Q12241904"})
    assert [e.qid for e in lists["summer"]] == ["Q2"]


def test_a_long_window_takes_the_events_near_its_date_first():
    index = [
        event("Q1", 9.0, WATERLOO, "1816-07-09"),  # a year on, in the window
        event("Q2", 3.0, (-65.2, -26.8), "1815-04-20"),
        event("Q3", 2.0, (80.6, 7.3), "1815-11-01"),
        event("Q4", 1.0, (150.0, -33.9), "1815-05-01"),
    ]
    chosen = m.choose(index, frame("1815-04-12", until="1816-10-26"), m.lineage(index))
    assert [e.qid for e in chosen] == ["Q2", "Q4", "Q3"]


def test_a_month_shows_its_own_events_before_its_neighbours():
    beat = m.Beat(
        id="veil",
        date=m.iso_day("1817-10-15"),
        window=(m.iso_day("1817-10-01"), m.iso_day("1817-10-31")),
        target=TAMBORA,
        focal="Q0",
        pins=(),
        hides=(),
    )
    index = [
        m.replace(event("Q1", 9.0, WATERLOO, "1817-11-05"), enwiki="Khadki"),
        m.replace(event("Q2", 1.0, (-83.7, 41.6), "1817-10-02"), enwiki="Fort Meigs"),
    ]
    october = m.month_lists([beat], index)[(1817, 10)]
    assert [e.qid for e in october] == ["Q2", "Q1"]


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


def test_a_list_reads_in_date_order_with_the_written_lines_and_no_title_years():
    munich = m.replace(
        event("Q2518869", 2.0, (11.6, 48.1), "1816-04-14"), label="Treaty of Munich (1816)"
    )
    chosen = [event("Q48314", 5.0, WATERLOO, "1816-06-18"), munich]
    lines = {"Q48314": {"line": "At Waterloo…", "source": {"title": "t", "url": "u"}}}
    listed = m.entries(chosen, lines)
    assert [(e["label"], e.get("line")) for e in listed] == [
        ("Treaty of Munich", None),
        ("Q48314", "At Waterloo…"),
    ]


BEAT = """```beat
id: one
date: "1815-04-10"
window: "1815-04-05..1815-04-12"
camera: {target: [118.0, -8.25], viewKm: 300}
focal: {qid: Q3591483}
MEANWHILE
```"""


@pytest.mark.parametrize(
    ("meanwhile", "pins", "hides"),
    [
        ("meanwhile: auto", (), ()),
        ("", (), ()),
        (
            "meanwhile: {pin: [Q48314], hide: [Q46362, Q1757487]}",
            ("Q48314",),
            ("Q46362", "Q1757487"),
        ),
        ("meanwhile: {hide: [Q46362]}", (), ("Q46362",)),
    ],
)
def test_a_beat_s_meanwhile_is_auto_or_its_pins_and_hides(meanwhile, pins, hides):
    [beat] = m.story_beats(BEAT.replace("MEANWHILE", meanwhile))
    assert (beat.pins, beat.hides) == (pins, hides)


@pytest.mark.parametrize(
    "meanwhile",
    [
        "meanwhile: often",
        "meanwhile: [Q48314]",
        "meanwhile: {pin: [Q48314], show: [Q46362]}",
        "meanwhile: {pin: Q48314}",
        "meanwhile: {hide: [Waterloo]}",
    ],
)
def test_a_beat_s_meanwhile_of_another_form_is_refused(meanwhile):
    with pytest.raises(m.MeanwhileError, match="meanwhile"):
        m.story_beats(BEAT.replace("MEANWHILE", meanwhile))
