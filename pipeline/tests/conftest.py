import warnings
from dataclasses import replace
from pathlib import Path

import netCDF4
import numpy as np
import pytest

from prebuild import coverage
from prebuild.cube import Tile
from prebuild.profiles import Context, Profile, make_context
from prebuild.tiles import Surface, TileSources, open_sources, surface


@pytest.fixture(autouse=True)
def no_raw_data(monkeypatch, tmp_path_factory):
    """Tests never read the raw-data folder: WANDER_DATA names a folder that does not exist."""
    monkeypatch.setenv("WANDER_DATA", str(tmp_path_factory.getbasetemp() / "no-wander-data"))


@pytest.fixture(scope="session")
def fixture_sources() -> TileSources:
    """The fixture profile's sources: the committed GEBCO and Natural Earth excerpts."""
    return open_sources(make_context(Profile.FIXTURE, 1))


@pytest.fixture(scope="session")
def fixture_surface(fixture_sources):
    """A fixture tile's surface, computed once per test session."""
    computed: dict[Tile, Surface] = {}

    def get(tile: Tile) -> Surface:
        if tile not in computed:
            computed[tile] = surface(tile, fixture_sources)
        return computed[tile]

    return get


@pytest.fixture(scope="session")
def fixture_coverage(tmp_path_factory) -> Context:
    """The coverage stage run once per session on the fixture profile, into a temporary build
    folder: its context, whose stages folder holds the record."""
    build = tmp_path_factory.mktemp("coverage")
    ctx = replace(
        make_context(Profile.FIXTURE, 4),
        out=build / "fixture",
        stages_dir=build / "stages",
        cache=build / "cache",
    )
    coverage.run(ctx)
    return ctx


@pytest.fixture
def write_grid(tmp_path):
    """Writes a global grid laid out as GEBCO's file and returns its path: int16 `elevation`
    (lat, lon), rows south first, cell centers half a cell in from -90° and -180°."""

    def write(elevation: np.ndarray) -> Path:
        path = tmp_path / "grid.nc"
        rows, columns = elevation.shape
        cell = 360 / columns
        with netCDF4.Dataset(path, "w", format="NETCDF4") as dataset:
            dataset.createDimension("lat", rows)
            dataset.createDimension("lon", columns)
            lat = dataset.createVariable("lat", "f8", ("lat",))
            lon = dataset.createVariable("lon", "f8", ("lon",))
            lat[:] = -90 + (np.arange(rows) + 0.5) * cell
            lon[:] = -180 + (np.arange(columns) + 0.5) * cell
            variable = dataset.createVariable("elevation", "i2", ("lat", "lon"), contiguous=True)
            with warnings.catch_warnings():
                # netCDF4 1.7.4 sets an array's shape when it writes, which numpy 2.5 deprecates.
                warnings.filterwarnings("ignore", "Setting the shape", DeprecationWarning)
                variable[:] = elevation
        return path

    return write


@pytest.fixture
def write_modera(tmp_path):
    """Writes a monthly grid laid out as ModE-RA's files and returns its path: float32 `temp2`
    (time, latitude, longitude), rows north first, columns from -180° evenly around the globe."""

    def write(name: str, temp2: np.ndarray) -> Path:
        path = tmp_path / name
        months, rows, columns = temp2.shape
        with netCDF4.Dataset(path, "w", format="NETCDF4") as dataset:
            dataset.createDimension("time", months)
            dataset.createDimension("latitude", rows)
            dataset.createDimension("longitude", columns)
            lat = dataset.createVariable("latitude", "f8", ("latitude",))
            lon = dataset.createVariable("longitude", "f8", ("longitude",))
            lat[:] = np.linspace(80, -80, rows)
            lon[:] = -180 + np.arange(columns) * 360 / columns
            variable = dataset.createVariable("temp2", "f4", ("time", "latitude", "longitude"))
            with warnings.catch_warnings():
                # netCDF4 1.7.4 sets an array's shape when it writes, which numpy 2.5 deprecates.
                warnings.filterwarnings("ignore", "Setting the shape", DeprecationWarning)
                variable[:] = temp2
        return path

    return write
