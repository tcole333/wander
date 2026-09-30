import fcntl
import subprocess
import sys
import threading
import time

import pytest

from prebuild.paths import REPO_ROOT
from prebuild.slots import SLOT_ENV, heavy_slot

SLOT_SH = REPO_ROOT / "app" / "scripts" / "slot.sh"


@pytest.fixture
def pool(tmp_path):
    """An empty pool, and the environment a session outside any slot starts with."""
    return tmp_path, {"WANDER_CACHE": str(tmp_path)}


def hold(path):
    """Takes the lock another process would hold on `path`; close the stream to drop it."""
    stream = path.open("a")
    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return stream


def test_a_free_pool_gives_the_first_slot_and_names_it_to_children(pool):
    _, env = pool
    with heavy_slot(env, "darwin") as slot:
        assert slot == 0
        assert env[SLOT_ENV] == "0"
    assert SLOT_ENV not in env


def test_a_held_slot_sends_the_next_run_to_another(pool):
    root, env = pool
    with hold(root / "heavy.0.lock"), heavy_slot(env, "darwin") as slot:
        assert slot == 1


def test_a_run_waits_while_every_slot_is_held(pool):
    root, env = pool
    first, second = hold(root / "heavy.0.lock"), hold(root / "heavy.1.lock")
    threading.Timer(0.3, second.close).start()
    started = time.monotonic()
    with heavy_slot(env, "darwin", poll=0.05) as slot:
        assert slot == 1
        assert time.monotonic() - started >= 0.3
    first.close()


def test_the_slot_is_free_again_once_the_run_ends(pool):
    root, env = pool
    with heavy_slot(env, "darwin"):
        pass
    hold(root / "heavy.0.lock").close()


@pytest.mark.parametrize(
    ("extra", "platform"),
    [({SLOT_ENV: "1"}, "darwin"), ({"CI": "true"}, "darwin"), ({}, "linux")],
    ids=["nested", "ci", "linux"],
)
def test_nested_ci_and_other_platforms_take_no_slot(pool, extra, platform):
    root, env = pool
    env.update(extra)
    with (
        hold(root / "heavy.0.lock"),
        hold(root / "heavy.1.lock"),
        heavy_slot(env, platform) as slot,
    ):
        assert slot is None


def test_a_pool_that_cannot_be_written_takes_no_slot(tmp_path):
    (tmp_path / "file").write_text("")
    with heavy_slot({"WANDER_CACHE": str(tmp_path / "file" / "pool")}, "darwin") as slot:
        assert slot is None


@pytest.mark.skipif(sys.platform != "darwin", reason="slot.sh takes slots only on macOS")
def test_the_npm_wrapper_shares_the_pool(pool):
    root, env = pool
    with heavy_slot(env, "darwin") as slot:
        assert slot == 0
        shown = subprocess.run(
            ["sh", str(SLOT_SH), "heavy", "printenv", SLOT_ENV],
            env={"PATH": "/usr/bin:/bin", "HOME": str(root), "WANDER_CACHE": str(root)},
            capture_output=True,
            text=True,
            check=True,
        )
    assert shown.stdout == "1\n"
