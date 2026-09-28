from prebuild import meanwhile as m

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
