"""The meanwhile stage (streaming.md 3.9, 5.3): a story's Meanwhile lists and the lobby's glows,
drawn from the event index (`ev/events.tsv.gz`, which the events stage writes into the profile's
output root) into the story's committed lock.

`uv run prebuild meanwhile --story <id>` reads the beats of `stories/<id>/story.md` and picks, for
each, `COUNT` events happening elsewhere at the beat's time:

- dated inside the beat's window, widened where needed to `PAD_DAYS` either side of the beat's
  date (a date of year or month precision counts as its whole year or month), and spanning no
  longer than the window or `SHORTEST_DAYS`, whichever is longer, so a decade's war does not stand
  for a month of it;
- more than `MIN_KM` from the beat's camera target;
- never the beat's focal event nor its part-of (P361) relatives, and never a parent with its child;
- greedy by score, each at least `MIN_KM` from those already taken;
- while enough others qualify, none the previous beat shows, nor any the next beat would show
  that is dated nearer to it (so Waterloo goes to the beat of late June 1815, not the April one
  before it, whose window also holds it).

A beat's `meanwhile: {pin: [qids], hide: [qids]}` puts its pins first, whatever the rule says, and
keeps its hides out; `meanwhile: auto`, the default, leaves the rule alone. The same rule gives
`COUNT` events for each month from `MONTHS[0]` to `MONTHS[1]`, which Meanwhile shows while the
visitor scrubs: the month's window, the target of the beat dated nearest it, none of the story's
focal events, and no event any beat hides.

A beat's entries carry the lines the story's writers give them in `stories/<id>/meanwhile.yaml`
(qid -> {line, date?, source: {title, url}}), with the date the source gives where it differs
from Wikidata's; a month's show the Wikidata label, and cite the event's written source where it
has one (taking its date too), else its Wikipedia article. The
lobby's glows are the `GLOW_COUNT` best-scored events of every era with a place of their own (an
inherited place is often a continent's or an ocean's middle), each at least `GLOW_MIN_KM` from the
others.

The stage rewrites the lock's `meanwhile` and `glows` and keeps everything else in it (the media
stage's images). It writes no record: the lock is its record.
"""

import gzip
import json
import math
import time
import urllib.parse
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from prebuild import events
from prebuild.media import BEAT_BLOCK, write_lock
from prebuild.profiles import Context

COUNT = 3  # entries per beat and per month
PAD_DAYS = 45  # a beat's window reaches at least this far either side of its date
SHORTEST_DAYS = 92  # the longest span a short window admits
MIN_KM = 2000.0  # from the beat's target, and between entries
MONTHS = ((1815, 1), (1817, 12))  # the months scrubbing shows, first and last
GLOW_COUNT = 120
GLOW_MIN_KM = 450.0
EARTH_KM = 6371.0088
MONTH_NAMES = (
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
YEAR, MONTH, DAY = 9, 10, 11  # Wikidata's precisions

type LonLat = tuple[float, float]


class MeanwhileError(ValueError):
    """The story, its lines or the event index are not what the stage reads."""


@dataclass(frozen=True)
class Event:
    """A row of the event index, its dates as day numbers (`day_number`)."""

    qid: str
    label: str
    enwiki: str
    date: int
    precision: int
    t0: int
    t1: int
    at: LonLat
    inherited: bool
    score: float
    parents: tuple[str, ...]

    @property
    def dated(self) -> tuple[int, int]:
        """The first and last day its date names at its precision: 1816 is all of 1816."""
        year, month, _ = civil(self.date)
        if self.precision <= YEAR:
            return day_number(year, 1, 1), day_number(year, 12, 31)
        if self.precision == MONTH:
            last = events.month_days(year, month)
            return day_number(year, month, 1), day_number(year, month, last)
        return self.date, self.date

    @property
    def middle(self) -> int:
        first, last = self.dated
        return (first + last) // 2


@dataclass(frozen=True)
class Frame:
    """Where and when one list looks: its date, its padded window, the longest span it admits,
    the place its entries keep away from, and the events it leaves out."""

    day: int
    start: int
    end: int
    longest: int
    target: LonLat
    excluded: frozenset[str]


@dataclass(frozen=True)
class Beat:
    """What the stage reads of a beat in story.md."""

    id: str
    date: int
    window: tuple[int, int]
    target: LonLat
    focal: str
    pins: tuple[str, ...]
    hides: tuple[str, ...]


def run(ctx: Context) -> None:
    if ctx.story is None:
        raise MeanwhileError("name the story: `uv run prebuild meanwhile --story <id>`")
    started = time.perf_counter()
    folder = ctx.repo / "stories" / ctx.story
    beats = story_beats((folder / "story.md").read_text(encoding="utf-8"))
    table = ctx.out / events.KEY
    if not table.exists():
        raise MeanwhileError(f"{table} is missing: run `uv run prebuild events` first")
    with gzip.open(table, "rt", encoding="utf-8") as stream:
        index = read_table(stream)
    lines = read_lines(folder / "meanwhile.yaml")
    by_beat = beat_lists(beats, index)
    by_month = month_lists(beats, index)
    unwritten = sorted({e.qid for chosen in by_beat.values() for e in chosen} - set(lines))
    if unwritten:
        print(f"meanwhile: no written line in meanwhile.yaml for {', '.join(unwritten)}")
    lock_path = folder / "story.lock.json"
    lock = read_lock(lock_path)
    lock["meanwhile"] = {
        "beats": {
            beat: [entry(e, lines.get(e.qid)) for e in chosen] for beat, chosen in by_beat.items()
        },
        "months": {
            f"{year:04d}-{month:02d}": [entry(e, lines.get(e.qid), line=False) for e in chosen]
            for (year, month), chosen in by_month.items()
        },
    }
    lock["glows"] = [{"qid": e.qid, "label": e.label, "at": list(e.at)} for e in glows(index)]
    write_lock(lock_path, lock)
    seconds = time.perf_counter() - started
    print(
        f"meanwhile: {sum(map(len, by_beat.values()))} beat entries, "
        f"{sum(map(len, by_month.values()))} month entries and {len(lock['glows'])} glows "
        f"into {lock_path.relative_to(ctx.repo)}, {seconds:.1f} s",
        flush=True,
    )


# The rule


def choose(
    index: Sequence[Event],
    frame: Frame,
    ancestors: Mapping[str, frozenset[str]],
    *,
    pins: Sequence[Event] = (),
    avoid: Iterable[str] = (),
    count: int = COUNT,
) -> list[Event]:
    """Up to `count` events for `frame`: the pins, then by score (`index`'s order) each that
    qualifies, keeps `MIN_KM` from those taken and is neither parent nor child of one of them
    (`ancestors`, from `lineage`), first leaving out those in `avoid` and then, if too few are
    left, taking them too."""
    chosen = list(pins)
    qualifying = [e for e in index if qualifies(e, frame) and e not in chosen]
    shunned = set(avoid)
    for allow_shunned in (False, True):
        for event in qualifying:
            if len(chosen) >= count:
                return chosen
            if event in chosen or (event.qid in shunned and not allow_shunned):
                continue
            if any(apart_km(event.at, c.at) < MIN_KM for c in chosen):
                continue
            if any(related(event.qid, c.qid, ancestors) for c in chosen):
                continue
            chosen.append(event)
    return chosen


def qualifies(event: Event, frame: Frame) -> bool:
    first, last = event.dated
    return (
        first <= frame.end
        and last >= frame.start
        and event.t0 <= frame.end
        and event.t1 >= frame.start
        and event.t1 - event.t0 + 1 <= frame.longest
        and apart_km(event.at, frame.target) > MIN_KM
        and event.qid not in frame.excluded
    )


def in_turn(
    frames: Sequence[Frame],
    index: Sequence[Event],
    ancestors: Mapping[str, frozenset[str]],
    pins: Sequence[Sequence[Event]] | None = None,
) -> list[list[Event]]:
    """Each frame's entries, in order. Where the pool allows, a list shuns the events the list
    before it took, and those the next list would take on its own that are dated nearer to it:
    Waterloo goes to the beat of June 1815 rather than to the one of April before it."""
    pinned = pins or [()] * len(frames)
    alone = [choose(index, f, ancestors, pins=p) for f, p in zip(frames, pinned, strict=True)]
    lists: list[list[Event]] = []
    for i, frame in enumerate(frames):
        shunned = {e.qid for e in lists[-1]} if lists else set()
        if i + 1 < len(frames):
            after = frames[i + 1]
            shunned |= {
                e.qid for e in alone[i + 1] if abs(e.middle - after.day) < abs(e.middle - frame.day)
            }
        lists.append(choose(index, frame, ancestors, pins=pinned[i], avoid=shunned))
    return lists


def beat_lists(beats: Sequence[Beat], index: Sequence[Event]) -> dict[str, list[Event]]:
    """Each beat's entries, by beat id in story order."""
    by_qid = {e.qid: e for e in index}
    ancestors = lineage(index)
    frames = []
    for beat in beats:
        missing = [qid for qid in beat.pins if qid not in by_qid]
        if missing:
            raise MeanwhileError(f"beat {beat.id!r} pins {', '.join(missing)}, not in the index")
        start, end = beat.window
        frames.append(
            Frame(
                day=beat.date,
                start=min(start, beat.date - PAD_DAYS),
                end=max(end, beat.date + PAD_DAYS),
                longest=max(end - start + 1, SHORTEST_DAYS),
                target=beat.target,
                excluded=relatives({beat.focal}, index, ancestors) | set(beat.hides),
            )
        )
    pins = [[by_qid[qid] for qid in beat.pins] for beat in beats]
    lists = in_turn(frames, index, ancestors, pins)
    return {beat.id: chosen for beat, chosen in zip(beats, lists, strict=True)}


def month_lists(
    beats: Sequence[Beat], index: Sequence[Event]
) -> dict[tuple[int, int], list[Event]]:
    """Each month's entries, from `MONTHS[0]` to `MONTHS[1]`."""
    ancestors = lineage(index)
    excluded = relatives({b.focal for b in beats}, index, ancestors) | {
        qid for b in beats for qid in b.hides
    }
    (year, month), last = MONTHS
    months: list[tuple[int, int]] = []
    frames: list[Frame] = []
    while (year, month) <= last:
        start = day_number(year, month, 1)
        end = day_number(year, month, events.month_days(year, month))
        middle = (start + end) // 2
        nearest = min(beats, key=lambda b: abs(b.date - middle))
        months.append((year, month))
        frames.append(
            Frame(
                day=middle,
                start=min(start, middle - PAD_DAYS),
                end=max(end, middle + PAD_DAYS),
                longest=SHORTEST_DAYS,
                target=nearest.target,
                excluded=frozenset(excluded),
            )
        )
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return dict(zip(months, in_turn(frames, index, ancestors), strict=True))


def glows(index: Sequence[Event], count: int = GLOW_COUNT) -> list[Event]:
    """The best-scored events with a place of their own, each `GLOW_MIN_KM` from the others."""
    chosen: list[Event] = []
    for event in index:
        if len(chosen) == count:
            break
        if event.inherited or any(apart_km(event.at, c.at) < GLOW_MIN_KM for c in chosen):
            continue
        chosen.append(event)
    return chosen


def lineage(index: Iterable[Event]) -> dict[str, frozenset[str]]:
    """Each event's ancestors through its part-of parents, as far as the index knows them."""
    parents = {e.qid: e.parents for e in index}
    found: dict[str, frozenset[str]] = {}

    def ancestors(qid: str, seen: frozenset[str]) -> frozenset[str]:
        if qid in found:
            return found[qid]
        above: set[str] = set()
        for parent in parents.get(qid, ()):
            if parent not in seen:
                above |= {parent} | ancestors(parent, seen | {parent})
        found[qid] = frozenset(above)
        return found[qid]

    for qid in parents:
        ancestors(qid, frozenset({qid}))
    return found


def related(a: str, b: str, ancestors: Mapping[str, frozenset[str]]) -> bool:
    return a in ancestors.get(b, frozenset()) or b in ancestors.get(a, frozenset())


def relatives(
    qids: set[str], index: Iterable[Event], ancestors: Mapping[str, frozenset[str]]
) -> frozenset[str]:
    """`qids`, their ancestors and every event they are ancestors of."""
    kin = set(qids)
    for qid in qids:
        kin |= ancestors.get(qid, frozenset())
    kin |= {e.qid for e in index if ancestors.get(e.qid, frozenset()) & qids}
    return frozenset(kin)


def apart_km(a: LonLat, b: LonLat) -> float:
    """The great-circle distance between two places."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


# Reading the story, its lines and the index


def story_beats(markdown: str) -> list[Beat]:
    beats = []
    for block in BEAT_BLOCK.findall(markdown):
        beat = yaml.safe_load(block)
        where = f"beat {beat.get('id')!r}"
        date = iso_day(str(beat["date"]))
        window = str(beat.get("window", f"{beat['date']}..{beat['date']}")).split("..")
        chosen = beat.get("meanwhile", "auto")
        if chosen == "auto":
            chosen = {}
        if not isinstance(chosen, dict) or set(chosen) - {"pin", "hide"}:
            raise MeanwhileError(f"{where}: meanwhile is auto or {{pin: [...], hide: [...]}}")
        lon, lat = beat["camera"]["target"]
        beats.append(
            Beat(
                id=str(beat["id"]),
                date=date,
                window=(iso_day(window[0]), iso_day(window[-1])),
                target=(float(lon), float(lat)),
                focal=str(beat["focal"]["qid"]),
                pins=tuple(str(qid) for qid in chosen.get("pin", ())),
                hides=tuple(str(qid) for qid in chosen.get("hide", ())),
            )
        )
    return beats


def read_lines(path: Path) -> dict[str, dict[str, Any]]:
    """The written lines, by qid: {line, date?, source: {title, url}}."""
    if not path.exists():
        return {}
    lines = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for qid, written in lines.items():
        source = written.get("source", {}) if isinstance(written, dict) else {}
        if not written.get("line") or not source.get("title") or not source.get("url"):
            raise MeanwhileError(f"{path.name}: {qid} needs a line and a source's title and url")
        if "date" in written:
            iso_day(str(written["date"]))
    return lines


def read_table(lines: Iterable[str]) -> list[Event]:
    """The event index, in its score order."""
    rows = iter(lines)
    header = tuple(next(rows, "").rstrip("\n").split("\t"))
    if header != events.COLUMNS:
        raise MeanwhileError(f"the event index's header is {header!r}")
    index = []
    for line in rows:
        row = dict(zip(header, line.rstrip("\n").split("\t"), strict=True))
        index.append(
            Event(
                qid=row["qid"],
                label=row["label"],
                enwiki=row["enwiki"],
                date=iso_day(row["date"]),
                precision=int(row["precision"]),
                t0=iso_day(row["t0"]),
                t1=iso_day(row["t1"]),
                at=(float(row["lon"]), float(row["lat"])),
                inherited=row["inherited"] == "1",
                score=float(row["score"]),
                parents=tuple(row["parents"].split()),
            )
        )
    return index


def read_lock(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


# What the lock holds


def entry(
    event: Event, written: Mapping[str, Any] | None = None, *, line: bool = True
) -> dict[str, Any]:
    """An entry as the lock gives it: the label with its first letter capitalized, the date and
    its label at its precision, the place, the source, and for a beat's entry (`line`) its written
    line. Where the event has a written line, the entry cites its source, and takes the date the
    source gives where that differs from Wikidata's."""
    day, precision = event.date, event.precision
    if written is not None and "date" in written:
        day, precision = iso_day(str(written["date"])), DAY
    fields: dict[str, Any] = {
        "qid": event.qid,
        "label": event.label[:1].upper() + event.label[1:],
        "date": events.iso(civil(day)),
        "dateLabel": date_label(day, precision),
        "at": list(event.at),
    }
    if written is not None and line:
        fields["line"] = written["line"]
    fields["source"] = dict(written["source"]) if written is not None else article(event)
    return fields


def article(event: Event) -> dict[str, str]:
    """The event's English Wikipedia article, else its Wikidata item."""
    if not event.enwiki:
        return {
            "title": f"{event.label} (Wikidata)",
            "url": f"https://www.wikidata.org/wiki/{event.qid}",
        }
    path = urllib.parse.quote(event.enwiki.replace(" ", "_"), safe="_(),'-.:")
    return {"title": f"{event.enwiki} (Wikipedia)", "url": f"https://en.wikipedia.org/wiki/{path}"}


def date_label(day: int, precision: int) -> str:
    """'18 June 1815', 'June 1815' or '1815', as the date's precision allows."""
    year, month, date = civil(day)
    shown = str(year) if year > 0 else f"{1 - year} BC"
    if precision <= YEAR:
        return shown
    if precision == MONTH:
        return f"{MONTH_NAMES[month - 1]} {shown}"
    return f"{date} {MONTH_NAMES[month - 1]} {shown}"


# Day numbers: days since 0001-01-01, proleptic Gregorian, astronomical years (as dates.ts)

_EPOCH = 306  # days from 0000-03-01 to 0001-01-01


def day_number(year: int, month: int, day: int) -> int:
    y = year - 1 if month <= 2 else year
    era = y // 400
    yoe = y - era * 400
    doy = (153 * ((month + 9) % 12) + 2) // 5 + day - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - _EPOCH


def civil(number: int) -> events.Day:
    z = number + _EPOCH
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    day = doy - (153 * mp + 2) // 5 + 1
    month = mp + 3 if mp < 10 else mp - 9
    return yoe + era * 400 + (1 if month <= 2 else 0), month, day


def iso_day(text: str) -> int:
    match = events.DATE.match(f"{text.strip()}T")
    if not match:
        raise MeanwhileError(f"{text!r} is not an ISO date")
    return day_number(int(match[1]), int(match[2]), int(match[3]))
