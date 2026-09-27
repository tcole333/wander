"""Layer folders (streaming.md 3, 7.1): a stage writes its layer's files into
`<layer>/.tmp-<pid>/` and, once every file is hashed, renames that folder to `<layer>/<ver8>/`. A
layer that already exists is kept, after a byte-for-byte comparison, since its version names its
bytes."""

import filecmp
import os
import shutil
from pathlib import Path


class LayerConflict(RuntimeError):
    """A layer folder already holds other bytes than the build made for the same version."""


def staging_folder(layer: Path) -> Path:
    """This run's empty staging folder in `layer`, made after clearing the ones an interrupted
    earlier run left there."""
    for leftover in layer.glob(".tmp-*"):
        shutil.rmtree(leftover, ignore_errors=True)
    staging = layer / f".tmp-{os.getpid()}"
    staging.mkdir(parents=True)
    return staging


def publish(staging: Path, target: Path) -> None:
    """Rename the staged layer to its version, or keep the one already there when it holds the
    same bytes."""
    try:
        staging.rename(target)
        return
    except OSError:
        if not target.is_dir():
            raise
    names = _files(staging)
    same = names == _files(target) and all(
        filecmp.cmp(staging / name, target / name, shallow=False) for name in names
    )
    if not same:
        raise LayerConflict(f"{target} already holds other bytes than this build made")


def _files(root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())
