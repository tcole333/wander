"""Content hashes: tree hashes for the freshness checks (streaming.md 7.2) and layer versions
(streaming.md 3). `app/src/test/stamp.ts` computes the same tree hash."""

import hashlib
from collections.abc import Mapping, Sequence
from pathlib import Path

# The code a build depends on. The coverage record's `inputs.code` hashes these.
CODE_PATHS = (
    "pipeline/src",
    "pipeline/config",
    "pipeline/pyproject.toml",
    "pipeline/uv.lock",
    "shared/constants.json",
)
# The fixture build also depends on the committed excerpts.
FIXTURE_PATHS = (*CODE_PATHS, "pipeline/tests/data")

SKIPPED_NAMES = frozenset({"__pycache__", ".DS_Store"})


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def lines_sha(digests: Mapping[str, str]) -> str:
    """SHA-256 over one line `"<path> <sha256>\\n"` per entry, the lines sorted bytewise."""
    lines = sorted(f"{path} {digest}\n".encode() for path, digest in digests.items())
    return sha256_bytes(b"".join(lines))


def tree_files(paths: Sequence[str], root: Path) -> list[str]:
    """Regular files under `paths` (files or folders relative to `root`), as POSIX paths relative
    to `root`. Missing paths, symlinks, `__pycache__` and `.DS_Store` are left out."""
    found: set[str] = set()
    for path in paths:
        _collect(root / path, root, found)
    return sorted(found)


def tree_sha(paths: Sequence[str], root: Path) -> str:
    """`lines_sha` over every file `tree_files` finds, keyed by its path relative to `root`."""
    return lines_sha({path: sha256_file(root / path) for path in tree_files(paths, root)})


def ver8(files: Mapping[str, bytes]) -> str:
    """A layer version: the first 8 hex characters of `lines_sha` over the stored bytes of the
    layer's files, keyed by path relative to the layer root (`7/1/103/50.wst`, `bounds.bin`)."""
    return lines_sha({path: sha256_bytes(data) for path, data in files.items()})[:8]


def _collect(path: Path, root: Path, found: set[str]) -> None:
    if path.name in SKIPPED_NAMES or path.is_symlink():
        return
    if path.is_file():
        found.add(path.relative_to(root).as_posix())
    elif path.is_dir():
        for child in path.iterdir():
            _collect(child, root, found)
