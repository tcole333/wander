"""The YAML configs under `pipeline/config/`: the fixture's tiles and excerpts (streaming.md 7.3),
the water set (3.1), the regions that bound L5-L7 (7.1), and the event index's classes and
curated corrections (3.4)."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from prebuild.cube import Tile, parse_tile_key
from prebuild.paths import config_dir

CONFIG_DIR = config_dir()
EVENT_CLASSES = CONFIG_DIR / "event-classes.yaml"
EVENT_CURATED = CONFIG_DIR / "events-curated.yaml"
CURATED_KEYS = frozenset({"boosts", "dates", "contested", "places"})
ISO_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
SCALERANKS = range(13)  # NE river scalerank runs 0-12
_QID = re.compile(r"Q[1-9][0-9]*")
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


@dataclass(frozen=True)
class EventClass:
    """A class of the event index (event-classes.yaml): exported with its subclasses."""

    qid: str
    name: str
    weight: float


@dataclass(frozen=True)
class CuratedDays:
    """The days a better source gives an event (events-curated.yaml), ISO days as history writes
    them, Julian before 15 October 1582: the day it dates the event to, the day the event ends, or
    both."""

    date: str | None = None
    end: str | None = None


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


def load_event_classes(path: Path = EVENT_CLASSES) -> list[EventClass]:
    doc = _mapping(_load(path), path.name, {"classes"})
    classes = []
    for row in _list(doc["classes"], "classes"):
        fields = _mapping(row, f"{path.name} class", {"qid", "name", "weight"})
        name = _text(fields["name"], f"{path.name} class")
        classes.append(
            EventClass(
                qid=_qid(fields["qid"], f"class {name}"),
                name=name,
                weight=_positive_float(fields["weight"], f"class {name} weight"),
            )
        )
    for key in ("qid", "name"):
        if len({getattr(c, key) for c in classes}) != len(classes):
            raise ConfigError(f"{path.name} lists a class {key} twice")
    return classes


def load_event_boosts(path: Path = EVENT_CURATED, *, legacy: bool = False) -> dict[str, float]:
    """Percentile-point boosts, or the legacy table's separate log-score additions."""
    boosts: dict[str, float] = {}
    for row in _curated(path, "boosts"):
        fields = _mapping(row, f"{path.name} boost")
        if (
            set(fields) - {"qid", "boost", "legacyBoost", "why"}
            or not {"qid", "boost", "why"} <= fields.keys()
        ):
            raise ConfigError(f"{path.name} boost needs qid, boost, why and optional legacyBoost")
        qid = _qid(fields["qid"], f"{path.name} boost")
        _text(fields["why"], f"boost {qid} why")
        if qid in boosts:
            raise ConfigError(f"{path.name} boosts {qid} twice")
        boost = _number(fields["boost"], f"boost {qid}")
        legacy_boost = _number(fields.get("legacyBoost", 0), f"legacyBoost {qid}")
        boosts[qid] = legacy_boost if legacy else boost
    return boosts


def load_event_dates(path: Path = EVENT_CURATED) -> dict[str, CuratedDays]:
    """Curated days by event qid (events-curated.yaml): the date, the end or both a better source
    gives."""
    dates: dict[str, CuratedDays] = {}
    for row in _curated(path, "dates"):
        fields = _mapping(row, f"{path.name} date")
        days = fields.keys() & {"date", "end"}
        if fields.keys() - {"qid", "date", "end", "why"} or not {"qid", "why"} <= fields.keys():
            raise ConfigError(f"{path.name} date needs qid, why and a date, an end or both")
        qid = _qid(fields["qid"], f"{path.name} date")
        _text(fields["why"], f"date {qid} why")
        if not days:
            raise ConfigError(f"{path.name}: {qid} needs a date, an end or both")
        for key in days:
            if not isinstance(fields[key], str) or not ISO_DAY.fullmatch(fields[key]):
                raise ConfigError(f"{path.name}: {qid}'s {key} is a quoted ISO day, 'YYYY-MM-DD'")
        if qid in dates:
            raise ConfigError(f"{path.name} dates {qid} twice")
        dates[qid] = CuratedDays(fields.get("date"), fields.get("end"))
    return dates


def load_contested_events(path: Path = EVENT_CURATED) -> frozenset[str]:
    """The events whose date the sources dispute (events-curated.yaml), by qid."""
    contested: set[str] = set()
    for row in _curated(path, "contested"):
        fields = _mapping(row, f"{path.name} contested event", {"qid", "why"})
        qid = _qid(fields["qid"], f"{path.name} contested event")
        _text(fields["why"], f"contested {qid} why")
        contested.add(qid)
    return frozenset(contested)


def load_event_places(path: Path = EVENT_CURATED) -> dict[str, dict[str, tuple[float, float]]]:
    """Curated places by event qid, each position by its key: a located event's `place`, where a
    better source (`source: {title, url}`) puts it, standing in for its own coordinates and its
    location's; or, for an unlocated parent, a sourced P17 `countryCentroid`, then a last-resort
    override (`at`)."""
    places = {}
    for row in _curated(path, "places"):
        fields = _mapping(row, f"{path.name} place")
        if set(fields) - {"qid", "why", "countryCentroid", "at", "place", "source"}:
            raise ConfigError(f"{path.name}: unknown place field")
        qid = _qid(fields.get("qid"), "place")
        _text(fields.get("why"), f"place {qid} why")
        if qid in places:
            raise ConfigError(f"{path.name} places {qid} twice")
        if "place" in fields:
            if fields.keys() & {"countryCentroid", "at"}:
                raise ConfigError(f"place {qid} gives a place, which leaves no fallback to take")
            source = _mapping(fields.get("source"), f"place {qid} source", {"title", "url"})
            _text(source["title"], f"place {qid} source title")
            if not _text(source["url"], f"place {qid} source url").startswith("https://"):
                raise ConfigError(f"place {qid} source url is not https")
        elif "source" in fields:
            raise ConfigError(f"place {qid} cites a source for no place")
        positions = {}
        for key in ("place", "countryCentroid", "at"):
            if key not in fields:
                continue
            point = _list(fields[key], f"place {qid} {key}")
            if len(point) != 2:
                raise ConfigError(f"place {qid} {key} needs longitude and latitude")
            lon, lat = (_number(x, f"place {qid}") for x in point)
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ConfigError(f"place {qid} is outside Earth")
            positions[key] = (lon, lat)
        if not positions:
            raise ConfigError(f"place {qid} needs a place, a countryCentroid or an at")
        places[qid] = positions
    return places


def curated_places(
    places: dict[str, dict[str, tuple[float, float]]],
) -> dict[str, tuple[float, float]]:
    """The events a curated `place` puts elsewhere than Wikidata's coordinates, by qid."""
    return {qid: positions["place"] for qid, positions in places.items() if "place" in positions}


def _curated(path: Path, key: str) -> list[Any]:
    """One list of events-curated.yaml, empty when the file leaves it out."""
    doc = _mapping(_load(path), path.name)
    unknown = sorted(set(doc) - CURATED_KEYS)
    if unknown:
        raise ConfigError(f"{path.name}: unknown key {', '.join(unknown)}")
    return _list(doc.get(key, []), f"{path.name} {key}")


def _qid(value: Any, where: str) -> str:
    if not isinstance(value, str) or not _QID.fullmatch(value):
        raise ConfigError(f"{where}: {value!r} is not a Wikidata item id")
    return value


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
