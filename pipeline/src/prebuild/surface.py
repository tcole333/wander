"""The surface stage (streaming.md 3.1, 3.8, 7.1, 7.2): every tile the coverage record makes
available, as a `.wst`, and `bounds.bin`, published as the layer `surf/<ver8>/` in the profile's
output root, with the record `build/stages/<profile>/surface.json`.

The stage refuses a coverage record whose inputs (the sources, the configs and the prebuild code)
differ from the current ones, and its own record keeps those inputs, so a surface record that a
later coverage run on other inputs outdated can be told apart. It first clears the staging folders
an interrupted earlier run left in `surf/`, then workers build the tiles into `surf/.tmp-<pid>/`;
once every file is hashed, that folder is renamed to `surf/<ver8>/`. A layer that already exists
is kept, after a byte-for-byte comparison, since its version names its bytes.

`bounds.bin` (gzip) holds each available node's LOD bounds in meters, [floor(h(codeMin)),
ceil(h(codeMax))], in node order:

    'WSB1' u8 version | u8 maxLevel | u16 pad | u32 count
    i16 bounds[count][2]
"""

import base64
import filecmp
import gzip
import os
import shutil
import struct
import time
from collections.abc import Mapping
from itertools import repeat
from pathlib import Path

import numpy as np

from prebuild import coverage, workers
from prebuild.config import load_water
from prebuild.constants import FORMATS
from prebuild.cube import Tile, available_nodes, node_count, node_from_index, node_index
from prebuild.expect import write_surface_expectations
from prebuild.hashing import layer_version, sha256_bytes
from prebuild.height import height_source
from prebuild.natural_earth import load_vectors
from prebuild.paths import config_dir
from prebuild.profiles import Context, Profile
from prebuild.records import write_record
from prebuild.tiles import build_tile, surface
from prebuild.wst import bounds_m, to_file

STAGE = "surface"
LAYER = "surf"
BOUNDS = "bounds.bin"
BOUNDS_MAGIC = str(FORMATS["surfaceBounds"]["magic"]).encode("ascii")
BOUNDS_VERSION = int(FORMATS["surfaceBounds"]["version"])
BOUNDS_HEADER = struct.Struct("<4sBBHI")


class LayerConflict(RuntimeError):
    """A layer folder already holds other bytes than the build made for the same version."""


def run(ctx: Context) -> None:
    started = time.perf_counter()
    cover = coverage.fresh_record(ctx)
    q_land: list[float] = cover["qLand"]
    max_level = len(q_land) - 1
    avail = base64.b64decode(cover["avail"])
    tiles = [node_from_index(k) for k in available_nodes(avail)]
    height_source(ctx)  # the GEBCO overviews, before the workers map them
    vectors = load_vectors(ctx, load_water(config_dir(ctx.repo) / "water.yaml"))
    layer = ctx.out / LAYER
    for leftover in layer.glob(".tmp-*"):
        shutil.rmtree(leftover, ignore_errors=True)
    staging = layer / f".tmp-{os.getpid()}"
    staging.mkdir(parents=True)
    try:
        with workers.tile_pool(ctx, vectors) as pool:
            qs = [q_land[t.level] for t in tiles]
            baked = list(pool.map(_bake, tiles, qs, repeat(staging)))
        digests = {f"{t.key()}.wst": sha for t, (sha, _) in zip(tiles, baked, strict=True)}
        ranges = {node_index(t): b for t, (_, b) in zip(tiles, baked, strict=True)}
        stored = bounds_bin(avail, max_level, ranges)
        (staging / BOUNDS).write_bytes(stored)
        digests[BOUNDS] = sha256_bytes(stored)
        ver = layer_version(digests)
        publish(staging, layer / ver)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    record = {
        "ver": ver,
        "maxLevel": max_level,
        "avail": cover["avail"],
        "bounds": f"{LAYER}/{ver}/{BOUNDS}",
        "inputs": cover["inputs"],
    }
    write_record(ctx, STAGE, record)
    if ctx.profile is Profile.FIXTURE:
        write_surface_expectations(ctx, record)
    seconds = time.perf_counter() - started
    print(f"surface: {len(tiles)} tiles into {LAYER}/{ver}/, {seconds:.1f} s", flush=True)


def bounds_payload(avail: bytes, max_level: int, ranges: Mapping[int, tuple[int, int]]) -> bytes:
    """The raw `bounds.bin`: the header, then [min, max] meters of every available node in node
    order. `ranges` holds exactly the available nodes."""
    if len(avail) != (node_count(max_level) + 7) // 8:
        raise ValueError(f"{len(avail)} bytes of availability do not match maxLevel {max_level}")
    nodes = available_nodes(avail)
    if sorted(ranges) != nodes:
        raise ValueError("bounds.bin takes a range for every available node, and only those")
    values = np.array([ranges[k] for k in nodes], dtype=np.int64).reshape(len(nodes), 2)
    if values.size and (values.min() < -(1 << 15) or values.max() >= 1 << 15):
        raise ValueError(f"meter bounds {values.min()}..{values.max()} do not fit an i16")
    header = BOUNDS_HEADER.pack(BOUNDS_MAGIC, BOUNDS_VERSION, max_level, 0, len(nodes))
    return header + values.astype("<i2").tobytes()


def bounds_bin(avail: bytes, max_level: int, ranges: Mapping[int, tuple[int, int]]) -> bytes:
    """The stored `bounds.bin`: gzip level 9 with mtime 0."""
    return gzip.compress(bounds_payload(avail, max_level, ranges), compresslevel=9, mtime=0)


def read_bounds(stored: bytes) -> tuple[int, list[tuple[int, int]]]:
    """maxLevel and the [min, max] entries of a stored `bounds.bin`, in node order."""
    raw = gzip.decompress(stored)
    magic, version, max_level, _, count = BOUNDS_HEADER.unpack_from(raw)
    if magic != BOUNDS_MAGIC or version != BOUNDS_VERSION:
        raise ValueError(f"not a version {BOUNDS_VERSION} bounds.bin: {magic!r} {version}")
    if len(raw) != BOUNDS_HEADER.size + 4 * count:
        raise ValueError(f"{len(raw)} bytes do not hold {count} bounds")
    values = np.frombuffer(raw, "<i2", 2 * count, BOUNDS_HEADER.size).reshape(count, 2)
    return max_level, [(int(low), int(high)) for low, high in values]


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


def _bake(tile: Tile, q: float, staging: Path) -> tuple[str, tuple[int, int]]:
    """Build one tile in a worker and write it under `staging`; its sha256 and meter bounds."""
    built = build_tile(surface(tile, workers.sources()), q)
    stored = to_file(built)
    path = staging / f"{tile.key()}.wst"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(stored)
    return sha256_bytes(stored), bounds_m(built)
