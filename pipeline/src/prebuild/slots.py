"""Machine-wide slots for heavy local work, shared with `app/scripts/slot.sh`: flock(2) locks on
`$WANDER_CACHE/heavy.<n>.lock` (`~/.cache/wander` by default, `WANDER_HEAVY_SLOTS` of them, 2 by
default), so parallel sessions on the Mac queue instead of slowing each other. Every `uv run
prebuild` and every pytest run takes one. A held slot passes to child processes in
`WANDER_HEAVY_SLOT`, so heavy work nested in it takes no second one. On CI, off macOS, and where
the pool cannot be written (Codex's sandbox), nothing is taken."""

import contextlib
import fcntl
import os
import sys
import time
from collections.abc import Iterator, MutableMapping
from pathlib import Path

SLOT_ENV = "WANDER_HEAVY_SLOT"


def cache_root(env: MutableMapping[str, str] = os.environ) -> Path:
    """`$WANDER_CACHE`, or `~/.cache/wander`: the slots, the e2e lock and the fixture store."""
    return Path(env.get("WANDER_CACHE") or Path.home() / ".cache" / "wander")


@contextlib.contextmanager
def heavy_slot(
    env: MutableMapping[str, str] = os.environ,
    platform: str = sys.platform,
    poll: float = 2.0,
) -> Iterator[int | None]:
    """Hold one of the heavy-work slots while the body runs, waiting while every slot is held;
    yields its number, or None when this process takes none."""
    if env.get(SLOT_ENV) or env.get("CI") or platform != "darwin":
        yield None
        return
    pool = cache_root(env)
    count = int(env.get("WANDER_HEAVY_SLOTS") or 2)
    said = False
    while True:
        for n in range(count):
            try:
                pool.mkdir(parents=True, exist_ok=True)
                stream = (pool / f"heavy.{n}.lock").open("a")
            except OSError:
                yield None
                return
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                stream.close()
                continue
            env[SLOT_ENV] = str(n)
            try:
                yield n
            finally:
                env.pop(SLOT_ENV, None)
                stream.close()
            return
        if not said:
            print(f"waiting for one of {count} heavy-work slots ({pool})", file=sys.stderr)
            said = True
        time.sleep(poll)
