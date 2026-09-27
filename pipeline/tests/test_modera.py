import gzip

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
