"""The events stage (streaming.md 3.4, 7.1, 7.2): the all-eras event index as one cleaned, scored
table, `ev/events.tsv.gz` in the profile's output root, read from the pinned Wikidata export
(`uv run prebuild wikidata`), with the record `build/stages/<profile>/events.json`.

Each row of the export is one dated statement of an event, exported under one class
(`pipeline/queries/events.rq`). The stage keeps the statements dated to the year or finer, groups
them by event and drops the events with no English label, no coordinates (or 0°, 0°), or no
Wikipedia edition. Per event it takes:

- the class: the heaviest of those it was exported under (`pipeline/config/event-classes.yaml`);
- the date: its point in time (P585), else its start (P580), else its end (P582); among several of
  one property, the most precise, then the earliest. `end` is its end time, when the date is not;
- the place: its own coordinates, else those of its location (`inherited` 1);
- the score: log2(1 + Wikipedia editions) times the class's weight, plus any boost in
  `pipeline/config/events-curated.yaml`;
- its part-of parents (P361) as Wikidata gives them, whether or not they are in the index.

The table is UTF-8 TSV with a header line, gzip level 9 with mtime 0, in score order, then by qid;
the first `MAX_ROWS` events are kept. Columns: qid, label, enwiki, class, date, precision, end,
endPrecision, lon, lat, inherited, editions, score, parents (space-separated qids). Dates are ISO
days in astronomical years (1 BC is 0000), as `app/src/story/dates.ts` reads them, with Wikidata's
precision: 9 year, 10 month, 11 day. Milestone 1 publishes none of it: the `.wev` files (3.4) come
with the globe's events layer. The fixture skips the stage, since it reads raw data.
"""

import gzip
import json
import math
import os
import re
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from prebuild.config import EventClass, load_event_boosts, load_event_classes
from prebuild.profiles import Context
from prebuild.records import write_record
from prebuild.sources import Source, SourcesError, load_sources, verified_path
from prebuild.wikidata import COLUMNS as EXPORT_COLUMNS
from prebuild.wikidata import META, SOURCE_PREFIX, TABLE

STAGE = "events"
KEY = "ev/events.tsv.gz"
MAX_ROWS = 100_000  # streaming.md 3.4's bound for one events file
YEAR = 9  # Wikidata's precision for a year; month is 10, day 11
DATE_ORDER = ("P585", "P580", "P582")  # point in time, start time, end time
COLUMNS = (
    "qid",
    "label",
    "enwiki",
    "class",
    "date",
    "precision",
    "end",
    "endPrecision",
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
    cls: str  # the class's name
    day: Day
    precision: int
    end: Day | None
    end_precision: int | None
    lon: float
    lat: float
    inherited: bool
    editions: int
    score: float
    parents: tuple[str, ...]


def run(ctx: Context) -> None:
    started = time.perf_counter()
    source = export_source(load_sources())
    meta = json.loads(verified_path(ctx, source.id, META).read_text(encoding="utf-8"))
    classes = load_event_classes()
    missing = [c.name for c in classes if c.qid not in meta["rows"]]
    if missing:
        raise EventsError(
            f"{source.id} lacks the classes {', '.join(missing)}: run `uv run prebuild wikidata`"
        )
    with gzip.open(verified_path(ctx, source.id, TABLE), "rt", encoding="utf-8") as stream:
        events = index(read_export(stream), classes, load_event_boosts())
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
    }
    write_record(ctx, STAGE, record)
    seconds = time.perf_counter() - started
    print(
        f"events: {len(events)} events from {source.id}, {len(stored) / 1e6:.1f} MB "
        f"({len(payload) / 1e6:.1f} MB decoded) into {KEY}, {seconds:.1f} s",
        flush=True,
    )


def export_source(registry: Mapping[str, Source]) -> Source:
    """The one Wikidata export sources.toml pins."""
    exports = [source for key, source in registry.items() if key.startswith(SOURCE_PREFIX)]
    if len(exports) != 1:
        raise SourcesError(
            f"sources.toml pins {len(exports)} Wikidata exports, not one: "
            "run `uv run prebuild wikidata`"
        )
    return exports[0]


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
) -> list[Event]:
    """The cleaned, scored events, in score order, then by qid, at most `MAX_ROWS`."""
    by_qid = {c.qid: c for c in classes}
    grouped: dict[str, list[Statement]] = {}
    for s in statements:
        if s.precision >= YEAR and s.cls in by_qid:
            grouped.setdefault(s.qid, []).append(s)
    events = []
    for qid, group in grouped.items():
        label = next((s.label for s in group if s.label), "")
        editions = max(s.editions for s in group)
        coord = next((s.coord for s in group if s.coord), None)
        place = next((s.place for s in group if s.place), None)
        lon_lat = coord or place
        if not label or not editions or lon_lat is None:
            continue
        cls = max((by_qid[s.cls] for s in group), key=lambda c: c.weight)
        dated = min(group, key=lambda s: (DATE_ORDER.index(s.prop), *_precise_then_earliest(s)))
        ends = [s for s in group if s.prop == "P582" and s.day >= dated.day]
        end = min(ends, key=_precise_then_earliest) if dated.prop != "P582" and ends else None
        events.append(
            Event(
                qid=qid,
                label=label,
                enwiki=next((s.enwiki for s in group if s.enwiki), ""),
                cls=cls.name,
                day=dated.day,
                precision=dated.precision,
                end=end.day if end else None,
                end_precision=end.precision if end else None,
                lon=lon_lat[0],
                lat=lon_lat[1],
                inherited=coord is None,
                editions=editions,
                score=math.log2(1 + editions) * cls.weight + boosts.get(qid, 0.0),
                parents=tuple(sorted({p for s in group for p in s.parents}, key=_number)),
            )
        )
    events.sort(key=lambda e: (-e.score, _number(e.qid)))
    return events[:MAX_ROWS]


def encode(events: Iterable[Event]) -> bytes:
    """The table's bytes: a header line, then one line per event."""
    lines = ["\t".join(COLUMNS)]
    for e in events:
        fields = (
            e.qid,
            _clean(e.label),
            _clean(e.enwiki),
            e.cls,
            iso(e.day),
            str(e.precision),
            iso(e.end) if e.end else "",
            str(e.end_precision or ""),
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


def _precise_then_earliest(s: Statement) -> tuple[int, Day]:
    return -s.precision, s.day


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
