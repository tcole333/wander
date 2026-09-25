"""The coverage stage (streaming.md 2, 3.1, 7.1, 7.2): which tiles the profile bakes, and qLand,
c200 and the tile count per level, in `build/stages/<profile>/coverage.json`.

Availability, built top down so a tile's parent is always baked:
- L0-L4: every tile.
- L5-L6: tiles on land or shelf, and for the region profile only inside its regions at that level
  (`regions-milestone1.yaml`).
- L7: tiles on land or shelf inside the `l7.yaml` regions.
The fixture takes exactly the tiles `fixture.yaml` lists. Either way the set is closed upward.

A tile is on land or shelf when, over its 264² texels dilated by one texel (texels -5..260), the
center of some GEBCO cell lies above -200 m, or the prepared land (NE land and minor islands),
projected, touches them. A child's dilated texels lie inside its parent's, so a child on land or
shelf always has a parent on land or shelf. A tile is inside a region at level L when one of its
33x33 mesh corners lies within the region's radius for L, or the region's center lies in the tile.

qLand, per level: the smallest multiple of 1/64 m from `q_land_start(L)` at which every tile baked
at L spans at most 4,096 codes. A tile's cheap bound is [min(raw, 0), max(raw, 0)] over the source
cells its heights read (`footprint.tile_window`): texel means are convex combinations of those
cells, the coastal clamp moves a height only toward 0 and an edge entry lies between its texels'
codes, so no code the tile stores falls outside it. A tile whose cheap bound fails at a candidate
has its clamped heights computed (`tiles.height_bound`).
"""

import base64
import itertools
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import Executor
from typing import Any

import numpy as np
import shapely

from prebuild import workers
from prebuild.codes import Q_STEP, SHELF_M, c200, meters_to_codes, q_land_start
from prebuild.config import Region, load_fixture, load_regions, load_water
from prebuild.cube import (
    BORDER,
    EARTH_RADIUS_M,
    FACES,
    TILE,
    Tile,
    avail_set,
    corner,
    dir_to_lonlat,
    face_of,
    face_st,
    lonlat_to_dir,
    node_count,
    node_index,
    st_to_dir,
    tile_of,
)
from prebuild.fields import SUBPIXELS, Grid, clip_boxes, clip_polygons, project
from prebuild.footprint import Window, cell_window, tile_window
from prebuild.gebco import GEBCO, GEBCO_NC, Raster, crop
from prebuild.hashing import CODE_PATHS, sha256_file, tree_sha
from prebuild.height import HeightSource, height_source
from prebuild.natural_earth import ZIPS, load_vectors
from prebuild.paths import config_dir, excerpts_dir
from prebuild.profiles import Context, Profile
from prebuild.records import read_record, write_record
from prebuild.sources import load_sources, pinned_file
from prebuild.tiles import height_bound, surface
from prebuild.wst import MAX_RANGE

type Bound = tuple[float, float]  # lowest and highest meters a tile's codes can take

STAGE = "coverage"
EVERYWHERE_BELOW = 5  # levels 0-4 bake every tile
DILATION = 1  # texels past a tile's stored border that land or shelf may touch
MESH = 33  # mesh corners a side, at every 8th texel corner
_REGION_CHUNK = 256  # tiles whose mesh corners are tested at once
# The configs each profile reads, whose hashes the record keeps.
CONFIGS: dict[Profile, tuple[str, ...]] = {
    Profile.GLOBAL: ("l7.yaml", "water.yaml"),
    Profile.REGION: ("l7.yaml", "regions-milestone1.yaml", "water.yaml"),
    Profile.FIXTURE: ("fixture.yaml", "water.yaml"),
}


class StaleCoverage(RuntimeError):
    """The coverage record was built from other sources, configs or code than the current ones."""


def run(ctx: Context) -> None:
    started = time.perf_counter()
    height_source(ctx)  # builds the GEBCO overviews once, before the workers map them
    vectors = load_vectors(ctx, load_water(config_dir(ctx.repo) / "water.yaml"))
    with workers.tile_pool(ctx, vectors) as pool:
        tiles = available_tiles(ctx, pool)
        cheap = dict(zip(tiles, pool.map(_cheap_bound, tiles), strict=True))
        levels = range(max(t.level for t in tiles) + 1)
        q_land = [
            _level_q_land(pool, level, [t for t in tiles if t.level == level], cheap)
            for level in levels
        ]
    counts = [sum(t.level == level for t in tiles) for level in levels]
    record = {
        "qLand": q_land,
        "c200": [c200(q) for q in q_land],
        "counts": counts,
        "avail": base64.b64encode(bitmap(tiles)).decode("ascii"),
        "inputs": inputs(ctx),
    }
    write_record(ctx, STAGE, record)
    seconds = time.perf_counter() - started
    print(
        f"coverage: {len(tiles)} tiles, per level {counts}, qLand {q_land}, {seconds:.1f} s",
        flush=True,
    )


def available_tiles(ctx: Context, pool: Executor) -> list[Tile]:
    """The tiles the profile bakes, in node order."""
    if ctx.profile is Profile.FIXTURE:
        tiles = sorted(load_fixture(config_dir(ctx.repo) / "fixture.yaml").tiles, key=node_index)
    else:
        tiles = grow(level_regions(ctx), lambda found: list(pool.map(_land_or_shelf, found)))
    check_closed_upward(tiles)
    return tiles


def level_regions(ctx: Context) -> dict[int, list[Region] | None]:
    """The regions that bound each level past L4; None where every tile on land or shelf bakes."""
    l7 = load_regions(config_dir(ctx.repo) / "l7.yaml")
    if ctx.profile is Profile.REGION:
        milestone = load_regions(config_dir(ctx.repo) / "regions-milestone1.yaml")
        return {5: milestone, 6: milestone, 7: l7}
    return {5: None, 6: None, 7: l7}


def grow(
    regions: Mapping[int, Sequence[Region] | None],
    land_or_shelf: Callable[[list[Tile]], list[bool]],
) -> list[Tile]:
    """Every tile at L0-L4, then level by level the children of the tiles kept one level up that
    lie in the level's regions and on land or shelf, in node order."""
    tiles = [
        Tile(face, level, x, y)
        for level in range(EVERYWHERE_BELOW)
        for face in range(6)
        for y in range(1 << level)
        for x in range(1 << level)
    ]
    kept = [t for t in tiles if t.level == EVERYWHERE_BELOW - 1]
    for level in sorted(regions):
        found = sorted((child for t in kept for child in t.children()), key=node_index)
        bound = regions[level]
        if bound is not None:
            found = list(itertools.compress(found, in_regions(found, bound)))
        kept = list(itertools.compress(found, land_or_shelf(found)))
        tiles += kept
    return tiles


def check_closed_upward(tiles: Sequence[Tile]) -> None:
    present = set(tiles)
    for tile in tiles:
        if tile.level > 0 and tile.parent() not in present:
            raise ValueError(f"tile {tile.key()} is available without its parent")


def bitmap(tiles: Sequence[Tile]) -> bytearray:
    """One bit per node down to the deepest level baked (streaming.md 3.0 item 8)."""
    max_level = max(t.level for t in tiles)
    avail = bytearray((node_count(max_level) + 7) // 8)
    for tile in tiles:
        avail_set(avail, node_index(tile))
    return avail


def in_regions(tiles: Sequence[Tile], regions: Sequence[Region]) -> list[bool]:
    """Whether each tile, all at one level, lies inside one of the regions at that level: one of
    its 33x33 mesh corners within the region's radius (a great-circle distance on the sphere of
    radius R), or the region's center in the tile."""
    if not tiles:
        return []
    levels = {t.level for t in tiles}
    if len(levels) > 1:
        raise ValueError("region tests take tiles of one level")
    level = levels.pop()
    inside = np.zeros(len(tiles), dtype=bool)
    at_level = [r for r in regions if level in r.radius_km]
    steps = np.arange(MESH) * (TILE // (MESH - 1))
    for start in range(0, len(tiles), _REGION_CHUNK):
        chunk = tiles[start : start + _REGION_CHUNK]
        face = np.array([t.face for t in chunk])
        s = corner(level, TILE * np.array([t.x for t in chunk])[:, None] + steps)
        t = corner(level, TILE * np.array([t.y for t in chunk])[:, None] + steps)
        lon, lat = dir_to_lonlat(st_to_dir(face[:, None, None], s[:, None, :], t[:, :, None]))
        for region in at_level:
            reach_m = 1000 * region.radius_km[level]
            near = great_circle_m(lon, lat, region.lon, region.lat) <= reach_m
            inside[start : start + len(chunk)] |= near.any(axis=(1, 2))
    centers = {tile_at(r.lon, r.lat, level) for r in at_level}
    inside |= np.array([t in centers for t in tiles])
    return inside.tolist()


def tile_at(lon: float, lat: float, level: int) -> Tile:
    """The tile at a level that holds a point."""
    p = lonlat_to_dir(lon, lat)
    face = int(face_of(p))
    s, t = face_st(face, p)
    return Tile(face, level, int(tile_of(s, level)), int(tile_of(t, level)))


def great_circle_m(lon: np.ndarray, lat: np.ndarray, lon0: float, lat0: float) -> np.ndarray:
    """Haversine distance in meters on the sphere of radius R."""
    phi, phi0 = np.radians(lat), np.radians(lat0)
    half_dphi = (phi - phi0) / 2
    half_dlam = np.radians(lon - lon0) / 2
    h = np.sin(half_dphi) ** 2 + np.cos(phi) * np.cos(phi0) * np.sin(half_dlam) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.minimum(h, 1.0)))


def coverage_texels(tile: Tile) -> tuple[range, range]:
    """Face-global texel rows and columns of the tile's 264² texels dilated by one texel."""
    reach = BORDER + DILATION
    return (
        range(TILE * tile.y - reach, TILE * (tile.y + 1) + reach),
        range(TILE * tile.x - reach, TILE * (tile.x + 1) + reach),
    )


def touches_land(tile: Tile, land: np.ndarray, tree: shapely.STRtree) -> bool:
    """Whether the prepared land parts, projected onto the tile's face, touch its dilated texels."""
    rows, cols = coverage_texels(tile)
    grid = Grid(
        tile.face,
        tile.level,
        SUBPIXELS * rows.start,
        SUBPIXELS * cols.start,
        SUBPIXELS * len(rows),
        SUBPIXELS * len(cols),
    )
    polygons = clip_polygons(land, tree, clip_boxes(grid, 0.0))
    if polygons.size == 0:
        return False

    def to_subpixels(lonlat: np.ndarray) -> np.ndarray:
        return np.column_stack(project(lonlat[:, 0], lonlat[:, 1], tile.face, tile.level))

    # Subpixel A spans [A - 0.5, A + 0.5] in projected coordinates.
    rect = shapely.box(
        grid.a0 - 0.5, grid.b0 - 0.5, grid.a0 + grid.width - 0.5, grid.b0 + grid.height - 0.5
    )
    return bool(shapely.intersects(shapely.transform(polygons, to_subpixels), rect).any())


def shelf_window(tile: Tile, cell_arcsec: int) -> Window:
    """The window of grid cells whose centers may lie in the tile's dilated texels."""
    rows, cols = coverage_texels(tile)
    s = corner(tile.level, np.arange(cols.start, cols.stop + 1))
    t = corner(tile.level, np.arange(rows.start, rows.stop + 1))
    lon, lat = dir_to_lonlat(st_to_dir(tile.face, s[None, :], t[:, None]))
    return cell_window(lon, lat, cell_arcsec)


def touches_shelf(tile: Tile, cells: Raster) -> bool:
    """Whether the center of some cell above -200 m lies in the tile's dilated texels."""
    j, i = np.nonzero(np.asarray(cells.data) > SHELF_M)
    if j.size == 0:
        return False
    per_degree = 3600 / cells.cell_arcsec
    lon = -180 + ((cells.i0 + i) % cells.global_w + 0.5) / per_degree
    lat = -90 + (cells.j0 + j + 0.5) / per_degree
    p = lonlat_to_dir(lon, lat)
    toward = p @ FACES[tile.face, 0] > 0
    with np.errstate(divide="ignore", invalid="ignore"):
        s, t = face_st(tile.face, p)
    rows, cols = coverage_texels(tile)
    inside = (
        toward
        & (s >= corner(tile.level, cols.start))
        & (s <= corner(tile.level, cols.stop))
        & (t >= corner(tile.level, rows.start))
        & (t <= corner(tile.level, rows.stop))
    )
    return bool(inside.any())


def cheap_bound(tile: Tile, heights: HeightSource) -> Bound:
    """[min(raw, 0), max(raw, 0)] over the source cells the tile's heights read."""
    raster = heights.raster(tile)
    cells = np.asarray(crop(raster, *tile_window(tile, raster.cell_arcsec)).data)
    return min(float(cells.min()), 0.0), max(float(cells.max()), 0.0)


def code_span(bound: Bound, q: float) -> int:
    """How many codes apart the bound's ends lie at qLand q."""
    low, high = meters_to_codes(bound, q)
    return int(high - low)


def choose_q_land(
    level: int, bounds: Sequence[Bound], exact: Callable[[list[int]], list[Bound]]
) -> float:
    """The smallest multiple of 1/64 m from q_land_start(level) at which every bound spans at most
    4,096 codes. `bounds` are the cheap bounds; `exact(indices)` gives the exact bounds of those
    tiles, asked once per tile and only for tiles whose cheap bound fails at a candidate."""
    known = list(bounds)
    refined: set[int] = set()
    step = round(q_land_start(level) / Q_STEP)
    while True:
        q = step * Q_STEP
        failing = [k for k, bound in enumerate(known) if code_span(bound, q) > MAX_RANGE]
        fresh = [k for k in failing if k not in refined]
        if fresh:
            for k, bound in zip(fresh, exact(fresh), strict=True):
                known[k] = bound
            refined.update(fresh)
            failing = [k for k in failing if code_span(known[k], q) > MAX_RANGE]
        if not failing:
            return q
        step += 1


def inputs(ctx: Context) -> dict[str, Any]:
    """What the stage read, as sha256s: GEBCO and the NE layers (the pinned hashes, or for the
    fixture the committed excerpts), the profile's configs and the prebuild code (`CODE_PATHS`)."""
    configs = {name: sha256_file(config_dir(ctx.repo) / name) for name in CONFIGS[ctx.profile]}
    if ctx.profile is Profile.FIXTURE:
        data = excerpts_dir(ctx.repo)
        gebco = tree_sha(["gebco"], data)
        ne = {name: tree_sha([f"ne/{name}.wkb.gz", f"ne/{name}.json"], data) for name in ZIPS}
    else:
        registry = load_sources()
        gebco = pinned_file(registry[GEBCO], GEBCO_NC).sha256
        ne = {
            name: pinned_file(registry[source], file).sha256
            for name, (source, file) in ZIPS.items()
        }
    return {"gebco": gebco, "ne": ne, "configs": configs, "code": tree_sha(CODE_PATHS, ctx.repo)}


def fresh_record(ctx: Context) -> dict[str, Any]:
    """The coverage record, once its inputs are known to match the current ones."""
    record = read_record(ctx, STAGE)
    current = inputs(ctx)
    recorded = record.get("inputs", {})
    changed = sorted(key for key in current if recorded.get(key) != current[key])
    if changed:
        raise StaleCoverage(
            f"the coverage record is stale ({', '.join(changed)} changed): "
            f"run `uv run prebuild --profile {ctx.profile} {STAGE}`"
        )
    return record


def _level_q_land(
    pool: Executor, level: int, tiles: list[Tile], cheap: Mapping[Tile, Bound]
) -> float:
    def exact(indices: list[int]) -> list[Bound]:
        return list(pool.map(_exact_bound, [tiles[k] for k in indices]))

    return choose_q_land(level, [cheap[t] for t in tiles], exact)


def _land_or_shelf(tile: Tile) -> bool:
    sources = workers.sources()
    if touches_land(tile, sources.vectors.land, sources.vectors.land_tree):
        return True
    heights = sources.heights
    return touches_shelf(tile, heights.grid_cells(shelf_window(tile, heights.grid_cell)))


def _cheap_bound(tile: Tile) -> Bound:
    return cheap_bound(tile, workers.sources().heights)


def _exact_bound(tile: Tile) -> Bound:
    return height_bound(surface(tile, workers.sources()))
