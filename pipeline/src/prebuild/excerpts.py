"""The `excerpts` stage (streaming.md 7.3): cut the committed excerpts under pipeline/tests/data/
from the verified sources, so the fixture build and CI never read raw data. It runs only when
named, never under the fixture profile, and writes no stage record.

- GEBCO: one excerpt per name in fixture.yaml, over the union of the windows of the tiles that read
  it (`footprint.tile_window`). 15" excerpts hold GEBCO's cells; coarser ones hold block means of
  the overviews, rounded half away from zero to int16 (a simplification for the fixture only).
- Natural Earth, in tiers around the fixture's tiles: land dissolved and simplified at 0.2° away
  from the L2 tiles (keeping parts of at least 0.1 deg²), at 0.01° around them, and in full around
  the L5-L7 tiles; minor islands, lakes and rivers only around the L2 tiles, at 0.01° there and in
  full around the L5-L7 tiles. The loader prepares the excerpts exactly as it prepares the zips.
"""

import math
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np
import shapely

from prebuild.codes import round_half_away
from prebuild.config import FixtureConfig, load_fixture
from prebuild.cube import TILE, Tile, corner, dir_to_lonlat, st_to_dir
from prebuild.footprint import Window, tile_window, union_windows
from prebuild.gebco import (
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

GEBCO = "gebco-2026"
GEBCO_NC = "GEBCO_2026.nc"
CAP_BYTES = 3_000_000  # the committed excerpts, all of pipeline/tests/data (streaming.md 7.3)
FIELD_TEXELS = 16  # a tile's fields rasterize texels -16..271: the border and a 12-texel margin
BOX_PAD_DEG = 0.25  # past the fields' clip pad: 0.1° plus the widest L2 river, at any latitude
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
    total = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
    if total > CAP_BYTES:
        raise ValueError(f"{folder} holds {total} bytes, past the {CAP_BYTES}-byte cap")
    print(f"excerpts: {folder} holds {total} bytes (cap {CAP_BYTES})", flush=True)


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


def write_ne_excerpts(
    ctx: Context, fixture: FixtureConfig, registry: dict[str, Source], folder: Path
) -> None:
    near_boxes, detail_boxes = boxes(fixture, NEAR_LEVEL), boxes(fixture, DETAIL_LEVEL)
    near = shapely.union_all([shapely.box(*b) for b in near_boxes])
    detail = shapely.union_all([shapely.box(*b) for b in detail_boxes])
    around = shapely.difference(near, detail)
    world_tier = {
        "name": "world",
        "simplifyDeg": WORLD_SIMPLIFY_DEG,
        "minPartDeg2": WORLD_MIN_PART_DEG2,
        "outside": "near",
    }
    near_tier = {"name": "near", "simplifyDeg": NEAR_SIMPLIFY_DEG, "boxes": near_boxes}
    detail_tier = {"name": "detail", "simplifyDeg": 0, "boxes": detail_boxes}
    for name, (source_id, filename) in ZIPS.items():
        pin = pinned_file(registry[source_id], filename)
        layer = read_zip_layer(verified_path(ctx, source_id, filename, registry))
        if name == "land":
            excerpt, tiers = land_tiers(layer, near, detail), [world_tier, near_tier, detail_tier]
        elif name == "minor_islands":
            excerpt = clip_tiers(layer, [("near", near, 0.0)], 2, KEPT_FIELDS[name])
            tiers = [{**near_tier, "simplifyDeg": 0}]
        else:
            dim = 2 if name == "lakes" else 1
            cuts = [("detail", detail, 0.0), ("near", around, NEAR_SIMPLIFY_DEG)]
            excerpt = clip_tiers(layer, cuts, dim, KEPT_FIELDS[name])
            tiers = [near_tier, detail_tier]
        meta = {"source": source_id, "file": pin.path, "sha256": pin.sha256, "tiers": tiers}
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
