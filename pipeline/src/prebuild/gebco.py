"""GEBCO heights (streaming.md 3.1): windows of the 15" grid read with netCDF4, the 1', 4' and 16'
block-mean overviews, the build's own bilinear sampling, and the int16 excerpts the fixture reads
in place of the grid (streaming.md 7.3).

Every grid here is global and center-registered with square cells: cell (i, j) is centered at
lon = -180 + (i + 0.5)·cell and lat = -90 + (j + 0.5)·cell, computed from the index, never read
from the file. Rows run south to north, as in GEBCO's file.
"""

import gzip
import json
import math
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]

ARCSEC_PER_TURN = 360 * 3600
VARIABLE = "elevation"
# Overview name -> source cells per side of each block (streaming.md 3.1).
OVERVIEWS: dict[str, int] = {"1m": 4, "4m": 16, "16m": 64}
STRIP_BLOCKS = 5  # overview strips hold this many of the largest blocks' rows


@dataclass(frozen=True)
class Raster:
    """A window of a global grid: row r is global row j0 + r (south first), and column k is global
    column (i0 + k) mod global_w, so a window may wrap across ±180°."""

    data: np.ndarray  # (h, w)
    cell_arcsec: int
    i0: int
    j0: int

    def __post_init__(self) -> None:
        if self.cell_arcsec <= 0 or (ARCSEC_PER_TURN // 2) % self.cell_arcsec:
            raise ValueError(f"{self.cell_arcsec}″ cells do not tile the globe")
        if self.data.ndim != 2:
            raise ValueError(f"raster data must be 2-D, not {self.data.shape}")
        if not 0 <= self.i0 < self.global_w or self.w > self.global_w:
            raise ValueError(f"columns {self.i0} + {self.w} fall outside {self.global_w}")
        if not 0 <= self.j0 <= self.j0 + self.h <= self.global_h:
            raise ValueError(f"rows {self.j0} + {self.h} fall outside {self.global_h}")

    @property
    def w(self) -> int:
        return self.data.shape[1]

    @property
    def h(self) -> int:
        return self.data.shape[0]

    @property
    def global_w(self) -> int:
        return ARCSEC_PER_TURN // self.cell_arcsec

    @property
    def global_h(self) -> int:
        return ARCSEC_PER_TURN // 2 // self.cell_arcsec

    @property
    def is_global(self) -> bool:
        return self.w == self.global_w and self.h == self.global_h


def read_window(nc: Path, i0: int, j0: int, w: int, h: int) -> Raster:
    """Cells [j0, j0 + h) x [i0, i0 + w) of the file's grid, the columns wrapping across ±180°
    (read as two slices). netCDF4 returns the stored int16 values, unmasked."""
    with netCDF4.Dataset(nc) as dataset:
        variable, cell_arcsec = _grid(dataset)
        return Raster(_take(variable, i0, j0, w, h, variable.shape[1]), cell_arcsec, i0, j0)


def grid_cell_arcsec(nc: Path) -> int:
    with netCDF4.Dataset(nc) as dataset:
        return _grid(dataset)[1]


def crop(r: Raster, i0: int, j0: int, w: int, h: int) -> Raster:
    """A window of a global raster, in its global cell indices."""
    if not r.is_global:
        raise ValueError("only a global raster can be cropped by global indices")
    return Raster(_take(r.data, i0, j0, w, h, r.global_w), r.cell_arcsec, i0, j0)


def overviews(nc: Path, cache: Path, factors: Mapping[str, int] = OVERVIEWS) -> dict[str, Raster]:
    """Global block means of the grid, kxk source cells per value: exact means rounded once to
    float32, built on first use into `cache` (one folder per source file, build/cache/gebco/<sha16>/
    for GEBCO_2026) and memory-mapped from there."""
    paths = {name: cache / f"{name}.npy" for name in factors}
    missing = {name: k for name, k in factors.items() if not paths[name].exists()}
    if missing:
        _build_overviews(nc, cache, missing)
    cell_arcsec = grid_cell_arcsec(nc)
    return {
        name: Raster(np.load(paths[name], mmap_mode="r"), cell_arcsec * k, 0, 0)
        for name, k in factors.items()
    }


def block_means(r: Raster, k: int) -> FloatArray:
    """Exact kxk block means of a raster whose rows and columns start on block boundaries."""
    if r.h % k or r.w % k or r.i0 % k or r.j0 % k:
        raise ValueError(f"the window does not align with {k}x{k} blocks")
    values = np.asarray(r.data, dtype=np.float64)
    return values.reshape(r.h // k, k, r.w // k, k).sum(axis=(1, 3)) / (k * k)


def bilinear(r: Raster, lon: npt.ArrayLike, lat: npt.ArrayLike) -> FloatArray:
    """Bilinear heights at lon/lat in degrees. Longitude wraps modulo the global width; rows clamp
    at the poles, where the grid has no row of its own. Every point must fall inside the window."""
    per_degree = 3600 / r.cell_arcsec
    x = (np.asarray(lon, dtype=np.float64) + 180) * per_degree - 0.5
    y = (np.asarray(lat, dtype=np.float64) + 90) * per_degree - 0.5
    x_floor, y_floor = np.floor(x), np.floor(y)
    fx, fy = x - x_floor, y - y_floor
    ix, iy = x_floor.astype(np.int64), y_floor.astype(np.int64)
    south = np.clip(iy, 0, r.global_h - 1) - r.j0
    north = np.clip(iy + 1, 0, r.global_h - 1) - r.j0
    west = (ix - r.i0) % r.global_w
    east = (ix + 1 - r.i0) % r.global_w
    outside = (south < 0) | (north >= r.h) | (west >= r.w) | (east >= r.w)
    if outside.any():
        raise ValueError(f"{int(outside.sum())} points fall outside the raster's window")
    d = r.data
    south_row = (1 - fx) * d[south, west].astype(np.float64) + fx * d[south, east]
    north_row = (1 - fx) * d[north, west].astype(np.float64) + fx * d[north, east]
    return (1 - fy) * south_row + fy * north_row


def write_excerpt(directory: Path, name: str, r: Raster, meta: Mapping[str, Any]) -> None:
    """`<name>.i16.gz` (little-endian int16, rows south first, gzip level 9 with mtime 0) and its
    sidecar `<name>.json`: `meta` (source, file, sha256, kind) plus the cell size and window."""
    if r.data.dtype != np.int16:
        raise TypeError(f"excerpts hold int16 heights, not {r.data.dtype}")
    directory.mkdir(parents=True, exist_ok=True)
    stored = np.ascontiguousarray(r.data, dtype="<i2").tobytes()
    (directory / f"{name}.i16.gz").write_bytes(gzip.compress(stored, compresslevel=9, mtime=0))
    sidecar = {**meta, "cellArcsec": r.cell_arcsec, "i0": r.i0, "j0": r.j0, "w": r.w, "h": r.h}
    (directory / f"{name}.json").write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")


def read_excerpt(directory: Path, name: str) -> Raster:
    sidecar = read_sidecar(directory, name)
    stored = gzip.decompress((directory / f"{name}.i16.gz").read_bytes())
    shape = (sidecar["h"], sidecar["w"])
    data = np.frombuffer(stored, dtype="<i2").reshape(shape).astype(np.int16)
    return Raster(data, sidecar["cellArcsec"], sidecar["i0"], sidecar["j0"])


def read_sidecar(directory: Path, name: str) -> dict[str, Any]:
    return json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))


def _grid(dataset: netCDF4.Dataset) -> tuple[netCDF4.Variable, int]:
    """The elevation variable and its cell size, after checking the layout this module assumes:
    (lat, lon), square cells that tile the globe, centers half a cell in from -90 and -180."""
    variable = dataset.variables[VARIABLE]
    if variable.dimensions != ("lat", "lon"):
        raise ValueError(f"{VARIABLE} has dimensions {variable.dimensions}, not (lat, lon)")
    rows, columns = variable.shape
    cell_arcsec, remainder = divmod(ARCSEC_PER_TURN, columns)
    if remainder or rows * 2 != columns:
        raise ValueError(f"a {rows}x{columns} grid is not global with square cells")
    cell = cell_arcsec / 3600
    first_lat, second_lat = (float(v) for v in dataset.variables["lat"][:2])
    first_lon = float(dataset.variables["lon"][0])
    if not (
        math.isclose(first_lat, -90 + cell / 2, abs_tol=1e-9)
        and math.isclose(second_lat - first_lat, cell, abs_tol=1e-9)
        and math.isclose(first_lon, -180 + cell / 2, abs_tol=1e-9)
    ):
        raise ValueError("the grid is not center-registered from -180°, -90° with rows south first")
    variable.set_auto_mask(False)
    return variable, cell_arcsec


def _take(source: Any, i0: int, j0: int, w: int, h: int, global_w: int) -> np.ndarray:
    rows = slice(j0, j0 + h)
    if i0 + w <= global_w:
        return np.asarray(source[rows, i0 : i0 + w])
    head = np.asarray(source[rows, i0:global_w])
    tail = np.asarray(source[rows, 0 : i0 + w - global_w])
    return np.concatenate([head, tail], axis=1)


def _build_overviews(nc: Path, cache: Path, factors: Mapping[str, int]) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    partial = {name: cache / f".{name}.npy.{os.getpid()}.tmp" for name in factors}
    try:
        with netCDF4.Dataset(nc) as dataset:
            variable, _ = _grid(dataset)
            _write_block_means(variable, partial, factors)
        for name in factors:
            partial[name].replace(cache / f"{name}.npy")
    finally:
        for path in partial.values():
            path.unlink(missing_ok=True)


def _write_block_means(
    variable: netCDF4.Variable, partial: Mapping[str, Path], factors: Mapping[str, int]
) -> None:
    """Sum each kxk block exactly in int64 and divide once, so a value is the float32 rounding of
    the exact mean. Rows are read in strips of whole blocks."""
    rows, columns = variable.shape
    largest = math.lcm(*factors.values())
    if rows % largest:
        raise ValueError(f"{rows} rows do not divide into {largest}-row blocks")
    outputs = {
        name: np.lib.format.open_memmap(
            partial[name], mode="w+", dtype=np.float32, shape=(rows // k, columns // k)
        )
        for name, k in factors.items()
    }
    step = largest * STRIP_BLOCKS
    for r0 in range(0, rows, step):
        strip = np.asarray(variable[r0 : min(r0 + step, rows), :], dtype=np.int64)
        for name, k in factors.items():
            n = strip.shape[0] // k
            sums = strip.reshape(n, k, columns // k, k).sum(axis=(1, 3))
            outputs[name][r0 // k : r0 // k + n] = (sums / (k * k)).astype(np.float32)
    for output in outputs.values():
        output.flush()
