"""`uv run prebuild wikidata` (streaming.md 3.4, 7.1): export the event index's classes from
QLever's public Wikidata endpoint into `$WANDER_DATA/sources/wikidata-events-<date>/`, and pin the
export in `pipeline/sources.toml`.

The step runs `pipeline/queries/events.rq` once for each class in
`pipeline/config/event-classes.yaml`, one request at a time with a pause between them, backing off
for minutes whenever the endpoint answers that it is busy or failed (429 or 5xx), and writes:

- `events.tsv.gz`: the endpoint's TSV rows under one header, each led by its class's qid
  (gzip level 9, mtime 0);
- `export.json`: when the export ran, the endpoint and the Wikidata dump its index holds, the
  query's sha256 and the rows each class gave.

It then appends the export's entry to `sources.toml`, pinning both files verify-only, so the
events stage reads the new export and `fetch` checks it. It refuses to start while `sources.toml`
pins an earlier export: the maintainer deletes that entry by hand first. It runs only when named,
since it rewrites `sources.toml`. Wikidata is CC0; the requests name the project and nothing else.
"""

import gzip
import json
import os
import re
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from prebuild.config import load_event_classes
from prebuild.hashing import sha256_bytes
from prebuild.paths import REPO_ROOT
from prebuild.profiles import Context
from prebuild.sources import SOURCES_TOML, SourceUnavailable

ENDPOINT = "https://qlever.dev/api/wikidata"
# Wikimedia asks every client to name itself and a way to reach its maker.
USER_AGENT = "wander-prebuild/0 (https://github.com/tcole333/wander)"
TIMEOUT_S = 600  # the largest class takes about 30 s
PAUSE_S = 5.0  # between requests
BUSY_WAITS_S = (60, 180, 600)  # after each busy or failed answer, unless it names a wait
BUSY = frozenset({429, 500, 502, 503, 504})  # answers another try may not get
QUERY = REPO_ROOT / "pipeline" / "queries" / "events.rq"
SOURCE_PREFIX = "wikidata-events-"  # the source id is this plus the export's date, YYYYMMDD
TABLE = "events.tsv.gz"
META = "export.json"
COLUMNS = (
    "?event",
    "?label",
    "?enwiki",
    "?property",
    "?date",
    "?precision",
    "?coord",
    "?placeCoord",
    "?editions",
    "?parents",
)
CLASS_LINE = re.compile(r"VALUES \?class \{ wd:Q[0-9]+ \}")


class WikidataError(RuntimeError):
    """The endpoint's answer is not the table the query asks for."""


def run(ctx: Context) -> None:
    if ctx.data is None:
        raise SourceUnavailable(f"the {ctx.profile} profile reads no raw data, so it exports none")
    started = time.perf_counter()
    check_unpinned(SOURCES_TOML.read_text(encoding="utf-8"))
    template = QUERY.read_text(encoding="utf-8")
    exported = datetime.now(UTC).replace(microsecond=0)
    index = endpoint_index()
    lines = ["\t".join(("?class", *COLUMNS))]
    counts: dict[str, int] = {}
    for event_class in load_event_classes():
        rows = class_rows(_post(class_query(template, event_class.qid)))
        lines += [f"{event_class.qid}\t{row}" for row in rows]
        counts[event_class.qid] = len(rows)
        print(f"wikidata: {event_class.name} ({event_class.qid}): {len(rows)} rows", flush=True)
        time.sleep(PAUSE_S)
    table = gzip.compress(("\n".join(lines) + "\n").encode(), compresslevel=9, mtime=0)
    meta = {
        "exported": exported.isoformat().replace("+00:00", "Z"),
        "endpoint": ENDPOINT,
        "index": index,
        "query": "pipeline/queries/events.rq",
        "querySha256": sha256_bytes(template.encode()),
        "rows": counts,
    }
    files = {TABLE: table, META: (json.dumps(meta, indent=2) + "\n").encode()}
    source_id = f"{SOURCE_PREFIX}{exported:%Y%m%d}"
    folder = ctx.data / "sources" / source_id
    folder.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        partial = folder / f".{name}.{os.getpid()}.tmp"
        partial.write_bytes(data)
        partial.replace(folder / name)
    entry = source_entry(source_id, meta["exported"], index, files)
    SOURCES_TOML.write_text(pin(SOURCES_TOML.read_text(encoding="utf-8"), entry), encoding="utf-8")
    seconds = time.perf_counter() - started
    print(
        f"wikidata: {len(lines) - 1} rows, {len(table) / 1e6:.1f} MB into {folder}, pinned as "
        f"{source_id} in pipeline/sources.toml, {seconds:.0f} s",
        flush=True,
    )


def class_query(template: str, qid: str) -> str:
    """The query for one class: the template with `qid` in its VALUES line."""
    if len(CLASS_LINE.findall(template)) != 1:
        raise WikidataError("events.rq needs exactly one `VALUES ?class { wd:Q... }` line")
    return CLASS_LINE.sub(f"VALUES ?class {{ wd:{qid} }}", template)


def class_rows(text: str) -> list[str]:
    """The rows of one class's answer, after checking its header."""
    header, *rows = text.rstrip("\n").split("\n")
    if tuple(header.split("\t")) != COLUMNS:
        raise WikidataError(f"the endpoint answered with columns {header!r}")
    return rows


def endpoint_index() -> str:
    """The name QLever gives its Wikidata index, which names the dump it was built from."""
    request = urllib.request.Request(f"{ENDPOINT}?cmd=stats", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return str(json.load(response)["name-index"])


def source_entry(source_id: str, exported: str, index: str, files: dict[str, bytes]) -> str:
    """The export's entry in sources.toml: its files, verify-only."""
    lines = [
        "# Wikidata's events of the classes in pipeline/config/event-classes.yaml, as QLever's",
        "# endpoint gave them (streaming.md 3.4). `uv run prebuild wikidata` wrote this entry;",
        "# delete it by hand before the next export.",
        f"[{source_id}]",
        'name = "Wikidata events, exported class by class with pipeline/queries/events.rq"',
        f"version = {_toml_string(f'exported {exported} from QLever: {index}')}",
        'license = "CC0-1.0"',
        'license_url = "https://creativecommons.org/publicdomain/zero/1.0/"',
        'attribution = "Wikidata contributors."',
        'landing_page = "https://qlever.dev/wikidata"',
        f'retrieved = "{exported[:10]}"',
    ]
    for name, data in files.items():
        lines += [
            "",
            f"[[{source_id}.files]]",
            f'path = "sources/{source_id}/{name}"',
            f"bytes = {len(data)}",
            f'sha256 = "{sha256_bytes(data)}"',
        ]
    return "\n".join(lines) + "\n"


def check_unpinned(text: str) -> None:
    """Refuse `sources.toml`'s text while it pins an export: one export is pinned at a time."""
    pinned = [key for key in tomllib.loads(text) if key.startswith(SOURCE_PREFIX)]
    if pinned:
        raise WikidataError(
            f"sources.toml pins {', '.join(pinned)}: delete its entry, then export again"
        )


def pin(text: str, entry: str) -> str:
    """`sources.toml`'s text with the export's entry appended."""
    check_unpinned(text)
    return text.rstrip("\n") + "\n\n" + entry


def _toml_string(value: str) -> str:
    """A TOML basic string: JSON's escapes are TOML's."""
    return json.dumps(value, ensure_ascii=False)


def _post(query: str) -> str:
    data = urllib.parse.urlencode({"query": query}).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=data,
        headers={
            "Accept": "text/tab-separated-values",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
        },
    )
    for wait in BUSY_WAITS_S:
        try:
            return _answer(request)
        except urllib.error.HTTPError as error:
            if error.code not in BUSY:
                raise
            retry_after = error.headers.get("Retry-After", "")
            seconds = int(retry_after) if retry_after.isdigit() else wait
            print(f"wikidata: the endpoint answered {error.code}; waiting {seconds} s", flush=True)
            time.sleep(seconds)
    return _answer(request)


def _answer(request: urllib.request.Request) -> str:
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return response.read().decode("utf-8")
