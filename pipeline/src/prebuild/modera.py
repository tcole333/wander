"""The modera stage (streaming.md 3.5, 3.8, 7.1, 7.2): ModE-RA's monthly 2 m temperature anomalies
(K, against 1901-2000) as the climate layer `fd/modera/<ver8>/` in the profile's output root, with
the record `build/stages/<profile>/modera.json`.

The stage reads the ensemble mean and spread NetCDFs with netCDF4, one year of 12 months at a time,
and writes `mean/<year>.bin` and `spread/<year>.bin` for every year, then `annual.bin`: each year's
unweighted mean of its 12 monthly means. Months follow the source's (year, month) order; its hour
offsets are never turned into dates. The files are staged in `fd/modera/.tmp-<pid>/` and published
as `fd/modera/<ver8>/` once hashed (layers.py).

    'WCY1' u8 version | u8 variable (0 mean, 1 spread, 2 annual mean) | i16 firstYear | u16 frames
    u16 nlat | u16 nlon | u16 pad
    f32 scale[frames] | f32 offset[frames]    K = u8·scale + offset; 255 = missing
    u8 data[frames][nlat][nlon]    the native grid: row 0 northmost, column 0 centered at lon0

Per frame, offset is the frame's lowest value and scale max(0.1 K, range / 254), so no value clips
and every value decodes within half a step. Each stored file is gzip level 9 with mtime 0.

The fixture reads gzipped NetCDF excerpts for 1815-1817: Europe's original float32 cells on the
native grid, with the rest marked missing. The same reader, quantizer and annual means run on both.
"""

import gzip
import shutil
import struct
import time
from dataclasses import dataclass

import netCDF4
import numpy as np
import numpy.typing as npt

from prebuild.constants import FORMATS, SENTINELS
from prebuild.hashing import sha256_bytes
from prebuild.layers import publish, staging_folder
from prebuild.paths import excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import write_record
from prebuild.sources import verified_path

type FloatArray = npt.NDArray[np.float64]

STAGE = "modera"
LAYER = "fd/modera"
SOURCE = "mode-ra-temp2"  # the source id in sources.toml
FILES = {
    "mean": "ModE-RA_ensmean_temp2_anom_wrt_1901-2000_1421-2008_mon.nc",
    "spread": "ModE-RA_ensstd_temp2_anom_wrt_1901-2000_1421-2008_mon.nc",
}
VARIABLE = "temp2"
FIRST_YEAR = 1421
LAST_YEAR = 2008
EXCERPT_YEARS = (1815, 1817)
MONTHS = 12

MEAN, SPREAD, ANNUAL = 0, 1, 2  # the header's variable
MAGIC = str(FORMATS["climate"]["magic"]).encode("ascii")
VERSION = int(FORMATS["climate"]["version"])
MISSING = SENTINELS["climateMissing"]
TOP_CODE = MISSING - 1  # 254
MIN_STEP = 0.1  # K per code
HEADER = struct.Struct("<4sBBhHHHH")  # 16 bytes, so the f32 arrays start aligned
LAT_DIGITS = 6  # the record's latitudes, to about 0.1 m


class ModeraError(ValueError):
    """A ModE-RA file or climate file is not laid out as the stage expects."""


@dataclass(frozen=True)
class Climate:
    """One climate file: u8 frames on the native grid, with each frame's scale and offset."""

    variable: int
    first_year: int
    scale: npt.NDArray[np.float32]  # (frames,)
    offset: npt.NDArray[np.float32]  # (frames,)
    codes: npt.NDArray[np.uint8]  # (frames, nlat, nlon)

    def values(self) -> FloatArray:
        """Kelvin per cell, NaN where the code is the missing sentinel."""
        kelvin = self.codes * self.scale.astype(np.float64)[:, None, None]
        kelvin += self.offset.astype(np.float64)[:, None, None]
        return np.where(self.codes == MISSING, np.nan, kelvin)


def run(ctx: Context) -> None:
    started = time.perf_counter()
    first, last = EXCERPT_YEARS if ctx.profile is Profile.FIXTURE else (FIRST_YEAR, LAST_YEAR)
    layer = ctx.out / LAYER
    staging = staging_folder(layer)
    digests: dict[str, str] = {}
    sizes: dict[str, dict[str, int]] = {"mean": {}, "spread": {}}
    largest = {"mean": (0.0, ""), "spread": (0.0, "")}

    def write(path: str, climate: Climate) -> int:
        stored = to_file(climate)
        target = staging / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(stored)
        digests[path] = sha256_bytes(stored)
        return len(stored)

    try:
        with (
            open_source(ctx, "mean") as mean_nc,
            open_source(ctx, "spread") as spread_nc,
        ):
            lat, lon0, dlon = _grid(mean_nc)
            if _grid(spread_nc) != (lat, lon0, dlon):
                raise ModeraError("the mean and spread files lie on different grids")
            sources = {
                "mean": _temp2(mean_nc, first, last),
                "spread": _temp2(spread_nc, first, last),
            }
            annual: list[FloatArray] = []
            for year in range(first, last + 1):
                months = slice((year - first) * MONTHS, (year - first + 1) * MONTHS)
                for name, variable in (("mean", MEAN), ("spread", SPREAD)):
                    frames = _read(sources[name], months)
                    climate = quantize(frames, variable, year)
                    sizes[name][str(year)] = write(f"{name}/{year}.bin", climate)
                    month = int(np.argmax(climate.scale))
                    if climate.scale[month] > largest[name][0]:
                        largest[name] = (float(climate.scale[month]), f"{year}-{month + 1:02d}")
                    if variable == MEAN:
                        annual.append(frames.mean(axis=0))
            annual_bytes = write("annual.bin", quantize(np.stack(annual), ANNUAL, first))
        ver = publish(staging, layer, digests)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    record = {
        "ver": ver,
        "years": [first, last],
        "lat": [round(value, LAT_DIGITS) for value in lat],
        "lon0": lon0,
        "dlon": dlon,
        "bytes": {**sizes, "annual": annual_bytes},
    }
    write_record(ctx, STAGE, record)
    total = sum(sum(per_year.values()) for per_year in sizes.values()) + annual_bytes
    steps = ", ".join(f"{name} {step:.4f} K ({month})" for name, (step, month) in largest.items())
    seconds = time.perf_counter() - started
    print(
        f"modera: {len(digests)} files, {total / 1e6:.1f} MB into {LAYER}/{ver}/, "
        f"largest step {steps}, {seconds:.1f} s",
        flush=True,
    )


def quantize(frames: FloatArray, variable: int, first_year: int) -> Climate:
    """Codes for `frames` (frames, nlat, nlon), in K with NaN for missing: per frame, offset is the
    lowest value and scale max(MIN_STEP, range / 254), both rounded to float32 before the codes
    are taken, so every value decodes within half a step. A frame with no value gets offset 0."""
    if frames.ndim != 3:
        raise ModeraError(f"frames must be (frames, nlat, nlon), not {frames.shape}")
    flat = frames.reshape(len(frames), -1).astype(np.float64)
    present = np.isfinite(flat)
    low = np.where(present, flat, np.inf).min(axis=1, initial=np.inf)
    high = np.where(present, flat, -np.inf).max(axis=1, initial=-np.inf)
    empty = ~present.any(axis=1)
    low[empty] = high[empty] = 0.0
    scale = np.maximum(MIN_STEP, (high - low) / TOP_CODE).astype(np.float32)
    offset = low.astype(np.float32)
    steps = np.rint((np.where(present, flat, 0.0) - offset[:, None]) / scale[:, None])
    codes = np.where(present, np.clip(steps, 0, TOP_CODE), MISSING).astype(np.uint8)
    return Climate(variable, first_year, scale, offset, codes.reshape(frames.shape))


def encode_payload(c: Climate) -> bytes:
    frames, nlat, nlon = c.codes.shape
    header = HEADER.pack(MAGIC, VERSION, c.variable, c.first_year, frames, nlat, nlon, 0)
    params = c.scale.astype("<f4").tobytes() + c.offset.astype("<f4").tobytes()
    return header + params + c.codes.tobytes()


def decode_payload(raw: bytes) -> Climate:
    if len(raw) < HEADER.size:
        raise ModeraError(
            f"payload is {len(raw)} bytes, shorter than the {HEADER.size}-byte header"
        )
    magic, version, variable, first_year, frames, nlat, nlon, _ = HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION:
        raise ModeraError(f"not a version {VERSION} climate file: {magic!r} {version}")
    expected = HEADER.size + 8 * frames + frames * nlat * nlon
    if len(raw) != expected:
        raise ModeraError(f"{len(raw)} bytes do not hold {frames} frames of {nlat}x{nlon}")
    scale = np.frombuffer(raw, "<f4", frames, HEADER.size)
    offset = np.frombuffer(raw, "<f4", frames, HEADER.size + 4 * frames)
    codes = np.frombuffer(raw, np.uint8, frames * nlat * nlon, HEADER.size + 8 * frames)
    return Climate(variable, first_year, scale, offset, codes.reshape(frames, nlat, nlon))


def to_file(c: Climate) -> bytes:
    """The stored file: gzip level 9, mtime 0, no file name."""
    return gzip.compress(encode_payload(c), compresslevel=9, mtime=0)


def from_file(data: bytes) -> Climate:
    return decode_payload(gzip.decompress(data))


def _grid(dataset: netCDF4.Dataset) -> tuple[list[float], float, float]:
    """The file's latitudes (north first), first column center and column step, after checking
    that the columns are evenly spaced around the whole globe."""
    lat = [float(value) for value in np.asarray(dataset["latitude"][:])]
    lon = np.asarray(dataset["longitude"][:], dtype=np.float64)
    dlon = float(lon[1] - lon[0])
    if lat != sorted(lat, reverse=True):
        raise ModeraError("latitudes do not run north to south")
    if not np.allclose(np.diff(lon), dlon) or not np.isclose(len(lon) * dlon, 360.0):
        raise ModeraError(f"{len(lon)} columns do not step evenly around the globe")
    return lat, float(lon[0]), dlon


def open_source(ctx: Context, name: str) -> netCDF4.Dataset:
    """The raw NetCDF, or its committed excerpt in memory; both use the same NetCDF reader."""
    if ctx.profile is Profile.FIXTURE:
        path = excerpts_dir(ctx.repo) / STAGE / f"{name}.nc.gz"
        return netCDF4.Dataset(f"{name}.nc", memory=gzip.decompress(path.read_bytes()))
    return netCDF4.Dataset(verified_path(ctx, SOURCE, FILES[name]))


def _temp2(dataset: netCDF4.Dataset, first: int, last: int) -> netCDF4.Variable:
    variable = dataset[VARIABLE]
    expected = (last - first + 1) * MONTHS
    if variable.dimensions != ("time", "latitude", "longitude") or variable.shape[0] != expected:
        raise ModeraError(
            f"{VARIABLE} is {variable.dimensions} {variable.shape}, not {expected} months of "
            f"{first}-{last} on (time, latitude, longitude)"
        )
    return variable


def _read(variable: netCDF4.Variable, months: slice) -> FloatArray:
    """Kelvin for the months, NaN where the file holds its fill value."""
    return np.ma.filled(variable[months].astype(np.float64), np.nan)
