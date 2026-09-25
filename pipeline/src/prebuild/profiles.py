"""Build profiles and the context every stage runs in (streaming.md 7.1)."""

import os
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from prebuild.paths import REPO_ROOT, data_root


class Profile(StrEnum):
    GLOBAL = "global"  # the production bake that publish-data uploads
    REGION = "region"  # the milestone-1 bake (streaming.md 8.1)
    FIXTURE = "fixture"  # committed excerpts only, for tests and CI (streaming.md 7.3)


# Each profile's output root, in the R2 key layout, relative to the repo.
OUTPUT_ROOTS: dict[Profile, str] = {
    Profile.GLOBAL: "build/out",
    Profile.REGION: "build/region",
    Profile.FIXTURE: "build/fixture",
}

# A bare `uv run prebuild` builds the global profile (owner decision 17).
DEFAULT_PROFILE = Profile.GLOBAL


@dataclass(frozen=True)
class Context:
    profile: Profile
    repo: Path
    data: Path | None  # the raw-data folder; None for the fixture, which reads committed excerpts
    out: Path  # the profile's output root
    stages_dir: Path  # stage records and, for the fixture, the test sidecars and stamp
    cache: Path
    jobs: int


def make_context(profile: Profile, jobs: int, repo: Path = REPO_ROOT) -> Context:
    build = repo / "build"
    return Context(
        profile=profile,
        repo=repo,
        data=None if profile is Profile.FIXTURE else data_root(),
        out=repo / OUTPUT_ROOTS[profile],
        stages_dir=build / "stages" / profile.value,
        cache=build / "cache",
        jobs=jobs,
    )


def default_jobs() -> int:
    """min(8, CPUs this process may use)."""
    return min(8, os.process_cpu_count() or 1)
