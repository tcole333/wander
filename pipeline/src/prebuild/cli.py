"""`uv run prebuild [--profile global|region|fixture] [--jobs N] [stage ...]` (streaming.md 7.1)."""

import argparse
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from prebuild import (
    borders,
    coverage,
    event_files,
    events,
    excerpts,
    fetch,
    fixture_store,
    fx,
    meanwhile,
    media,
    modera,
    openings,
    surface,
    wikidata,
)
from prebuild.expect import clear_stamp, write_expectations
from prebuild.hashing import FIXTURE_PATHS, tree_sha
from prebuild.paths import REPO_ROOT
from prebuild.profiles import DEFAULT_PROFILE, Context, Profile, default_jobs, make_context
from prebuild.slots import heavy_slot

type Runner = Callable[[Context], None]

# Every stage, in the order a run takes them. Each stage registers here when it lands.
STAGES: dict[str, Runner] = {
    "fetch": fetch.run,
    "wikidata": wikidata.run,
    "excerpts": excerpts.run,
    "coverage": coverage.run,
    "surface": surface.run,
    "borders": borders.run,
    "events": events.run,
    "openings": openings.run,
    "event-files": event_files.run,
    "modera": modera.run,
    "fx": fx.run,
    "media": media.run,
    "meanwhile": meanwhile.run,
}

# A run with no stage named leaves these out: wikidata, excerpts and openings rewrite committed
# files, and media and meanwhile build the one story named with --story.
NAMED_ONLY = frozenset({"wikidata", "excerpts", "openings", "media", "meanwhile"})
# Each builds the story named with --story.
STORY_STAGES = frozenset({"media", "meanwhile"})
# The fixture reads only committed excerpts, so it never runs the stages that read raw data.
# Borders tests draw synthetic snapshots (borders.py). Meanwhile also stays out until it has a
# fixture story and lock of its own: a fixture build must never rewrite the Tambora lock. Openings
# stays out too: its lock is checked against the whole index, which the fixture holds a slice of.
RAW_DATA_ONLY = frozenset({"fetch", "wikidata", "excerpts", "borders", "meanwhile", "openings"})


def default_stages(profile: Profile, stages: Mapping[str, Runner] = STAGES) -> list[str]:
    """What a run with no stage named runs, in order."""
    skipped = NAMED_ONLY | (RAW_DATA_ONLY if profile is Profile.FIXTURE else frozenset())
    return [name for name in stages if name not in skipped]


def plan(
    argv: Sequence[str],
    *,
    stages: Mapping[str, Runner] = STAGES,
    repo: Path = REPO_ROOT,
) -> tuple[Context, list[str]]:
    """The context and the stages, in run order, that `argv` asks for. Bad arguments exit 2."""
    parser = _parser(stages)
    args = parser.parse_args(argv)
    profile = Profile(args.profile)
    named: list[str] = args.stages
    for name in named:
        if name not in stages:
            parser.error(f"unknown stage {name!r} (stages: {_listed(stages)})")
        if profile is Profile.FIXTURE and name in RAW_DATA_ONLY:
            if name == "meanwhile":
                parser.error("meanwhile needs a fixture story and lock of its own")
            if name == "openings":
                parser.error("openings checks its list against the whole event index")
            parser.error(f"the fixture profile reads no raw data, so it does not run {name}")
    for name in STORY_STAGES & set(named):
        if args.story is None:
            parser.error(f"{name} builds one story: name it with --story <id>")
    if args.story is not None and not STORY_STAGES & set(named):
        parser.error("--story goes with the media and meanwhile stages")
    if args.offline and "media" not in named:
        parser.error("--offline goes with the media stage")
    if args.rebuild and (profile is not Profile.FIXTURE or named):
        parser.error("--rebuild goes with a full fixture build: --profile fixture, no stages named")
    names = [name for name in stages if name in named] if named else default_stages(profile, stages)
    ctx = make_context(
        profile, args.jobs, repo, story=args.story, offline=args.offline, rebuild=args.rebuild
    )
    return ctx, names


def run(ctx: Context, names: Sequence[str], stages: Mapping[str, Runner] = STAGES) -> None:
    """Run the stages in order. Every fixture run clears the stamp first. The surface stage
    writes its own sidecars (tiles.json, points.json) whenever it runs; only a full fixture build
    then writes the cube samples and the synthetic tiles and, last, the stamp, so a failed or
    partial build never looks fresh. The stamp hashes the inputs as they stood before the stages
    ran, so a file saved during the build leaves the fixture stale. A full fixture build first
    looks for its inputs in the fixture store and restores that build instead, unless --rebuild;
    one it makes goes into the store when no input changed while it ran."""
    fixture = ctx.profile is Profile.FIXTURE
    full_fixture = fixture and list(names) == default_stages(ctx.profile, stages)
    if fixture:
        clear_stamp(ctx)
    inputs = tree_sha(FIXTURE_PATHS, ctx.repo) if full_fixture else None
    store = fixture_store.store_root() if full_fixture else None
    if inputs is not None and store is not None and not ctx.rebuild:
        entry = store / inputs
        try:
            if fixture_store.restore(ctx, entry):
                print(f"prebuild --profile {ctx.profile}: restored {entry}", flush=True)
                return
        except OSError as error:
            print(f"prebuild: could not restore {entry}, building: {error}", file=sys.stderr)
    if not names and not full_fixture:
        print(f"prebuild --profile {ctx.profile}: no stages to run", flush=True)
    for name in names:
        print(f"prebuild --profile {ctx.profile}: {name}", flush=True)
        stages[name](ctx)
    if inputs is not None:
        write_expectations(ctx, inputs)
        print(f"prebuild --profile {ctx.profile}: wrote the test sidecars and stamp", flush=True)
        if store is not None and tree_sha(FIXTURE_PATHS, ctx.repo) == inputs:
            fixture_store.save(ctx, store / inputs)


def main(argv: Sequence[str] | None = None) -> int:
    ctx, names = plan(sys.argv[1:] if argv is None else argv)
    with heavy_slot():
        run(ctx, names)
    return 0


def _parser(stages: Mapping[str, Runner]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prebuild",
        description="Turn Wander's raw sources into web-ready assets (streaming.md 7.1).",
        epilog=(
            f"Stages, in order: {_listed(stages)}. With none named, every stage runs except "
            "wikidata, excerpts, openings, media and meanwhile; the fixture profile also skips "
            "fetch and borders."
        ),
    )
    parser.add_argument(
        "--profile",
        choices=[profile.value for profile in Profile],
        default=DEFAULT_PROFILE.value,
        help="global writes build/out/ (the default), region build/region/, fixture build/fixture/",
    )
    parser.add_argument(
        "--jobs",
        type=_positive,
        default=default_jobs(),
        metavar="N",
        help="worker processes (default: min(8, CPUs))",
    )
    parser.add_argument(
        "--story", metavar="ID", help="the story media and meanwhile build: stories/<ID>/"
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="media reads the committed sources in pipeline/tests/data/media/, not Commons",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="build the fixture even when the fixture store holds a build of these inputs",
    )
    parser.add_argument("stages", nargs="*", metavar="stage", help="stages to run (see below)")
    return parser


def _positive(text: str) -> int:
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError(f"must be at least 1, not {value}")
    return value


def _listed(stages: Mapping[str, Runner]) -> str:
    return ", ".join(stages) or "none yet"
