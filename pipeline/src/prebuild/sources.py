"""The source registry, `pipeline/sources.toml` (streaming.md 7.1, owner decisions 10 and 11).

Stages find their raw inputs through `verified_path`, which checks only that the file exists and
has its pinned byte size; the `fetch` stage alone computes sha256.
"""

import re
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from prebuild.paths import REPO_ROOT
from prebuild.profiles import Context

SOURCES_TOML = REPO_ROOT / "pipeline" / "sources.toml"

_SOURCE_KEYS = frozenset(
    {"name", "version", "license", "license_url", "attribution", "landing_page", "retrieved"}
)
_OPTIONAL_SOURCE_KEYS = frozenset({"landing_page"})
_FILE_KEYS = frozenset({"path", "source_url", "bytes", "sha256"})
_OPTIONAL_FILE_KEYS = frozenset({"source_url"})
_UNZIPPED_KEYS = frozenset({"from", "member", "path", "bytes", "sha256"})
_ID = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_SHA256 = re.compile(r"[0-9a-f]{64}")


class SourcesError(ValueError):
    """`sources.toml` does not hold what the registry format requires."""


class SourceUnavailable(FileNotFoundError):
    """A pinned input is missing or has the wrong size; the message names the command to run."""


@dataclass(frozen=True)
class SourceFile:
    path: str  # relative to $WANDER_DATA
    bytes: int
    sha256: str
    source_url: str | None  # None: verify-only, never downloaded


@dataclass(frozen=True)
class Unzipped:
    from_: str  # the zip's path, one of the source's files
    member: str
    path: str
    bytes: int
    sha256: str


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    version: str
    license: str
    license_url: str
    attribution: str
    landing_page: str | None
    retrieved: str
    files: tuple[SourceFile, ...]
    unzipped: tuple[Unzipped, ...]

    def pinned(self) -> tuple[SourceFile | Unzipped, ...]:
        return (*self.files, *self.unzipped)


def load_sources(path: Path = SOURCES_TOML) -> dict[str, Source]:
    """Every source in the registry, validated: known keys only, 64-hex sha256s, positive sizes,
    paths unique and under `sources/<id>/`, and each unzipped member taken from a listed zip."""
    with path.open("rb") as stream:
        table = tomllib.load(stream)
    sources = [_source(source_id, entry) for source_id, entry in table.items()]
    paths = [pinned.path for source in sources for pinned in source.pinned()]
    duplicated = sorted({p for p in paths if paths.count(p) > 1})
    if duplicated:
        raise SourcesError(f"paths pinned more than once: {', '.join(duplicated)}")
    return {source.id: source for source in sources}


def pinned_file(source: Source, filename: str) -> SourceFile | Unzipped:
    """The source's file or unzipped member whose path ends in `filename`."""
    for pinned in source.pinned():
        if PurePosixPath(pinned.path).name == filename:
            return pinned
    raise SourcesError(f"{source.id} pins no file named {filename!r}")


def verified_path(
    ctx: Context,
    source_id: str,
    filename: str,
    sources: Mapping[str, Source] | None = None,
) -> Path:
    """Where a pinned input sits under the raw-data folder, after checking that it exists and has
    its pinned byte size. The fixture profile reads no raw data, so it always raises."""
    if ctx.data is None:
        raise SourceUnavailable(
            f"the {ctx.profile} profile reads committed excerpts, not raw data ({source_id})"
        )
    registry = load_sources() if sources is None else sources
    if source_id not in registry:
        raise SourcesError(f"no source {source_id!r} in sources.toml")
    pinned = pinned_file(registry[source_id], filename)
    path = ctx.data / pinned.path
    if not path.is_file():
        raise SourceUnavailable(f"{path} is missing: run `uv run prebuild fetch`")
    size = path.stat().st_size
    if size != pinned.bytes:
        raise SourceUnavailable(
            f"{path} has {size} bytes, not the pinned {pinned.bytes}: run `uv run prebuild fetch`"
        )
    return path


def _source(source_id: str, entry: Any) -> Source:
    if not _ID.fullmatch(source_id):
        raise SourcesError(f"source id {source_id!r} is not a lowercase, hyphenated name")
    if not isinstance(entry, dict):
        raise SourcesError(f"{source_id} is not a table")
    fields = _fields(
        source_id, entry, _SOURCE_KEYS | {"files", "unzipped"}, _OPTIONAL_SOURCE_KEYS | {"unzipped"}
    )
    files = tuple(_file(source_id, row) for row in _rows(source_id, "files", fields["files"]))
    zips = {f.path for f in files}
    unzipped = tuple(
        _unzipped(source_id, row, zips) for row in _rows(source_id, "unzipped", fields["unzipped"])
    )
    return Source(
        id=source_id,
        name=_text(source_id, "name", fields["name"]),
        version=_text(source_id, "version", fields["version"]),
        license=_text(source_id, "license", fields["license"]),
        license_url=_text(source_id, "license_url", fields["license_url"]),
        attribution=_text(source_id, "attribution", fields["attribution"]),
        landing_page=_optional_text(source_id, "landing_page", fields["landing_page"]),
        retrieved=_text(source_id, "retrieved", fields["retrieved"]),
        files=files,
        unzipped=unzipped,
    )


def _file(source_id: str, row: dict[str, Any]) -> SourceFile:
    fields = _fields(source_id, row, _FILE_KEYS, _OPTIONAL_FILE_KEYS)
    return SourceFile(
        path=_path(source_id, fields["path"]),
        bytes=_size(source_id, fields["bytes"]),
        sha256=_sha256(source_id, fields["sha256"]),
        source_url=_optional_text(source_id, "source_url", fields["source_url"]),
    )


def _unzipped(source_id: str, row: dict[str, Any], zips: set[str]) -> Unzipped:
    fields = _fields(source_id, row, _UNZIPPED_KEYS, frozenset())
    from_ = _path(source_id, fields["from"])
    if from_ not in zips:
        raise SourcesError(f"{source_id}: unzipped member comes from {from_}, not a listed file")
    return Unzipped(
        from_=from_,
        member=_text(source_id, "member", fields["member"]),
        path=_path(source_id, fields["path"]),
        bytes=_size(source_id, fields["bytes"]),
        sha256=_sha256(source_id, fields["sha256"]),
    )


def _fields(
    source_id: str, table: dict[str, Any], keys: frozenset[str], optional: frozenset[str]
) -> dict[str, Any]:
    unknown = sorted(set(table) - keys)
    if unknown:
        raise SourcesError(f"{source_id}: unknown keys {', '.join(unknown)}")
    missing = sorted(keys - optional - set(table))
    if missing:
        raise SourcesError(f"{source_id}: missing keys {', '.join(missing)}")
    return {key: table.get(key) for key in keys}


def _rows(source_id: str, key: str, value: Any) -> list[dict[str, Any]]:
    rows = [] if value is None else value
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise SourcesError(f"{source_id}: {key} is not an array of tables")
    if key == "files" and not rows:
        raise SourcesError(f"{source_id}: pins no files")
    return rows


def _text(source_id: str, key: str, value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise SourcesError(f"{source_id}: {key} is not a non-empty string")
    return value


def _optional_text(source_id: str, key: str, value: Any) -> str | None:
    return None if value is None else _text(source_id, key, value)


def _path(source_id: str, value: Any) -> str:
    path = PurePosixPath(_text(source_id, "path", value))
    if path.parts[:2] != ("sources", source_id) or len(path.parts) < 3 or ".." in path.parts:
        raise SourcesError(f"{source_id}: {path} is not under sources/{source_id}/")
    return path.as_posix()


def _size(source_id: str, value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise SourcesError(f"{source_id}: bytes {value!r} is not a positive integer")
    return value


def _sha256(source_id: str, value: Any) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise SourcesError(f"{source_id}: sha256 {value!r} is not 64 lowercase hex characters")
    return value
