"""The borders stage (streaming.md 3.3, 7.1, 7.2): the border steps from Cliopatria, one field per
state of the world from 3400 BCE to 2000, and, until Tambora moves onto the steps, milestone 1's
1815 field from a historical-basemaps snapshot.

**Steps** (global and fixture profiles). The selection (cliopatria.py) gives each step's polities,
their outer units and the stateless land, and step_fields.py bakes each step's field and preview,
skipping those the cache holds. The stage then writes, in the profile's output root:

- each step's field as `fd/borders/s/<sha16>.bin`, a step whose field equals the one before
  dropped;
- the previews in chunks of step_fields.PER_CHUNK as `fd/borders/p/<sha16>.bin`;
- `polities.json`, each polity's id, Wikidata ids and outer unit through the steps, as
  `fd/borders/m/<sha16>.json`;
- the CC BY 4.0 notice, Cliopatria's attribution and every correction with its source, as
  `lic/<sha16>.txt`;

and beside its record the review queue `borders-review.json` and `borders-lakes.bin`, the lakes'
shores `npm run verify:bake` checks the borders against. A step that fails, a correction that
leaves a step in its range unchanged, or a story's border beat before the first step fails the
stage, after the queue is written. The fixture bakes the two years of its excerpt.

**The 1815 field** (global and region profiles). For each snapshot `world_<stem>.geojson` pinned
in `sources.toml` the stage applies the cited corrections in `pipeline/config/borders-<stem>.yaml`,
then, face by face (border_fields.py):

1. rasterizes the polities, largest first so enclaves stay, at 4x4 subpixels per texel in
   face-global subpixels (as fields.py does for coasts), over the face, its apron and a margin;
2. gives every subpixel no polity holds (the sea, and the slivers between the source's coarse
   coast and Natural Earth's) the polity nearest it, so no border ever follows a coast: the look
   draws borders on land only, and they end where it draws the coast;
3. takes each subpixel's distance E to the nearest subpixel center of another polity, D = E - 0.5,
   signed + on the side of the higher polity id; a texel's d is the mean D of its 2x2 central
   subpixels divided by 4, and where those straddle two borders' sides rather than a border (a
   polity's middle, where the nearest border changes), the mean of their sizes.

A polity is the snapshot's NAME, else its SUBJECTO; features with neither are one "unclaimed"
polity, so the lines between unnamed features never draw but a polity's edge against unclaimed land
does. Each face stores FACE_TEXELS texels a side, apron included.

    'WBF1' u8 version | u8 faces (6) | u16 size (texels a side) | u16 apron | i16 year | u32 pad
    u8 d[6][size][size]    min(255, rha(128 + 16·clamp(d, -8, 8))), d in texels, + on the higher id

stored gzip level 9, mtime 0, as `fd/borders/<ver8>/<stem>.bin`, the corrected source as
`lic/<sha16>.geojson` and the GPL notice as `lic/<sha16>.txt`. The fixture never bakes it: its
source is never committed.

The record `build/stages/<profile>/borders.json` holds release.json's `borderSteps` section as
`steps`, the step each story's border beats draw, the overlap pairs no correction acknowledges,
the composites and relations `hierarchy.yaml` does not class, the stateless holes and gaps the
history pass owes a cited verdict (`owed`), and the 1815 field's `borders` section as is
(streaming.md 3.8, 7.2).
"""

import bisect
import copy
import gzip
import json
import re
import shutil
import struct
import textwrap
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import shapely
import yaml

from prebuild import cliopatria as clio
from prebuild import events, step_fields
from prebuild.border_fields import (
    APRON,
    MARGIN_TEXELS,
    Polity,
    extend,
    rasterize,
    signed_subpixels,
    texel_distance,
)
from prebuild.codes import field_bytes
from prebuild.config import CONFIG_DIR, ConfigError
from prebuild.constants import FORMATS
from prebuild.fields import SUBPIXELS
from prebuild.hashing import CODE_PATHS, layer_version, sha256_bytes, sha256_file, tree_sha
from prebuild.layers import publish, staging_folder, write_object
from prebuild.media import BEAT_BLOCK
from prebuild.natural_earth import parts_of_dimension
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import write_json, write_record
from prebuild.sources import Source, load_sources, verified_path

STAGE = "borders"
LAYER = "fd/borders"
STEPS, PREVIEWS, POLITIES = "s", "p", "m"  # the steps' folders under LAYER
LICENSES = "lic"
SHORES = "borders-lakes.bin"  # beside the record: the lakes' shores, for verify:bake
LAND = "borders-land.bin"  # beside the record: the land less lakes, for verify:bake
SOURCE = "historical-basemaps"  # the 1815 field's source id in sources.toml
SNAPSHOT = re.compile(r"world_(bc\d+|\d+)\.geojson")
FACE_TEXELS = 2048  # the 1815 field's texels per face side, apron included
MAGIC = str(FORMATS["borderField"]["magic"]).encode("ascii")
VERSION = int(FORMATS["borderField"]["version"])
HEADER = struct.Struct("<4sBBHHhI")  # 16 bytes
BUILD_SCRIPTS = "https://github.com/tcole333/wander/tree/borders-{ver}/pipeline"
GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.txt"
UNCLAIMED = ""  # the polity key of land the snapshot names no polity for


class BordersError(ValueError):
    """A snapshot or its corrections are not what the stage expects."""


@dataclass(frozen=True)
class Correction:
    polity: str
    becomes: str
    at: tuple[float, float] | None  # only the part holding this point, else all of the polity
    why: str
    source: Mapping[str, str]  # title, publisher, url


@dataclass(frozen=True)
class Corrections:
    modified: str  # the notice's date, YYYY-MM-DD
    items: tuple[Correction, ...]


def run(ctx: Context) -> None:
    record: dict[str, Any] = {}
    if ctx.profile is not Profile.REGION:
        record |= bake_steps(ctx)
    if ctx.profile is not Profile.FIXTURE:
        record |= bake_snapshots(ctx)
    write_record(ctx, STAGE, record)


# The steps -------------------------------------------------------------------------------------


def bake_steps(ctx: Context) -> dict[str, Any]:
    """Selects and bakes every step, writes their files, and returns the record's steps, beats,
    unacknowledged, unclassified and owed entries and inputs."""
    started = time.perf_counter()
    code = tree_sha(CODE_PATHS, ctx.repo)  # before the stage reads it, so a later edit is stale
    source = clio.load_cliopatria(ctx)
    config = clio.load_config(config_dir(ctx.repo) / clio.CONFIG)
    terrain = clio.load_terrain(ctx)
    years = clio.step_years(source, config)
    print(f"borders: {len(source.rows)} Cliopatria rows, {len(years)} steps", flush=True)
    masks = step_fields.terrain_masks(ctx, terrain, config.rules.sliver_km, ctx.jobs)
    identity = step_fields.code_identity(ctx.repo, masks)
    keys = {year: step_fields.step_key(year, source, config, identity) for year in years}

    def progress(count: int, total: int, year: int) -> None:
        if count % 25 == 0 or count == total:
            seconds = time.perf_counter() - started
            print(f"borders: baked {count} of {total} steps, {year}, {seconds:.0f} s", flush=True)

    baked: dict[int, step_fields.Baked] = {}
    failed: dict[int, str] = {}
    chosen = step_fields.bake_steps(ctx, keys, source, config, terrain, masks, progress)
    for year, step, error in chosen:
        if step is None:
            failed[year] = str(error)
            print(f"borders: {year} fails: {error}", flush=True)
        else:
            baked[year] = step
    digests = [step_fields.operation_digest(c, source) for c in config.corrections]
    applied = {
        year: frozenset(k for k, d in enumerate(digests) if d in step.applied)
        for year, step in baked.items()
    }
    unchanged = clio.unchanged(config, sorted(baked), applied)
    reports = {year: step.report for year, step in baked.items()}
    owing = clio.owed(years, reports, config, clio.cells(terrain.dry))
    queue = clio.review_queue(source, config, years, reports, failed, unchanged, owing)
    for year, used in applied.items():
        labels = [config.corrections[k].label() for k in sorted(used)]
        queue["byStep"][str(year)]["corrections"] = labels
    write_json(ctx.stages_dir / clio.REVIEW, queue)
    write_terrain(ctx, masks)
    if failed or unchanged:
        problems = [f"{year}: {failed[year]}" for year in sorted(failed)] + unchanged
        raise BordersError(
            f"{len(failed)} steps fail and {len(unchanged)} corrections change nothing "
            f"(see {ctx.stages_dir / clio.REVIEW}): {'; '.join(problems[:5])}"
        )
    kept = distinct(years, baked)
    steps = write_steps(ctx, source, config, kept, baked)
    beats = border_beats(ctx.repo, steps["years"])
    total = sum(steps["bytes"]) + sum(steps["previews"]["bytes"])
    print(
        f"borders: {len(kept)} steps ({len(years) - len(kept)} equal to the one before) and "
        f"{len(steps['previews']['keys'])} preview chunks, {total / 1e6:.1f} MB, "
        f"{time.perf_counter() - started:.0f} s",
        flush=True,
    )
    return {
        "steps": steps,
        "beats": beats,
        "unacknowledged": unacknowledged(kept, baked),
        "unclassified": {
            kind: [entry["name"] for entry in queue["unclassified"][kind]]
            for kind in ("composites", "relations")
        },
        "owed": owing,
        "inputs": {"code": code, "cliopatria": source_sha(ctx)},
    }


def distinct(years: Sequence[int], baked: Mapping[int, step_fields.Baked]) -> list[int]:
    """The steps whose field differs from the step before's."""
    kept: list[int] = []
    for year in years:
        if not kept or baked[year].planes != baked[kept[-1]].planes:
            kept.append(year)
    return kept


def write_steps(
    ctx: Context,
    source: clio.Cliopatria,
    config: clio.Config,
    kept: Sequence[int],
    baked: Mapping[int, step_fields.Baked],
) -> dict[str, Any]:
    """Writes the steps, their preview chunks, the polities and the notice; release.json's
    borderSteps section."""
    keys, sizes, digests = [], [], {}
    for year in kept:
        data = baked[year].field()
        key = f"{LAYER}/{STEPS}/{sha256_bytes(data)[:16]}.bin"
        write_object(ctx.out / key, data)
        keys.append(key)
        sizes.append(len(data))
        digests[key] = sha256_bytes(data)
    chunks, chunk_sizes = [], []
    per = step_fields.PER_CHUNK
    for first in range(0, len(kept), per):
        group = kept[first : first + per]
        data = step_fields.chunk_file(group, [baked[year].preview() for year in group])
        key = f"{LAYER}/{PREVIEWS}/{sha256_bytes(data)[:16]}.bin"
        write_object(ctx.out / key, data)
        chunks.append(key)
        chunk_sizes.append(len(data))
        digests[key] = sha256_bytes(data)
    document = clio.polities_document(source, config, [(y, baked[y].outers) for y in kept])
    data = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    polities_key = f"{LAYER}/{POLITIES}/{sha256_bytes(data)[:16]}.json"
    write_object(ctx.out / polities_key, data)
    digests[polities_key] = sha256_bytes(data)
    text = steps_notice(load_sources()[clio.SOURCE], config).encode("utf-8")
    notice_key = write_license_file(ctx.out, text, "txt")
    digests[notice_key] = sha256_bytes(text)
    return {
        "ver": layer_version(digests),
        "size": step_fields.STEP_TEXELS,
        "apron": APRON,
        "years": list(kept),
        "keys": keys,
        "bytes": sizes,
        "previews": {"per": per, "keys": chunks, "bytes": chunk_sizes},
        "polities": polities_key,
        "notice": notice_key,
    }


def unacknowledged(
    kept: Sequence[int], baked: Mapping[int, step_fields.Baked]
) -> list[dict[str, Any]]:
    """Each overlap pair no `overlap` correction acknowledges, with the steps it needs one in."""
    steps: dict[tuple[str, str], list[int]] = {}
    for year in kept:
        for pair in baked[year].unacknowledged:
            steps.setdefault(pair, []).append(year)
    return [{"polities": list(pair), "steps": found} for pair, found in sorted(steps.items())]


def first_day(year: int) -> int:
    """The day a step beginning in `year` holds from: its 1 January in the historical calendar
    (Julian before 15 October 1582), as a day number (streaming.md 3.0)."""
    return events.day_number(*events.from_historical((year, 1, 1)))


def border_beats(repo: Path, years: Sequence[int]) -> dict[str, dict[str, int]]:
    """The step each story's border beats draw: the last one beginning on or before the beat's
    day. A border beat before the first step fails."""
    days = [first_day(year) for year in years]
    found: dict[str, dict[str, int]] = {}
    for path in sorted((repo / "stories").glob("*/story.md")):
        story = path.parent.name
        for block in BEAT_BLOCK.findall(path.read_text(encoding="utf-8")):
            beat = yaml.safe_load(block)
            layers = beat.get("layers", [])
            if "borders" not in [next(iter(i)) if isinstance(i, dict) else i for i in layers]:
                continue
            date = str(beat["date"])
            match = events.DATE.match(f"{date}T")
            if match is None:
                raise BordersError(f"{story}'s beat {beat['id']}: {date!r} is not an ISO date")
            day = events.day_number(int(match[1]), int(match[2]), int(match[3]))
            index = bisect.bisect_right(days, day) - 1
            if index < 0:
                raise BordersError(
                    f"{story}'s beat {beat['id']} on {date} draws borders before the first border "
                    f"step, {years[0] if years else 'none'}"
                )
            found.setdefault(story, {})[str(beat["id"])] = years[index]
    return found


def source_sha(ctx: Context) -> str:
    """The sha256 of the Cliopatria file the selection read: the pinned zip's, or the excerpt's."""
    if ctx.profile is Profile.FIXTURE:
        return sha256_file(excerpts_dir(ctx.repo) / clio.EXCERPT / clio.EXCERPT_FILE)
    return next(f.sha256 for f in load_sources()[clio.SOURCE].files if f.path.endswith(clio.ZIP))


def write_terrain(ctx: Context, masks: step_fields.Terrain) -> None:
    """Beside the record, what `npm run verify:bake` checks the steps against, each gzip, face
    after face at the steps' texels: `borders-lakes.bin`, the signed distance to the drawn lakes'
    shores as R stores it, + off the lakes; and `borders-land.bin`, a byte per texel, 1 where at
    least 2 of its 2x2 central subpixels lie on land less lakes."""
    side = step_fields.face_side(masks.texels)
    m = SUBPIXELS * MARGIN_TEXELS
    land = []
    for packed in masks.dry:
        dry = step_fields._unpack(packed, (side, side))[m:-m, m:-m]
        blocks = dry.reshape(dry.shape[0] // SUBPIXELS, SUBPIXELS, dry.shape[1] // SUBPIXELS, -1)
        central = sum(blocks[:, i, :, j].astype(np.uint8) for i in (1, 2) for j in (1, 2))
        land.append((central >= 2).astype(np.uint8).tobytes())
    ctx.stages_dir.mkdir(parents=True, exist_ok=True)
    for name, faces in ((SHORES, masks.shores), (LAND, land)):
        data = gzip.compress(b"".join(faces), compresslevel=6, mtime=0)
        (ctx.stages_dir / name).write_bytes(data)


def steps_notice(source: Source, config: clio.Config) -> str:
    """The CC BY 4.0 notice published beside the steps (owner decision 33): what they are drawn
    from, under which license, and what Wander changed, every correction with its source."""
    pinned = next(f for f in source.files if f.path.endswith(clio.ZIP))
    title = source.name.split(",")[0]
    corrections = [
        f"{_years(c.years)}: {describe(c.op)}. {c.why}{_cited(c.source)}"
        for c in config.corrections
    ]
    changes = [
        "Each border step draws the polities Cliopatria gives for the years it holds, from "
        "3400 BCE to 2000. Composite polities and vassal relations are nested as Wander classes "
        "them, an empire's members inside one outer border; land no polity holds is drawn as "
        "stateless, less the slivers along its coasts and the small pockets it leaves inland; and "
        "where two polities overlap, the smaller keeps the land they share unless a correction "
        "names the other.",
        "They are drawn on the six faces of Wander's cube sphere, "
        f"{step_fields.STEP_TEXELS - 2 * APRON:,} texels along each face edge, as signed distances "
        "to the borders, with a preview of each step's outer borders.",
        "The corrections below are applied." if corrections else "No corrections are applied.",
    ]
    lines = [
        "Wander's borders through time",
        "",
        *_wrap(f"These borders are drawn from {title} {source.version}:"),
        *_wrap(source.attribution, "  "),
        f"  {source.landing_page}",
        f"  {pinned.source_url}",
        "",
        *_wrap(f"{title} is licensed under {_license_name(source)}:"),
        f"  {source.license_url}",
        "",
        f"Changed for Wander, last on {max(config.modified.values(), default='')}:",
        *[line for change in changes for line in _wrap(change, "- ")],
        *(["", "Corrections:"] if corrections else []),
        *[line for c in corrections for line in _wrap(c, "- ")],
        "",
    ]
    return "\n".join(lines)


def describe(op: clio.Operation) -> str:
    """What a correction does, in a clause."""
    match op:
        case clio.Give(polity, to, at, shape_from, member_of):
            part = (
                f"the part of {polity} at {at[0]}, {at[1]}"
                if at
                else f"the part of {polity} inside {shape_from[0]}'s shape of "
                f"{_year(shape_from[1])}"
                if shape_from
                else polity
            )
            member = f", a member of {member_of}" if member_of else ""
            return f"{part} is drawn as {to}{member}"
        case clio.Carry(polity, year):
            return f"{polity} is drawn with its shape of {_year(year)}"
        case clio.Add(polity, _, _, member_of):
            member = f", a member of {member_of}" if member_of else ""
            return f"{polity} is drawn with a shape from the source{member}"
        case clio.Drop(polity, _):
            return f"{polity}'s pieces inside a shape from the source are taken away"
        case clio.Member(polity, of):
            return f"{polity} is a member of {of}"
        case clio.Rename(polity, to):
            return f"{polity} is named {to}"
        case clio.Pocket(at, _, str() as to, shape_from, shape):
            land = f"the stateless land at {at[0]}, {at[1]}"
            if shape_from:
                name, year = shape_from
                land = f"the part of {land} inside {name}'s shape of {_year(year)}"
            elif shape is not None:
                land = f"the part of {land} inside a shape from the source"
            return f"{land} is drawn as {to}"
        case clio.Pocket(at, stateless):
            fate = "stays stateless" if stateless else "goes to its neighbours"
            return f"the stateless land at {at[0]}, {at[1]} {fate}"
        case clio.Overlap((a, b), winner):
            return f"where {a} and {b} overlap, {winner} keeps the land"
    raise BordersError(f"no description of {op!r}")


def _year(year: int) -> str:
    return str(year) if year > 0 else f"{1 - year} BCE"


def _years(years: tuple[int, int]) -> str:
    first, last = years
    return _year(first) if first == last else f"{_year(first)}-{_year(last)}"


def _cited(source: Mapping[str, str] | None) -> str:
    if source is None:
        return ""
    fields = [source["title"], source["publisher"], source["url"], source.get("locator")]
    return f" Source: {', '.join(f for f in fields if f)}."


# The 1815 field --------------------------------------------------------------------------------


def bake_snapshots(ctx: Context) -> dict[str, Any]:
    """Bakes each pinned historical-basemaps snapshot and returns release.json's `borders`
    section."""
    started = time.perf_counter()
    source = load_sources()[SOURCE]
    stems = snapshot_stems(source)
    layer = ctx.out / LAYER
    staging = staging_folder(layer)
    digests: dict[str, str] = {}
    sizes: dict[str, int] = {}
    corrected: dict[str, bytes] = {}
    fixes: dict[str, Corrections] = {}
    try:
        for stem in stems:
            path = verified_path(ctx, SOURCE, f"world_{stem}.geojson")
            fixes[stem] = load_corrections(stem)
            collection = correct(json.loads(path.read_bytes()), fixes[stem].items)
            corrected[stem] = geojson_bytes(collection)
            drawn = polities(collection)
            faces = [face_field(face, drawn, FACE_TEXELS) for face in range(6)]
            stored = to_file(np.stack(faces), stem_year(stem))
            (staging / f"{stem}.bin").write_bytes(stored)
            digests[f"{stem}.bin"] = sha256_bytes(stored)
            sizes[stem] = len(stored)
        ver = publish(staging, layer, digests)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    files = {}
    for stem in stems:
        key = f"{LAYER}/{ver}/{stem}.bin"
        source_key = write_license_file(ctx.out, corrected[stem], "geojson")
        text = notice(source, stem, fixes[stem], ver, key, source_key)
        notice_key = write_license_file(ctx.out, text.encode("utf-8"), "txt")
        files[stem] = {"key": key, "bytes": sizes[stem], "notice": notice_key, "source": source_key}
    seconds = time.perf_counter() - started
    total = sum(sizes.values()) / 1e6
    print(
        f"borders: {', '.join(stems)} into {LAYER}/{ver}/, {total:.1f} MB, {seconds:.1f} s",
        flush=True,
    )
    return {"ver": ver, "stems": stems, "years": [stem_year(s) for s in stems], "files": files}


def snapshot_stems(source: Source) -> list[str]:
    """The stems of the pinned snapshots, oldest first: `world_1815.geojson` gives 1815."""
    stems = [m.group(1) for f in source.files if (m := SNAPSHOT.fullmatch(Path(f.path).name))]
    return sorted(stems, key=stem_year)


def stem_year(stem: str) -> int:
    """A stem's astronomical year: `bc123000` is 1 - 123000, `1815` is 1815 (streaming.md 3.0)."""
    return 1 - int(stem[2:]) if stem.startswith("bc") else int(stem)


def polity_key(properties: Mapping[str, Any]) -> str:
    """The polity a feature belongs to: its NAME, else its SUBJECTO, else unclaimed land."""
    for field in ("NAME", "SUBJECTO"):
        value = properties.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return UNCLAIMED


def load_corrections(stem: str, directory: Path = CONFIG_DIR) -> Corrections:
    """`borders-<stem>.yaml`, or none when the snapshot has no such file."""
    path = directory / f"borders-{stem}.yaml"
    if not path.is_file():
        return Corrections(modified="", items=())
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or set(doc) != {"modified", "corrections"}:
        raise ConfigError(f"{path.name} needs exactly the keys corrections, modified")
    items = []
    for row in doc["corrections"]:
        keys = {"polity", "becomes", "why", "source"}
        if not isinstance(row, dict) or not keys <= set(row) <= keys | {"at"}:
            raise ConfigError(f"{path.name}: a correction needs {', '.join(sorted(keys))}")
        source = row["source"]
        if not isinstance(source, dict) or set(source) != {"title", "publisher", "url"}:
            raise ConfigError(f"{path.name}: {row['polity']}'s source needs title, publisher, url")
        at = row.get("at")
        items.append(
            Correction(
                polity=str(row["polity"]),
                becomes=str(row["becomes"]),
                at=None if at is None else (float(at[0]), float(at[1])),
                why=" ".join(str(row["why"]).split()),
                source={key: str(value) for key, value in source.items()},
            )
        )
    return Corrections(modified=str(doc["modified"]), items=tuple(items))


def correct(collection: Mapping[str, Any], corrections: Sequence[Correction]) -> dict[str, Any]:
    """The snapshot with each correction applied in turn: the polity's polygons (only the one
    holding `at`, if given) join the first feature of the polity it becomes, and a feature left
    with none is dropped. Every other feature stays as it was."""
    fixed = copy.deepcopy(dict(collection))
    features: list[dict[str, Any]] = fixed["features"]
    for c in corrections:
        target = next((f for f in features if polity_key(f["properties"]) == c.becomes), None)
        if target is None:
            raise BordersError(f"no polity {c.becomes!r} to give {c.polity}'s land to")
        moved = []
        for feature in features:
            if polity_key(feature["properties"]) != c.polity:
                continue
            parts = _polygons(feature["geometry"])
            taking = [p for p in parts if c.at is None or _holds(p, c.at)]
            moved += taking
            feature["geometry"] = {
                "type": "MultiPolygon",
                "coordinates": [p for p in parts if not any(p is q for q in taking)],
            }
        if not moved:
            where = "" if c.at is None else f" at {c.at}"
            raise BordersError(f"no land of {c.polity!r}{where} to correct")
        target["geometry"] = {
            "type": "MultiPolygon",
            "coordinates": _polygons(target["geometry"]) + moved,
        }
        features[:] = [f for f in features if f["geometry"]["coordinates"]]
    return fixed


def geojson_bytes(collection: Mapping[str, Any]) -> bytes:
    """The corrected source as published: compact UTF-8 JSON, keys in the source's order."""
    return json.dumps(collection, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def polities(collection: Mapping[str, Any]) -> list[Polity]:
    """Each feature's polygons with its polity's id, largest first: ids number the polity keys in
    sorted order from 1, unclaimed land first; 0 is left for no polity."""
    features = collection["features"]
    keys = sorted({polity_key(f["properties"]) for f in features})
    ids = {key: k + 1 for k, key in enumerate(keys)}
    drawn = []
    for feature in features:
        geometry = shapely.make_valid(shapely.from_geojson(json.dumps(feature["geometry"])))
        parts = parts_of_dimension(geometry, 2)
        if parts.size == 0:
            continue
        shape = shapely.multipolygons(parts)
        drawn.append(Polity(ids[polity_key(feature["properties"])], shape, shapely.area(shape)))
    if len(ids) > int(np.iinfo(np.uint16).max):
        raise BordersError(f"{len(ids)} polities do not fit u16 ids")
    return sorted(drawn, key=lambda p: (-p.area, p.id))


def face_field(
    face: int, drawn: Sequence[Polity], texels: int = FACE_TEXELS
) -> npt.NDArray[np.uint8]:
    """The stored bytes of one face, texels x texels, row 0 the smallest t."""
    subpixels = signed_subpixels(extend(rasterize(face, drawn, texels - 2 * APRON)))
    m = SUBPIXELS * MARGIN_TEXELS
    return field_bytes(texel_distance(subpixels[m:-m, m:-m]))


def to_file(faces: npt.NDArray[np.uint8], year: int) -> bytes:
    """The stored file: the header and the six faces, gzip level 9, mtime 0, no file name."""
    count, size, _ = faces.shape
    header = HEADER.pack(MAGIC, VERSION, count, size, APRON, year, 0)
    return gzip.compress(header + faces.astype(np.uint8).tobytes(), compresslevel=9, mtime=0)


def from_file(data: bytes) -> tuple[int, npt.NDArray[np.uint8]]:
    """The year and the faces of a stored file."""
    raw = gzip.decompress(data)
    magic, version, count, size, apron, year, _ = HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION or apron != APRON:
        raise BordersError(f"not a version {VERSION} border field: {magic!r} {version}")
    faces = np.frombuffer(raw, np.uint8, offset=HEADER.size)
    return year, faces.reshape(count, size, size)


def write_license_file(out: Path, data: bytes, extension: str) -> str:
    """Writes `lic/<sha16>.<extension>` under the output root and returns its key."""
    key = f"{LICENSES}/{sha256_bytes(data)[:16]}.{extension}"
    write_object(out / key, data)
    return key


def notice(
    source: Source, stem: str, fixes: Corrections, ver: str, key: str, source_key: str
) -> str:
    """The GPL notice published beside a snapshot's borders (owner decision 6): what they come
    from, under which license, what changed and when, and where the changed source and the build
    scripts are."""
    pinned = next(f for f in source.files if Path(f.path).name == f"world_{stem}.geojson")
    corrections = [
        (
            f"{c.polity}{'' if c.at is None else f' (its part at {c.at[0]}, {c.at[1]})'} "
            f"becomes {c.becomes}. {c.why} Source: {c.source['title']}, {c.source['publisher']}, "
            f"{c.source['url']}"
        )
        for c in fixes.items
    ]
    changes = [
        *(["The corrections below are applied."] if corrections else []),
        f"The corrected snapshot is published beside this notice as {source_key}.",
        f"It is drawn on the six faces of Wander's cube sphere, {FACE_TEXELS - 2 * APRON:,} texels "
        "along each face edge, as signed distances to the borders between its polities, once "
        "every stretch of sea is given to the polity nearest it, so no border follows a coast. "
        f"The result is {key}.",
    ]
    lines = [
        f"Wander's historical borders, {stem}",
        "",
        *_wrap(
            f"These borders are built from {Path(pinned.path).name} of {source.attribution}, at "
            f"commit {source.version}:"
        ),
        f"  {source.landing_page}",
        f"  {pinned.source_url}",
        "",
        *_wrap(
            f"Like their source, they are free software under the {_license_name(source)}, with "
            "no warranty, to the extent permitted by law:"
        ),
        f"  {GPL_URL}",
        "",
        f"Changed for Wander on {fixes.modified}:" if fixes.modified else "Changed for Wander:",
        *[line for change in changes for line in _wrap(change, "- ")],
        *(["", "Corrections:"] if corrections else []),
        *[line for c in corrections for line in _wrap(c, "- ")],
        "",
        "The build scripts:",
        f"  {BUILD_SCRIPTS.format(ver=ver)}",
        "",
    ]
    return "\n".join(lines)


def _wrap(text: str, bullet: str = "") -> list[str]:
    """Text wrapped at 80 columns, hanging under its bullet; URLs never break."""
    indent = " " * len(bullet)
    return textwrap.wrap(
        text,
        80,
        initial_indent=bullet,
        subsequent_indent=indent,
        break_long_words=False,
        break_on_hyphens=False,
    )


def _license_name(source: Source) -> str:
    if source.license == "GPL-3.0":
        return "GNU General Public License, version 3 (GPL-3.0)"
    if source.license == "CC-BY-4.0":
        return "the Creative Commons Attribution 4.0 International license (CC BY 4.0)"
    return source.license


def _polygons(geometry: Mapping[str, Any]) -> list[Any]:
    kind = geometry["type"]
    if kind == "Polygon":
        return [geometry["coordinates"]]
    if kind == "MultiPolygon":
        return list(geometry["coordinates"])
    raise BordersError(f"a {kind} is no polity's land")


def _holds(polygon: Any, at: tuple[float, float]) -> bool:
    return bool(shapely.Polygon(polygon[0], polygon[1:]).contains(shapely.Point(at)))
