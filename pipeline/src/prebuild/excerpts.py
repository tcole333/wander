"""The `excerpts` stage (streaming.md 7.3): cut the committed excerpts under pipeline/tests/data/
from the verified sources, so the fixture build and CI never read raw data. It runs only when
named, never under the fixture profile, and writes no stage record.

- GEBCO: one excerpt per name in fixture.yaml, over the union of the windows of the tiles that read
  it (`footprint.tile_window`). 15" excerpts hold GEBCO's cells; coarser ones hold block means of
  the overviews, rounded half away from zero to int16 (a simplification for the fixture only).
- Natural Earth, in tiers around the fixture's tiles: land dissolved and simplified at 0.2° away
  from the L2 tiles (keeping parts of at least 0.1 deg²), at 0.01° around them, and in full around
  the L5-L7 tiles; minor islands only around the L2 tiles, in full; lakes and rivers only around
  the L2 tiles, at 0.01° there and in full around the L5-L7 tiles. Each keeps only the columns the
  loader reads, and the loader prepares the excerpts exactly as it prepares the zips.
- ModE-RA: 1815-1817 mean and spread, Europe's float32 cells on the native grid, missing elsewhere;
  NetCDF classic (no timestamps), gzip level 9 with mtime 0, plus provenance and attribution.
- Events: all statements of events dated in 1815-1817, plus their exported ancestors, in export
  order. The TSV terms stay untouched; its sidecar keeps the export metadata and selection rule.
"""

import gzip
import json
import math
import warnings
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import netCDF4
import numpy as np
import shapely

from prebuild import events, modera
from prebuild.codes import round_half_away
from prebuild.config import FixtureConfig, load_fixture
from prebuild.cube import BORDER, TILE, Tile, corner, dir_to_lonlat, st_to_dir
from prebuild.fields import MARGIN_TEXELS
from prebuild.footprint import Window, tile_window, union_windows
from prebuild.gebco import (
    GEBCO,
    GEBCO_NC,
    Raster,
    block_means,
    crop,
    grid_cell_arcsec,
    overviews,
    read_window,
    write_excerpt,
)
from prebuild.natural_earth import (
    ZIPS,
    Layer,
    parts_of_dimension,
    read_zip_layer,
    write_excerpt_layer,
)
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context
from prebuild.sources import Source, SourceUnavailable, load_sources, pinned_file, verified_path

CAP_BYTES = 3_000_000  # the committed excerpts, all of pipeline/tests/data (streaming.md 7.3)
MODERA_BOUNDS = (-15, 35, 35, 65)  # west, south, east, north; cell centers included
FIELD_TEXELS = BORDER + MARGIN_TEXELS  # texels a tile's fields rasterize past each edge
# Past fields.clip_boxes' pad at the levels cut here (widest at L2: 0.16° in latitude) up to
# about 70° latitude, where the pad's longitude part, which grows as 1/cos(latitude), is 0.25°.
BOX_PAD_DEG = 0.25
BOX_STEPS_PER_DEG = 100  # boxes round outward to 0.01°
WORLD_SIMPLIFY_DEG = 0.2
WORLD_MIN_PART_DEG2 = 0.1
NEAR_SIMPLIFY_DEG = 0.01
NEAR_LEVEL = 2  # tiles at this level and deeper get the 0.01° tier around them
DETAIL_LEVEL = 5  # and at this level and deeper, full detail
# The columns each clipped NE excerpt keeps: the ones the loaders read. `land()` reads only the
# minor islands' geometry.
KEPT_FIELDS: dict[str, tuple[str, ...]] = {
    "minor_islands": (),
    "lakes": ("featurecla", "ne_id"),
    "rivers": ("featurecla", "scalerank"),
}


def run(ctx: Context) -> None:
    if ctx.data is None:
        raise SourceUnavailable(f"the {ctx.profile} profile reads no raw data, so it cuts none")
    fixture = load_fixture(config_dir(ctx.repo) / "fixture.yaml")
    registry = load_sources()
    folder = excerpts_dir(ctx.repo)
    write_gebco_excerpts(ctx, fixture, registry, folder / "gebco")
    write_ne_excerpts(ctx, fixture, registry, folder / "ne")
    write_modera_excerpts(ctx, registry, folder / "modera")
    write_events_excerpt(ctx, registry, folder / "events")
    total = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
    if total > CAP_BYTES:
        raise ValueError(f"{folder} holds {total} bytes, past the {CAP_BYTES}-byte cap")
    print(f"excerpts: {folder} holds {total} bytes (cap {CAP_BYTES})", flush=True)


def attribution(source: Source, filename: str) -> dict[str, Any]:
    """The same source pin as the surface sidecars, with the credit carried beside the cut."""
    pin = pinned_file(source, filename)
    return {
        "source": source.id,
        "file": pin.path,
        "sha256": pin.sha256,
        "license": source.license,
        "license_url": source.license_url,
        "attribution": source.attribution,
        "landing_page": source.landing_page,
    }


def write_modera_excerpts(ctx: Context, registry: dict[str, Source], folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    first, last = modera.EXCERPT_YEARS
    months = slice((first - modera.FIRST_YEAR) * 12, (last - modera.FIRST_YEAR + 1) * 12)
    west, south, east, north = MODERA_BOUNDS
    for name, filename in modera.FILES.items():
        path = verified_path(ctx, modera.SOURCE, filename, registry)
        with TemporaryDirectory(dir=folder) as scratch, netCDF4.Dataset(path) as source:
            nc = Path(scratch) / f"{name}.nc"
            lat, lon = source["latitude"][:], source["longitude"][:]
            keep = ((lat >= south) & (lat <= north))[:, None] & ((lon >= west) & (lon <= east))[
                None, :
            ]
            with netCDF4.Dataset(nc, "w", format="NETCDF3_CLASSIC") as excerpt:
                excerpt.setncatts({key: source.getncattr(key) for key in source.ncattrs()})
                excerpt.createDimension("time", (last - first + 1) * 12)
                excerpt.createDimension("latitude", len(lat))
                excerpt.createDimension("longitude", len(lon))
                for key in ("time", "latitude", "longitude", modera.VARIABLE):
                    original = source[key]
                    options = (
                        {"fill_value": netCDF4.default_fillvals["f4"]}
                        if key == modera.VARIABLE
                        else {}
                    )
                    variable = excerpt.createVariable(
                        key, original.dtype, original.dimensions, **options
                    )
                    variable.setncatts(
                        {a: original.getncattr(a) for a in original.ncattrs() if a != "_FillValue"}
                    )
                    values = original[months] if "time" in original.dimensions else original[:]
                    if key == modera.VARIABLE:
                        values = np.ma.array(values, mask=np.ma.getmaskarray(values) | ~keep)
                    with warnings.catch_warnings():
                        # netCDF4 1.7.4 sets array.shape on writes, deprecated by numpy 2.5.
                        warnings.filterwarnings("ignore", "Setting the shape", DeprecationWarning)
                        variable[:] = values
            stored = gzip.compress(nc.read_bytes(), compresslevel=9, mtime=0)
        (folder / f"{name}.nc.gz").write_bytes(stored)
        meta = {
            **attribution(registry[modera.SOURCE], filename),
            "years": [first, last],
            "bounds": list(MODERA_BOUNDS),
            "selection": "Original float32 cells with centers inside bounds; missing elsewhere. "
            "All 12 months per year, in source order, on the full native latitude/longitude grid.",
        }
        (folder / f"{name}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"excerpts: modera/{name} {first}-{last}, {len(stored)} bytes", flush=True)


def select_events(lines: list[str], years: tuple[int, int]) -> list[str]:
    """Keep whole events, not just their in-span statements, and close over exported parents."""
    statements = events.read_export(lines)
    parents: dict[str, set[str]] = {}
    for line in lines[1:]:
        fields = line.rstrip("\n").split("\t")
        qid = events.term(fields[1]).removeprefix(events.ENTITY)
        parents.setdefault(qid, set()).update(events.term(fields[-1]).split())
    selected = {s.qid for s in statements if years[0] <= s.day[0] <= years[1]}
    pending = list(selected)
    while pending:
        for parent in parents[pending.pop()]:
            if parent in parents and parent not in selected:
                selected.add(parent)
                pending.append(parent)
    return [
        lines[0],
        *(
            line
            for line in lines[1:]
            if events.term(line.split("\t", 2)[1]).removeprefix(events.ENTITY) in selected
        ),
    ]


def write_events_excerpt(ctx: Context, registry: dict[str, Source], folder: Path) -> None:
    source = events.export_source(registry)
    with gzip.open(
        verified_path(ctx, source.id, events.TABLE, registry), "rt", encoding="utf-8"
    ) as stream:
        lines = select_events(stream.readlines(), modera.EXCERPT_YEARS)
    meta = json.loads(
        verified_path(ctx, source.id, events.META, registry).read_text(encoding="utf-8")
    )
    counts = Counter(line.split("\t", 1)[0] for line in lines[1:])
    meta.update(
        {
            **attribution(source, events.TABLE),
            "rows": {cls: counts[cls] for cls in meta["rows"]},
            "years": list(modera.EXCERPT_YEARS),
            "selection": "All statements of events with any date in these years, plus all their "
            "ancestors present in the export, retaining original row order and TSV terms.",
        }
    )
    folder.mkdir(parents=True, exist_ok=True)
    stored = gzip.compress("".join(lines).encode("utf-8"), compresslevel=9, mtime=0)
    (folder / events.TABLE).write_bytes(stored)
    (folder / events.META).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"excerpts: events {len(lines) - 1} statements, {len(stored)} bytes", flush=True)


def excerpt_window(fixture: FixtureConfig, name: str) -> Window:
    """The union of the windows of every fixture tile that reads the excerpt."""
    cell = fixture.excerpts[name]
    return union_windows((tile_window(t, cell) for t in fixture.tiles_reading(name)), cell)


def write_gebco_excerpts(
    ctx: Context, fixture: FixtureConfig, registry: dict[str, Source], folder: Path
) -> None:
    pin = pinned_file(registry[GEBCO], GEBCO_NC)
    nc = verified_path(ctx, GEBCO, GEBCO_NC, registry)
    meta = {"source": GEBCO, "file": pin.path, "sha256": pin.sha256}
    grid_cell = grid_cell_arcsec(nc)
    for name, cell in fixture.excerpts.items():
        window = excerpt_window(fixture, name)
        if cell == grid_cell:
            raster, kind = read_window(nc, *window), "cells"
        else:
            views = overviews(nc, ctx.cache / "gebco" / pin.sha256[:16])
            raster, kind = coarsened(views.values(), cell, window), "blockMean"
        write_excerpt(folder, name, raster, {**meta, "kind": kind})
        print(f"excerpts: gebco/{name} {raster.w}x{raster.h} {kind}", flush=True)


def coarsened(views: Iterable[Raster], cell_arcsec: int, window: Window) -> Raster:
    """Block means over a window of a coarser grid, from the coarsest overview that divides it,
    rounded half away from zero to int16."""
    fitting = [v for v in views if cell_arcsec % v.cell_arcsec == 0]
    if not fitting:
        raise ValueError(f"no overview divides {cell_arcsec}″ cells")
    source = max(fitting, key=lambda v: v.cell_arcsec)
    k = cell_arcsec // source.cell_arcsec
    i0, j0, w, h = window
    block = crop(source, i0 * k, j0 * k, w * k, h * k)
    means = np.empty((h, w), dtype=np.float64)
    band = max(1, 2048 // k)  # rows of blocks per pass, to bound memory
    for b0 in range(0, h, band):
        rows = block.data[b0 * k : (b0 + band) * k]
        means[b0 : b0 + band] = block_means(Raster(rows, source.cell_arcsec, 0, 0), k)
    return Raster(round_half_away(means).astype(np.int16), cell_arcsec, i0, j0)


def field_box(tile: Tile) -> tuple[float, float, float, float]:
    """(west, south, east, north) around the lon/lat footprint of the tile's field raster, padded
    by BOX_PAD_DEG and rounded outward to 0.01°."""
    c = np.arange(TILE * tile.x - FIELD_TEXELS, TILE * (tile.x + 1) + FIELD_TEXELS + 1)
    r = np.arange(TILE * tile.y - FIELD_TEXELS, TILE * (tile.y + 1) + FIELD_TEXELS + 1)
    s_edge, t_edge = corner(tile.level, c), corner(tile.level, r)
    s = np.concatenate([s_edge, s_edge, np.full(r.size, s_edge[0]), np.full(r.size, s_edge[-1])])
    t = np.concatenate([np.full(c.size, t_edge[0]), np.full(c.size, t_edge[-1]), t_edge, t_edge])
    lon, lat = dir_to_lonlat(st_to_dir(tile.face, s, t))
    if lon.max() - lon.min() > 180 or lat.max() > 89 or lat.min() < -89:
        raise ValueError(f"tile {tile.key()} wraps the dateline or a pole; excerpt boxes do not")
    n = BOX_STEPS_PER_DEG
    return (
        math.floor((lon.min() - BOX_PAD_DEG) * n) / n,
        math.floor((lat.min() - BOX_PAD_DEG) * n) / n,
        math.ceil((lon.max() + BOX_PAD_DEG) * n) / n,
        math.ceil((lat.max() + BOX_PAD_DEG) * n) / n,
    )


def boxes(fixture: FixtureConfig, min_level: int) -> list[tuple[float, float, float, float]]:
    """Field boxes of the fixture tiles at min_level and deeper, less those inside another."""
    found = sorted({field_box(t) for t in fixture.tiles if t.level >= min_level})
    return [b for b in found if not any(o != b and _inside(b, o) for o in found)]


def ne_tiers(fixture: FixtureConfig) -> dict[str, list[dict[str, Any]]]:
    """The tiers each NE excerpt is cut in, by layer, as its sidecar records them."""
    near_boxes, detail_boxes = boxes(fixture, NEAR_LEVEL), boxes(fixture, DETAIL_LEVEL)
    world = {
        "name": "world",
        "simplifyDeg": WORLD_SIMPLIFY_DEG,
        "minPartDeg2": WORLD_MIN_PART_DEG2,
        "outside": "near",
    }
    near = {"name": "near", "simplifyDeg": NEAR_SIMPLIFY_DEG, "boxes": near_boxes}
    detail = {"name": "detail", "simplifyDeg": 0, "boxes": detail_boxes}
    return {
        "land": [world, near, detail],
        "minor_islands": [{**near, "simplifyDeg": 0}],
        "lakes": [near, detail],
        "rivers": [near, detail],
    }


def write_ne_excerpts(
    ctx: Context, fixture: FixtureConfig, registry: dict[str, Source], folder: Path
) -> None:
    tiers = ne_tiers(fixture)
    near = shapely.union_all([shapely.box(*b) for b in boxes(fixture, NEAR_LEVEL)])
    detail = shapely.union_all([shapely.box(*b) for b in boxes(fixture, DETAIL_LEVEL)])
    around = shapely.difference(near, detail)
    for name, (source_id, filename) in ZIPS.items():
        pin = pinned_file(registry[source_id], filename)
        layer = read_zip_layer(verified_path(ctx, source_id, filename, registry))
        if name == "land":
            excerpt = land_tiers(layer, near, detail)
        elif name == "minor_islands":
            excerpt = clip_tiers(layer, [("near", near, 0.0)], 2, KEPT_FIELDS[name])
        else:
            dim = 2 if name == "lakes" else 1
            cuts = [("detail", detail, 0.0), ("near", around, NEAR_SIMPLIFY_DEG)]
            excerpt = clip_tiers(layer, cuts, dim, KEPT_FIELDS[name])
        meta = {"source": source_id, "file": pin.path, "sha256": pin.sha256, "tiers": tiers[name]}
        write_excerpt_layer(folder, name, excerpt, meta)
        print(f"excerpts: ne/{name} {len(excerpt)} rows", flush=True)


def land_tiers(layer: Layer, near: shapely.Geometry, detail: shapely.Geometry) -> Layer:
    """Land dissolved into one row per tier. Each tier is simplified before it is clipped, so
    neighboring tiers meet along the same box edges."""
    dissolved = shapely.union_all(parts_of_dimension(shapely.make_valid(layer.geoms), 2))
    world_parts = parts_of_dimension(shapely.simplify(dissolved, WORLD_SIMPLIFY_DEG), 2)
    world_parts = world_parts[shapely.area(world_parts) >= WORLD_MIN_PART_DEG2]
    tiers = {
        "world": shapely.difference(shapely.multipolygons(world_parts), near),
        "near": shapely.intersection(
            shapely.simplify(dissolved, NEAR_SIMPLIFY_DEG), shapely.difference(near, detail)
        ),
        "detail": shapely.intersection(dissolved, detail),
    }
    rows = [(tier, piece) for tier, geom in tiers.items() if (piece := _only(geom, 2)) is not None]
    return Layer(
        np.array([piece for _, piece in rows], dtype=object),
        {
            "featurecla": np.array(["Land"] * len(rows), dtype=object),
            "tier": np.array([tier for tier, _ in rows], dtype=object),
        },
    )


def clip_tiers(
    layer: Layer,
    cuts: list[tuple[str, shapely.Geometry, float]],
    dim: int,
    fields: Iterable[str],
) -> Layer:
    """For each (tier, region, simplify) cut, every feature's part inside the region, simplified
    first when simplify > 0: one row per feature and tier, keeping `fields`."""
    valid = shapely.make_valid(layer.geoms)
    columns = list(fields)
    geoms: list[shapely.Geometry] = []
    attrs: dict[str, list[Any]] = {column: [] for column in [*columns, "tier"]}
    for tier, region, tolerance in cuts:
        for k in np.flatnonzero(shapely.intersects(valid, region)):
            source = shapely.simplify(valid[k], tolerance) if tolerance else valid[k]
            piece = _only(shapely.intersection(source, region), dim)
            if piece is None:
                continue
            geoms.append(piece)
            for column in columns:
                attrs[column].append(layer.attrs[column][k])
            attrs["tier"].append(tier)
    return Layer(
        np.array(geoms, dtype=object),
        {column: np.array(values, dtype=object) for column, values in attrs.items()},
    )


def _only(geom: shapely.Geometry, dim: int) -> shapely.Geometry | None:
    """The parts of `geom` of dimension `dim` as one geometry, or None when there are none."""
    parts = parts_of_dimension(geom, dim)
    if parts.size == 0:
        return None
    if parts.size == 1:
        return parts[0]
    return shapely.multipolygons(parts) if dim == 2 else shapely.multilinestrings(parts)


def _inside(inner: tuple[float, ...], outer: tuple[float, ...]) -> bool:
    west, south, east, north = outer
    return west <= inner[0] and south <= inner[1] and inner[2] <= east and inner[3] <= north
