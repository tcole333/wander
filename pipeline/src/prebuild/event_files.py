"""Runtime event files (streaming.md 3.4). No network: the cleaned table supplies the rows;
its pinned local export supplies alternate places/dates and otherwise discarded parent records.
Neither the TSV nor the story locks are rewritten. The worker's exact array bytes set paging.
Explore's openings (`explore/openings.lock.json`, the openings stage's) join the overview on top
of its quota, so the first view never waits on a rest file; the record's `inputs` hash the lock.
An event's score is weighed by its heaviest class, and its `cls` is the class its mark draws, its
most specific (the table's `display`).
"""

import bisect
import csv
import gzip
import json
import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, replace
from pathlib import Path

import yaml
from shapely.geometry import Point, shape

from prebuild import events
from prebuild.config import (
    CONFIG_DIR,
    load_event_boosts,
    load_event_classes,
    load_event_dates,
    load_event_places,
)
from prebuild.hashing import sha256_file, ver8
from prebuild.meanwhile import apart_km, civil, day_number, iso_day
from prebuild.openings import FOLDER as OPENINGS_FOLDER
from prebuild.openings import LOCK as OPENINGS_LOCK
from prebuild.paths import excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import read_record, write_record
from prebuild.sources import load_sources, verified_path

STAGE = "event-files"
OVERVIEW_ROWS = 4096
ALL_ROWS = 100_000
ALL_BYTES = 16 * 1024 * 1024
SCALE = 100_000
COLUMNS = (
    "row",
    "qid",
    "lon",
    "lat",
    "t0",
    "t1",
    "prec",
    "cls",
    "score",
    "flags",
    "unc",
    "parent",
    "label",
)


@dataclass
class Row:
    event: events.Event
    era: int
    score: int = 0
    row: int = 0
    parent: int = -1
    flags: int = 0
    unc: int = 0
    ext: tuple[int, int, int, int] | None = None


def era_edges() -> list[int]:
    """The day numbers of the finite era edges, each its year's 1 January in the historical
    calendar, where the events stage starts an event dated to that year."""
    years = yaml.safe_load((CONFIG_DIR / "era-bins.yaml").read_text())["edges"]
    if len(years) != 25 or years != sorted(set(years)):
        raise events.EventsError("era-bins.yaml needs 25 increasing edges")
    return [day_number(*events.from_historical((int(year), 1, 1))) for year in years[1:-1]]


def read_table(path: Path) -> list[events.Event]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        rows = csv.DictReader(stream, delimiter="\t")
        if tuple(rows.fieldnames or ()) != events.COLUMNS:
            raise events.EventsError(f"{path}: not the events table")
        return [
            events.Event(
                qid=r["qid"],
                label=r["label"],
                enwiki=r["enwiki"],
                cls=r["class"],
                display=r["display"],
                day=civil(iso_day(r["date"])),
                precision=int(r["precision"]),
                t0=civil(iso_day(r["t0"])),
                t1=civil(iso_day(r["t1"])),
                lon=float(r["lon"]),
                lat=float(r["lat"]),
                inherited=r["inherited"] == "1",
                editions=int(r["editions"]),
                score=float(r["score"]),
                parents=tuple(r["parents"].split()),
            )
            for r in rows
        ]


def centroid(points: list[events.LonLat]) -> events.LonLat:
    vectors = [
        (
            math.cos(math.radians(lat)) * math.cos(math.radians(lon)),
            math.cos(math.radians(lat)) * math.sin(math.radians(lon)),
            math.sin(math.radians(lat)),
        )
        for lon, lat in points
    ]
    x, y, z = (sum(v[i] for v in vectors) for i in range(3))
    if math.hypot(x, y, z) < 1e-12:
        return min(points)  # antipodal children have no unique spherical centroid
    return math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))


def extent(points: list[events.LonLat]) -> tuple[int, int, int, int]:
    """Smallest longitude arc; east may exceed 180 degrees at the dateline."""
    lons = sorted({lon % 360 for lon, _ in points})
    gap = max(range(len(lons)), key=lambda i: (lons[(i + 1) % len(lons)] - lons[i]) % 360)
    west = lons[(gap + 1) % len(lons)]
    east = lons[gap] + (360 if lons[gap] < west else 0)
    if west > 180:
        west, east = west - 360, east - 360
    return tuple(
        round(x * SCALE) for x in (west, min(p[1] for p in points), east, max(p[1] for p in points))
    )


def prepare(table: list[events.Event], statements: list[events.Statement]) -> list[Row]:
    classes = load_event_classes()
    boosts, dates, places = load_event_boosts(), load_event_dates(), load_event_places()
    exported = {
        e.qid: e for e in events.index(statements, classes, boosts, dates, keep_unlocated=True)
    }
    accepted = {e.qid: e for e in table}
    # A sourced fallback can also admit an exported parent whose children have no usable
    # locations. Otherwise such a parent would never be reached from the located TSV rows.
    exported_parents = {p for e in exported.values() for p in e.parents}
    for qid in places.keys() & exported_parents:
        if qid in exported and qid not in accepted:
            accepted[qid] = exported[qid]
    # Only add exported ancestors of accepted events. A locationless, unrelated event is not a mark.
    pending = list(accepted)
    while pending:
        for parent in accepted[pending.pop()].parents:
            if parent not in accepted and parent in exported:
                accepted[parent] = exported[parent]
                pending.append(parent)
    children: dict[str, list[str]] = defaultdict(list)
    for e in accepted.values():
        for parent in e.parents:
            children[parent].append(e.qid)
    derived: set[str] = set()
    unlocated = {q for q, e in accepted.items() if not math.isfinite(e.lon)}
    # Walk through unlocated children to source positions, without depending on input order.
    found = {}
    for qid in sorted(unlocated):
        todo, seen, points = list(children[qid]), {qid}, []
        while todo:
            child = todo.pop()
            if child in seen:
                continue
            seen.add(child)
            if child in unlocated:
                todo.extend(children[child])
            else:
                points.append((accepted[child].lon, accepted[child].lat))
        if points:
            found[qid] = centroid(points)
    for qid, (lon, lat) in found.items():
        accepted[qid] = replace(accepted[qid], lon=lon, lat=lat)
    derived.update(found)
    unlocated.difference_update(found)
    for qid in sorted(unlocated):
        supplied = places.get(qid, {})
        point = supplied.get("countryCentroid", supplied.get("at"))
        if point:
            accepted[qid] = replace(accepted[qid], lon=point[0], lat=point[1])
            derived.add(qid)
        else:
            del accepted[qid]
    edges = era_edges()
    rows = [Row(e, bisect.bisect_right(edges, day_number(*e.day))) for e in accepted.values()]
    weights = {c.name: c.weight for c in classes}
    # Ties share their upper cumulative rank; singleton eras get 1 before weighting.
    # Curated boosts are percentile points, capped before applying the class weight.
    by_era: dict[int, list[int]] = defaultdict(list)
    for r in rows:
        by_era[r.era].append(r.event.editions)
    for values in by_era.values():
        values.sort()
    max_weight = max(weights.values())
    for r in rows:
        e = r.event
        values = by_era[r.era]
        percentile = bisect.bisect_right(values, e.editions) / len(values)
        boosted = min(1, max(0, percentile + boosts.get(e.qid, 0)))
        r.score = round(1000 * boosted * weights[e.cls] / max_weight)
    rows.sort(key=lambda r: (-r.score, int(r.event.qid[1:])))
    by_qid = {r.event.qid: r for r in rows}
    source: dict[str, list[events.Statement]] = defaultdict(list)
    for s in statements:
        source[s.qid].append(s)
    points_by_qid: dict[str, list[events.LonLat]] = {}
    for i, r in enumerate(rows):
        r.row = i
        e = r.event
        group = source[e.qid]
        direct = {s.coord for s in group if s.coord}
        points = direct or {s.place for s in group if s.place} or {(e.lon, e.lat)}
        points_by_qid[e.qid] = sorted(points)
        conflict = any(
            len({(s.day, s.precision) for s in group if s.prop == prop}) > 1
            for prop in events.DATE_ORDER
        )
        r.flags = (
            int(e.inherited and e.qid not in derived)
            | (2 if e.qid in derived else 0)
            | (4 if len(points) > 1 else 0)
            | (8 if conflict else 0)
            | (16 if e.qid in boosts or e.qid in dates or e.qid in places else 0)
        )
    # Prefer a containing, then the shortest parent; score and Q number settle ties. Assign in
    # Q-number order and reject cycle-closing edges (including self-parent claims).
    for r in sorted(rows, key=lambda r: int(r.event.qid[1:])):
        e = r.event
        candidates = [by_qid[p] for p in e.parents if p in by_qid and p != e.qid]
        candidates.sort(
            key=lambda p: (
                not (p.event.t0 <= e.t0 and p.event.t1 >= e.t1),
                day_number(*p.event.t1) - day_number(*p.event.t0),
                -p.score,
                int(p.event.qid[1:]),
            )
        )
        for parent in candidates:
            at = parent.row
            while at != -1 and at != r.row:
                at = rows[at].parent
            if at != r.row:
                r.parent = parent.row
                break
    descendants: dict[int, list[int]] = defaultdict(list)
    for r in rows:
        if r.parent != -1:
            descendants[r.parent].append(r.row)

    def locations(r: Row) -> list[events.LonLat]:
        points = list(points_by_qid[r.event.qid])
        for child in descendants[r.row]:
            points.extend(locations(rows[child]))
        if descendants[r.row] or r.flags & 4:
            r.ext = extent(points)
        if r.flags & 2:
            # No source accuracy radius is available. For derived positions use the children's
            # reach; inherited source points retain 0 (no invented accuracy estimate).
            r.unc = min(
                65535, math.ceil(max(apart_km((r.event.lon, r.event.lat), p) for p in points))
            )
        return points

    for r in rows:
        if r.parent == -1:
            locations(r)
    return rows


def document(rows: list[Row], classes: list[str] | None = None) -> dict:
    doc = {"v": 1, "rows": len(rows)}
    if classes is not None:
        doc["classes"] = classes
    class_index = {c.name: i for i, c in enumerate(load_event_classes())}
    for column in COLUMNS:
        doc[column] = []
    doc["ext"] = []
    for r in rows:
        e = r.event
        t0, t1 = day_number(*e.t0), day_number(*e.t1)
        for t in (t0, t1):
            assert abs(t) <= 2**53 - 1 and int(float(t)) == t and civil(t) in (e.t0, e.t1)
        values = (
            r.row,
            int(e.qid[1:]),
            round(e.lon * SCALE),
            round(e.lat * SCALE),
            t0,
            t1,
            e.precision,
            class_index[e.display],
            r.score,
            r.flags,
            r.unc,
            r.parent,
            e.label,
        )
        for column, value in zip(COLUMNS, values, strict=True):
            doc[column].append(value)
        if r.ext is not None:
            doc["ext"].append([r.row, *r.ext])
    return doc


def decoded_bytes(doc: dict) -> int:
    """All worker arrays: 47 B/row + 4 B qid lookup + UTF-8 + end offset + sparse extents."""
    return 51 * doc["rows"] + 4 + sum(len(s.encode()) for s in doc["label"]) + 20 * len(doc["ext"])


def overview(rows: list[Row], count: int = OVERVIEW_ROWS) -> list[Row]:
    regions = [
        shape(f["geometry"])
        for f in json.loads((CONFIG_DIR / "macro-regions.geojson").read_text())["features"]
    ]
    quota = count // (24 * len(regions))
    cells: dict[tuple[int, int], int] = defaultdict(int)
    chosen: set[int] = set()
    for r in rows:
        region = next(
            (i for i, area in enumerate(regions) if area.covers(Point(r.event.lon, r.event.lat))),
            None,
        )
        if region is None:
            raise events.EventsError(
                f"macro-regions.geojson leaves {r.event.qid} at "
                f"({r.event.lon}, {r.event.lat}) outside every region"
            )
        cell = r.era, region
        if cells[cell] < quota:
            chosen.add(r.row)
            cells[cell] += 1
    for r in rows:
        if len(chosen) >= count:
            break
        chosen.add(r.row)
    return [r for r in rows if r.row in chosen]


def forced(rows: list[Row], qids: list[str], *, strict: bool) -> set[int]:
    """The rows of the openings, which join the overview on top of its quota. An opening absent
    from the rows fails a build of the whole index (`strict`); the fixture's slice of the index
    leaves it out and says how many it left."""
    by_qid = {r.event.qid: r.row for r in rows}
    absent = [qid for qid in qids if qid not in by_qid]
    if absent and strict:
        raise events.EventsError(
            f"the openings {', '.join(absent)} are not in the event index: "
            "run `uv run prebuild openings`"
        )
    if absent:
        print(f"event-files: {len(absent)} of {len(qids)} openings not in the index, left out")
    return {by_qid[qid] for qid in qids if qid in by_qid}


def build(
    rows: list[Row],
    out: Path,
    *,
    openings: Iterable[int] = (),
    all_rows: int = ALL_ROWS,
    all_bytes: int = ALL_BYTES,
) -> dict:
    """Write immutable .wev keys under out, the `openings` rows in the overview whatever its
    quota. Threshold arguments let small tests exercise pages."""
    edges = era_edges()
    chosen = {r.row for r in overview(rows)} | set(openings)
    first = [r for r in rows if r.row in chosen]
    rest = [r for r in rows if r.row not in chosen]
    full = document(rows)
    pages = {"overview": first}
    bins = {}
    if len(rows) <= all_rows and decoded_bytes(full) <= all_bytes:
        pages["all"] = rest
    else:
        pages.update({f"p{i:02}": [] for i in range(24)})
        pages["long"] = []
        bins = {f"p{i:02}": i for i in range(24)}
        for r in rest:
            lo = bisect.bisect_right(edges, day_number(*r.event.t0))
            hi = bisect.bisect_right(edges, day_number(*r.event.t1))
            if hi - lo >= 3:
                pages["long"].append(r)
            else:
                for i in range(lo, hi + 1):
                    pages[f"p{i:02}"].append(r)
    stored, records = {}, []
    for name, page in pages.items():
        if not page and name != "overview":
            continue
        doc = document(page, [c.name for c in load_event_classes()] if name == "overview" else None)
        payload = json.dumps(
            doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode()
        stored[f"{name}.wev"] = gzip.compress(payload, compresslevel=9, mtime=0)
        record = {
            "key": f"{name}.wev",
            "t0": min(doc["t0"], default=0),
            "t1": max(doc["t1"], default=0),
            "rows": len(page),
            "bytes": len(stored[f"{name}.wev"]),
            "decoded": decoded_bytes(doc),
            "jsonBytes": len(payload),
        }
        if name in bins:
            record["bin"] = bins[name]
        records.append(record)
    version = ver8(stored)
    prefix = f"ev/{version}/"
    for name, data in stored.items():
        path = out / prefix / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.read_bytes() != data:
            raise events.EventsError(f"immutable key collision: {path}")
        if not path.exists():
            path.write_bytes(data)
    for record in records:
        record["key"] = prefix + record["key"]
    return {
        "ver": version,
        "overview": prefix + "overview.wev",
        "rows": len(rows),
        "eraEdges": edges,
        "files": records,
    }


def openings_lock(ctx: Context) -> Path:
    """The committed lock of Explore's openings (the openings stage's)."""
    return ctx.repo / OPENINGS_FOLDER / OPENINGS_LOCK


def opening_qids(ctx: Context) -> list[str]:
    """The qids of Explore's openings, from a lock checked against this profile's event index.
    The fixture's index is a slice of the whole one the lock was checked against, so its table is
    never the lock's."""
    path = openings_lock(ctx)
    if not path.exists():
        raise events.EventsError(f"{path} is missing: run `uv run prebuild openings`")
    lock = json.loads(path.read_text(encoding="utf-8"))
    if ctx.profile is not Profile.FIXTURE and lock["table"] != sha256_file(ctx.out / events.KEY):
        raise events.EventsError(
            f"{OPENINGS_FOLDER}/{OPENINGS_LOCK} was checked against another event index: "
            f"run `uv run prebuild --profile {ctx.profile} openings`"
        )
    return [opening["qid"] for opening in lock["openings"]]


def run(ctx: Context) -> None:
    record = read_record(ctx, events.STAGE)
    source = events.export_source(load_sources())
    if any(record["inputs"].get(k) != v for k, v in events.inputs(source.id).items()):
        raise events.EventsError(
            f"events table is stale: run `uv run prebuild --profile {ctx.profile} events`"
        )
    qids = opening_qids(ctx)
    path = (
        excerpts_dir(ctx.repo) / "events" / events.TABLE
        if ctx.profile is Profile.FIXTURE
        else verified_path(ctx, source.id, events.TABLE)
    )
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        statements = events.read_export(stream)
    rows = prepare(read_table(ctx.out / events.KEY), statements)
    strict = ctx.profile is not Profile.FIXTURE
    result = build(rows, ctx.out, openings=forced(rows, qids, strict=strict))
    result["inputs"] = {"openings": sha256_file(openings_lock(ctx))}
    write_record(ctx, STAGE, result)
    print(
        f"event-files: {len(rows)} rows, {sum(f['bytes'] for f in result['files'])} B stored, "
        f"{sum(f['decoded'] for f in result['files'])} B in worker arrays, ev/{result['ver']}/",
        flush=True,
    )
