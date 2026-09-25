"""Magics, sentinels and the layer order shared with the app, read from shared/constants.json."""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONSTANTS_PATH = REPO_ROOT / "shared" / "constants.json"

_constants = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))

FORMATS: dict[str, dict[str, str | int]] = _constants["formats"]
SENTINELS: dict[str, int] = _constants["sentinels"]
LAYERS: list[str] = _constants["layers"]
