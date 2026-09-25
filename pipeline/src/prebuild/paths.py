"""Where the prebuild reads: the repo and the raw-data folder."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def data_root() -> Path:
    """$WANDER_DATA, else ~/projects/wander-data (owner decision 10). The fixture never reads it."""
    configured = os.environ.get("WANDER_DATA")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "projects" / "wander-data"


def excerpts_dir(repo: Path = REPO_ROOT) -> Path:
    """The committed excerpts the fixture reads in place of raw data (streaming.md 7.3)."""
    return repo / "pipeline" / "tests" / "data"


def config_dir(repo: Path = REPO_ROOT) -> Path:
    """The prebuild's YAML configs."""
    return repo / "pipeline" / "config"
