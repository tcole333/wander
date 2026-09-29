"""The openings stage (streaming.md 3.4): the events Explore opens on, from the list written in
the repo-root `explore/openings.yaml` (qid -> {line, date?, at?, source: {title, url}}, the form of
a story's `meanwhile.yaml`), checked against the event index (`ev/events.tsv.gz` in the profile's
output root) into the committed `explore/openings.lock.json`, which the app bundles and whose qids
the `event-files` stage forces into the overview.

`uv run prebuild openings` writes `{table, openings}`: the sha256 of the index it checked, and
each opening as Meanwhile's entries give an event (`meanwhile.entry`), with its line, its source
and its class, in date order. A written `date` (an ISO day or month, proleptic Gregorian as the
index's) stands in for the index's, as in Meanwhile, where it falls within the index's span for
the event, which its mark in the overview keeps. Its place is always the index's, as its mark's is.
It stops on:

- an opening the index lacks;
- a written `date` outside the index's span for the event, or any written `at`;
- an opening part of another (P361, as far as the index knows its parents), since two openings of
  one family open on one view;
- an opening that starts after `LAST_YEAR`, where Explore's ruler ends;
- an index built from another export or other configs than the current ones (the events record's
  `inputs`);
- a line naming a day and month other than the event's date as its sources give it: Julian before
  15 October 1582, Gregorian from then on (`historical`), or naming a day where the date is only a
  month or a year.

It writes no record: the lock is its record.
"""

import gzip
import re
import time
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from prebuild import events, meanwhile
from prebuild.hashing import sha256_file
from prebuild.media import write_lock
from prebuild.profiles import Context
from prebuild.records import read_record

FOLDER = "explore"
LIST = "openings.yaml"
LOCK = "openings.lock.json"
LAST_YEAR = 2000  # the last year of Explore's ruler
MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MONTH = "|".join(MONTHS)
# '18 June', '18th June', 'June 18' and 'June 18th', but not 'June 1815'.
DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)? ({_MONTH})\b")
MONTH_DAY = re.compile(rf"\b({_MONTH}) (\d{{1,2}})(?:st|nd|rd|th)?\b")
# The first day of the Gregorian calendar; the days before it are read in the Julian.
GREGORIAN = meanwhile.day_number(1582, 10, 15)
_JDN_OF_DAY_ZERO = 1721426  # the Julian day number of 0001-01-01, proleptic Gregorian


class OpeningsError(ValueError):
    """The list, its lines or the event index are not what the stage reads."""


def run(ctx: Context) -> None:
    started = time.perf_counter()
    table = ctx.out / events.KEY
    if not table.exists():
        raise OpeningsError(
            f"{table} is missing: run `uv run prebuild --profile {ctx.profile} events` first"
        )
    if read_record(ctx, events.STAGE).get("inputs") != meanwhile.current_inputs():
        raise OpeningsError(
            f"{table} was built from another export or other configs: "
            f"run `uv run prebuild --profile {ctx.profile} events`"
        )
    folder = ctx.repo / FOLDER
    written = read_list(folder / LIST)
    with gzip.open(table, "rt", encoding="utf-8") as stream:
        index = meanwhile.read_table(stream)
    lock = {"table": sha256_file(table), "openings": openings(index, written)}
    path = folder / LOCK
    write_lock(path, lock)
    seconds = time.perf_counter() - started
    print(
        f"openings: {len(lock['openings'])} openings into {path.relative_to(ctx.repo)}, "
        f"{seconds:.1f} s",
        flush=True,
    )


def read_list(path: Path) -> dict[str, dict[str, Any]]:
    """The written openings, by qid, as `meanwhile.read_lines` reads a story's lines."""
    if not path.exists():
        raise OpeningsError(f"{path} is missing: write the openings there first")
    try:
        written = meanwhile.read_lines(path)
    except meanwhile.MeanwhileError as error:
        raise OpeningsError(str(error)) from None
    if not written:
        raise OpeningsError(f"{path.name} lists no openings")
    for qid in written:
        if not isinstance(qid, str) or not events.QID.fullmatch(qid):
            raise OpeningsError(f"{path.name}: {qid!r} is not a Wikidata qid")
    return written


def openings(
    index: Iterable[meanwhile.Event], written: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """The lock's openings, in date order: each written opening as the index gives it, with its
    written date and place where the list gives them, checked as the stage's rules say."""
    index = list(index)
    by_qid = {e.qid: e for e in index}
    missing = [qid for qid in written if qid not in by_qid]
    if missing:
        raise OpeningsError(f"{', '.join(missing)} not in the event index")
    for qid, fields in written.items():
        check_written(by_qid[qid], fields)
    chosen = [meanwhile.as_written(by_qid[qid], written[qid]) for qid in written]
    ancestors = meanwhile.lineage(index)
    for event in chosen:
        within = [
            other.qid for other in chosen if other.qid in ancestors.get(event.qid, frozenset())
        ]
        if within:
            raise OpeningsError(
                f"{event.qid} ({event.label}) is part of {', '.join(within)}: "
                "an opening is never part of another"
            )
        if meanwhile.civil(event.t0)[0] > LAST_YEAR:
            raise OpeningsError(
                f"{event.qid} ({event.label}) starts after {LAST_YEAR}, where the ruler ends"
            )
        check_line(event, str(written[event.qid]["line"]))
    return [
        {**meanwhile.entry(e, written[e.qid]), "class": e.cls}
        for e in sorted(chosen, key=lambda e: (e.date, e.qid))
    ]


def check_written(event: meanwhile.Event, fields: Mapping[str, Any]) -> None:
    """Stops on a written date outside the index's span for the event, or on a written place:
    the overview's mark keeps the index's dates and place, and the lock draws the same mark until
    the overview decodes."""
    if "at" in fields:
        raise OpeningsError(
            f"{event.qid} ({event.label}) is written with an `at`, but its mark keeps the "
            "index's place: leave it out"
        )
    if "date" not in fields:
        return
    first, last, _ = meanwhile.written_date(str(fields["date"]))
    if not event.t0 <= first <= last <= event.t1:
        span = f"{events.iso(meanwhile.civil(event.t0))} to {events.iso(meanwhile.civil(event.t1))}"
        raise OpeningsError(
            f"{event.qid} ({event.label}) is written as {fields['date']}, outside the index's "
            f"{span}, which its mark keeps: curate the date in events-curated.yaml or leave it out"
        )


def check_line(event: meanwhile.Event, line: str) -> None:
    """Stops on a day and month in the line other than the event's date as its sources give it,
    or on any day where the date is only a month or a year."""
    named = [(int(day), MONTHS.index(month) + 1) for day, month in DAY_MONTH.findall(line)]
    named += [(int(day), MONTHS.index(month) + 1) for month, day in MONTH_DAY.findall(line)]
    if not named:
        return
    if event.precision < events.DAY:
        raise OpeningsError(
            f"{event.qid}'s line names a day, but its date is a "
            f"{meanwhile.precision_name(event.precision)}: give the day as its date"
        )
    _, month, day = historical(event.date)
    for named_day, named_month in named:
        if (named_day, named_month) != (day, month):
            raise OpeningsError(
                f"{event.qid}'s line names {named_day} {MONTHS[named_month - 1]}, "
                f"but its date is {day} {MONTHS[month - 1]}"
            )


def historical(number: int) -> events.Day:
    """A day number as its sources date it: in the Julian calendar before 15 October 1582, in the
    Gregorian from then on, astronomical years (1 BC is 0)."""
    if number >= GREGORIAN:
        return meanwhile.civil(number)
    c = number + _JDN_OF_DAY_ZERO + 32082
    d = (4 * c + 3) // 1461
    e = c - 1461 * d // 4
    m = (5 * e + 2) // 153
    return d - 4800 + m // 10, m + 3 - 12 * (m // 10), e - (153 * m + 2) // 5 + 1
