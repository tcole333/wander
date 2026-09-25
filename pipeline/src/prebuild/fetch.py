"""The `fetch` stage (streaming.md 7.1): download each missing input into
`$WANDER_DATA/sources/<id>/`, unzip the pinned members beside their zips, and check the sha256 of
every pinned file. It is the only stage that hashes raw data, and the only one that uses the
network. It writes no stage record.
"""

import shutil
import urllib.request
import zipfile
from collections.abc import Mapping
from pathlib import Path

from prebuild.hashing import sha256_file
from prebuild.profiles import Context
from prebuild.sources import Source, SourceFile, SourceUnavailable, Unzipped, load_sources

CHUNK = 1 << 20
TIMEOUT_S = 60


class FetchError(RuntimeError):
    """A pinned file could not be fetched, or its bytes differ from the pin."""


def run(ctx: Context, sources: Mapping[str, Source] | None = None) -> None:
    if ctx.data is None:
        raise SourceUnavailable(f"the {ctx.profile} profile reads no raw data, so it has no fetch")
    registry = load_sources() if sources is None else sources
    count = 0
    for source in registry.values():
        for f in source.files:
            ensure_file(ctx.data, f, source.landing_page)
            count += 1
        for u in source.unzipped:
            ensure_unzipped(ctx.data, u)
            count += 1
    print(f"fetch: {count} pinned files verified under {ctx.data}", flush=True)


def ensure_file(root: Path, f: SourceFile, landing_page: str | None = None) -> None:
    """Check a pinned file, downloading it first when it is missing. A download goes to a `.part`
    file beside the target and is renamed only once its size and sha256 match the pin."""
    target = root / f.path
    if target.exists():
        _check(target, f.bytes, f.sha256)
        return
    if f.source_url is None:
        where = f" from {landing_page}" if landing_page else ""
        raise FetchError(f"{target} is missing and verify-only: download it by hand{where}")
    print(f"fetch: downloading {f.path} from {f.source_url}", flush=True)
    partial = _partial(target)
    try:
        request = urllib.request.Request(f.source_url, headers={"User-Agent": "wander-prebuild"})
        with (
            urllib.request.urlopen(request, timeout=TIMEOUT_S) as response,
            partial.open("wb") as out,
        ):
            shutil.copyfileobj(response, out, CHUNK)
        _check(partial, f.bytes, f.sha256)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)


def ensure_unzipped(root: Path, u: Unzipped) -> None:
    """Check a pinned zip member beside its zip, extracting it first when it is missing."""
    target = root / u.path
    if target.exists():
        _check(target, u.bytes, u.sha256)
        return
    print(f"fetch: unzipping {u.member} from {u.from_}", flush=True)
    partial = _partial(target)
    try:
        with (
            zipfile.ZipFile(root / u.from_) as archive,
            archive.open(u.member) as member,
            partial.open("wb") as out,
        ):
            shutil.copyfileobj(member, out, CHUNK)
        _check(partial, u.bytes, u.sha256)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(target)


def _partial(target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    return target.with_name(f"{target.name}.part")


def _check(path: Path, size: int, sha256: str) -> None:
    actual_size = path.stat().st_size
    if actual_size != size:
        raise FetchError(f"{path} has {actual_size} bytes, not the pinned {size}")
    actual = sha256_file(path)
    if actual != sha256:
        raise FetchError(f"{path} has sha256 {actual}, not the pinned {sha256}")
