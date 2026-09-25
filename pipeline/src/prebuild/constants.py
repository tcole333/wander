"""Magics, sentinels, the layer order and the cube table shared with the app, read from
shared/constants.json."""

import json
from typing import TypedDict

from prebuild.paths import REPO_ROOT

CONSTANTS_PATH = REPO_ROOT / "shared" / "constants.json"


class CubeFace(TypedDict):
    c: list[int]
    u: list[int]
    v: list[int]


class Cube(TypedDict):
    tile: int
    border: int
    earthRadiusM: float
    faces: list[CubeFace]


_constants = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))

FORMATS: dict[str, dict[str, str | int]] = _constants["formats"]
SENTINELS: dict[str, int] = _constants["sentinels"]
LAYERS: list[str] = _constants["layers"]
CUBE: Cube = _constants["cube"]
