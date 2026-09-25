"""The YAML configs under `pipeline/config/`: the fixture's tiles and excerpts (streaming.md 7.3),
the water set (3.1) and the regions that bound L5-L7 (7.1)."""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from prebuild.cube import Tile, parse_tile_key
from prebuild.paths import REPO_ROOT

CONFIG_DIR = REPO_ROOT / "pipeline" / "config"
SCALERANKS = range(13)  # NE river scalerank runs 0-12
_WATER_KEYS = (
    "halfWidthKm",
    "riversMaxScalerank",
    "riverClasses",
    "lakeClasses",
    "reservoirAllowlist",
)


class ConfigError(ValueError):
    """A config file does not hold what its format requires."""


@dataclass(frozen=True)
class FixtureConfig:
    """The fixture's tiles and, for each, the committed GEBCO excerpt its heights read."""

    excerpts: Mapping[str, int]  # excerpt name -> cell size in arc-seconds
    rasters: Mapping[Tile, str]  # tile -> excerpt name, in the order fixture.yaml lists them

    @property
    def tiles(self) -> list[Tile]:
        return list(self.rasters)

    def tiles_reading(self, excerpt: str) -> list[Tile]:
        return [tile for tile, name in self.rasters.items() if name == excerpt]


@dataclass(frozen=True)
class WaterConfig:
    """The rivers-and-lakes field's inputs (streaming.md 3.1, owner decision 13)."""

    half_width_km: Mapping[int, float]  # by river scalerank
    rivers_max_scalerank: Mapping[int, int]  # by level; levels not listed take every river
    river_classes: tuple[str, ...]
    lake_classes: tuple[str, ...]
    reservoir_allowlist: frozenset[int]  # NE ids of reservoirs that are natural lakes


@dataclass(frozen=True)
class Region:
    """A disc on the globe with a radius per level (l7.yaml, regions-milestone1.yaml)."""

    name: str
    lon: float
    lat: float
    radius_km: Mapping[int, float]


def load_fixture(path: Path = CONFIG_DIR / "fixture.yaml") -> FixtureConfig:
    doc = _mapping(_load(path), path.name, {"excerpts", "groups"})
    excerpts = {
        _text(name, path.name): _positive_int(cell, f"{path.name} excerpt {name}")
        for name, cell in _mapping(doc["excerpts"], "excerpts").items()
    }
    rasters: dict[Tile, str] = {}
    for group, entry in _mapping(doc["groups"], "groups").items():
        fields = _mapping(entry, f"group {group}", {"rasters", "tiles"})
        by_level = {
            _level(level, f"group {group}"): _text(name, f"group {group}")
            for level, name in _mapping(fields["rasters"], f"group {group} rasters").items()
        }
        for name in by_level.values():
            if name not in excerpts:
                raise ConfigError(f"group {group} reads {name}, which excerpts does not list")
        for tile in _expand_tiles(fields["tiles"], f"group {group}"):
            if tile in rasters:
                raise ConfigError(f"tile {tile.key()} is listed twice")
            if tile.level not in by_level:
                raise ConfigError(f"group {group} has no raster for level {tile.level}")
            rasters[tile] = by_level[tile.level]
    for tile in rasters:
        if tile.level > 0 and tile.parent() not in rasters:
            raise ConfigError(f"tile {tile.key()} is listed without its parent")
    unread = sorted(set(excerpts) - set(rasters.values()))
    if unread:
        raise ConfigError(f"no tile reads {', '.join(unread)}")
    return FixtureConfig(excerpts=excerpts, rasters=rasters)


def load_water(path: Path = CONFIG_DIR / "water.yaml") -> WaterConfig:
    doc = _mapping(_load(path), path.name, set(_WATER_KEYS))
    half_width = {
        _level(rank, "halfWidthKm"): _positive_float(km, f"halfWidthKm {rank}")
        for rank, km in _mapping(doc["halfWidthKm"], "halfWidthKm").items()
    }
    if sorted(half_width) != list(SCALERANKS):
        raise ConfigError(f"halfWidthKm needs scaleranks {SCALERANKS.start}-{SCALERANKS.stop - 1}")
    rivers_max = {
        _level(level, "riversMaxScalerank"): _level(rank, "riversMaxScalerank")
        for level, rank in _mapping(doc["riversMaxScalerank"], "riversMaxScalerank").items()
    }
    allowlist: list[int] = []
    for row in _list(doc["reservoirAllowlist"], "reservoirAllowlist"):
        fields = _mapping(row, "reservoirAllowlist entry", {"ne_id", "name"})
        allowlist.append(_positive_int(fields["ne_id"], f"reservoir {fields['name']}"))
    if len(allowlist) != len(set(allowlist)):
        raise ConfigError("reservoirAllowlist lists an ne_id twice")
    return WaterConfig(
        half_width_km=half_width,
        rivers_max_scalerank=rivers_max,
        river_classes=tuple(_text(c, "riverClasses") for c in _list(doc["riverClasses"], "")),
        lake_classes=tuple(_text(c, "lakeClasses") for c in _list(doc["lakeClasses"], "")),
        reservoir_allowlist=frozenset(allowlist),
    )


def load_regions(path: Path) -> list[Region]:
    regions = []
    for row in _list(_load(path), path.name):
        fields = _mapping(row, f"{path.name} region", {"name", "lon", "lat", "radiusKm"})
        name = _text(fields["name"], f"{path.name} region")
        lon, lat = _number(fields["lon"], name), _number(fields["lat"], name)
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ConfigError(f"region {name} is not at a lon/lat")
        radius = {
            _level(level, name): _positive_float(km, f"region {name} radius")
            for level, km in _mapping(fields["radiusKm"], f"region {name} radiusKm").items()
        }
        regions.append(Region(name=name, lon=lon, lat=lat, radius_km=radius))
    if len({r.name for r in regions}) != len(regions):
        raise ConfigError(f"{path.name} names a region twice")
    return regions


def _expand_tiles(value: Any, where: str) -> list[Tile]:
    tiles: list[Tile] = []
    for item in _list(value, where):
        key = _text(item, where)
        if key.startswith("all-L"):
            level = _level(key.removeprefix("all-L"), where)
            side = range(1 << level)
            tiles += [Tile(face, level, x, y) for face in range(6) for y in side for x in side]
        else:
            try:
                tiles.append(parse_tile_key(key))
            except ValueError as error:
                raise ConfigError(f"{where}: {error}") from None
    return tiles


def _load(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def _mapping(value: Any, where: str, keys: set[str] | None = None) -> dict[Any, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{where} is not a mapping")
    if keys is not None and set(value) != keys:
        raise ConfigError(f"{where} needs exactly the keys {', '.join(sorted(keys))}")
    return value


def _list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list):
        raise ConfigError(f"{where} is not a list")
    return value


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{where}: {value!r} is not a name")
    return value


def _level(value: Any, where: str) -> int:
    level = int(value) if isinstance(value, str) and value.isdigit() else value
    if not isinstance(level, int) or isinstance(level, bool) or level < 0:
        raise ConfigError(f"{where}: {value!r} is not a level or rank")
    return level


def _number(value: Any, where: str) -> float:
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise ConfigError(f"{where}: {value!r} is not a number")
    return float(value)


def _positive_float(value: Any, where: str) -> float:
    number = _number(value, where)
    if number <= 0:
        raise ConfigError(f"{where}: {value!r} is not positive")
    return number


def _positive_int(value: Any, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ConfigError(f"{where}: {value!r} is not a positive integer")
    return value
