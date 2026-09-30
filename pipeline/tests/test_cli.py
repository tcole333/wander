import contextlib
import json
import os
from pathlib import Path

import pytest

from prebuild.cli import STAGES, main, plan, run
from prebuild.fixture_store import prune, store_root
from prebuild.hashing import FIXTURE_PATHS, tree_sha
from prebuild.profiles import Context, Profile

REPO = Path("/repo")
# Stand-ins for the stages of streaming.md 7.1 that have not landed, in their order.
STAND_INS = {
    name: lambda ctx: None
    for name in (
        "fetch",
        "wikidata",
        "excerpts",
        "coverage",
        "surface",
        "borders",
        "events",
        "openings",
        "modera",
        "fx",
        "media",
        "meanwhile",
    )
}


def planned(*argv: str) -> list[str]:
    return plan(argv, stages=STAND_INS, repo=REPO)[1]


@pytest.mark.parametrize(
    ("argv", "stages"),
    [
        ((), ["fetch", "coverage", "surface", "borders", "events", "modera", "fx"]),
        (
            ("--profile", "region"),
            ["fetch", "coverage", "surface", "borders", "events", "modera", "fx"],
        ),
        (("--profile", "fixture"), ["coverage", "surface", "events", "modera", "fx"]),
        (("surface", "coverage"), ["coverage", "surface"]),
        (("coverage", "coverage"), ["coverage"]),
        (("excerpts",), ["excerpts"]),
        (("events", "wikidata"), ["wikidata", "events"]),
        (("openings", "events"), ["events", "openings"]),
        (("--profile", "region", "openings"), ["openings"]),
        (("--profile", "region", "media", "--story", "tambora"), ["media"]),
        (("meanwhile", "media", "--story", "tambora"), ["media", "meanwhile"]),
        (("--profile", "fixture", "surface"), ["surface"]),
        (("--profile", "fixture", "modera", "events"), ["events", "modera"]),
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
        ("--profile", "fixture", "borders"),
        ("--profile", "fixture", "wikidata"),
        ("--profile", "moon"),
        ("--jobs", "0"),
        ("--jobs", "many"),
        ("media",),
        ("meanwhile",),
        ("surface", "--story", "tambora"),
        ("--profile", "fixture", "meanwhile", "--story", "tambora"),
        ("--profile", "fixture", "openings"),
        ("openings", "--story", "tambora"),
        ("meanwhile", "--story", "tambora", "--offline"),
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
    assert ran == ["coverage", "surface", "events", "modera", "fx"]
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


@pytest.mark.parametrize("fail", ["surface", "events", "modera"])
def test_a_failed_fixture_build_leaves_no_stamp(tmp_path, fail):
    stages = recording_stages([], fail=fail)
    ctx, names = plan(["--profile", "fixture"], stages=stages, repo=tmp_path)
    ctx.stages_dir.mkdir(parents=True)
    (ctx.stages_dir / "stamp.json").write_text('{"inputs": "old"}')
    with pytest.raises(RuntimeError):
        run(ctx, names, stages)
    assert not (ctx.stages_dir / "stamp.json").exists()


def test_a_file_saved_during_the_build_leaves_the_fixture_stale(tmp_path):
    source = tmp_path / "pipeline" / "src" / "stage.py"
    source.parent.mkdir(parents=True)
    source.write_text("print('before')\n")

    def edit_during_the_build(ctx):
        source.write_text("print('during')\n")

    stages = {**STAND_INS, "coverage": edit_during_the_build}
    before = tree_sha(FIXTURE_PATHS, tmp_path)
    ctx, names = plan(["--profile", "fixture"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    stamp = json.loads((ctx.stages_dir / "stamp.json").read_text())
    assert stamp["inputs"] == before != tree_sha(FIXTURE_PATHS, tmp_path)


def test_other_profiles_write_no_sidecars(tmp_path):
    stages = recording_stages([])
    ctx, names = plan(["--profile", "region"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert not (ctx.stages_dir / "stamp.json").exists()
    assert not (ctx.stages_dir / "expect").exists()


def test_the_stages_that_have_landed_are_registered_in_order():
    assert list(STAGES) == [
        "fetch",
        "wikidata",
        "excerpts",
        "coverage",
        "surface",
        "borders",
        "events",
        "openings",
        "event-files",
        "modera",
        "fx",
        "media",
        "meanwhile",
    ]


def test_main_prints_usage_for_help(capsys):
    with pytest.raises(SystemExit) as exited:
        main(["--help"])
    assert exited.value.code == 0
    assert "usage: prebuild [-h] [--profile {global,region,fixture}] [--jobs N]" in (
        capsys.readouterr().out
    )


# The fixture store


def building_stages(ran: list[str]):
    """Stand-ins whose coverage stage writes a tile and a record, as a fixture build would."""

    def coverage(ctx):
        ran.append("coverage")
        (ctx.out / "surf").mkdir(parents=True, exist_ok=True)
        (ctx.out / "surf" / "0.wst").write_bytes(b"tile")
        ctx.stages_dir.mkdir(parents=True, exist_ok=True)
        (ctx.stages_dir / "coverage.json").write_text("{}")

    return {**STAND_INS, "coverage": coverage}


def build_fixture(repo: Path, *argv: str) -> tuple[list[str], Context]:
    ran: list[str] = []
    stages = building_stages(ran)
    ctx, names = plan(["--profile", "fixture", *argv], stages=stages, repo=repo)
    run(ctx, names, stages)
    return ran, ctx


def files_under(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_a_full_fixture_build_goes_into_the_store_under_its_inputs(tmp_path):
    _, ctx = build_fixture(tmp_path)
    stamp = json.loads((ctx.stages_dir / "stamp.json").read_text())
    entry = store_root() / stamp["inputs"]
    assert files_under(entry / "out") == files_under(ctx.out)
    assert files_under(entry / "stages") == files_under(ctx.stages_dir)


def test_a_build_of_stored_inputs_restores_them_in_place_of_what_was_there(tmp_path):
    _, built = build_fixture(tmp_path)
    expected = files_under(tmp_path / "build")
    (built.out / "surf" / "0.wst").write_bytes(b"changed")
    (built.out / "left-over.wst").write_bytes(b"old")
    ran, _ = build_fixture(tmp_path)
    assert ran == []
    assert files_under(tmp_path / "build") == expected


def test_rebuild_builds_even_when_the_store_holds_the_inputs(tmp_path):
    build_fixture(tmp_path)
    ran, _ = build_fixture(tmp_path, "--rebuild")
    assert ran == ["coverage"]


def test_a_rebuild_replaces_the_stored_build_of_its_inputs(tmp_path):
    _, ctx = build_fixture(tmp_path)
    entry = store_root() / json.loads((ctx.stages_dir / "stamp.json").read_text())["inputs"]
    (entry / "out" / "surf" / "0.wst").write_bytes(b"suspect")
    (entry / "out" / "left-over.wst").write_bytes(b"old")
    build_fixture(tmp_path, "--rebuild")
    assert files_under(entry / "out") == files_under(ctx.out)
    assert files_under(entry / "stages") == files_under(ctx.stages_dir)
    assert [path.name for path in entry.parent.iterdir()] == [entry.name]


def test_other_inputs_miss_the_store(tmp_path):
    build_fixture(tmp_path)
    (tmp_path / "pipeline" / "sources.toml").parent.mkdir(parents=True, exist_ok=True)
    (tmp_path / "pipeline" / "sources.toml").write_text("[pins]\n")
    ran, _ = build_fixture(tmp_path)
    assert ran == ["coverage"]


def test_a_build_whose_inputs_changed_while_it_ran_is_not_stored(tmp_path):
    source = tmp_path / "pipeline" / "src" / "stage.py"
    source.parent.mkdir(parents=True)
    source.write_text("print('before')\n")
    stages = {**building_stages([]), "surface": lambda ctx: source.write_text("print('during')\n")}
    before = tree_sha(FIXTURE_PATHS, tmp_path)
    ctx, names = plan(["--profile", "fixture"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert not (store_root() / before).exists()


def test_ci_keeps_no_store(tmp_path, monkeypatch):
    monkeypatch.setenv("CI", "true")
    build_fixture(tmp_path)
    ran, _ = build_fixture(tmp_path)
    assert ran == ["coverage"]


def test_a_partial_fixture_build_neither_reads_nor_fills_the_store(tmp_path):
    build_fixture(tmp_path)
    ran: list[str] = []
    stages = building_stages(ran)
    ctx, names = plan(["--profile", "fixture", "coverage"], stages=stages, repo=tmp_path)
    run(ctx, names, stages)
    assert ran == ["coverage"]
    assert not (ctx.stages_dir / "stamp.json").exists()


@pytest.mark.parametrize(
    "argv",
    [
        ("--rebuild",),
        ("--profile", "region", "--rebuild"),
        ("--profile", "fixture", "surface", "--rebuild"),
    ],
)
def test_rebuild_goes_only_with_a_full_fixture_build(argv):
    with pytest.raises(SystemExit) as exited:
        planned(*argv)
    assert exited.value.code == 2


def test_the_store_keeps_the_most_recently_used_builds(tmp_path):
    for age, name in enumerate("abcd"):
        (tmp_path / name).mkdir()
        os.utime(tmp_path / name, (1000 - age, 1000 - age))
    (tmp_path / ".tmp-1").mkdir()
    prune(tmp_path, keep=2)
    assert sorted(p.name for p in tmp_path.iterdir()) == [".tmp-1", "a", "b"]
