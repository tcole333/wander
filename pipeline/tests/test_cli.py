import contextlib
import json
import os
from pathlib import Path

import pytest

from prebuild.cli import STAGES, main, plan, run
from prebuild.profiles import Profile

REPO = Path("/repo")
# Stand-ins for the stages of streaming.md 7.1 that have not landed, in their order.
STAND_INS = {
    name: lambda ctx: None for name in ("fetch", "excerpts", "coverage", "surface", "media")
}


def planned(*argv: str) -> list[str]:
    return plan(argv, stages=STAND_INS, repo=REPO)[1]


@pytest.mark.parametrize(
    ("argv", "stages"),
    [
        ((), ["fetch", "coverage", "surface"]),
        (("--profile", "region"), ["fetch", "coverage", "surface"]),
        (("--profile", "fixture"), ["coverage", "surface"]),
        (("surface", "coverage"), ["coverage", "surface"]),
        (("coverage", "coverage"), ["coverage"]),
        (("excerpts",), ["excerpts"]),
        (("--profile", "region", "media"), ["media"]),
        (("--profile", "fixture", "surface"), ["surface"]),
    ],
)
def test_plan_runs_the_named_stages_or_every_implicit_one_in_order(argv, stages):
    assert planned(*argv) == stages


@pytest.mark.parametrize(
    "argv",
    [
        ("no-such-stage",),
        ("--profile", "fixture", "fetch"),
        ("--profile", "fixture", "excerpts"),
        ("--profile", "moon"),
        ("--jobs", "0"),
        ("--jobs", "many"),
    ],
)
def test_plan_rejects_bad_arguments_with_exit_code_2(argv):
    with pytest.raises(SystemExit) as exited:
        planned(*argv)
    assert exited.value.code == 2


def test_a_bare_run_builds_the_global_profile():
    ctx, _ = plan([], stages=STAND_INS, repo=REPO)
    assert ctx.profile is Profile.GLOBAL


@pytest.mark.parametrize(
    ("profile", "out"),
    [("global", "build/out"), ("region", "build/region"), ("fixture", "build/fixture")],
)
def test_each_profile_has_its_own_output_root_and_records(profile, out):
    ctx, _ = plan(["--profile", profile], stages=STAND_INS, repo=REPO)
    assert ctx.out == REPO / out
    assert ctx.stages_dir == REPO / "build" / "stages" / profile
    assert ctx.cache == REPO / "build" / "cache"


def test_the_fixture_profile_has_no_data_root():
    ctx, _ = plan(["--profile", "fixture"], stages=STAND_INS, repo=REPO)
    assert ctx.data is None


def test_other_profiles_read_wander_data(monkeypatch):
    monkeypatch.setenv("WANDER_DATA", "/data/wander")
    ctx, _ = plan(["--profile", "region"], stages=STAND_INS, repo=REPO)
    assert ctx.data == Path("/data/wander")


def test_the_data_root_defaults_to_the_projects_folder(monkeypatch, tmp_path):
    monkeypatch.delenv("WANDER_DATA")
    monkeypatch.setenv("HOME", str(tmp_path))
    ctx, _ = plan([], stages=STAND_INS, repo=REPO)
    assert ctx.data == tmp_path / "projects" / "wander-data"


def test_jobs_default_to_at_most_eight():
    ctx, _ = plan([], stages=STAND_INS, repo=REPO)
    assert ctx.jobs == min(8, os.process_cpu_count() or 1)
    assert plan(["--jobs", "3"], stages=STAND_INS, repo=REPO)[0].jobs == 3


def recording_stages(ran: list[str], fail: str | None = None):
    def stage(name):
        def runner(ctx):
            ran.append(name)
            if name == fail:
                raise RuntimeError(f"{name} failed")

        return runner

    return {name: stage(name) for name in STAND_INS}


def test_run_takes_the_stages_in_order(tmp_path):
    ran: list[str] = []
    stages = recording_stages(ran)
    ctx, names = plan(["surface", "coverage"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert ran == ["coverage", "surface"]


def test_a_full_fixture_build_writes_the_sidecars_and_stamp(tmp_path):
    ran: list[str] = []
    stages = recording_stages(ran)
    ctx, names = plan(["--profile", "fixture"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert ran == ["coverage", "surface"]
    assert (ctx.stages_dir / "expect" / "cube-samples.json").is_file()
    assert "inputs" in json.loads((ctx.stages_dir / "stamp.json").read_text())


@pytest.mark.parametrize("fail", [None, "surface"], ids=["finished", "failed"])
def test_a_partial_fixture_build_clears_the_stamp(tmp_path, fail):
    full = recording_stages([])
    ctx, names = plan(["--profile", "fixture"], stages=full, repo=tmp_path)
    run(ctx, names, full)
    partial = recording_stages([], fail=fail)
    ctx, names = plan(["--profile", "fixture", "surface"], stages=partial, repo=tmp_path)
    with pytest.raises(RuntimeError) if fail else contextlib.nullcontext():
        run(ctx, names, partial)
    assert not (ctx.stages_dir / "stamp.json").exists()


def test_a_failed_fixture_build_leaves_no_stamp(tmp_path):
    stages = recording_stages([], fail="surface")
    ctx, names = plan(["--profile", "fixture"], stages=stages, repo=tmp_path)
    ctx.stages_dir.mkdir(parents=True)
    (ctx.stages_dir / "stamp.json").write_text('{"inputs": "old"}')
    with pytest.raises(RuntimeError):
        run(ctx, names, stages)
    assert not (ctx.stages_dir / "stamp.json").exists()


def test_other_profiles_write_no_sidecars(tmp_path):
    stages = recording_stages([])
    ctx, names = plan(["--profile", "region"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert not (ctx.stages_dir / "stamp.json").exists()
    assert not (ctx.stages_dir / "expect").exists()


def test_stages_that_have_not_landed_are_not_registered():
    assert set(STAGES).isdisjoint({"fetch", "excerpts", "coverage", "surface", "media"})


def test_main_prints_usage_for_help(capsys):
    with pytest.raises(SystemExit) as exited:
        main(["--help"])
    assert exited.value.code == 0
    assert "usage: prebuild [-h] [--profile {global,region,fixture}] [--jobs N]" in (
        capsys.readouterr().out
    )
