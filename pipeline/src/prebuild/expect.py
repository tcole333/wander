"""Test sidecars of the fixture build (streaming.md 7.3): expected values in
build/stages/fixture/expect/ and the stamp that tells the Vitest fixture loader the build is fresh.
"""

import itertools
import json
import math
from pathlib import Path
from typing import Any

from prebuild.cube import (
    TILE,
    Tile,
    face_of,
    face_st,
    lonlat_to_dir,
    node_index,
    st_to_dir,
    texel_center,
    texel_of,
    tile_of,
)
from prebuild.hashing import FIXTURE_PATHS, tree_sha
from prebuild.profiles import Context, Profile
from prebuild.records import write_json

SUMBAWA = (118.0, -8.25)
TAMBORA_SUMMIT = (117.9604, -8.2479)  # the GEBCO maximum on the rim
KIRKUK_VERTEX = (45.0, math.degrees(math.atan(math.sqrt(0.5))))  # where faces 0, 1 and 4 meet
LEVELS = range(8)


def stamp_path(ctx: Context) -> Path:
    return ctx.stages_dir / "stamp.json"


def clear_stamp(ctx: Context) -> None:
    stamp_path(ctx).unlink(missing_ok=True)


def write_expectations(ctx: Context) -> None:
    """Write the sidecars, then the stamp over FIXTURE_PATHS; runs last in a full fixture build."""
    if ctx.profile is not Profile.FIXTURE:
        raise ValueError(f"test sidecars belong to the fixture build, not {ctx.profile}")
    ctx.out.mkdir(parents=True, exist_ok=True)
    expect = ctx.stages_dir / "expect"
    expect.mkdir(parents=True, exist_ok=True)
    samples = [cube_sample(lon, lat, level) for lon, lat, level in sample_points()]
    (expect / "cube-samples.json").write_text(_json_rows(samples), encoding="utf-8")
    stamp = {"inputs": tree_sha(FIXTURE_PATHS, ctx.repo), "paths": list(FIXTURE_PATHS)}
    write_json(stamp_path(ctx), stamp)


def sample_points() -> list[tuple[float, float, int]]:
    """(lon, lat, level) points for the cube cross-check (streaming.md 3.0 item 9)."""
    grid = [
        (-180 + 7.5 * k, -90 + 5.0 * m, (k + m) % 8)
        for k, m in itertools.product(range(48), range(37))
    ]
    kirkuk = [
        (KIRKUK_VERTEX[0] + d_lon, KIRKUK_VERTEX[1] + d_lat)
        for d_lon, d_lat in itertools.product((-1e-4, 1e-4), repeat=2)
    ]
    dateline = list(itertools.product((-180.0, 180.0, 179.9999), (-30.0, 0.0, 30.0)))
    named = [SUMBAWA, TAMBORA_SUMMIT, *kirkuk, *dateline]
    return grid + [(lon, lat, level) for level in LEVELS for lon, lat in named]


def cube_sample(lon: float, lat: float, level: int) -> dict[str, Any]:
    p = lonlat_to_dir(lon, lat)
    face = int(face_of(p))
    s, t = face_st(face, p)
    x, y = int(tile_of(s, level)), int(tile_of(t, level))
    i, j = int(texel_of(s, level, x)), int(texel_of(t, level, y))
    center = st_to_dir(face, texel_center(level, TILE * x + i), texel_center(level, TILE * y + j))
    return {
        "lon": lon,
        "lat": lat,
        "L": level,
        "f": face,
        "x": x,
        "y": y,
        "node": node_index(Tile(face, level, x, y)),
        "s": float(s),
        "t": float(t),
        "i": i,
        "j": j,
        "center": [float(v) for v in center],
    }


def _json_rows(rows: list[dict[str, Any]]) -> str:
    """A JSON array with one row per line; floats in shortest round-trip form."""
    return "[\n" + ",\n".join(json.dumps(row) for row in rows) + "\n]\n"
