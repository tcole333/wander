import pytest

from prebuild.profiles import Profile, make_context
from prebuild.records import MissingStageRecord, read_record, record_path, write_record


@pytest.fixture
def ctx(tmp_path):
    return make_context(Profile.REGION, jobs=1, repo=tmp_path)


def test_records_round_trip(ctx):
    record = {"qLand": [2.0, 2.015625], "avail": "AAE=", "inputs": {"code": "ab" * 32}}
    path = write_record(ctx, "coverage", record)
    assert path == ctx.repo / "build" / "stages" / "region" / "coverage.json"
    assert read_record(ctx, "coverage") == record


def test_a_missing_record_names_the_command_that_writes_it(ctx):
    with pytest.raises(MissingStageRecord) as missing:
        read_record(ctx, "coverage")
    assert str(missing.value) == (
        "build/stages/region/coverage.json is missing: "
        "run `uv run prebuild --profile region coverage`"
    )


def test_writing_a_record_leaves_no_partial_file(ctx):
    write_record(ctx, "surface", {"ver": "0123abcd"})
    write_record(ctx, "surface", {"ver": "89abcdef"})
    assert [p.name for p in record_path(ctx, "surface").parent.iterdir()] == ["surface.json"]
    assert read_record(ctx, "surface") == {"ver": "89abcdef"}
