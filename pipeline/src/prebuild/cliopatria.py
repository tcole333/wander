"""The borders' selection from Cliopatria (streaming.md 3.0 and 3.3, owner decisions 33-37): which
polities each border step draws, how they nest into outer units, and the land no state held.

Cliopatria v0.2.0 (`sources.toml`) gives each polity's shape in rows valid from one year to
another. It writes years before 1 CE as negative years BCE, so its -n is astronomical 1 - n, and its
0, the last year of six rows each followed by rows starting at 1, is 1 BCE, astronomical 0. Every
year here is astronomical.

- **Steps** begin in every change year up to 2000: a POLITY or vassalage row's first year or the
  year after its last, and a correction's. A step whose rows and corrections equal the one before
  is dropped.
- **Leaves** are the POLITY rows valid in a step's year whose names are not in parentheses, the
  composites' form, after the cited corrections in `pipeline/config/borders/<era>.yaml`.
- **Outer units:** a composite's members are its `Components`, then, for a row no valid composite
  lists, the valid composites its `MemberOf` names; a vassal joins its paramount when
  `hierarchy.yaml` marks the relation a membership. A leaf's outer unit is the root among the
  empires above it, and a leaf that reaches two roots fails its step. A composite `hierarchy.yaml`
  does not class keeps its members apart, as a grouping's, and a relation it does not class makes
  no member; the step lists both as unclassified. A composite's land that no polity row holds, when
  at least `leftoverKm2`, is drawn under the composite's own name, in the composite's root.
- **Overlaps:** of two drawn polities that overlap, the smaller keeps the land they share, unless an
  `overlap` correction names the other. Pairs sharing more than `reviewKm2` go to the review
  queue, and those sharing more than `duplicateShare` of the larger need an `overlap` correction:
  a step lists the pairs without one.
- **Stateless land** is Natural Earth land less its drawn lakes and every polity, under one id.
  Lakes stay empty, so the bake's fill splits each among its neighbours. A stateless piece that
  touches the sea loses its parts narrower than 2·`sliverKm` to the polity nearest them (an opening
  on an equal-area projection about the piece). One that does not, a hole in the polities, is
  filled as the land of the state around it when the drawn land it touches is all one outer unit's
  (owner decision 38): the bake fills it from that state's land alone, since across a lake another
  state's can lie nearer. One between states goes to its neighbours when it touches a lake and is
  under `pocketKm2`, or when it is narrower than 2·`sliverKm` throughout: the bake fills such a
  pocket that touches a polity from the polities alone, since across a lake stateless land can lie
  nearer. Other holes between states stay stateless, since they may be real stateless enclaves; a
  `pocket` correction overrides the rules, for a coastal piece too, and is how a place really
  without a state inside one stays stateless, how one between states is cited as stateless, and
  how a gap in Cliopatria's shapes is drawn as the land of the state that held it.
- **Carried through:** land one polity draws in the steps on both sides of a stateless run of at
  most GAP_YEARS is drawn as that polity's through the run (owner decision 38), in its shape of the
  step before as far as the step after holds it, which is how a row Cliopatria drops for a while
  shows. Every step is selected without it first (`Plain`), and `carry_through` reads those in year
  order; a step the rule reaches is selected again with the land it carries, as its polity's, under
  that polity's outer unit where the step draws it and else the unit both sides draw it in. Land a
  stateless `pocket` keeps in any step of the run is not carried, nor land held on the two sides by
  different polities: those stay as the rules leave them.
- **The antimeridian:** Cliopatria's shapes stop at ±180°, so land just across it that no polity
  holds goes to the polity whose shape runs along the other side at the same latitudes: otherwise
  Chukotka east of the meridian is stateless from 1778 and a border runs down it.
- **Size tier:** each outer unit's drawn land splits into connected pieces, and a piece under
  `minorKm2` is minor: its borders with other outer units draw in the inner plane (owner decision
  36).

Polity ids number the sorted names of every POLITY row and every name a correction draws, from 2;
stateless land is 1 and 0 means none. The fixture reads the committed excerpt, the POLITY rows
valid in its two years, and selects only those years.

    uv run python -m prebuild.cliopatria [--profile global|region|fixture] [--jobs N]

selects every step, twice where the carry-through reaches it, and writes the review queue
`build/stages/<profile>/borders-review.json`: the steps that fail and the corrections that leave a
step unchanged, the unclassified composites and relations, the members whose composite is not
valid, the overlap pairs, the names that vanish and return, and each step's leftovers, pockets
given by rule (a hole filled as its state's names the state), land carried through and enclosed
stateless pieces kept with the outer units around them, and the leaves it draws that no valid row
gives it or that a valid row gives it and it does not draw, naming those neither a correction
names nor the carry-through draws; and what the steps owe the history pass (owner decision 38),
which publish-data refuses: each stateless hole of OWED_KM2 or more no correction cites, and each
gap, land held on both sides of a stateless run of at most GAP_YEARS that the carry-through leaves
stateless, as each step's stateless land on a CELL_DEG grid shows it. It exits 1 when a step fails
or a correction leaves a step unchanged, after writing the queue.
"""

import argparse
import base64
import gzip
import hashlib
import itertools
import json
import math
import multiprocessing
import os
import re
import struct
import sys
import tempfile
import time
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pyogrio.raw
import shapely
import shapely.affinity
import yaml
from scipy import ndimage

from prebuild.config import ConfigError, load_water
from prebuild.natural_earth import (
    ZIPS,
    lakes,
    land,
    parse_records,
    parts_of_dimension,
    read_excerpt_layer,
    read_zip_layer,
    records,
)
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context, Profile, default_jobs, make_context
from prebuild.records import write_json
from prebuild.sources import SourceUnavailable, verified_path

SOURCE = "cliopatria"  # the source id in sources.toml
ZIP = "cliopatria.geojson.zip"
MEMBER = "cliopatria_polities_only.geojson"  # the layer inside the zip
EXCERPT = "cliopatria"  # the fixture's folder under pipeline/tests/data
EXCERPT_FILE = "polities.geojson.gz"
EXCERPT_META = "polities.json"
EXCERPT_YEARS = (1815, 1830)  # the fixture's two steps
CONFIG = "borders"  # the folder under pipeline/config
HIERARCHY = "hierarchy.yaml"
RULES = "rules.yaml"
# The era files and the years a correction in each may start in.
ERAS: dict[str, tuple[int | None, int | None]] = {
    "bce": (None, 0),
    "0001-0999": (1, 999),
    "1000-1499": (1000, 1499),
    "1500-1799": (1500, 1799),
    "1800-1913": (1800, 1913),
    "1914-2000": (1914, 2000),
}
LAST_YEAR = 2000  # steps begin up to this year
STATELESS = ""  # the key of land no state held
STATELESS_ID = 1
MAX_ID = 0xFFFD  # real ids run 1..0xFFFD (streaming.md 3.0)
COLUMNS = ("Name", "FromYear", "ToYear", "Type", "Wikidata", "Components", "MemberOf")
VASSALAGE = re.compile(r"\(Vassalage of (.+) to (.+)\)")
EARTH_KM = 6371.0
TOUCH_DEG = 1e-6  # a stateless piece this close to the coast or a lake touches it
PIECE_GAP_DEG = 0.01  # parts of one outer unit this close are one piece
OPENING_TOLERANCE_KM = 2.0  # the stateless openings simplify coasts this far
POLE_LAT = 89.9  # a stateless piece reaching this far north or south is never opened
LARGE_POCKET_KM2 = 1000  # the review queue lists pockets this large one by one, and counts the rest
SEAM_DEG = 1e-6  # a shape this close to ±180° runs along the antimeridian
SEAM_REACH_DEG = 20.0  # land across the antimeridian goes to the polity there when within this
REVIEW = "borders-review.json"
# Land one polity holds in the steps on both sides of a stateless run of at most GAP_YEARS is
# carried through it, which is how a row Cliopatria drops for a while shows. The history pass owes
# a cited verdict (owner decision 38) for each stateless hole this large, and for each gap this
# large the carry-through leaves: land held on both sides of such a run by two polities, as
# Prussia's was in 1864-70, between Cliopatria's German Confederation and German Empire. Land
# stateless for longer is more often a state's real end, which decision 35 leaves blank.
OWED_KM2 = 10_000
GAP_YEARS = 25
CELL_DEG = 0.5  # the grid each step records its stateless land on, for the gaps
PLAIN_VERTICES = 1024  # the most vertices of a piece of the stateless land the carry-through reads


class SelectionError(ValueError):
    """Cliopatria, the hierarchy or a correction do not give a step the selection can draw."""


# Cliopatria -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Row:
    """One Cliopatria row: a polity's shape over a span of years, or a relation between polities."""

    name: str
    first: int  # astronomical
    last: int
    polity: bool  # a POLITY row; else a RELATION
    wikidata: str
    components: tuple[str, ...]
    member_of: tuple[str, ...]
    geometry: shapely.Geometry  # valid polygons, lon/lat
    km2: float
    digest: str  # of its name, links and shape, so equal rows compare equal

    @property
    def composite(self) -> bool:
        return self.name.startswith("(")

    def holds(self, year: int) -> bool:
        return self.first <= year <= self.last


@dataclass(frozen=True)
class Cliopatria:
    rows: tuple[Row, ...]
    years: tuple[int, ...] | None  # the fixture excerpt's years, the only ones it can select

    def at(self, name: str, year: int) -> Row | None:
        """The POLITY row of that name valid in that year; Cliopatria holds at most one."""
        return next((r for r in self.rows if r.polity and r.name == name and r.holds(year)), None)


def astronomical(year: int) -> int:
    """A Cliopatria year as an astronomical one: its -n is n BCE, 1 - n, and its 0 is 1 BCE."""
    return year + 1 if year < 0 else year


def km2(geometry: Any) -> Any:
    """Area on a Lambert cylindrical equal-area projection, km²; elementwise over an array."""

    def project(xy: np.ndarray) -> np.ndarray:
        lon, lat = np.radians(xy[:, 0]), np.radians(np.clip(xy[:, 1], -90, 90))
        return np.column_stack([lon * EARTH_KM, np.sin(lat) * EARTH_KM])

    area = shapely.area(shapely.transform(geometry, project))
    return float(area) if np.ndim(area) == 0 else area


def polygons(geometry: shapely.Geometry) -> shapely.Geometry:
    """The polygons of a geometry `make_valid` may have made mixed, as one MultiPolygon."""
    return shapely.multipolygons(parts_of_dimension(shapely.make_valid(geometry), 2))


def make_row(
    name: str,
    first: int,
    last: int,
    geometry: shapely.Geometry,
    *,
    polity: bool = True,
    wikidata: str = "",
    components: Sequence[str] = (),
    member_of: Sequence[str] = (),
) -> Row:
    """A row from its fields, years astronomical, its shape made valid polygons."""
    shape = polygons(geometry)
    digest = hashlib.sha256(
        "\n".join([name, ";".join(components), ";".join(member_of)]).encode()
        + shapely.to_wkb(shape, byte_order=1)
    ).hexdigest()
    return Row(
        name=name,
        first=first,
        last=last,
        polity=polity,
        wikidata=wikidata,
        components=tuple(components),
        member_of=tuple(member_of),
        geometry=shape,
        km2=km2(shape),
        digest=digest,
    )


def read_rows(path: str) -> list[Row]:
    """Every row of a Cliopatria GeoJSON that GDAL reads at `path` (a `/vsizip/` or `/vsigzip/`
    path), in source order."""
    meta, _, wkb, fields = pyogrio.raw.read(path, read_geometry=True, columns=list(COLUMNS))
    columns = dict(zip((str(name) for name in meta["fields"]), fields, strict=True))
    return [
        make_row(
            _field(columns["Name"][k]),
            astronomical(int(columns["FromYear"][k])),
            astronomical(int(columns["ToYear"][k])),
            geometry,
            polity=_field(columns["Type"][k]) == "POLITY",
            wikidata=_field(columns["Wikidata"][k]),
            components=_names(columns["Components"][k]),
            member_of=_names(columns["MemberOf"][k]),
        )
        for k, geometry in enumerate(shapely.from_wkb(wkb))
    ]


def load_cliopatria(ctx: Context) -> Cliopatria:
    """The pinned zip's rows, or for the fixture the committed excerpt's and its years."""
    if ctx.profile is Profile.FIXTURE:
        folder = excerpts_dir(ctx.repo) / EXCERPT
        meta = json.loads((folder / EXCERPT_META).read_text(encoding="utf-8"))
        if meta["source"] != SOURCE:
            raise SourceUnavailable(
                "the fixture names another source: run `uv run prebuild excerpts`"
            )
        rows = read_rows(f"/vsigzip/{folder / EXCERPT_FILE}")
        return Cliopatria(tuple(rows), tuple(int(y) for y in meta["years"]))
    path = verified_path(ctx, SOURCE, ZIP)
    return Cliopatria(tuple(read_rows(f"/vsizip/{path}/{MEMBER}")), None)


def _field(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _names(value: Any) -> tuple[str, ...]:
    return tuple(name.strip() for name in _field(value).split(";") if name.strip())


# Config ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Citation:
    why: str
    source: Mapping[str, str] | None  # title, publisher, url[, locator]


@dataclass(frozen=True)
class Hierarchy:
    composites: Mapping[str, str]  # composite -> "empire" | "grouping"
    relations: Mapping[str, bool]  # vassalage relation -> whether the vassal is a member
    citations: Mapping[str, Citation]


@dataclass(frozen=True)
class Rules:
    minor_km2: float
    leftover_km2: float
    sliver_km: float
    pocket_km2: float
    review_km2: float
    duplicate_share: float


@dataclass(frozen=True)
class Give:
    """Moves a polity's land, all of it, the part holding `at`, or the part inside another
    polity's shape in another year, to a polity, drawn already or new, optionally as a member."""

    polity: str
    to: str
    at: tuple[float, float] | None = None
    shape_from: tuple[str, int] | None = None
    member_of: str | None = None


@dataclass(frozen=True)
class Carry:
    """Draws a polity with its shape in another year where Cliopatria has no row of it."""

    polity: str
    year: int


@dataclass(frozen=True)
class Add:
    """Draws a cited shape as a polity, new or joined to one drawn, optionally as a member."""

    polity: str
    shape: shapely.Geometry
    wikidata: str = ""
    member_of: str | None = None


@dataclass(frozen=True)
class Member:
    """Makes a polity or composite a member of another."""

    polity: str
    of: str


@dataclass(frozen=True)
class Drop:
    """Takes away a polity's pieces that lie wholly inside a cited shape, as scraps its rows carry:
    another polity holding the land keeps it, and the rest is left to the stateless rules."""

    polity: str
    shape: shapely.Geometry


@dataclass(frozen=True)
class Rename:
    polity: str
    to: str


@dataclass(frozen=True)
class Pocket:
    """The stateless piece holding `at`, enclosed or on a coast, stays stateless whole, as a place
    really without a state does even inside one, or goes to its neighbours; or, with `to`, it is
    that polity's land, all of it or its part inside another polity's shape in another year or
    inside a cited shape."""

    at: tuple[float, float]
    stateless: bool = False
    to: str | None = None
    shape_from: tuple[str, int] | None = None
    shape: shapely.Geometry | None = None


@dataclass(frozen=True)
class Overlap:
    """Which of two overlapping polities keeps the land they share."""

    polities: tuple[str, str]
    winner: str


type Operation = Give | Carry | Add | Drop | Member | Rename | Pocket | Overlap

OPERATIONS: dict[str, type] = {
    "give": Give,
    "carry": Carry,
    "add": Add,
    "drop": Drop,
    "member": Member,
    "rename": Rename,
    "pocket": Pocket,
    "overlap": Overlap,
}


@dataclass(frozen=True)
class Correction:
    era: str
    number: int  # its place in the era's file, from 1
    years: tuple[int, int]
    why: str
    source: Mapping[str, str] | None  # only a smaller-wins `overlap` may go without
    op: Operation

    def label(self) -> str:
        kind = next(key for key, cls in OPERATIONS.items() if isinstance(self.op, cls))
        return f"{self.era}.yaml correction {self.number} ({kind}, {self.years[0]}-{self.years[1]})"


@dataclass(frozen=True)
class Config:
    hierarchy: Hierarchy
    rules: Rules
    corrections: tuple[Correction, ...]  # in era order, then file order
    modified: Mapping[str, str]  # each file's `modified` date, keyed by file name


def load_config(folder: Path | None = None) -> Config:
    """`pipeline/config/borders/`: the hierarchy, the rules and the era correction files. A file
    other than these, or a key the format does not name, fails."""
    folder = config_dir() / CONFIG if folder is None else folder
    known = {HIERARCHY, RULES, *(f"{era}.yaml" for era in ERAS)}
    stray = sorted(p.name for p in folder.glob("*.yaml") if p.name not in known)
    if stray:
        raise ConfigError(f"{folder.name}/ holds files the borders do not read: {', '.join(stray)}")
    modified: dict[str, str] = {}
    hierarchy_doc = _yaml(folder / HIERARCHY, {"modified", "composites", "relations"})
    modified[HIERARCHY] = str(hierarchy_doc["modified"])
    hierarchy = load_hierarchy(hierarchy_doc)
    rules = load_rules(_yaml(folder / RULES, set(_RULE_KEYS)))
    corrections: list[Correction] = []
    for era in ERAS:
        path = folder / f"{era}.yaml"
        if not path.is_file():
            continue
        doc = _yaml(path, {"modified", "corrections"})
        modified[path.name] = str(doc["modified"])
        rows = doc["corrections"] or []
        if not isinstance(rows, list):
            raise ConfigError(f"{path.name}: corrections is not a list")
        corrections += [load_correction(row, era, k + 1, folder) for k, row in enumerate(rows)]
    return Config(hierarchy, rules, tuple(corrections), modified)


_RULE_KEYS = {
    "minorKm2": "minor_km2",
    "leftoverKm2": "leftover_km2",
    "sliverKm": "sliver_km",
    "pocketKm2": "pocket_km2",
    "reviewKm2": "review_km2",
    "duplicateShare": "duplicate_share",
}


def load_rules(doc: Mapping[str, Any]) -> Rules:
    values = {}
    for key, name in _RULE_KEYS.items():
        value = doc[key]
        if not isinstance(value, int | float) or isinstance(value, bool) or value <= 0:
            raise ConfigError(f"{RULES}: {key} is not a positive number")
        values[name] = float(value)
    if values["duplicate_share"] > 1:
        raise ConfigError(f"{RULES}: duplicateShare is a share of the larger polity, at most 1")
    return Rules(**values)


def load_hierarchy(doc: Mapping[str, Any]) -> Hierarchy:
    composites: dict[str, str] = {}
    relations: dict[str, bool] = {}
    citations: dict[str, Citation] = {}
    for name, entry in _entries(doc["composites"], "composites"):
        if not name.startswith("("):
            raise ConfigError(f"{HIERARCHY}: {name} is no composite's name")
        _keys(entry, {"kind", "why", "source"}, set(), name)
        if entry["kind"] not in ("empire", "grouping"):
            raise ConfigError(f"{HIERARCHY}: {name}'s kind is empire or grouping")
        composites[name] = entry["kind"]
        citations[name] = Citation(_why(entry, name), _source(entry["source"], name))
    for name, entry in _entries(doc["relations"], "relations"):
        if not VASSALAGE.fullmatch(name):
            raise ConfigError(f"{HIERARCHY}: {name} is no vassalage relation")
        _keys(entry, {"member", "why", "source"}, set(), name)
        if not isinstance(entry["member"], bool):
            raise ConfigError(f"{HIERARCHY}: {name}'s member is true or false")
        relations[name] = entry["member"]
        citations[name] = Citation(_why(entry, name), _source(entry["source"], name))
    return Hierarchy(composites, relations, citations)


def load_correction(row: Any, era: str, number: int, folder: Path) -> Correction:
    where = f"{era}.yaml correction {number}"
    if not isinstance(row, dict):
        raise ConfigError(f"{where} is not a mapping")
    kinds = [key for key in row if key in OPERATIONS]
    if len(kinds) != 1:
        raise ConfigError(f"{where} needs one operation of {', '.join(OPERATIONS)}")
    kind = kinds[0]
    _keys(row, {"years", "why", kind}, {"source"}, where)
    years = row["years"]
    if (
        not isinstance(years, list)
        or len(years) != 2
        or not all(isinstance(y, int) and not isinstance(y, bool) for y in years)
        or years[0] > years[1]
    ):
        raise ConfigError(f"{where}: years is [from, to], astronomical, from <= to")
    low, high = ERAS[era]
    if (low is not None and years[0] < low) or (high is not None and years[0] > high):
        raise ConfigError(f"{where} starts in {years[0]}, outside its era's file")
    if years[1] > LAST_YEAR:
        raise ConfigError(f"{where} runs past {LAST_YEAR}, the last step")
    source = _source(row["source"], where) if "source" in row else None
    op = _operation(kind, row[kind], where, folder)
    if source is None and not isinstance(op, Overlap):
        raise ConfigError(f"{where} needs a source")
    return Correction(era, number, (years[0], years[1]), _why(row, where), source, op)


def _operation(kind: str, value: Any, where: str, folder: Path) -> Operation:
    if not isinstance(value, dict):
        raise ConfigError(f"{where}: {kind} is not a mapping")
    if kind == "give":
        _keys(value, {"polity", "to"}, {"at", "shape_from", "member_of"}, where)
        if "at" in value and "shape_from" in value:
            raise ConfigError(f"{where}: give takes at or shape_from, not both")
        return Give(
            polity=_name(value["polity"], where),
            to=_name(value["to"], where),
            at=_point(value["at"], where) if "at" in value else None,
            shape_from=_shape_from(value["shape_from"], where) if "shape_from" in value else None,
            member_of=_name(value["member_of"], where) if "member_of" in value else None,
        )
    if kind == "carry":
        _keys(value, {"polity", "from"}, set(), where)
        return Carry(_name(value["polity"], where), _year(value["from"], where))
    if kind == "add":
        _keys(value, {"polity", "shape"}, {"wikidata", "member_of"}, where)
        return Add(
            polity=_name(value["polity"], where),
            shape=_shape(folder / _name(value["shape"], where), where),
            wikidata=str(value.get("wikidata", "")),
            member_of=_name(value["member_of"], where) if "member_of" in value else None,
        )
    if kind == "drop":
        _keys(value, {"polity", "shape"}, set(), where)
        return Drop(
            polity=_name(value["polity"], where),
            shape=_shape(folder / _name(value["shape"], where), where),
        )
    if kind == "member":
        _keys(value, {"polity", "of"}, set(), where)
        return Member(_name(value["polity"], where), _name(value["of"], where))
    if kind == "rename":
        _keys(value, {"polity", "to"}, set(), where)
        return Rename(_name(value["polity"], where), _name(value["to"], where))
    if kind == "pocket":
        _keys(value, {"at"}, {"stateless", "to", "shape_from", "shape"}, where)
        if ("stateless" in value) == ("to" in value):
            raise ConfigError(f"{where}: pocket takes stateless or to")
        if "shape_from" in value and "shape" in value:
            raise ConfigError(f"{where}: pocket takes shape_from or shape, not both")
        if "stateless" in value:
            if "shape_from" in value or "shape" in value:
                raise ConfigError(f"{where}: pocket takes shape_from or shape only with to")
            if not isinstance(value["stateless"], bool):
                raise ConfigError(f"{where}: pocket's stateless is true or false")
            return Pocket(_point(value["at"], where), value["stateless"])
        return Pocket(
            _point(value["at"], where),
            to=_name(value["to"], where),
            shape_from=_shape_from(value["shape_from"], where) if "shape_from" in value else None,
            shape=_shape(folder / _name(value["shape"], where), where)
            if "shape" in value
            else None,
        )
    _keys(value, {"polities", "winner"}, set(), where)
    pair = value["polities"]
    if not isinstance(pair, list) or len(pair) != 2 or pair[0] == pair[1]:
        raise ConfigError(f"{where}: overlap's polities are two names")
    winner = _name(value["winner"], where)
    if winner not in pair:
        raise ConfigError(f"{where}: overlap's winner is one of its polities")
    return Overlap((_name(pair[0], where), _name(pair[1], where)), winner)


def _yaml(path: Path, keys: set[str]) -> dict[str, Any]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or set(doc) != keys:
        raise ConfigError(f"{path.name} needs exactly the keys {', '.join(sorted(keys))}")
    return doc


def _entries(value: Any, where: str) -> Iterable[tuple[str, dict[str, Any]]]:
    if value is None:
        return []
    if not isinstance(value, dict):
        raise ConfigError(f"{HIERARCHY}: {where} is not a mapping")
    return value.items()


def _keys(value: Mapping[str, Any], required: set[str], optional: set[str], where: str) -> None:
    if not isinstance(value, dict) or not required <= set(value) <= required | optional:
        wanted = ", ".join([*sorted(required), *(f"[{key}]" for key in sorted(optional))])
        raise ConfigError(f"{where} needs {wanted}")


def _why(value: Mapping[str, Any], where: str) -> str:
    why = " ".join(str(value["why"] or "").split())
    if not why:
        raise ConfigError(f"{where} needs a why")
    return why


def _source(value: Any, where: str) -> dict[str, str]:
    required, optional = {"title", "publisher", "url"}, {"locator"}
    if not isinstance(value, dict):
        raise ConfigError(f"{where}'s source needs title, publisher, url[, locator]")
    _keys(value, required, optional, f"{where}'s source")
    return {key: str(value[key]) for key in value}


def _name(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where}: {value!r} is not a name")
    return value.strip()


def _year(value: Any, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ConfigError(f"{where}: {value!r} is not a year")
    return value


def _shape_from(value: Any, where: str) -> tuple[str, int]:
    if not isinstance(value, dict):
        raise ConfigError(f"{where}: shape_from is {{polity, year}}")
    _keys(value, {"polity", "year"}, set(), where)
    return (_name(value["polity"], where), _year(value["year"], where))


def _point(value: Any, where: str) -> tuple[float, float]:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or not all(isinstance(v, int | float) and not isinstance(v, bool) for v in value)
    ):
        raise ConfigError(f"{where}: at is [lon, lat]")
    return (float(value[0]), float(value[1]))


def _shape(path: Path, where: str) -> shapely.Geometry:
    """A GeoJSON geometry, Feature or FeatureCollection's polygons, as one MultiPolygon."""
    if not path.is_file():
        raise ConfigError(f"{where}: no shape file {path.name}")
    doc = json.loads(path.read_text(encoding="utf-8"))
    geometries = (
        [f["geometry"] for f in doc["features"]]
        if doc.get("type") == "FeatureCollection"
        else [doc["geometry"]]
        if doc.get("type") == "Feature"
        else [doc]
    )
    shape = polygons(shapely.union_all([shapely.from_geojson(json.dumps(g)) for g in geometries]))
    if shapely.is_empty(shape):
        raise ConfigError(f"{where}: {path.name} holds no polygon")
    return shape


# Terrain ---------------------------------------------------------------------------------------


@dataclass
class Terrain:
    """Natural Earth land, the lakes that draw, the land less those lakes, and trees to test what a
    stateless piece touches."""

    land: shapely.Geometry
    lakes: shapely.Geometry
    dry: shapely.Geometry
    coast: shapely.STRtree = field(init=False)
    lake_tree: shapely.STRtree = field(init=False)

    def __post_init__(self) -> None:
        self.coast = shapely.STRtree(_chunks(shapely.get_rings(shapely.get_parts(self.land))))
        self.lake_tree = shapely.STRtree(parts_of_dimension(self.lakes, 2))

    @classmethod
    def of(cls, land: shapely.Geometry, lakes: shapely.Geometry) -> Terrain:
        return cls(land, lakes, shapely.difference(land, lakes))

    def to_wkb(self) -> bytes:
        return records(np.array([self.land, self.lakes, self.dry], dtype=object))

    @classmethod
    def from_wkb(cls, data: bytes) -> Terrain:
        return cls(*parse_records(data))


def load_terrain(ctx: Context) -> Terrain:
    """The land with the minor islands and the lakes that draw (water.yaml), from the zips, or for
    the fixture from the committed excerpts, prepared as the shore and water fields prepare them."""
    names = ("land", "minor_islands", "lakes")
    if ctx.profile is Profile.FIXTURE:
        folder = excerpts_dir(ctx.repo) / "ne"
        layers = {name: read_excerpt_layer(folder, name) for name in names}
    else:
        layers = {name: read_zip_layer(verified_path(ctx, *ZIPS[name])) for name in names}
    water = load_water(config_dir(ctx.repo) / "water.yaml")
    return Terrain.of(land(layers["land"], layers["minor_islands"]), lakes(layers["lakes"], water))


def _chunks(rings: np.ndarray, size: int = 256) -> list[shapely.LineString]:
    """The rings as lines of at most `size` segments, so a tree query touches only what is near."""
    out = []
    for ring in rings:
        xy = shapely.get_coordinates(ring)
        for k in range(0, len(xy) - 1, size):
            part = xy[k : k + size + 1]
            if len(part) >= 2:
                out.append(shapely.LineString(part))
    return out


# Steps -----------------------------------------------------------------------------------------


def change_years(source: Cliopatria, config: Config) -> list[int]:
    """Every year a POLITY or vassalage row begins or ends the year before, or a correction does,
    up to LAST_YEAR."""
    years = set()
    for row in source.rows:
        if row.polity or VASSALAGE.fullmatch(row.name):
            years |= {row.first, row.last + 1}
    for correction in config.corrections:
        years |= {correction.years[0], correction.years[1] + 1}
    first = min(r.first for r in source.rows)
    return sorted(y for y in years if first <= y <= LAST_YEAR)


def step_years(source: Cliopatria, config: Config) -> list[int]:
    """The years steps begin: the change years whose rows and corrections differ from the step
    before's, or for the fixture the excerpt's years."""
    if source.years is not None:
        return list(source.years)
    steps: list[int] = []
    last: tuple[Any, ...] | None = None
    rows = [r for r in source.rows if r.polity or VASSALAGE.fullmatch(r.name)]
    for year in change_years(source, config):
        signature = _signature(year, rows, config)
        if signature != last:
            steps.append(year)
            last = signature
    return steps


def _signature(year: int, rows: Sequence[Row], config: Config) -> tuple[Any, ...]:
    digests = sorted(r.digest for r in rows if r.holds(year))
    active = [k for k, c in enumerate(config.corrections) if c.years[0] <= year <= c.years[1]]
    return (tuple(digests), tuple(active))


def polity_ids(source: Cliopatria, config: Config) -> dict[str, int]:
    """Stateless land 1, then every POLITY row's name and every name a correction draws, sorted,
    from 2, so a polity keeps its id in every step."""
    names = {r.name for r in source.rows if r.polity}
    for c in config.corrections:
        op = c.op
        if isinstance(op, Give | Rename):
            names.add(op.to)
        elif isinstance(op, Carry | Add):
            names.add(op.polity)
        elif isinstance(op, Pocket) and op.to is not None:
            names.add(op.to)
    if len(names) + 1 > MAX_ID:
        raise SelectionError(f"{len(names)} polities do not fit u16 ids")
    return {STATELESS: STATELESS_ID} | {n: k + 2 for k, n in enumerate(sorted(names))}


# Selection -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Part:
    """Land a polity draws in a step: disjoint from every other part."""

    polity: str
    outer: str
    minor: bool  # in a piece of its outer unit under minorKm2
    geometry: shapely.Geometry


type Holes = tuple[tuple[str, shapely.Geometry], ...]  # an outer unit's name and its holes


@dataclass(frozen=True)
class Selection:
    year: int
    parts: tuple[Part, ...]  # sorted by polity, then minor
    stateless: shapely.Geometry  # the stateless land kept
    applied: frozenset[int]  # the corrections, by index in Config.corrections, that changed it
    unacknowledged: tuple[tuple[str, str], ...]  # pairs past duplicateShare no correction names
    report: dict[str, Any]
    # The other pockets given that touch a polity, which the bake fills from the polities alone.
    pockets: shapely.Geometry = field(default_factory=shapely.MultiPolygon)
    # The holes inside one state, by its outer unit, which the bake fills from that unit's land.
    holes: Holes = ()
    # The stateless land a `pocket` correction keeps, which the carry-through never carries.
    cited: shapely.Geometry = field(default_factory=shapely.MultiPolygon)

    def outers(self) -> dict[str, str]:
        """Each drawn polity's outer unit."""
        return {part.polity: part.outer for part in self.parts}


@dataclass(frozen=True)
class Carried:
    """Land a polity draws in the steps on both sides of a stateless run, drawn as its own in a step
    of the run: its shape of the step before, as far as the step after holds it."""

    polity: str
    outer: str  # the outer unit both sides draw it in, or itself where they differ
    shape: shapely.Geometry
    run: tuple[int, int]  # the years the steps before and after the run begin


def select(
    year: int,
    source: Cliopatria,
    config: Config,
    terrain: Terrain,
    carried: Sequence[Carried] = (),
) -> Selection:
    """What the step beginning in `year` draws, with the land `carry_through` carries in it."""
    active = [(k, c) for k, c in enumerate(config.corrections) if c.years[0] <= year <= c.years[1]]
    applied: set[int] = set()
    rows = _valid_rows(year, source, active, applied)
    polities = {r.name: r for r in rows if r.polity}
    leaves = {name: r.geometry for name, r in polities.items() if not r.composite}
    counted = len(leaves)
    leftovers = _leftovers(polities, config.rules)
    leaves |= {name: shape for name, (shape, _) in leftovers.items()}
    joins = _draw_corrections(active, leaves, source, applied)
    _across_seam(leaves, terrain)
    outer, membership = _outer_units(year, rows, polities, leaves, joins, config, active, applied)
    drawn, overlaps, unacknowledged = _overlaps(year, leaves, config, active, applied)
    held = shapely.union_all(list(leaves.values())) if leaves else shapely.Polygon()
    pockets = [(k, c.op) for k, c in active if isinstance(c.op, Pocket)]
    fills = [(k, op) for k, op in pockets if op.to is not None]
    held, named_fills = _named_fills(fills, held, drawn, outer, terrain, source, applied)
    held, carried_through = _carry(carried, held, drawn, outer)
    stateless, filled, holes, cited, unclaimed = _stateless(
        held,
        drawn,
        outer,
        terrain,
        config.rules,
        [(k, op) for k, op in pockets if op.to is None],
        applied,
        named_fills,
    )
    parts, minor = _parts(drawn, outer, config.rules)
    valid = {name for name, r in polities.items() if not r.composite}
    shown = {name for name in drawn if not name.startswith("(")}
    named = set().union(*(_names_of(config.corrections[k].op) for k in applied))
    named |= {piece.polity for piece in carried}
    changed = sorted((shown - valid) | (valid - shown))
    report = {
        "year": year,
        "leaves": counted,
        "drawn": len(drawn),
        "added": sorted(shown - valid),
        "removed": sorted(valid - shown),
        "unexplained": [name for name in changed if name not in named],
        "outer": len(set(outer.values())),
        "minorPieces": minor,
        "leftovers": [{"composite": n, "km2": round(a)} for n, (_, a) in leftovers.items()],
        **membership,
        "overlaps": overlaps,
        "carried": carried_through,
        "stateless": unclaimed,
        "statelessCells": pack_cells(cells(stateless)),
    }
    return Selection(
        year, parts, stateless, frozenset(applied), unacknowledged, report, filled, holes, cited
    )


def _names_of(op: Operation) -> set[str]:
    """The polities a correction names, which it may add to a step's leaves or take from them."""
    match op:
        case Give() | Rename():
            return {op.polity, op.to}
        case Carry() | Add() | Drop():
            return {op.polity}
        case Overlap():
            return set(op.polities)
        case Pocket(to=str() as to):
            return {to}
        case _:
            return set()


def _valid_rows(
    year: int, source: Cliopatria, active: Sequence[tuple[int, Correction]], applied: set[int]
) -> list[Row]:
    """The rows valid in `year`, renamed, with what they link to renamed too."""
    valid = [r for r in source.rows if r.holds(year)]
    renames = {}
    for k, c in active:
        if isinstance(c.op, Rename) and any(r.polity and r.name == c.op.polity for r in valid):
            renames[c.op.polity] = c.op.to
            applied.add(k)
    if not renames:
        return valid
    rows = [_renamed(r, renames) for r in valid]
    names = [r.name for r in rows if r.polity]
    if len(set(names)) < len(names):
        raise SelectionError(f"{year}: a rename gives two polities one name")
    return rows


def _leftovers(
    polities: Mapping[str, Row], rules: Rules
) -> dict[str, tuple[shapely.Geometry, float]]:
    """Each composite's land that no polity row holds, from Cliopatria's own shapes, when at least
    leftoverKm2, with its area. A composite's `Components` can lag its rows, and its shape can
    reach land another polity holds, so its members alone would leave it land that is theirs."""
    leaves = [r.geometry for r in polities.values() if not r.composite]
    tree = shapely.STRtree(leaves)
    found = {}
    for name, row in sorted(polities.items()):
        if not row.composite:
            continue
        near = tree.query(row.geometry, predicate="intersects")
        held = shapely.union_all([leaves[k] for k in near])
        rest = polygons(shapely.difference(row.geometry, held))
        area = km2(rest)
        if area >= rules.leftover_km2:
            found[name] = (rest, area)
    return found


def _draw_corrections(
    active: Sequence[tuple[int, Correction]],
    leaves: dict[str, shapely.Geometry],
    source: Cliopatria,
    applied: set[int],
) -> dict[str, set[str]]:
    """Applies the carries, adds, drops and gives to `leaves`, in file order; what they make
    members of what."""
    joins: dict[str, set[str]] = defaultdict(set)
    for k, c in active:
        op = c.op
        if isinstance(op, Carry):
            row = source.at(op.polity, op.year)
            if row is None:
                raise SelectionError(f"{c.label()}: Cliopatria has no {op.polity} in {op.year}")
            if op.polity not in leaves:
                leaves[op.polity] = row.geometry
                applied.add(k)
        elif isinstance(op, Add):
            before = leaves.get(op.polity)
            if before is None:
                leaves[op.polity] = op.shape
                applied.add(k)
            elif km2(shapely.difference(op.shape, before)) > 0:
                leaves[op.polity] = polygons(shapely.union(before, op.shape))
                applied.add(k)
            if op.member_of:
                joins[op.polity].add(op.member_of)
        elif isinstance(op, Drop):
            land = leaves.get(op.polity)
            if land is None:
                continue
            pieces = shapely.get_parts(land)
            inside = shapely.within(pieces, op.shape)
            if not inside.any():
                continue
            if inside.all():
                del leaves[op.polity]
            else:
                leaves[op.polity] = shapely.multipolygons(list(pieces[~inside]))
            applied.add(k)
        elif isinstance(op, Give):
            moved = _given(op, leaves, source)
            if moved is None:
                continue
            rest = polygons(shapely.difference(leaves[op.polity], moved))
            if shapely.is_empty(rest):
                del leaves[op.polity]
            else:
                leaves[op.polity] = rest
            target = leaves.get(op.to)
            leaves[op.to] = moved if target is None else polygons(shapely.union(target, moved))
            if op.member_of:
                joins[op.to].add(op.member_of)
            applied.add(k)
    return joins


def _across_seam(leaves: dict[str, shapely.Geometry], terrain: Terrain) -> None:
    """Gives the land just across the antimeridian that no polity holds, a piece at a time, to the
    one polity whose shape runs along the other side of the meridian where the piece meets it,
    when the piece lies within SEAM_REACH_DEG of the meridian. Cliopatria's shapes stop at ±180°:
    without this, Chukotka east of the meridian is stateless whenever Russia's shape reaches it,
    and a border runs down the meridian."""
    for side in (1.0, -1.0):
        # This side's meridian, where the polities' shapes stop, and the land across the other.
        seams = {}
        along = _meridian_strip(180.0 * side, -side * SEAM_DEG)
        for name, shape in leaves.items():
            west, _, east, _ = shapely.bounds(shape)
            if (east if side > 0 else -west) < 180.0 - SEAM_DEG:
                continue
            seam = shapely.intersection(shape, along)
            if not shapely.is_empty(seam):
                seams[name] = shapely.affinity.translate(seam, xoff=-360.0 * side)
        if not seams:
            continue
        reach = _meridian_strip(-180.0 * side, side * SEAM_REACH_DEG)
        free = shapely.intersection(terrain.dry, reach)
        near = [shape for shape in leaves.values() if shapely.intersects(shape, reach)]
        if near:
            free = shapely.difference(free, shapely.union_all(near))
        for piece in parts_of_dimension(free, 2):
            west, _, east, _ = shapely.bounds(piece)
            inner, outer = (west, east) if side > 0 else (-east, -west)
            if inner > -180.0 + SEAM_DEG or outer >= -180.0 + SEAM_REACH_DEG - SEAM_DEG:
                continue  # off the meridian, or running on past the reach
            owners = [n for n, seam in seams.items() if shapely.dwithin(seam, piece, SEAM_DEG)]
            if len(owners) == 1:
                leaves[owners[0]] = polygons(shapely.union(leaves[owners[0]], piece))


def _meridian_strip(meridian: float, width: float) -> shapely.Geometry:
    """The strip from `meridian` `width` degrees east (or west, when negative), pole to pole."""
    return shapely.box(min(meridian, meridian + width), -90, max(meridian, meridian + width), 90)


def _outer_units(
    year: int,
    rows: Sequence[Row],
    polities: Mapping[str, Row],
    leaves: Mapping[str, shapely.Geometry],
    joins: Mapping[str, set[str]],
    config: Config,
    active: Sequence[tuple[int, Correction]],
    applied: set[int],
) -> tuple[dict[str, str], dict[str, Any]]:
    """Each drawn polity's outer unit, and what the membership left for review."""
    hierarchy = config.hierarchy
    composites = {name: r for name, r in polities.items() if r.composite}
    kinds = {name: hierarchy.composites.get(name, "grouping") for name in composites}
    parents: dict[str, set[str]] = defaultdict(set)
    for name, row in composites.items():
        for component in row.components:
            if component != name:
                parents[component].add(name)
    unsettled = []
    for name, row in sorted(polities.items()):
        if parents.get(name) or not row.member_of:
            continue
        found = {m for m in row.member_of if m in composites and m != name}
        if found:
            parents[name] |= found
        else:
            unsettled.append({"polity": name, "memberOf": list(row.member_of)})
    unclassified_relations = []
    for row in rows:
        match = None if row.polity else VASSALAGE.fullmatch(row.name)
        if match is None:
            continue
        if row.name not in hierarchy.relations:
            unclassified_relations.append(row.name)
            continue
        vassal = _resolve(match.group(1), polities)
        paramount = _resolve(match.group(2), polities)
        if hierarchy.relations[row.name] and vassal and paramount:
            parents[vassal].add(paramount)
    known = set(polities) | set(leaves)
    for name, found in joins.items():
        parents[name] |= found & known
    for k, c in active:
        op = c.op
        if not isinstance(op, Member) or op.polity not in known or op.of not in known:
            continue
        if op.of not in parents[op.polity]:
            parents[op.polity].add(op.of)
            applied.add(k)

    def roots(name: str, seen: frozenset[str] = frozenset()) -> set[str]:
        """The outermost empires above `name`, or `name` itself when none is."""
        found: set[str] = set()
        for parent in sorted(parents.get(name, ())):
            if parent in seen or (parent in composites and kinds[parent] != "empire"):
                continue
            found |= roots(parent, seen | {name})
        return found or {name}

    outer: dict[str, str] = {}
    for name in sorted(leaves):
        found = roots(name)
        if len(found) > 1:
            raise SelectionError(f"{year}: {name} reaches two roots, {' and '.join(sorted(found))}")
        outer[name] = found.pop()
    review = {
        "unclassified": {
            "composites": sorted(n for n in composites if n not in hierarchy.composites),
            "relations": sorted(unclassified_relations),
        },
        "unsettled": unsettled,
    }
    return outer, review


def _overlaps(
    year: int,
    leaves: Mapping[str, shapely.Geometry],
    config: Config,
    active: Sequence[tuple[int, Correction]],
    applied: set[int],
) -> tuple[dict[str, shapely.Geometry], list[dict[str, Any]], tuple[tuple[str, str], ...]]:
    """Each polity's land once every overlap is settled, the overlaps to review, and the pairs
    past duplicateShare no correction names."""
    rules = config.rules
    names = sorted(leaves)
    shapes = np.array([leaves[n] for n in names], dtype=object)
    areas = km2(shapes) if names else np.zeros(0)
    named = {
        tuple(sorted(c.op.polities)): (c.op.winner, k)
        for k, c in active
        if isinstance(c.op, Overlap)
    }
    beaten: dict[int, list[int]] = defaultdict(list)
    overlaps = []
    unacknowledged = []
    candidates = shapely.STRtree(shapes).query(shapes, predicate="intersects") if names else []
    for i, j in np.transpose(candidates):
        if i >= j or shapely.touches(shapes[i], shapes[j]):
            continue
        shared = km2(shapely.intersection(shapes[i], shapes[j]))
        if shared <= 0:
            continue
        pair = (names[i], names[j])
        smaller = i if (areas[i], names[i]) < (areas[j], names[j]) else j
        winner = smaller
        if pair in named:
            chosen, k = named[pair]
            winner = i if chosen == names[i] else j
            applied.add(k)
            if winner != smaller and config.corrections[k].source is None:
                raise SelectionError(
                    f"{config.corrections[k].label()}: {chosen} is the larger in {year}, so the "
                    "correction needs a source"
                )
        beaten[j if winner == i else i].append(winner)
        share = float(shared / max(areas[i], areas[j]))
        duplicate = share > rules.duplicate_share
        if duplicate and pair not in named:
            unacknowledged.append(pair)
        if shared > rules.review_km2 or duplicate:
            overlaps.append(
                {
                    "polities": list(pair),
                    "km2": round(shared),
                    "share": round(share, 3),
                    "winner": names[winner],
                    "duplicate": duplicate,
                    "acknowledged": pair in named,
                }
            )
    drawn = {}
    for i, name in enumerate(names):
        shape = shapes[i]
        if beaten.get(i):
            shape = polygons(shapely.difference(shape, shapely.union_all(shapes[beaten[i]])))
        if not shapely.is_empty(shape):
            drawn[name] = shape
    return drawn, overlaps, tuple(unacknowledged)


def _renamed(row: Row, renames: Mapping[str, str]) -> Row:
    def rename(name: str) -> str:
        return renames.get(name, name)

    return Row(
        name=rename(row.name),
        first=row.first,
        last=row.last,
        polity=row.polity,
        wikidata=row.wikidata,
        components=tuple(rename(c) for c in row.components),
        member_of=tuple(rename(m) for m in row.member_of),
        geometry=row.geometry,
        km2=row.km2,
        digest=row.digest,
    )


def _resolve(name: str, polities: Mapping[str, Row]) -> str | None:
    """A relation's party: the composite of that name when one is valid, else the polity."""
    for candidate in (f"({name})", name):
        if candidate in polities:
            return candidate
    return None


def _given(op: Give, leaves: Mapping[str, shapely.Geometry], source: Cliopatria):
    """The land a `give` moves this step, or None when it moves none."""
    land = leaves.get(op.polity)
    if land is None:
        return None
    if op.at is not None:
        point = shapely.Point(op.at)
        taken = [p for p in shapely.get_parts(land) if shapely.contains(p, point)]
        moved = shapely.multipolygons(taken) if taken else shapely.MultiPolygon()
    elif op.shape_from is not None:
        name, year = op.shape_from
        row = source.at(name, year)
        if row is None:
            raise SelectionError(f"give {op.polity}: Cliopatria has no {name} in {year}")
        moved = polygons(shapely.intersection(land, row.geometry))
    else:
        moved = land
    return None if shapely.is_empty(moved) or km2(moved) <= 0 else moved


def _named_fills(
    fills: Sequence[tuple[int, Pocket]],
    held: shapely.Geometry,
    drawn: dict[str, shapely.Geometry],
    outer: dict[str, str],
    terrain: Terrain,
    source: Cliopatria,
    applied: set[int],
) -> tuple[shapely.Geometry, list[dict[str, Any]]]:
    """Draws, in file order, the stateless land each `pocket` with `to` names as that polity's: the
    piece holding its point, or that piece's part inside another polity's shape in another year or
    inside a cited shape. A Cliopatria polity the step does not draw otherwise is drawn from that
    land alone, its own outer unit; a name Cliopatria never gives fails, as a slip would. No cap
    holds, since one polity takes the land and no line is drawn through it. The land held after,
    and the pockets given, for the report."""
    given: list[dict[str, Any]] = []
    if not fills:
        return held, given
    pieces = list(parts_of_dimension(shapely.difference(terrain.dry, held), 2))
    for k, op in fills:
        assert op.to is not None
        if op.to not in drawn and not any(r.polity and r.name == op.to for r in source.rows):
            raise SelectionError(f"pocket at {op.at}: Cliopatria has no polity named {op.to}")
        point = shapely.Point(op.at)
        found = next((i for i, p in enumerate(pieces) if shapely.contains(p, point)), None)
        if found is None:
            continue
        piece = pieces[found]
        if op.shape is not None:
            moved = polygons(shapely.intersection(piece, op.shape))
        elif op.shape_from is not None:
            name, year = op.shape_from
            row = source.at(name, year)
            if row is None:
                raise SelectionError(f"pocket at {op.at}: Cliopatria has no {name} in {year}")
            moved = polygons(shapely.intersection(piece, row.geometry))
        else:
            moved = piece
        area = km2(moved)
        if shapely.is_empty(moved) or area <= 0:
            continue
        pieces[found : found + 1] = list(parts_of_dimension(shapely.difference(piece, moved), 2))
        before = drawn.get(op.to)
        drawn[op.to] = moved if before is None else polygons(shapely.union(before, moved))
        outer.setdefault(op.to, op.to)
        held = shapely.union(held, moved)
        applied.add(k)
        at = shapely.point_on_surface(moved)
        given.append(
            {
                "km2": round(area),
                "at": [round(at.x, 2), round(at.y, 2)],
                "rule": "correction",
                "polity": op.to,
            }
        )
    return held, given


def _carry(
    carried: Sequence[Carried],
    held: shapely.Geometry,
    drawn: dict[str, shapely.Geometry],
    outer: dict[str, str],
) -> tuple[shapely.Geometry, dict[str, Any]]:
    """Draws the land `carry_through` carries in this step as its polities': land the step left
    stateless when selected without it, so no other polity holds it. A polity the step does not
    draw otherwise joins the outer unit both sides of its largest run draw it in when the step
    draws that unit, and is its own else. The land held after, and what was carried, for the
    report: the pieces of LARGE_POCKET_KM2 or more one by one, and the rest counted."""
    report: dict[str, Any] = {"pieces": len(carried), "km2": 0, "large": []}
    if not carried:
        return held, report
    units = set(outer.values())
    areas = [km2(piece.shape) for piece in carried]
    by_polity: dict[str, list[int]] = defaultdict(list)
    for k, piece in enumerate(carried):
        by_polity[piece.polity].append(k)
    for name, found in by_polity.items():
        shape = polygons(shapely.union_all([carried[k].shape for k in found]))
        before = drawn.get(name)
        drawn[name] = shape if before is None else polygons(shapely.union(before, shape))
        if name not in outer:
            largest = carried[max(found, key=lambda k: areas[k])]
            outer[name] = largest.outer if largest.outer in units else name
    held = shapely.union(held, shapely.union_all([piece.shape for piece in carried]))
    report["km2"] = round(sum(areas))
    for piece, area in zip(carried, areas, strict=True):
        if area >= LARGE_POCKET_KM2:
            at = shapely.point_on_surface(piece.shape)
            report["large"].append(
                {
                    "polity": piece.polity,
                    "km2": round(area),
                    "at": [round(at.x, 2), round(at.y, 2)],
                    "run": list(piece.run),
                }
            )
    report["large"].sort(key=lambda entry: -entry["km2"])
    return held, report


def _stateless(
    held: shapely.Geometry,
    drawn: Mapping[str, shapely.Geometry],
    outer: Mapping[str, str],
    terrain: Terrain,
    rules: Rules,
    pockets: Sequence[tuple[int, Pocket]],
    applied: set[int],
    named: Sequence[dict[str, Any]] = (),
) -> tuple[shapely.Geometry, shapely.Geometry, Holes, shapely.Geometry, dict[str, Any]]:
    """The stateless land kept, the other pockets given that touch a polity, the holes inside one
    state by its outer unit, the stateless land a correction keeps, and what the rules did with the
    rest, with `named`, the pockets given to the polities corrections name. A pocket that touches
    no polity, an island in a lake among stateless shores, is left to the fill, as the sea is. A
    correction keeping a piece stateless changes its step whenever it finds the piece, since it
    cites it, even where the rules keep it too."""
    free = shapely.difference(terrain.dry, held)
    pieces = parts_of_dimension(free, 2)
    sea = _touching(pieces, terrain.coast)
    lake = _touching(pieces, terrain.lake_tree)
    states = _enclosing(pieces, drawn, outer)
    overrides = {}  # a piece's index -> whether it stays stateless, and the correction
    for k, pocket in pockets:
        point = shapely.Point(pocket.at)
        holding = [i for i, p in enumerate(pieces) if shapely.contains(p, point)]
        if holding:
            overrides[holding[0]] = (pocket.stateless, k)
    shapely.prepare(held)
    kept, enclosed, filled, cited = [], [], [], []
    given = list(named)
    holes: dict[str, list[shapely.Geometry]] = {}
    sliver_km2 = 0.0
    radius = rules.sliver_km
    for i, piece in enumerate(pieces):
        area = km2(piece)
        at = shapely.point_on_surface(piece)
        where = [round(at.x, 2), round(at.y, 2)]
        if sea[i]:
            core = _opening(piece, radius)
            if i not in overrides:
                sliver_km2 += area - km2(core)
                kept += list(parts_of_dimension(core, 2))
                continue
            # A coastal piece a correction names is kept whole, or given whole.
            stateless, k = overrides[i]
            if stateless or km2(core) > 0:
                applied.add(k)
            rule = None if stateless else "correction"
        else:
            rule = None
            if len(states[i]) == 1:
                rule = "state"
            elif lake[i] and area < rules.pocket_km2:
                rule = "lake"
            elif shapely.is_empty(_opening(piece, radius)):
                rule = "narrow"
            if i in overrides:
                stateless, k = overrides[i]
                if stateless or rule is None:
                    applied.add(k)
                    rule = None if stateless else "correction"
        if rule == "correction" and area >= rules.pocket_km2:
            raise SelectionError(
                f"a pocket correction gives away the piece at {where}, {round(area):,} km², "
                "past pocketKm2"
            )
        if rule is None:
            kept.append(piece)
            if i in overrides and overrides[i][0]:
                cited.append(piece)
            if not sea[i]:
                entry = {
                    "km2": round(area),
                    "at": where,
                    "lake": bool(lake[i]),
                    "states": states[i],
                }
                if i in overrides:
                    entry["correction"] = True
                enclosed.append(entry)
        else:
            entry = {"km2": round(area), "at": where, "rule": rule}
            given.append(entry)
            if rule == "state":
                entry["state"] = states[i][0]
                holes.setdefault(states[i][0], []).append(piece)
            elif shapely.dwithin(piece, held, TOUCH_DEG):
                filled.append(piece)
    report = {
        "pieces": int(pieces.size),
        "sliverKm2": round(sliver_km2),
        "pockets": len(given),
        "pocketKm2": sum(p["km2"] for p in given),
        "byRule": {
            rule: sum(1 for p in given if p["rule"] == rule)
            for rule in ("state", "lake", "narrow", "correction")
        },
        "largePockets": sorted(
            (p for p in given if p["km2"] >= LARGE_POCKET_KM2), key=lambda p: -p["km2"]
        ),
        "enclosed": sorted(enclosed, key=lambda p: -p["km2"]),
        "keptKm2": round(sum(km2(p) for p in kept)),
    }
    stateless = shapely.multipolygons(kept) if kept else shapely.MultiPolygon()
    pocketed = shapely.multipolygons(filled) if filled else shapely.MultiPolygon()
    inside = tuple((unit, shapely.multipolygons(holes[unit])) for unit in sorted(holes))
    kept_by_correction = shapely.multipolygons(cited) if cited else shapely.MultiPolygon()
    return stateless, pocketed, inside, kept_by_correction, report


def _enclosing(
    pieces: np.ndarray, drawn: Mapping[str, shapely.Geometry], outer: Mapping[str, str]
) -> list[list[str]]:
    """The outer units whose drawn land each piece touches, sorted."""
    touched: list[set[str]] = [set() for _ in range(pieces.size)]
    names = sorted(drawn)
    if pieces.size and names:
        tree = shapely.STRtree(np.array([drawn[n] for n in names], dtype=object))
        found = tree.query(pieces, predicate="dwithin", distance=TOUCH_DEG)
        for i, j in found.T:
            touched[int(i)].add(outer[names[int(j)]])
    return [sorted(units) for units in touched]


def _touching(pieces: np.ndarray, tree: shapely.STRtree) -> np.ndarray:
    touching = np.zeros(pieces.size, dtype=bool)
    if pieces.size:
        found = tree.query(pieces, predicate="dwithin", distance=TOUCH_DEG)
        touching[np.unique(found[0])] = True
    return touching


def _parts(
    drawn: Mapping[str, shapely.Geometry], outer: Mapping[str, str], rules: Rules
) -> tuple[tuple[Part, ...], int]:
    """Each polity's drawn land split by its outer unit's pieces into minor and not, and the number
    of minor pieces."""
    by_outer: dict[str, list[str]] = defaultdict(list)
    for name in drawn:
        by_outer[outer[name]].append(name)
    parts: list[Part] = []
    minor_pieces = 0
    for unit, members in sorted(by_outer.items()):
        pieces = parts_of_dimension(shapely.union_all([drawn[n] for n in members]), 2)
        small = _minor_pieces(pieces, rules.minor_km2)
        minor_pieces += len(small)
        minor = shapely.union_all(small) if small else None
        for name in sorted(members):
            shape = drawn[name]
            if minor is None:
                parts.append(Part(name, unit, False, shape))
                continue
            inside = polygons(shapely.intersection(shape, minor))
            outside = polygons(shapely.difference(shape, minor))
            if not shapely.is_empty(outside):
                parts.append(Part(name, unit, False, outside))
            if not shapely.is_empty(inside):
                parts.append(Part(name, unit, True, inside))
    return tuple(parts), minor_pieces


def _minor_pieces(pieces: np.ndarray, minor_km2: float) -> list[shapely.Geometry]:
    """The pieces, joined where they lie within PIECE_GAP_DEG of each other, under minor_km2."""
    if pieces.size == 0:
        return []
    group = list(range(pieces.size))

    def find(k: int) -> int:
        while group[k] != k:
            group[k] = group[group[k]]
            k = group[k]
        return k

    near = shapely.STRtree(pieces).query(pieces, predicate="dwithin", distance=PIECE_GAP_DEG)
    for a, b in near.T:
        group[find(int(a))] = find(int(b))
    joined: dict[int, list[int]] = defaultdict(list)
    for k in range(pieces.size):
        joined[find(k)].append(k)
    areas = km2(pieces)
    return [
        shapely.union_all(pieces[ks])
        for ks in joined.values()
        if float(areas[ks].sum()) < minor_km2
    ]


def _laea(lon0: float, lat0: float):
    """Forward and inverse Lambert azimuthal equal-area projections about (lon0, lat0), in km."""
    l0, p0 = math.radians(lon0), math.radians(lat0)
    sp0, cp0 = math.sin(p0), math.cos(p0)

    def forward(xy: np.ndarray) -> np.ndarray:
        lam = np.radians(xy[:, 0]) - l0
        lam = (lam + math.pi) % (2 * math.pi) - math.pi
        phi = np.radians(np.clip(xy[:, 1], -90, 90))
        k = np.sqrt(2 / np.maximum(1 + sp0 * np.sin(phi) + cp0 * np.cos(phi) * np.cos(lam), 1e-12))
        x = EARTH_KM * k * np.cos(phi) * np.sin(lam)
        y = EARTH_KM * k * (cp0 * np.sin(phi) - sp0 * np.cos(phi) * np.cos(lam))
        return np.column_stack([x, y])

    def inverse(xy: np.ndarray) -> np.ndarray:
        x, y = xy[:, 0], xy[:, 1]
        rho = np.maximum(np.hypot(x, y), 1e-12)
        c = 2 * np.arcsin(np.clip(rho / (2 * EARTH_KM), -1, 1))
        phi = np.arcsin(np.clip(np.cos(c) * sp0 + y * np.sin(c) * cp0 / rho, -1, 1))
        lam = l0 + np.arctan2(x * np.sin(c), rho * cp0 * np.cos(c) - y * sp0 * np.sin(c))
        return np.column_stack([np.degrees(lam), np.degrees(phi)])

    return forward, inverse


def _opening(piece: shapely.Geometry, radius_km: float) -> shapely.Geometry:
    """The parts of the piece at least 2·radius wide: its morphological opening, on an equal-area
    projection about its centroid. The opening runs on the piece simplified to OPENING_TOLERANCE_KM
    and dilates that much further, so the coast keeps its detail: the result is the piece where the
    opening reaches. A piece that reaches a pole, Antarctica, stays whole: no polity lies near it,
    and no projection about its centroid holds it without wrapping."""
    if km2(piece) < math.pi * radius_km**2:
        return shapely.Polygon()
    _, south, _, north = shapely.bounds(piece)
    if south <= -POLE_LAT or north >= POLE_LAT:
        return piece
    center = shapely.centroid(piece)
    forward, inverse = _laea(center.x, center.y)
    flat = shapely.transform(shapely.segmentize(piece, 0.1), forward)
    rough = polygons(shapely.simplify(flat, OPENING_TOLERANCE_KM))
    eroded = shapely.buffer(rough, -radius_km, quad_segs=4)
    if shapely.is_empty(eroded):
        return shapely.Polygon()
    reach = shapely.buffer(eroded, radius_km + OPENING_TOLERANCE_KM, quad_segs=4)
    reach = polygons(shapely.transform(shapely.segmentize(reach, 10.0), inverse))
    return polygons(shapely.intersection(piece, reach))


# Carrying through ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Plain:
    """What the carry-through reads of a step selected without it: each polity's land, with the
    holes the step fills as its own when it is its own outer unit, each polity's outer unit, and the
    stateless land no correction keeps, cut into pieces of at most PLAIN_VERTICES vertices so the
    land beside a polity is found without the rest."""

    year: int
    land: Mapping[str, shapely.Geometry]
    outer: Mapping[str, str]
    stateless: np.ndarray  # polygons

    @classmethod
    def of(cls, selection: Selection) -> Plain:
        shapes: dict[str, list[shapely.Geometry]] = defaultdict(list)
        for part in selection.parts:
            shapes[part.polity].append(part.geometry)
        for unit, hole in selection.holes:
            if unit in shapes:
                shapes[unit].append(hole)
        land = {name: polygons(shapely.union_all(found)) for name, found in sorted(shapes.items())}
        free = selection.stateless
        if not shapely.is_empty(selection.cited):
            free = shapely.difference(free, selection.cited)
        return cls(selection.year, land, selection.outers(), _subdivide(free, PLAIN_VERTICES))

    def to_bytes(self) -> bytes:
        names = list(self.land)
        head = {"year": self.year, "names": names, "outer": [self.outer[n] for n in names]}
        shapes = np.array([*self.land.values(), *self.stateless], dtype=object)
        return _pack(head, shapes)

    @classmethod
    def from_bytes(cls, data: bytes) -> Plain:
        head, shapes = _unpack(data)
        names = head["names"]
        land = dict(zip(names, shapes[: len(names)], strict=True))
        outer = dict(zip(names, head["outer"], strict=True))
        return cls(head["year"], land, outer, shapes[len(names) :])


@dataclass
class _Run:
    """Land a polity drew in the step before `first` and that has stood stateless since."""

    polity: str
    outer: str  # its outer unit in the step before
    first: int  # the index of the run's first step
    shape: shapely.Geometry


def carry_through(plains: Iterable[Plain]) -> dict[int, tuple[Carried, ...]]:
    """The land each step carries, by its year, from every step selected without it (`Plain`), in
    year order: where one polity draws land in the steps on both sides of a stateless run of at
    most GAP_YEARS, its shape of the step before, as far as the step after holds it, in each step
    of the run. A run starts where land a polity drew turns stateless and ends where any polity
    holds it, or where it would run past GAP_YEARS; land a stateless `pocket` keeps ends it too."""
    found: dict[int, list[Carried]] = defaultdict(list)
    years: list[int] = []
    runs: list[_Run] = []
    before: Plain | None = None
    for plain in plains:
        years.append(plain.year)
        now = len(years) - 1
        tree = shapely.STRtree(plain.stateless)
        going: list[_Run] = []
        for run in runs:
            if plain.year - years[run.first] > GAP_YEARS:
                continue
            land = plain.land.get(run.polity)
            back = _overlap(run.shape, [land]) if land is not None else shapely.MultiPolygon()
            if not shapely.is_empty(back):
                outer = run.outer if plain.outer[run.polity] == run.outer else run.polity
                bounds = (years[run.first - 1], plain.year)
                for k in range(run.first, now):
                    found[years[k]].append(Carried(run.polity, outer, back, bounds))
            rest = _overlap(run.shape, plain.stateless[tree.query(run.shape)])
            if not shapely.is_empty(rest):
                run.shape = rest
                going.append(run)
        if before is not None and plain.stateless.size:
            names = list(before.land)
            shapes = np.array([before.land[n] for n in names], dtype=object)
            pairs = tree.query(shapes, predicate="intersects")
            for k in np.unique(pairs[0]):
                near = plain.stateless[pairs[1][pairs[0] == k]]
                start = _overlap(shapes[k], near)
                if not shapely.is_empty(start):
                    going.append(_Run(names[k], before.outer[names[k]], now, start))
        runs = going
        before = plain
    return {year: tuple(pieces) for year, pieces in found.items()}


def _overlap(shape: shapely.Geometry, others: Sequence[shapely.Geometry] | np.ndarray):
    """The land `shape` shares with `others`, polygons only, empty where it shares none."""
    if len(others) == 0:
        return shapely.MultiPolygon()
    shared = shapely.intersection(shape, np.asarray(others, dtype=object))
    return polygons(shapely.union_all(shared))


def _subdivide(geometry: shapely.Geometry, most: int) -> np.ndarray:
    """The geometry's polygons, each halved across its longer side until it has at most `most`
    vertices."""
    out = []
    stack = list(parts_of_dimension(geometry, 2))
    while stack:
        piece = stack.pop()
        if shapely.get_num_coordinates(piece) <= most:
            out.append(piece)
            continue
        west, south, east, north = shapely.bounds(piece)
        if east - west >= north - south:
            middle = (west + east) / 2
            halves = [(west, south, middle, north), (middle, south, east, north)]
        else:
            middle = (south + north) / 2
            halves = [(west, south, east, middle), (west, middle, east, north)]
        for half in halves:
            stack += list(parts_of_dimension(shapely.intersection(piece, shapely.box(*half)), 2))
    return np.array(out, dtype=object)


_HEAD = struct.Struct("<I")


def _pack(head: Mapping[str, Any], shapes: np.ndarray) -> bytes:
    """`u32 length | JSON head` and the shapes' WKB records, gzip level 1."""
    text = json.dumps(head, ensure_ascii=False).encode()
    return gzip.compress(_HEAD.pack(len(text)) + text + records(shapes), 1, mtime=0)


def _unpack(data: bytes) -> tuple[dict[str, Any], np.ndarray]:
    raw = gzip.decompress(data)
    (length,) = _HEAD.unpack_from(raw)
    head = json.loads(raw[_HEAD.size : _HEAD.size + length])
    rest = raw[_HEAD.size + length :]
    shapes = parse_records(rest) if rest else np.array([], dtype=object)
    return head, shapes


def pack_carried(carried: Mapping[int, Sequence[Carried]]) -> bytes:
    """What `carry_through` found, as the bake's cache keeps it."""
    entries = [
        {"year": year, "polity": c.polity, "outer": c.outer, "run": list(c.run)}
        for year in sorted(carried)
        for c in carried[year]
    ]
    shapes = [c.shape for year in sorted(carried) for c in carried[year]]
    return _pack({"carried": entries}, np.array(shapes, dtype=object))


def unpack_carried(data: bytes) -> dict[int, tuple[Carried, ...]]:
    head, shapes = _unpack(data)
    found: dict[int, list[Carried]] = defaultdict(list)
    for entry, shape in zip(head["carried"], shapes, strict=True):
        run = (int(entry["run"][0]), int(entry["run"][1]))
        found[int(entry["year"])].append(Carried(entry["polity"], entry["outer"], shape, run))
    return {year: tuple(pieces) for year, pieces in found.items()}


def select_all(
    years: Sequence[int], source: Cliopatria, config: Config, terrain: Terrain
) -> dict[int, Selection]:
    """Every step, the land the carry-through carries drawn, in this process: for the tests."""
    plain = {year: select(year, source, config, terrain) for year in years}
    carried = carry_through(Plain.of(plain[year]) for year in years)
    return {
        year: select(year, source, config, terrain, carried[year]) if year in carried else chosen
        for year, chosen in plain.items()
    }


# Coverage, polities and the review queue --------------------------------------------------------


def cells(geometry: shapely.Geometry) -> np.ndarray:
    """Whether each cell of the CELL_DEG grid has its centre in `geometry`: rows from the south,
    columns from 180° W."""
    lon = np.arange(-180 + CELL_DEG / 2, 180, CELL_DEG)
    lat = np.arange(-90 + CELL_DEG / 2, 90, CELL_DEG)
    x, y = np.meshgrid(lon, lat)
    shapely.prepare(geometry)
    return shapely.contains_xy(geometry, x, y)


def pack_cells(mask: np.ndarray) -> str:
    return base64.b64encode(np.packbits(mask)).decode("ascii")


def unpack_cells(text: str) -> np.ndarray:
    rows, columns = round(180 / CELL_DEG), round(360 / CELL_DEG)
    bits = np.unpackbits(np.frombuffer(base64.b64decode(text), np.uint8))
    return bits[: rows * columns].reshape(rows, columns).astype(bool)


def _cell_of(at: Sequence[float]) -> tuple[int, int]:
    rows, columns = round(180 / CELL_DEG), round(360 / CELL_DEG)
    row = min(rows - 1, max(0, math.floor((at[1] + 90) / CELL_DEG)))
    return row, min(columns - 1, max(0, math.floor((at[0] + 180) / CELL_DEG)))


def owed(
    years: Sequence[int],
    reports: Mapping[int, dict[str, Any]],
    config: Config,
    land: np.ndarray,
) -> dict[str, list[dict[str, Any]]]:
    """What the steps owe the history pass, which publish-data refuses (owner decision 38): each
    stateless hole of OWED_KM2 or more no pocket correction cites, as a place over its run of steps,
    and each gap of OWED_KM2 or more, land held in the steps on both sides of a stateless run of at
    most GAP_YEARS, holding no such hole and no stateless pocket's point. `land` is the cells of
    the terrain's dry land; each place's years run from its first step to the day before the step
    after its last."""
    steps = [y for y in years if y in reports]
    if not steps:
        return {"holes": [], "gaps": []}
    ends = {y: after - 1 for y, after in itertools.pairwise(steps)} | {steps[-1]: LAST_YEAR}
    holes: list[dict[str, Any]] = []
    last: list[tuple[dict[str, Any], list[float]]] = []  # the places in the step before, and where
    for year in steps:
        now = []
        for entry in reports[year]["stateless"]["enclosed"]:
            if entry["km2"] < OWED_KM2 or entry.get("correction"):
                continue
            place = next((p for p, at in last if _near(at, entry["at"])), None)
            if place is None:
                place = {"at": entry["at"], "km2": 0, "years": [year, year], "states": []}
                holes.append(place)
            place["years"][1] = ends[year]
            if entry["km2"] > place["km2"]:
                place["km2"], place["at"] = entry["km2"], entry["at"]
            place["states"] = sorted(set(place["states"]) | set(entry["states"]))
            place["lake"] = place.get("lake", False) or entry["lake"]
            now.append((place, entry["at"]))
        last = now
    return {"holes": holes, "gaps": _gaps(steps, ends, reports, config, land)}


def _near(a: Sequence[float], b: Sequence[float]) -> bool:
    """Two points of one hole in steps side by side: its outline moves, but not far."""
    return abs(a[0] - b[0]) <= 2 and abs(a[1] - b[1]) <= 2


def _gaps(
    steps: Sequence[int],
    ends: Mapping[int, int],
    reports: Mapping[int, dict[str, Any]],
    config: Config,
    land: np.ndarray,
) -> list[dict[str, Any]]:
    stateless = np.stack([unpack_cells(reports[y]["statelessCells"]) for y in steps])
    held = land[None] & ~stateless
    lat = np.arange(-90 + CELL_DEG / 2, 90, CELL_DEG)
    cell_km2 = (EARTH_KM * math.radians(CELL_DEG)) ** 2 * np.cos(np.radians(lat))[:, None]
    cited = [
        (c.years, _cell_of(c.op.at))
        for c in config.corrections
        if isinstance(c.op, Pocket) and c.op.stateless
    ]
    listed = [
        (year, _cell_of(entry["at"]))
        for year in steps
        for entry in reports[year]["stateless"]["enclosed"]
        if entry["km2"] >= OWED_KM2
    ]
    gaps = []
    for a in range(1, len(steps) - 1):
        alive = held[a - 1] & stateless[a]
        for b in range(a, len(steps) - 1):
            if not alive.any() or steps[b + 1] - steps[a] > GAP_YEARS:
                break
            labels, count = ndimage.label(alive & held[b + 1])
            first, last = steps[a], ends[steps[b]]
            for k in range(1, count + 1):
                region = labels == k
                km2 = float((cell_km2 * region).sum())
                if km2 < OWED_KM2:
                    continue
                if any(first <= y <= last and region[cell] for y, cell in listed):
                    continue
                if any(f <= last and first <= t and region[cell] for (f, t), cell in cited):
                    continue
                rows, columns = np.nonzero(region)
                at = [
                    round(float(columns.mean()) * CELL_DEG - 180 + CELL_DEG / 2, 1),
                    round(float(rows.mean()) * CELL_DEG - 90 + CELL_DEG / 2, 1),
                ]
                gaps.append({"at": at, "km2": round(km2), "years": [first, last]})
            alive &= stateless[b + 1]
    return sorted(gaps, key=lambda g: (g["years"], g["at"]))


def unchanged(
    config: Config, years: Sequence[int], applied: Mapping[int, frozenset[int]]
) -> list[str]:
    """Each correction that leaves a step in its range unchanged, naming those steps."""
    errors = []
    for k, c in enumerate(config.corrections):
        missed = [y for y in years if c.years[0] <= y <= c.years[1] and k not in applied[y]]
        if missed:
            errors.append(f"{c.label()} changes nothing in the steps {', '.join(map(str, missed))}")
    return errors


def polities_document(
    source: Cliopatria, config: Config, steps: Sequence[tuple[int, Mapping[str, str]]]
) -> dict[str, dict[str, Any]]:
    """`polities.json`: keyed by name, each polity's id, Wikidata ids and outer unit through the
    steps, `[first step, last step, outer unit]` for each run of steps it is drawn in under one
    outer unit. `steps` gives each step's year and its polities' outer units, in order."""
    ids = polity_ids(source, config)
    wikidata: dict[str, list[str]] = defaultdict(list)
    for row in source.rows:
        if row.polity and row.wikidata and row.wikidata not in wikidata[row.name]:
            wikidata[row.name].append(row.wikidata)
    for c in config.corrections:
        if isinstance(c.op, Add) and c.op.wikidata and c.op.wikidata not in wikidata[c.op.polity]:
            wikidata[c.op.polity].append(c.op.wikidata)
    runs: dict[str, list[list[Any]]] = defaultdict(list)
    previous: dict[str, str] = {}
    for year, outers in steps:
        shown = dict(outers)
        for unit in set(outers.values()):
            shown.setdefault(unit, unit)
        current: dict[str, str] = {}
        for name, unit in sorted(shown.items()):
            if previous.get(name) == unit:
                runs[name][-1][1] = year
            else:
                runs[name].append([year, year, unit])
            current[name] = unit
        previous = current
    return {
        name: {"id": ids[name], "wikidata": wikidata.get(name, []), "steps": runs[name]}
        for name in sorted(runs)
    }


def returns(source: Cliopatria) -> list[dict[str, Any]]:
    """Each time a polity's rows stop and later resume: its name and the years it is gone."""
    spans: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for row in source.rows:
        if row.polity and not row.composite:
            spans[row.name].append((row.first, row.last))
    gone = []
    for name, found in sorted(spans.items()):
        found.sort()
        for (_, last), (first, _) in itertools.pairwise(found):
            if first > last + 1:
                gone.append({"polity": name, "gone": [last + 1, first - 1]})
    return gone


def review_queue(
    source: Cliopatria,
    config: Config,
    years: Sequence[int],
    reports: Mapping[int, dict[str, Any]],
    failed: Mapping[int, str],
    errors: Sequence[str],
    owing: Mapping[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """What the history pass reviews, gathered over every step, with what it owes (`owed`)."""
    unclassified: dict[str, dict[str, list[int]]] = {"composites": {}, "relations": {}}
    unsettled: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(list)
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for year in years:
        report = reports.get(year)
        if report is None:
            continue
        for kind in ("composites", "relations"):
            for name in report["unclassified"][kind]:
                unclassified[kind].setdefault(name, []).append(year)
        for entry in report["unsettled"]:
            unsettled[(entry["polity"], tuple(entry["memberOf"]))].append(year)
        for overlap in report["overlaps"]:
            key = tuple(overlap["polities"])
            seen = pairs.setdefault(
                key,
                {
                    "polities": list(key),
                    "steps": [],
                    "duplicate": [],
                    "unacknowledged": [],
                    "km2": 0,
                    "share": 0.0,
                    "winners": [],
                },
            )
            seen["steps"].append(year)
            if overlap["duplicate"]:
                seen["duplicate"].append(year)
                if not overlap["acknowledged"]:
                    seen["unacknowledged"].append(year)
            seen["km2"] = max(seen["km2"], overlap["km2"])
            seen["share"] = max(seen["share"], overlap["share"])
            if overlap["winner"] not in seen["winners"]:
                seen["winners"].append(overlap["winner"])
    ordered = sorted(pairs.values(), key=lambda p: (p["steps"][0], p["polities"]))
    return {
        "source": SOURCE,
        "steps": list(years),
        "failed": [{"year": y, "error": failed[y]} for y in sorted(failed)],
        "unchanged": list(errors),
        "unclassified": {
            kind: [{"name": n, "steps": _spans(ys, years)} for n, ys in sorted(found.items())]
            for kind, found in unclassified.items()
        },
        "unsettled": [
            {"polity": p, "memberOf": list(m), "steps": _spans(ys, years)}
            for (p, m), ys in sorted(unsettled.items())
        ],
        "overlaps": {
            "unacknowledged": [p for p in ordered if p["unacknowledged"]],
            "acknowledged": [p for p in ordered if p["duplicate"] and not p["unacknowledged"]],
            "smaller": [p for p in ordered if not p["duplicate"]],
        },
        "returns": returns(source),
        "owed": dict(owing),
        "byStep": {
            str(y): {
                key: reports[y][key]
                for key in (
                    "leaves",
                    "drawn",
                    "added",
                    "removed",
                    "unexplained",
                    "outer",
                    "minorPieces",
                    "leftovers",
                    "carried",
                    "stateless",
                )
            }
            for y in years
            if y in reports
        },
    }


def _spans(found: Sequence[int], years: Sequence[int]) -> list[list[int]]:
    """Runs of consecutive steps, as [first step, last step]."""
    index = {y: k for k, y in enumerate(years)}
    spans: list[list[int]] = []
    for year in found:
        if spans and index[spans[-1][1]] == index[year] - 1:
            spans[-1][1] = year
        else:
            spans.append([year, year])
    return spans


# Running every step ----------------------------------------------------------------------------

type Summary = tuple[int, dict[str, Any] | None, frozenset[int], dict[str, str], str | None]
# A step's year, the land it carries, and where its Plain is written when it is selected without.
type Work = tuple[int, tuple[Carried, ...], Path | None]

_worker: tuple[Cliopatria, Config, Terrain] | None = None


def selections(
    ctx: Context, work: Sequence[Work], source: Cliopatria, config: Config, terrain: Terrain
) -> Iterator[Summary]:
    """Each step's report, the corrections it applied, its polities' outer units and its error, in
    the order of `work`, from `ctx.jobs` worker processes; a step given a path writes its Plain
    there."""
    if ctx.jobs <= 1:
        for item in work:
            yield _select_summary(item, source, config, terrain)
        return
    with ProcessPoolExecutor(
        max_workers=ctx.jobs,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=_start,
        initargs=(ctx, terrain.to_wkb()),
    ) as pool:
        yield from pool.map(_task, work)


def _start(ctx: Context, terrain: bytes) -> None:
    global _worker
    _worker = (
        load_cliopatria(ctx),
        load_config(config_dir(ctx.repo) / CONFIG),
        Terrain.from_wkb(terrain),
    )


def _task(work: Work) -> Summary:
    if _worker is None:
        raise RuntimeError("the selection's inputs exist only inside a selection worker")
    return _select_summary(work, *_worker)


def _select_summary(work: Work, source: Cliopatria, config: Config, terrain: Terrain) -> Summary:
    year, carried, path = work
    try:
        chosen = select(year, source, config, terrain, carried)
    except SelectionError as error:
        return year, None, frozenset(), {}, str(error)
    if path is not None:
        write_plain(path, Plain.of(chosen))
    return year, chosen.report, chosen.applied, chosen.outers(), None


def write_plain(path: Path, plain: Plain) -> None:
    """Writes the Plain whole: another run sees all of it or none."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    partial.write_bytes(plain.to_bytes())
    partial.replace(path)


def read_plains(paths: Iterable[Path]) -> Iterator[Plain]:
    for path in paths:
        yield Plain.from_bytes(path.read_bytes())


def write_review(ctx: Context) -> int:
    """Selects every step, then again those the carry-through reaches, and writes the review queue;
    the count of failed steps and unchanged corrections."""
    started = time.perf_counter()
    source = load_cliopatria(ctx)
    config = load_config(config_dir(ctx.repo) / CONFIG)
    terrain = load_terrain(ctx)
    years = step_years(source, config)
    print(f"cliopatria: {len(source.rows)} rows, {len(years)} steps", flush=True)
    summaries: dict[int, Summary] = {}
    ctx.cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ctx.cache, prefix="plain-") as folder:
        paths = {year: Path(folder) / f"{year}.bin" for year in years}
        work: list[Work] = [(year, (), paths[year]) for year in years]
        for count, summary in enumerate(selections(ctx, work, source, config, terrain), 1):
            summaries[summary[0]] = summary
            _progress("selected", count, len(work), summary, started)
        carried = carry_through(read_plains(paths[y] for y in years if paths[y].is_file()))
    again: list[Work] = [(year, carried[year], None) for year in years if year in carried]
    print(f"cliopatria: {len(again)} steps carry land through a stateless run", flush=True)
    for count, summary in enumerate(selections(ctx, again, source, config, terrain), 1):
        summaries[summary[0]] = summary
        _progress("carried", count, len(again), summary, started)
    reports = {y: s[1] for y, s in summaries.items() if s[1] is not None}
    applied = {y: s[2] for y, s in summaries.items()}
    failed = {y: s[4] for y, s in summaries.items() if s[4] is not None}
    errors = unchanged(config, [y for y in years if y not in failed], applied)
    owing = owed(years, reports, config, cells(terrain.dry))
    queue = review_queue(source, config, years, reports, failed, errors, owing)
    path = ctx.stages_dir / REVIEW
    write_json(path, queue)
    overlaps = queue["overlaps"]
    print(
        f"cliopatria: {path.relative_to(ctx.repo) if path.is_relative_to(ctx.repo) else path}: "
        f"{len(failed)} steps failed, {len(errors)} corrections unchanged, "
        f"{len(overlaps['unacknowledged'])} unacknowledged pairs, "
        f"{len(overlaps['smaller'])} smaller overlaps, {len(queue['returns'])} returns, "
        f"{len(owing['holes'])} holes and {len(owing['gaps'])} gaps owed, "
        f"{time.perf_counter() - started:.0f} s",
        flush=True,
    )
    return len(failed) + len(errors)


def _progress(doing: str, count: int, total: int, summary: Summary, started: float) -> None:
    year, error = summary[0], summary[4]
    if error is not None:
        print(f"cliopatria: {year} fails: {error}", flush=True)
    if count % 25 == 0 or count == total:
        seconds = time.perf_counter() - started
        print(f"cliopatria: {doing} {count} of {total} steps, {year}, {seconds:.0f} s", flush=True)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m prebuild.cliopatria")
    parser.add_argument("--profile", choices=[p.value for p in Profile], default="global")
    parser.add_argument("--jobs", type=int, default=default_jobs())
    args = parser.parse_args(argv)
    ctx = make_context(Profile(args.profile), args.jobs)
    sys.exit(1 if write_review(ctx) else 0)


if __name__ == "__main__":
    main()
