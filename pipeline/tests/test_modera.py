import gzip
from dataclasses import replace

import numpy as np
import pytest

from prebuild import modera
from prebuild.profiles import Profile, make_context
from prebuild.records import read_record


def within_half_a_step(climate: modera.Climate, expected: np.ndarray) -> bool:
    error = np.abs(climate.values() - expected)
    return bool(np.all(error <= climate.scale[:, None, None] / 2 + 1e-6))


def test_a_climate_file_decodes_within_half_a_step_and_keeps_missing_cells():
    rng = np.random.default_rng(1816)
    frames = rng.normal(0.0, 3.0, (3, 4, 6))
    frames[1] *= 12  # a wide-range month, whose step grows past 0.1 K
    frames[0, 2, 3] = frames[2, 0, 0] = np.nan
    stored = modera.to_file(modera.quantize(frames, modera.MEAN, 1816))
    assert stored[4:8] == b"\0\0\0\0"  # gzip mtime 0
    assert gzip.decompress(stored)[:4] == b"WCY1"
    decoded = modera.from_file(stored)
    assert (decoded.variable, decoded.first_year, decoded.codes.shape) == (0, 1816, (3, 4, 6))
    assert decoded.scale[0] == np.float32(0.1) < decoded.scale[1]
    missing = np.isnan(frames)
    assert np.array_equal(decoded.codes == modera.MISSING, missing)
    error = np.abs(decoded.values() - frames)[~missing]
    half_step = np.broadcast_to(decoded.scale[:, None, None] / 2, frames.shape)[~missing]
    assert np.all(error <= half_step + 1e-6)


# The stage, on two years of a synthetic 4x8 grid


@pytest.fixture
def built(monkeypatch, tmp_path, write_modera):
    """The stage's layer folder and record, and the monthly grids it read."""
    rng = np.random.default_rng(1815)
    sources = {
        "mean": rng.normal(0.0, 2.0, (24, 4, 8)).astype(np.float32),
        "spread": rng.uniform(0.2, 1.5, (24, 4, 8)).astype(np.float32),
    }
    paths = {modera.FILES[name]: write_modera(f"{name}.nc", data) for name, data in sources.items()}
    monkeypatch.setattr(modera, "FIRST_YEAR", 1815)
    monkeypatch.setattr(modera, "LAST_YEAR", 1816)
    monkeypatch.setattr(modera, "verified_path", lambda ctx, source, filename: paths[filename])
    ctx = make_context(Profile.REGION, 1, tmp_path)
    modera.run(ctx)
    record = read_record(ctx, modera.STAGE)
    return ctx.out / modera.LAYER / record["ver"], record, sources


def test_each_year_file_holds_that_years_twelve_months(built):
    layer, _, sources = built
    for name, variable in (("mean", modera.MEAN), ("spread", modera.SPREAD)):
        year = modera.from_file((layer / name / "1816.bin").read_bytes())
        assert (year.variable, year.first_year) == (variable, 1816)
        assert within_half_a_step(year, sources[name][12:])


def test_annual_bin_holds_each_years_mean_of_its_monthly_means(built):
    layer, _, sources = built
    annual = modera.from_file((layer / "annual.bin").read_bytes())
    expected = sources["mean"].astype(np.float64).reshape(2, 12, 4, 8).mean(axis=1)
    assert (annual.variable, annual.first_year) == (modera.ANNUAL, 1815)
    assert within_half_a_step(annual, expected)


def test_the_record_gives_every_files_bytes(built):
    layer, record, _ = built
    sizes = {
        name: {year: (layer / name / f"{year}.bin").stat().st_size for year in ("1815", "1816")}
        for name in ("mean", "spread")
    }
    assert record["bytes"] == {**sizes, "annual": (layer / "annual.bin").stat().st_size}


@pytest.fixture(scope="module")
def real_built(tmp_path_factory):
    folder = tmp_path_factory.mktemp("real-modera")
    ctx = replace(
        make_context(Profile.FIXTURE, 1), out=folder / "out", stages_dir=folder / "stages"
    )
    modera.run(ctx)
    record = read_record(ctx, modera.STAGE)
    return ctx, ctx.out / modera.LAYER / record["ver"], record


def test_real_1816_summer_is_cold_over_central_europe(real_built):
    _, layer, record = real_built
    year = modera.from_file((layer / "mean/1816.bin").read_bytes())
    assert record["years"] == [1815, 1817]
    assert (year.first_year, year.codes.shape) == (1816, (12, 96, 192))
    lat = np.asarray(record["lat"])
    lon = record["lon0"] + np.arange(192) * record["dlon"]
    europe = ((lat >= 45) & (lat <= 55))[:, None] & ((lon >= 0) & (lon <= 20))[None, :]
    # June, July and August, against ModE-RA's 1901-2000 baseline, not a synthetic cold patch.
    summer = year.values()[5:8, europe]
    assert np.isfinite(summer).all()
    assert np.all(summer.mean(axis=1) < -1.0)
    assert np.isnan(year.values()[:, 0, 0]).all()  # beyond the spatial excerpt


@pytest.mark.parametrize("name", ["mean", "spread"])
def test_real_monthly_cells_survive_quantization_and_annual_means_keep_the_years(real_built, name):
    ctx, layer, record = real_built
    with modera.open_source(ctx, name) as source:
        frames = np.ma.filled(source["temp2"][:].astype(np.float64), np.nan)
    for i, year in enumerate(range(1815, 1818)):
        decoded = modera.from_file((layer / name / f"{year}.bin").read_bytes())
        expected = frames[i * 12 : (i + 1) * 12]
        np.testing.assert_array_equal(np.isnan(decoded.values()), np.isnan(expected))
        error = np.abs(decoded.values() - expected)
        assert np.all((error <= decoded.scale[:, None, None] / 2 + 1e-6) | np.isnan(expected))
        assert record["bytes"][name][str(year)] == (layer / name / f"{year}.bin").stat().st_size
    if name == "spread":
        assert np.nanmin(frames) > 0
    else:
        annual = modera.from_file((layer / "annual.bin").read_bytes())
        assert (annual.variable, annual.first_year, annual.codes.shape) == (2, 1815, (3, 96, 192))
        expected = frames.reshape(3, 12, 96, 192).mean(axis=1)
        error = np.abs(annual.values() - expected)
        assert np.all((error <= annual.scale[:, None, None] / 2 + 1e-6) | np.isnan(expected))
