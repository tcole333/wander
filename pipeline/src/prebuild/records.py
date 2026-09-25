"""Stage records at build/stages/<profile>/<stage>.json (streaming.md 7.2)."""

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from prebuild.profiles import Context


class MissingStageRecord(FileNotFoundError):
    """A stage needs a record that no run has written; the message names the command to run."""


def record_path(ctx: Context, stage: str) -> Path:
    return ctx.stages_dir / f"{stage}.json"


def write_record(ctx: Context, stage: str, record: Mapping[str, Any]) -> Path:
    path = record_path(ctx, stage)
    write_json(path, record)
    return path


def read_record(ctx: Context, stage: str) -> dict[str, Any]:
    path = record_path(ctx, stage)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        shown = path.relative_to(ctx.repo) if path.is_relative_to(ctx.repo) else path
        raise MissingStageRecord(
            f"{shown} is missing: run `uv run prebuild --profile {ctx.profile} {stage}`"
        ) from None
    return json.loads(text)


def write_json(path: Path, value: object) -> None:
    """Write JSON so a reader sees the old file or the new one, never part of one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    partial.replace(path)
