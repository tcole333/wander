"""Texel heights (streaming.md 3.1): each texel is the mean of its 4x4 bilinear sub-samples of
GEBCO meters, taken at exact face-global positions (3.0 item 5), so a texel's height depends only
on where it is and on the raster its level reads.

A `HeightSource` names that raster for each tile. The production source reads the coarsest GEBCO
grid whose cell is no larger than the level's texel; the fixture reads the committed excerpt
fixture.yaml names for the tile. Both hand back a `gebco.Raster`, and the rest is the same code.
"""

from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

import numpy as np
import numpy.typing as npt

from prebuild.config import FixtureConfig, load_fixture
from prebuild.cube import Tile
from prebuild.footprint import SUBSAMPLES, subsample_lonlat, tile_window
from prebuild.gebco import (
    GEBCO,
    GEBCO_NC,
    Raster,
    bilinear,
    grid_cell_arcsec,
    overviews,
    read_excerpt,
    read_window,
)
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.sources import load_sources, pinned_file, verified_path

type FloatArray = npt.NDArray[np.float64]

GRID = "15s"  # GEBCO's own cells; the overviews are named in gebco.OVERVIEWS
# Level -> the coarsest GEBCO source whose cell is no larger than the level's texel, or the grid
# where none is (streaming.md 3.1).
PRODUCTION_SOURCES: dict[int, str] = {
    0: "16m",
    1: "4m",
    2: "4m",
    3: "1m",
    4: "1m",
    5: GRID,
    6: GRID,
    7: GRID,
}


class HeightSource(Protocol):
    def raster(self, tile: Tile) -> Raster:
        """The raster every height of the tile reads: its texels -4..259 and the owner-frame
        texels its edge profiles take."""
        ...


def texel_means(face: int, level: int, g_rows: range, g_cols: range, raster: Raster) -> FloatArray:
    """Heights of face-global texels g_rows x g_cols, shaped (rows, cols): each the sum of its 16
    bilinear sub-samples in a fixed order, t outer and s inner, times 1/16. numpy's own reductions
    pick their order by array shape, so the sum is spelled out."""
    lon, lat = subsample_lonlat(face, level, g_rows, g_cols)
    samples = bilinear(raster, lon, lat).reshape(len(g_rows), SUBSAMPLES, len(g_cols), SUBSAMPLES)
    total = samples[:, 0, :, 0].copy()
    for b in range(SUBSAMPLES):
        for a in range(SUBSAMPLES):
            if a or b:
                total += samples[:, b, :, a]
    return total * (1 / SUBSAMPLES**2)


class GebcoHeights:
    """The production source: GEBCO_2026's 15" grid, read per tile over the tile's window, and its
    1', 4' and 16' overviews, memory-mapped from build/cache/gebco/<sha16>/."""

    def __init__(self, nc: Path, views: Mapping[str, Raster]) -> None:
        self.nc = nc
        self.views = dict(views)
        self.grid_cell = grid_cell_arcsec(nc)

    def raster(self, tile: Tile) -> Raster:
        if tile.level not in PRODUCTION_SOURCES:
            raise ValueError(f"no GEBCO source for level {tile.level}")
        name = PRODUCTION_SOURCES[tile.level]
        if name == GRID:
            return read_window(self.nc, *tile_window(tile, self.grid_cell))
        return self.views[name]


class ExcerptHeights:
    """The fixture's source: the committed excerpt fixture.yaml names for each tile."""

    def __init__(self, fixture: FixtureConfig, folder: Path) -> None:
        self.fixture = fixture
        self.folder = folder
        self._read: dict[str, Raster] = {}

    def raster(self, tile: Tile) -> Raster:
        if tile not in self.fixture.rasters:
            raise ValueError(f"fixture.yaml lists no tile {tile.key()}")
        name = self.fixture.rasters[tile]
        if name not in self._read:
            self._read[name] = read_excerpt(self.folder, name)
        return self._read[name]


def height_source(ctx: Context) -> HeightSource:
    """The fixture's excerpts under the fixture profile, else GEBCO under $WANDER_DATA, whose
    overviews are built on first use."""
    if ctx.profile is Profile.FIXTURE:
        return ExcerptHeights(
            load_fixture(config_dir(ctx.repo) / "fixture.yaml"), excerpts_dir(ctx.repo) / "gebco"
        )
    registry = load_sources()
    nc = verified_path(ctx, GEBCO, GEBCO_NC, registry)
    sha = pinned_file(registry[GEBCO], GEBCO_NC).sha256
    return GebcoHeights(nc, overviews(nc, ctx.cache / "gebco" / sha[:16]))
