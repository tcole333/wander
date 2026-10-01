"""The borders stage (streaming.md 3.3, 7.1, 7.2): the border steps from Cliopatria, one field per
state of the world from 3400 BCE to 2000.

The selection (cliopatria.py) gives each step's polities, their outer units and the stateless land,
with the land the carry-through carries in it from every step selected without it, and
step_fields.py bakes each step's field and preview, skipping those the cache holds. The stage then
writes, in the profile's output root:

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
stage, after the queue is written. The global and fixture profiles run it, the fixture on the two
years of its excerpt; the region profile bakes no borders (cli.py).

The record `build/stages/<profile>/borders.json` holds release.json's `borderSteps` section as
`steps`, the step each story's border beats draw, the overlap pairs no correction acknowledges, the
composites and relations `hierarchy.yaml` does not class, and the stateless holes and gaps the
history pass owes a cited verdict (`owed`), each by its id and with the owner's acknowledgment where
`acknowledged.yaml` lists it as a known gap (streaming.md 3.8, 7.2).
"""

import bisect
import gzip
import json
import textwrap
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from prebuild import cliopatria as clio
from prebuild import events, step_fields
from prebuild.border_fields import APRON, MARGIN_TEXELS
from prebuild.fields import SUBPIXELS
from prebuild.hashing import CODE_PATHS, layer_version, sha256_bytes, sha256_file, tree_sha
from prebuild.layers import write_object
from prebuild.media import BEAT_BLOCK
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import write_json, write_record
from prebuild.sources import Source, load_sources

STAGE = "borders"
LAYER = "fd/borders"
STEPS, PREVIEWS, POLITIES = "s", "p", "m"  # the steps' folders under LAYER
LICENSES = "lic"
SHORES = "borders-lakes.bin"  # beside the record: the lakes' shores, for verify:bake
LAND = "borders-land.bin"  # beside the record: the land less lakes, for verify:bake


class BordersError(ValueError):
    """A step, a correction or a story's border beat is not what the stage expects."""


def run(ctx: Context) -> None:
    write_record(ctx, STAGE, bake_steps(ctx))


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
    plain = {year: step_fields.step_key(year, source, config, identity) for year in years}
    carried = step_fields.carried_steps(ctx, plain, source, config, terrain)
    keys = {
        year: step_fields.carried_key(key, carried[year]) if year in carried else key
        for year, key in plain.items()
    }

    def progress(count: int, total: int, year: int) -> None:
        if count % 25 == 0 or count == total:
            seconds = time.perf_counter() - started
            print(f"borders: baked {count} of {total} steps, {year}, {seconds:.0f} s", flush=True)

    baked: dict[int, step_fields.Baked] = {}
    failed: dict[int, str] = {}
    chosen = step_fields.bake_steps(ctx, keys, source, config, terrain, masks, progress, carried)
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
    notice_key = write_license_file(ctx.out, text)
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
        case clio.Pocket(at, _, str() as to, shape_from, shape, _, within):
            land = f"the stateless land at {at[0]}, {at[1]}"
            if shape_from:
                name, year = shape_from
                land = f"the part of {land} inside {name}'s shape of {_year(year)}"
                if within:
                    land += f" and {within[0]}'s of {_year(within[1])}"
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


def write_license_file(out: Path, data: bytes) -> str:
    """Writes `lic/<sha16>.txt` under the output root and returns its key."""
    key = f"{LICENSES}/{sha256_bytes(data)[:16]}.txt"
    write_object(out / key, data)
    return key


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
    if source.license == "CC-BY-4.0":
        return "the Creative Commons Attribution 4.0 International license (CC BY 4.0)"
    return source.license
