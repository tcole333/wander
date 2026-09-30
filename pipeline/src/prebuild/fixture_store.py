"""The fixture store (streaming.md 7.3): each full fixture build this Mac has made, under
`$WANDER_CACHE/fixture/<inputs>/` (`~/.cache/wander` by default), keyed by the stamp's tree hash
of FIXTURE_PATHS, so a checkout whose inputs another has built restores that build in under a
second instead of building it again. A restore replaces build/fixture/ and build/stages/fixture/
outright, stamp last. CI keeps no store, and where the store cannot be written (Codex's sandbox)
the build simply runs."""

import ctypes
import os
import shutil
import sys
import uuid
from collections.abc import Mapping
from pathlib import Path

from prebuild.profiles import Context
from prebuild.slots import cache_root

# Builds kept, the most recently built or restored first; each takes about 6 MB.
KEEP = 16
STAMP = "stamp.json"


def store_root(env: Mapping[str, str] = os.environ) -> Path | None:
    """Where full fixture builds are kept, or None on CI."""
    if env.get("CI"):
        return None
    return cache_root(dict(env)) / "fixture"


def restore(ctx: Context, entry: Path) -> bool:
    """Replace the fixture's output root and stage folder with the stored build in `entry`, if
    there is one. The stamp lands last, so an interrupted restore leaves the fixture stale."""
    if not entry.is_dir():
        return False
    for folder in (ctx.stages_dir, ctx.out):
        shutil.rmtree(folder, ignore_errors=True)
        folder.parent.mkdir(parents=True, exist_ok=True)
    clone(entry / "out", ctx.out)
    staging = ctx.stages_dir.with_name(f".tmp-{uuid.uuid4().hex}")
    clone(entry / "stages", staging)
    (staging / STAMP).unlink()
    staging.rename(ctx.stages_dir)
    shutil.copyfile(entry / "stages" / STAMP, ctx.stages_dir / STAMP)
    os.utime(entry)
    return True


def save(ctx: Context, entry: Path) -> None:
    """Keep the fixture just built as `entry`, whole or not at all, then drop the least recently
    used builds past KEEP. A store that cannot be written is left as it is."""
    staging = entry.parent / f".tmp-{uuid.uuid4().hex}"
    try:
        staging.mkdir(parents=True)
        clone(ctx.out, staging / "out")
        clone(ctx.stages_dir, staging / "stages")
        try:
            staging.rename(entry)
        except OSError:
            if not entry.is_dir():
                raise
    except OSError as error:
        print(f"prebuild: kept no copy of the fixture in {entry.parent}: {error}", file=sys.stderr)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    prune(entry.parent)


def prune(root: Path, keep: int = KEEP) -> None:
    """Drop all but the `keep` most recently used builds under `root`."""
    try:
        builds = sorted(
            (path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return
    for path in builds[keep:]:
        shutil.rmtree(path, ignore_errors=True)


def clone(source: Path, target: Path) -> None:
    """Copy the folder `source` to `target`, which must not exist: an APFS clone on macOS, which
    shares the blocks until either copy changes, and a plain copy elsewhere."""
    if sys.platform == "darwin" and _clonefile(source, target):
        return
    shutil.copytree(source, target, symlinks=True)


def _clonefile(source: Path, target: Path) -> bool:
    libc = ctypes.CDLL(None, use_errno=True)
    return libc.clonefile(os.fsencode(source), os.fsencode(target), ctypes.c_uint32(0)) == 0
