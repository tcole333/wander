"""Layer folders (streaming.md 3, 7.1): a stage writes its layer's files into
`<layer>/.tmp-<pid>/` and, once every file is hashed, renames that folder to `<layer>/<ver8>/`. A
layer that already exists is kept, after a byte-for-byte comparison, since its version names its
bytes. A staging folder that no longer holds every file the build hashed, as when a second run of
the stage cleared it midway, is never published."""

import filecmp
import os
import shutil
from collections.abc import Mapping
from pathlib import Path

from prebuild.hashing import layer_version


class LayerConflict(RuntimeError):
    """A layer folder already holds other bytes than the build made for the same version, or the
    staging folder lost files the build wrote."""


def staging_folder(layer: Path) -> Path:
    """This run's empty staging folder in `layer`, made after clearing the ones an interrupted
    earlier run left there."""
    for leftover in layer.glob(".tmp-*"):
        shutil.rmtree(leftover, ignore_errors=True)
    staging = layer / f".tmp-{os.getpid()}"
    staging.mkdir(parents=True)
    return staging


def publish(staging: Path, layer: Path, digests: Mapping[str, str]) -> str:
    """Rename the staged files to `layer/<ver8>/`, or keep the folder already there when it holds
    the same bytes, and return the version. `digests` holds the sha256 of every file the build
    wrote, keyed by layer-relative path."""
    names = _files(staging)
    if names != sorted(digests):
        raise LayerConflict(f"{staging} does not hold the {len(digests)} files this build hashed")
    ver = layer_version(digests)
    target = layer / ver
    try:
        staging.rename(target)
        return ver
    except OSError:
        if not target.is_dir():
            raise
    same = names == _files(target) and all(
        filecmp.cmp(staging / name, target / name, shallow=False) for name in names
    )
    if not same:
        raise LayerConflict(f"{target} already holds other bytes than this build made")
    return ver


def _files(root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())
