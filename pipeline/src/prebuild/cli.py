"""`uv run prebuild [--profile global|region|fixture] [--jobs N] [stage ...]` (streaming.md 7.1)."""

import argparse
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from prebuild.expect import clear_stamp, write_expectations
from prebuild.paths import REPO_ROOT
from prebuild.profiles import DEFAULT_PROFILE, Context, Profile, default_jobs, make_context

type Runner = Callable[[Context], None]

# Every stage, in the order a run takes them. Each stage registers here when it lands.
STAGES: dict[str, Runner] = {}

# A run with no stage named leaves these out: excerpts rewrites committed files, and media
# builds the one story named with --story.
NAMED_ONLY = frozenset({"excerpts", "media"})
# The fixture reads only committed excerpts, so it never runs the stages that read raw data.
RAW_DATA_ONLY = frozenset({"fetch", "excerpts"})


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
            parser.error(f"the fixture profile reads no raw data, so it does not run {name}")
    names = [name for name in stages if name in named] if named else default_stages(profile, stages)
    return make_context(profile, args.jobs, repo), names


def run(ctx: Context, names: Sequence[str], stages: Mapping[str, Runner] = STAGES) -> None:
    """Run the stages in order. A full fixture build then writes the test sidecars and, last, the
    stamp; it clears the stamp first, so a failed or partial build never looks fresh."""
    full_fixture = ctx.profile is Profile.FIXTURE and list(names) == default_stages(
        ctx.profile, stages
    )
    if full_fixture:
        clear_stamp(ctx)
    if not names and not full_fixture:
        print(f"prebuild --profile {ctx.profile}: no stages to run", flush=True)
    for name in names:
        print(f"prebuild --profile {ctx.profile}: {name}", flush=True)
        stages[name](ctx)
    if full_fixture:
        write_expectations(ctx)
        print(f"prebuild --profile {ctx.profile}: wrote the test sidecars and stamp", flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    ctx, names = plan(sys.argv[1:] if argv is None else argv)
    run(ctx, names)
    return 0


def _parser(stages: Mapping[str, Runner]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prebuild",
        description="Turn Wander's raw sources into web-ready assets (streaming.md 7.1).",
        epilog=(
            f"Stages, in order: {_listed(stages)}. With none named, every stage runs except "
            "excerpts and media; the fixture profile also skips fetch."
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
    parser.add_argument("stages", nargs="*", metavar="stage", help="stages to run (see below)")
    return parser


def _positive(text: str) -> int:
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError(f"must be at least 1, not {value}")
    return value


def _listed(stages: Mapping[str, Runner]) -> str:
    return ", ".join(stages) or "none yet"
