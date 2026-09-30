"""The events stage (streaming.md 3.4, 7.1, 7.2): the all-eras event index as one cleaned, scored
table, `ev/events.tsv.gz` in the profile's output root, read from the pinned Wikidata export
(`uv run prebuild wikidata`), with the record `build/stages/<profile>/events.json`, whose `inputs`
name the export and hash the two configs, so a stage reading the table can tell when it is stale.

Each row of the export is one dated statement of an event, exported under one class
(`pipeline/queries/events.rq`). The stage keeps the statements dated to the year or finer, groups
them by event and drops the events with no English label, no coordinates (or 0°, 0°), or no
Wikipedia edition. Per event it takes:

- the class: the heaviest of those it was exported under (`pipeline/config/event-classes.yaml`),
  which weighs its score;
- the class it is displayed as, whose glyph its mark draws: of the classes it was exported under,
  the most specific nested within its heaviest. The export takes each class with its subclasses,
  so it gives a class every event of each of its subclasses: a class is nested within another
  when every event exported under it is also exported under the other. The 1815 eruption of
  Tambora, exported as a volcanic eruption and a natural disaster, is scored as the heavier
  natural disaster and displayed as a volcanic eruption, since the export gives every volcanic
  eruption as a natural disaster too. Where Wikidata does not nest a class within the one it
  belongs to, event-classes.yaml declares it `within` that one, and each event counts under it as
  though the export had: a siege exported as a battle too draws the siege, and a tropical cyclone
  exported as a natural disaster the cyclone. Two classes that merely share events are not
  nested, whichever is rarer: the export's riots and massacres share 34 events and neither holds
  the other, so a riot that is also a massacre keeps its heaviest class's glyph and pace layer.
  Among classes the export cannot tell apart, or nested within the heaviest but not within one
  another, it is displayed as the heavier, then the one event-classes.yaml lists first;
- the date: its point in time (P585), else its start (P580), else its end (P582); among several of
  one property, the most precise, then the earliest; or the `date` in `dates` in
  `pipeline/config/events-curated.yaml`, where a better source dates it otherwise. A date of year
  or month precision stands for the first day it names (`named_days`);
- the span `t0`-`t1` it covers: from the earliest of its date and start times to the latest of its
  date and end times, each widened to its precision (a year runs 1 January to 31 December), so a
  war with a point in time still spans its years; a curated date leaves out the statement it
  corrects, so a one-day battle Wikidata dates two years late spans its one day, and a curated
  `end` stands in for its end times (P582);
- the place: the `place` in `places` in `pipeline/config/events-curated.yaml`, where a better
  source puts it than Wikidata's coordinates; else its own coordinates, else those of its location
  (`inherited` 1);
- the score: log2(1 + Wikipedia editions) times the class's weight, plus any legacyBoost in
  `pipeline/config/events-curated.yaml`;
- its part-of parents (P361) as Wikidata gives them, whether or not they are in the index.

The table is UTF-8 TSV with a header line, gzip level 9 with mtime 0, in score order, then by qid;
all accepted events are kept (event-files pages larger corpora). Columns: qid, label, enwiki,
class, display, date, precision, t0, t1, lon, lat, inherited, editions, score, parents
(space-separated qids). Dates are ISO days in the
proleptic Gregorian calendar with astronomical years (1 BC is 0000), as `app/src/story/dates.ts`
reads them, with Wikidata's precision: 9 year, 10 month, 11 day.

Calendar: Wikidata's export gives a day in the proleptic Gregorian calendar, converting a date its
source wrote in the Julian (Hastings, 14 October 1066, is exported as 20 October), but a year or a
month as its source wrote it, unconverted. Sources write the dates before 15 October 1582 in the
Julian calendar, so the stage reads a year or month in that historical calendar: 1066 runs from
1 January 1066 (Julian), which is 7 January (Gregorian), to 31 December (Julian). The calendar
here mirrors dates.ts's: `historical` and `format_historical` give a day as history writes it,
Julian before the reform, as Explore shows it. A curated day is written as history writes it
too, so the stage reads one before the reform in the Julian: the Fall of Constantinople's end,
29 May 1453, is the Gregorian 7 June.

The table stays build-only for Meanwhile and lobby picks. The separate event-files stage reads it
and the pinned export to publish the runtime `.wev` files, with percentile scores and display
parents (3.4). The fixture reads a committed slice of the export, retaining all statements of
events dated in 1815-1817 and their exported ancestors.
"""

import gzip
import json
import math
import os
import re
import time
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from prebuild.config import (
    EVENT_CLASSES,
    EVENT_CURATED,
    CuratedDays,
    EventClass,
    curated_places,
    enclosing,
    load_event_boosts,
    load_event_classes,
    load_event_dates,
    load_event_places,
)
from prebuild.hashing import sha256_file
from prebuild.paths import excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import write_record
from prebuild.sources import Source, SourcesError, load_sources, verified_path
from prebuild.wikidata import COLUMNS as EXPORT_COLUMNS
from prebuild.wikidata import META, SOURCE_PREFIX, TABLE

STAGE = "events"
KEY = "ev/events.tsv.gz"
YEAR, MONTH, DAY = 9, 10, 11  # Wikidata's precisions
REFORM = (1582, 10, 15)  # the first Gregorian day; the Julian 4 October 1582 is the day before
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
DATE_ORDER = ("P585", "P580", "P582")  # point in time, start time, end time
COLUMNS = (
    "qid",
    "label",
    "enwiki",
    "class",
    "display",
    "date",
    "precision",
    "t0",
    "t1",
    "lon",
    "lat",
    "inherited",
    "editions",
    "score",
    "parents",
)
ENTITY = "http://www.wikidata.org/entity/"
QID = re.compile(r"Q[1-9][0-9]*")
DATE = re.compile(r"(-?[0-9]+)-([0-9]{2})-([0-9]{2})T")
POINT = re.compile(r"POINT\(([-+0-9.eE]+) ([-+0-9.eE]+)\)", re.IGNORECASE)
ESCAPE = re.compile(r"\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)")
ESCAPES = {"t": "\t", "n": "\n", "r": "\r", "b": "\b", "f": "\f"}

type Day = tuple[int, int, int]  # astronomical year, month, day
type LonLat = tuple[float, float]


class EventsError(ValueError):
    """The export is not what the stage reads, or does not match the class list."""


@dataclass(frozen=True)
class Statement:
    """One row of the export: a dated statement of an event, under one class."""

    cls: str  # the class's qid
    qid: str
    label: str
    enwiki: str
    prop: str  # P585, P580 or P582
    day: Day
    precision: int
    coord: LonLat | None
    place: LonLat | None  # its location's coordinates
    editions: int
    parents: tuple[str, ...]


@dataclass(frozen=True)
class Event:
    """One row of the table."""

    qid: str
    label: str
    enwiki: str
    cls: str  # the name of its heaviest class, which weighs its score
    display: str  # its most specific class nested within that one, which its mark draws
    day: Day
    precision: int
    t0: Day
    t1: Day
    lon: float
    lat: float
    inherited: bool
    editions: int
    score: float
    parents: tuple[str, ...]


def run(ctx: Context) -> None:
    started = time.perf_counter()
    source = export_source(load_sources())
    fixture = ctx.profile is Profile.FIXTURE
    paths = {
        name: excerpts_dir(ctx.repo) / STAGE / name
        if fixture
        else verified_path(ctx, source.id, name)
        for name in (META, TABLE)
    }
    meta = json.loads(paths[META].read_text(encoding="utf-8"))
    if fixture and meta["source"] != source.id:
        raise EventsError("the fixture names another export: run `uv run prebuild excerpts`")
    classes = load_event_classes()
    missing = [c.name for c in classes if c.qid not in meta["rows"]]
    if missing:
        raise EventsError(
            f"{source.id} lacks the classes {', '.join(missing)}: run `uv run prebuild wikidata`"
        )
    with gzip.open(paths[TABLE], "rt", encoding="utf-8") as stream:
        statements = read_export(stream)
    places = curated_places(load_event_places())
    if not fixture:  # the fixture's slice holds the events of 1815-1817 only
        check_places(statements, places, source.id)
    events = index(
        statements,
        classes,
        load_event_boosts(legacy=True),
        load_event_dates(),
        places=places,
    )
    payload = encode(events)
    stored = gzip.compress(payload, compresslevel=9, mtime=0)
    target = ctx.out / KEY
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    partial.write_bytes(stored)
    partial.replace(target)
    by_class = {c.name: 0 for c in classes}
    for event in events:
        by_class[event.cls] += 1
    record = {
        "key": KEY,
        "export": source.id,
        "exported": meta["exported"],
        "rows": len(events),
        "bytes": len(stored),
        "decoded": len(payload),
        "classes": by_class,
        "inputs": inputs(source.id),
    }
    if fixture:
        record["inputs"].update({name: sha256_file(path) for name, path in paths.items()})
    write_record(ctx, STAGE, record)
    seconds = time.perf_counter() - started
    print(
        f"events: {len(events)} events from {source.id}, {len(stored) / 1e6:.1f} MB "
        f"({len(payload) / 1e6:.1f} MB decoded) into {KEY}, {seconds:.1f} s",
        flush=True,
    )


def inputs(export: str) -> dict[str, str]:
    """What the table is built from: the export's id and the configs' sha256s."""
    return {
        "export": export,
        "classes": sha256_file(EVENT_CLASSES),
        "curated": sha256_file(EVENT_CURATED),
    }


def export_source(registry: Mapping[str, Source]) -> Source:
    """The one Wikidata export sources.toml pins."""
    exports = [source for key, source in registry.items() if key.startswith(SOURCE_PREFIX)]
    if len(exports) != 1:
        raise SourcesError(
            f"sources.toml pins {len(exports)} Wikidata exports, not one: "
            "run `uv run prebuild wikidata`"
        )
    return exports[0]


def check_places(
    statements: Iterable[Statement], places: Mapping[str, LonLat], export: str
) -> None:
    """Refuses a curated place for an event the whole export lacks, which would move nothing."""
    exported = {s.qid for s in statements}
    missing = sorted(places.keys() - exported, key=_number)
    if missing:
        raise EventsError(
            f"events-curated.yaml places {', '.join(missing)}, which {export} lacks: "
            "correct the qid or drop its place"
        )


def read_export(lines: Iterable[str]) -> list[Statement]:
    """The export's statements, after its header line."""
    rows = iter(lines)
    header = tuple(next(rows, "").rstrip("\n").split("\t"))
    if header != ("?class", *EXPORT_COLUMNS):
        raise EventsError(f"the export's header is {header!r}")
    statements = []
    for n, line in enumerate(rows, start=2):
        fields = [term(field) for field in line.rstrip("\n").split("\t")]
        if len(fields) != 11:
            raise EventsError(f"export line {n} has {len(fields)} fields, not 11")
        cls, event, label, enwiki, prop, date, precision, coord, place, editions, parents = fields
        day = _day(date)
        if day is None:
            continue  # deep time beyond an ISO date, far coarser than a year
        statements.append(
            Statement(
                cls=cls,
                qid=_qid(event.removeprefix(ENTITY), n),
                label=label,
                enwiki=enwiki,
                prop=prop,
                day=day,
                precision=int(precision),
                coord=point(coord),
                place=point(place),
                editions=int(editions or 0),
                parents=tuple(_qid(p, n) for p in parents.split()),
            )
        )
    return statements


def index(
    statements: Iterable[Statement],
    classes: Sequence[EventClass],
    boosts: Mapping[str, float],
    dates: Mapping[str, CuratedDays] | None = None,
    *,
    keep_unlocated: bool = False,
    places: Mapping[str, LonLat] | None = None,
) -> list[Event]:
    """The cleaned, scored events, in score order, then by qid. A curated date (`dates`, by qid)
    stands in for Wikidata's, in the span as well as the date, and a curated end for its end
    times; a curated place (`places`, by qid) for a located event's coordinates and its location's.
    A curated place for an event the export leaves unlocated is refused."""
    by_qid = {c.qid: c for c in classes}
    listed = {c.qid: i for i, c in enumerate(classes)}
    grouped: dict[str, list[Statement]] = {}
    for s in statements:
        if s.precision >= YEAR and s.cls in by_qid:
            grouped.setdefault(s.qid, []).append(s)
    # A curated place moves a located event. An unlocated one is a parent, which the event-files
    # stage places from its children, or else by a sourced countryCentroid or an at.
    unlocated = sorted(
        (
            q
            for q in (places or {})
            if q in grouped and not any(s.coord or s.place for s in grouped[q])
        ),
        key=_number,
    )
    if unlocated:
        raise EventsError(
            f"events-curated.yaml gives {', '.join(unlocated)} a place, but the export leaves it "
            "unlocated: give an unlocated parent a countryCentroid or an at"
        )
    # The events the export gives each class, and each ordered pair of classes together: a class
    # is nested within another when the export gives the other every one of its events. An event
    # counts under the classes event-classes.yaml declares its classes within, too, where the
    # export does not nest them: every siege is a battle.
    by_name = {c.name: c for c in classes}
    declared = {c.qid: {by_name[n].qid for n in enclosing(c, by_name)} for c in classes}
    held: Counter[str] = Counter()
    both: Counter[tuple[str, str]] = Counter()
    for group in grouped.values():
        counted = set().union(*({s.cls, *declared[s.cls]} for s in group))
        held.update(counted)
        both.update((a, b) for a in counted for b in counted if a != b)
    events = []
    for qid, group in grouped.items():
        label = next((s.label for s in group if s.label), "")
        editions = max(s.editions for s in group)
        coord = next((s.coord for s in group if s.coord), None)
        place = next((s.place for s in group if s.place), None)
        curated_place = places.get(qid) if places else None
        lon_lat = curated_place or coord or place
        if not label or not editions or (lon_lat is None and not keep_unlocated):
            continue
        # The event-files stage places exported parents from their children. The legacy table
        # and Meanwhile still require a source location; NaNs never reach that table.
        lon_lat = lon_lat or (math.nan, math.nan)
        cls = max((by_qid[s.cls] for s in group), key=lambda c: c.weight)
        display = _displayed(cls.qid, {s.cls for s in group}, held, both, by_qid, listed)
        dated = min(group, key=lambda s: (DATE_ORDER.index(s.prop), -s.precision, s.day))
        curation = dates.get(qid, CuratedDays()) if dates else CuratedDays()
        curated = _historical_day(curation.date) if curation.date else None
        end = _historical_day(curation.end) if curation.end else None
        day, precision = (curated, DAY) if curated else (_first_day(dated), dated.precision)
        # A curated day corrects the statement Wikidata dates the event by, in its span as well,
        # and a curated end every end time.
        corrected = (dated.prop, dated.day, dated.precision) if curated else None
        spanning = [
            s
            for s in group
            if (s.prop, s.day, s.precision) != corrected and not (end and s.prop == "P582")
        ]
        starts = [s for s in spanning if s is dated or s.prop == "P580"]
        ends = [s for s in spanning if s is dated or s.prop == "P582"]
        events.append(
            Event(
                qid=qid,
                label=label,
                enwiki=next((s.enwiki for s in group if s.enwiki), ""),
                cls=cls.name,
                display=by_qid[display].name,
                day=day,
                precision=precision,
                t0=min([day, *(_first_day(s) for s in starts)]),
                t1=max([day, *([end] if end else []), *(_last_day(s) for s in ends)]),
                lon=lon_lat[0],
                lat=lon_lat[1],
                inherited=coord is None and curated_place is None,
                editions=editions,
                score=math.log2(1 + editions) * cls.weight + boosts.get(qid, 0.0),
                parents=tuple(sorted({p for s in group for p in s.parents}, key=_number)),
            )
        )
    events.sort(key=lambda e: (-e.score, _number(e.qid)))
    return events


def _displayed(
    heaviest: str,
    exported: set[str],
    held: Mapping[str, int],
    both: Mapping[tuple[str, str], int],
    by_qid: Mapping[str, EventClass],
    listed: Mapping[str, int],
) -> str:
    """The class an event is displayed as: of the classes it was `exported` under, the most specific
    nested within its `heaviest`, then the heavier, then the first listed."""

    def within(a: str, b: str) -> bool:
        """Whether every event class a counts is counted under class b."""
        return a == b or both[(b, a)] == held[a]

    nested = [c for c in exported if within(c, heaviest)]
    deepest = [c for c in nested if not any(within(d, c) and held[d] < held[c] for d in nested)]
    return min(deepest, key=lambda c: (-by_qid[c].weight, listed[c]))


def encode(events: Iterable[Event]) -> bytes:
    """The table's bytes: a header line, then one line per event."""
    lines = ["\t".join(COLUMNS)]
    for e in events:
        fields = (
            e.qid,
            _clean(e.label),
            _clean(e.enwiki),
            e.cls,
            e.display,
            iso(e.day),
            str(e.precision),
            iso(e.t0),
            iso(e.t1),
            _decimal(e.lon, 5),
            _decimal(e.lat, 5),
            "1" if e.inherited else "0",
            str(e.editions),
            _decimal(e.score, 4),
            " ".join(e.parents),
        )
        lines.append("\t".join(fields))
    return ("\n".join(lines) + "\n").encode()


def term(text: str) -> str:
    """One SPARQL TSV term's value: an IRI's address, a literal's text, or a bare value as is."""
    if text.startswith("<") and text.endswith(">"):
        return text[1:-1]
    if text.startswith('"'):
        return ESCAPE.sub(_unescape, text[1 : text.rindex('"')])
    return text


def point(text: str) -> LonLat | None:
    """A WKT point on Earth; None for none, a point on another body, or 0°, 0°."""
    match = POINT.fullmatch(text)
    if not match:
        return None
    lon, lat = float(match[1]), float(match[2])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90) or (lon, lat) == (0, 0):
        return None
    return lon, lat


def iso(day: Day) -> str:
    year, month, date = day
    sign = "-" if year < 0 else ""
    return f"{sign}{abs(year):04d}-{month:02d}-{date:02d}"


def _first_day(s: Statement) -> Day:
    return named_days(s.day, s.precision)[0] if s.precision < DAY else s.day


def _last_day(s: Statement) -> Day:
    return named_days(s.day, s.precision)[1] if s.precision < DAY else s.day


def month_days(year: int, month: int) -> int:
    """Days in a month of the proleptic Gregorian calendar, astronomical years."""
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


# The calendar, as app/src/story/dates.ts has it: day numbers count the days since 0001-01-01 in
# the proleptic Gregorian calendar, astronomical years, by integer arithmetic; history writes the
# days before 15 October 1582 in the Julian calendar.

_EPOCH = 306  # days from 0000-03-01 to 0001-01-01 (Gregorian)
_JULIAN_EPOCH = 308  # days from 0000-03-01 to 0001-01-03 (Julian), which is 0001-01-01 Gregorian


def day_number(year: int, month: int, day: int) -> int:
    """The day number of a proleptic Gregorian date."""
    y = year - 1 if month <= 2 else year
    era = y // 400
    yoe = y - era * 400
    doy = (153 * ((month + 9) % 12) + 2) // 5 + day - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - _EPOCH


def civil(number: int) -> Day:
    """The proleptic Gregorian date of a day number."""
    z = number + _EPOCH
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    day = doy - (153 * mp + 2) // 5 + 1
    month = mp + 3 if mp < 10 else mp - 9
    return yoe + era * 400 + (1 if month <= 2 else 0), month, day


def julian_day_number(year: int, month: int, day: int) -> int:
    """The day number of a proleptic Julian date."""
    y = year - 1 if month <= 2 else year
    era = y // 4
    doy = (153 * ((month + 9) % 12) + 2) // 5 + day - 1
    return era * 1461 + (y - era * 4) * 365 + doy - _JULIAN_EPOCH


def julian_civil(number: int) -> Day:
    """The proleptic Julian date of a day number."""
    z = number + _JULIAN_EPOCH
    era = z // 1461
    doe = z - era * 1461
    yoe = (doe - doe // 1460) // 365
    doy = doe - 365 * yoe
    mp = (5 * doy + 2) // 153
    day = doy - (153 * mp + 2) // 5 + 1
    month = mp + 3 if mp < 10 else mp - 9
    return yoe + era * 4 + (1 if month <= 2 else 0), month, day


def historical(day: Day) -> Day:
    """A proleptic Gregorian date as history writes it: Julian before 15 October 1582."""
    return julian_civil(day_number(*day)) if day < REFORM else day


def from_historical(date: Day) -> Day:
    """The proleptic Gregorian date of a historical one. 5-14 October 1582 never were."""
    if date >= REFORM:
        return date
    if date > (1582, 10, 4):
        raise ValueError(f"{iso(date)} fell in the calendar reform's gap")
    return civil(julian_day_number(*date))


def named_days(date: Day, precision: int) -> tuple[Day, Day]:
    """The first and last proleptic Gregorian days a historical date names at its precision: a
    year from its 1 January to its 31 December, a month from its first day to its last, each in
    the Julian calendar before the reform, as its sources write them."""
    year, month, _ = date
    if precision >= DAY:
        first = from_historical(date)
        return first, first
    if precision <= YEAR:
        first, following = (year, 1, 1), (year + 1, 1, 1)
    else:
        first, following = (year, month, 1), (year + month // 12, month % 12 + 1, 1)
    return from_historical(first), civil(day_number(*from_historical(following)) - 1)


def format_historical(day: Day, precision: int = DAY) -> str:
    """A proleptic Gregorian date as history writes it, at Wikidata's precision: '14 October
    1066', 'March 44 BCE', '701 BCE', as dates.ts's formatHistorical."""
    year, month, date = historical(day)
    named = str(year) if year > 0 else f"{1 - year} BCE"
    if precision <= YEAR:
        return named
    named = f"{MONTHS[month - 1]} {named}"
    return named if precision == MONTH else f"{date} {named}"


def _historical_day(text: str) -> Day:
    """The proleptic Gregorian day of a curated ISO day, written as history writes it."""
    day = _day(f"{text}T")
    if day is None:
        raise EventsError(f"{text!r} is not an ISO day")
    return from_historical(day)


def _day(text: str) -> Day | None:
    match = DATE.match(text)
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def _qid(text: str, line: int) -> str:
    if not QID.fullmatch(text):
        raise EventsError(f"export line {line}: {text!r} is not a Wikidata item")
    return text


def _number(qid: str) -> int:
    return int(qid[1:])


def _unescape(match: re.Match[str]) -> str:
    code = match[1]
    if code[0] in "uU" and len(code) > 1:
        return chr(int(code[1:], 16))
    return ESCAPES.get(code, code)


def _clean(text: str) -> str:
    """Text for one TSV field: no tabs or line breaks."""
    return " ".join(text.split())


def _decimal(value: float, digits: int) -> str:
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text
