"""Worker processes for the per-tile stages (streaming.md 7.1): `--jobs` spawn-context processes,
each holding the profile's tile sources.

The parent prepares the Natural Earth layers once and hands every worker the same WKB, so all of
them rasterize the same geometry. Each worker opens the heights itself: the committed excerpts for
the fixture, else GEBCO, with the overviews memory-mapped from the cache the parent built.
"""

import multiprocessing
from concurrent.futures import ProcessPoolExecutor

from prebuild.config import load_water
from prebuild.fields import FieldVectors
from prebuild.height import height_source
from prebuild.natural_earth import Vectors, from_wkb, to_wkb
from prebuild.paths import config_dir
from prebuild.profiles import Context
from prebuild.tiles import TileSources

_sources: TileSources | None = None


def tile_pool(ctx: Context, vectors: Vectors) -> ProcessPoolExecutor:
    """`ctx.jobs` workers whose tasks read `sources()`."""
    return ProcessPoolExecutor(
        max_workers=ctx.jobs,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=_start,
        initargs=(ctx, to_wkb(vectors)),
    )


def sources() -> TileSources:
    """The tile sources of the worker a task runs in."""
    if _sources is None:
        raise RuntimeError("tile sources exist only inside a tile_pool worker")
    return _sources


def _start(ctx: Context, wkb: bytes) -> None:
    global _sources
    water = load_water(config_dir(ctx.repo) / "water.yaml")
    _sources = TileSources(height_source(ctx), FieldVectors.build(from_wkb(wkb), water))
