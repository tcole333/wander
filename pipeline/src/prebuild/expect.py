"""Test sidecars of the fixture build (streaming.md 7.3): expected values in
build/stages/fixture/expect/ and the stamp that tells the Vitest fixture loader the build is fresh.
"""

import base64
import hashlib
import itertools
import json
import math
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from prebuild.codes import field_bytes, meters_to_codes, q_land_start
from prebuild.cube import (
    BORDER,
    TILE,
    Tile,
    available_nodes,
    face_edge_sides,
    face_of,
    face_st,
    lonlat_to_dir,
    node_from_index,
    node_index,
    st_to_dir,
    texel_center,
    texel_of,
    tile_of,
)
from prebuild.hashing import FIXTURE_PATHS
from prebuild.profiles import Context, Profile
from prebuild.records import write_json
from prebuild.tiles import open_sources, surface
from prebuild.wst import (
    MIP_ENTRIES,
    MIP_SIZES,
    PLANE_SHAPE,
    PROFILE_ENTRIES,
    PROFILES_SHAPE,
    SIZE,
    E,
    S,
    WstTile,
    bounds_m,
    decoder_outputs,
    edge_texels,
    from_file,
    grid33,
    mip_entries,
    mips,
    tile_flags,
    to_file,
)

SUMBAWA = (118.0, -8.25)
TAMBORA_SUMMIT = (117.9604, -8.2479)  # the GEBCO maximum on the rim
KIRKUK_VERTEX = (45.0, math.degrees(math.atan(math.sqrt(0.5))))  # where faces 0, 1 and 4 meet
LEVELS = range(8)
SYNTHETIC = "synthetic"  # the synthetic .wst tiles and what they decode to, under expect/
# Known places in the fixture's tiles, as (name, lon, lat, level), for points.json.
POINTS: list[tuple[str, float, float, int]] = [
    ("tambora-summit", *TAMBORA_SUMMIT, 7),
    ("tambora-caldera", 118.0, -8.25, 7),
    ("sanggar", 118.1, -8.3, 7),  # the Sanggar peninsula, east of the caldera
    ("flores-sea", 117.7, -8.0, 5),
    ("lake-urmia", 45.4631, 37.622, 5),  # more than 8 texels from its shore
    ("tigris", 43.6959, 34.6549, 6),  # on the river line above Samarra
]


def stamp_path(ctx: Context) -> Path:
    return ctx.stages_dir / "stamp.json"


def clear_stamp(ctx: Context) -> None:
    stamp_path(ctx).unlink(missing_ok=True)


def write_expectations(ctx: Context, inputs: str) -> None:
    """Write the cube samples and the synthetic tiles, then the stamp; runs last in a full fixture
    build. `inputs` is the caller's tree hash of FIXTURE_PATHS, taken before the stages ran."""
    if ctx.profile is not Profile.FIXTURE:
        raise ValueError(f"test sidecars belong to the fixture build, not {ctx.profile}")
    ctx.out.mkdir(parents=True, exist_ok=True)
    expect = ctx.stages_dir / "expect"
    expect.mkdir(parents=True, exist_ok=True)
    samples = [cube_sample(lon, lat, level) for lon, lat, level in sample_points()]
    (expect / "cube-samples.json").write_text(_json_rows(samples), encoding="utf-8")
    write_synthetic(expect)
    stamp = {"inputs": inputs, "paths": list(FIXTURE_PATHS)}
    write_json(stamp_path(ctx), stamp)


def sample_points() -> list[tuple[float, float, int]]:
    """(lon, lat, level) points for the cube cross-check (streaming.md 3.0 item 9)."""
    grid = [
        (-180 + 7.5 * k, -90 + 5.0 * m, (k + m) % 8)
        for k, m in itertools.product(range(48), range(37))
    ]
    kirkuk = [
        (KIRKUK_VERTEX[0] + d_lon, KIRKUK_VERTEX[1] + d_lat)
        for d_lon, d_lat in itertools.product((-1e-4, 1e-4), repeat=2)
    ]
    dateline = list(itertools.product((-180.0, 180.0, 179.9999), (-30.0, 0.0, 30.0)))
    named = [SUMBAWA, TAMBORA_SUMMIT, *kirkuk, *dateline]
    return grid + [(lon, lat, level) for level in LEVELS for lon, lat in named]


def cube_sample(lon: float, lat: float, level: int) -> dict[str, Any]:
    p = lonlat_to_dir(lon, lat)
    face = int(face_of(p))
    s, t = face_st(face, p)
    x, y = int(tile_of(s, level)), int(tile_of(t, level))
    i, j = int(texel_of(s, level, x)), int(texel_of(t, level, y))
    center = st_to_dir(face, texel_center(level, TILE * x + i), texel_center(level, TILE * y + j))
    return {
        "lon": lon,
        "lat": lat,
        "L": level,
        "f": face,
        "x": x,
        "y": y,
        "node": node_index(Tile(face, level, x, y)),
        "s": float(s),
        "t": float(t),
        "i": i,
        "j": j,
        "center": [float(v) for v in center],
    }


def synthetic_tiles() -> dict[str, WstTile]:
    """Tiles for the .wst round trip between the Python encoder and the app's decoder
    (streaming.md 3.1), built to reach the corners of the format that the fixture's baked tiles
    (`tiles.json`) do not. Between them they store profiles on 0, 1, 2 and 4 sides."""
    return {"extremes": _extremes(), "trench": _trench(), "random": _random(), "root": _root()}


def write_synthetic(expect: Path) -> None:
    """Each synthetic tile as a stored file, the planes and decoder outputs it must decode to as
    raw little-endian arrays, and `synthetic.json` listing the tiles with their header fields and
    meter bounds."""
    shutil.rmtree(expect / SYNTHETIC, ignore_errors=True)
    rows = []
    for name, t in synthetic_tiles().items():
        stored = f"{SYNTHETIC}/{name}.wst"
        _write_bytes(expect / stored, to_file(t))
        planes = {"codes": t.codes, "shore": t.shore, "water": t.water}
        outputs = {}
        for output, values in {**planes, **decoder_outputs(t)}.items():
            outputs[output] = f"{SYNTHETIC}/{name}/{output}.bin"
            _write_bytes(expect / outputs[output], _little(values))
        rows.append(
            {
                "name": name,
                "key": t.tile.key(),
                "wst": stored,
                "header": _header(t),
                "boundsM": list(bounds_m(t)),
                "outputs": outputs,
            }
        )
    write_json(expect / f"{SYNTHETIC}.json", rows)


def write_surface_expectations(ctx: Context, record: Mapping[str, Any]) -> None:
    """What the fixture's surface layer decodes to, for the app's decoder: `tiles.json` maps each
    available tile's key, in node order, to its node, header, meter bounds and the sha256 of its
    decoded planes as little-endian arrays (codes, shore and water, the RG16F edge texture and the
    33² f32 grid).
    `points.json` locates each of POINTS and gives the clamped height there before quantization
    and the signs of the shore and water distances."""
    if ctx.profile is not Profile.FIXTURE:
        raise ValueError(f"test sidecars belong to the fixture build, not {ctx.profile}")
    expect = ctx.stages_dir / "expect"
    layer = ctx.out / Path(record["bounds"]).parent
    tiles: dict[str, dict[str, Any]] = {}
    for k in available_nodes(base64.b64decode(record["avail"])):
        tile = node_from_index(k)
        t = from_file((layer / f"{tile.key()}.wst").read_bytes(), tile)
        planes = {
            "codes": t.codes,
            "shore": t.shore,
            "water": t.water,
            "edges": edge_texels(t),
            "grid": grid33(t),
        }
        tiles[tile.key()] = {
            "node": k,
            "header": _header(t),
            "boundsM": list(bounds_m(t)),
            "sha256": {name: _sha256(values) for name, values in planes.items()},
        }
    write_json(expect / "tiles.json", tiles)
    sources = open_sources(ctx)
    rows = []
    for name, lon, lat, level in POINTS:
        sample = cube_sample(lon, lat, level)
        tile = Tile(sample["f"], level, sample["x"], sample["y"])
        if tile.key() not in tiles:
            raise ValueError(f"{name} lies in {tile.key()}, which the fixture does not bake")
        s = surface(tile, sources)
        at = (sample["j"] + BORDER, sample["i"] + BORDER)
        rows.append(
            {
                "name": name,
                "lon": lon,
                "lat": lat,
                "key": tile.key(),
                "i": sample["i"],
                "j": sample["j"],
                "meters": float(s.heights[at]),
                "shoreSign": int(np.sign(s.fields.shore_d[at])),
                "waterSign": int(np.sign(s.fields.water_d[at])),
            }
        )
    (expect / "points.json").write_text(_json_rows(rows), encoding="utf-8")


def edge_profiles(
    tile: Tile, codes: npt.ArrayLike, shore: npt.ArrayLike
) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.int64]]:
    """The (4, 451) profile codes and shore bytes of a tile's own planes, as the bake writes the
    entries its own face owns: on each stored side, entry k of mip m is the rha mean of the four
    mip-m codes around corner 2^m·k and (T + 2) >> 2 of their shore bytes, whose sum is T. Zero on
    in-face sides."""
    profiles = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    profile_shore = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    for m, (code_mip, shore_mip) in enumerate(zip(mips(codes), mips(shore), strict=True)):
        # Tile corner 2^m·k comes after stored mip-m row and column (4 >> m) + k - 1.
        k = np.arange(MIP_ENTRIES[m]) + (BORDER >> m) - 1
        code_sums, shore_sums = _side_sums(code_mip, k), _side_sums(shore_mip, k)
        for e in face_edge_sides(tile):
            mip_entries(profiles, m)[e] = np.sign(code_sums[e]) * ((np.abs(code_sums[e]) + 2) >> 2)
            mip_entries(profile_shore, m)[e] = (shore_sums[e] + 2) >> 2
    return profiles, profile_shore


def _side_sums(plane: npt.NDArray[np.int64], k: npt.NDArray[np.int64]) -> npt.NDArray[np.int64]:
    """(4, len(k)): along sides N, E, S, W, the sums of the four texels around the corners after
    rows and columns k; N and E after the last of k, S and W after the first."""
    around = plane[:-1, :-1] + plane[:-1, 1:] + plane[1:, :-1] + plane[1:, 1:]
    first, last = k[0], k[-1]
    return np.stack([around[last, k], around[k, last], around[first, k], around[k, first]])


def _extremes() -> WstTile:
    """Codes at codeMid ± 2048 in 8-texel blocks, and texel by texel (the largest residuals, ±8,192)
    in the upper half; shore and water at 0 and 255, whose residuals wrap past 0 and 255. The
    face-4 tile at the Kirkuk corner, whose S and E sides store profiles alternating between the
    extremes, as their shore bytes do."""
    mid, reach = 1000, 2048
    j, i = np.indices(PLANE_SHAPE)
    high = np.where(j < SIZE // 2, (i // 8 + j // 8) % 2 == 1, (i + j) % 2 == 1)
    profiles = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    profile_shore = np.zeros(PROFILES_SHAPE, dtype=np.int64)
    k = np.arange(PROFILE_ENTRIES)
    for e in (S, E):
        odd = (k + e) % 2 == 1
        profiles[e] = np.where(odd, mid + reach, mid - reach)
        profile_shore[e] = np.where(odd, 255, 0)
    for m in range(len(MIP_SIZES)):
        for out in (profiles, profile_shore):
            mip_entries(out, m)[E, 0] = mip_entries(out, m)[S, -1]  # the corner S and E share
    shore_d = np.where(high, np.inf, -np.inf)
    water_d = np.where(high, -8.0, 8.0)
    return WstTile.from_planes(
        Tile(4, 7, 127, 0),
        flags=tile_flags(shore_d, water_d),
        q_land=q_land_start(7),
        codes=np.where(high, mid + reach, mid - reach),
        shore=field_bytes(shore_d),
        water=field_bytes(water_d),
        profiles=profiles,
        profile_shore=profile_shore,
    )


def _trench() -> WstTile:
    """All sea: a trench 6 km deep, far below c200, beside a shelf that crosses -200 m. Heights
    fall toward the trench's axis, so residuals run negative as well as positive. Sumbawa's L7
    tile, inside its face, so it stores no profile."""
    j, i = np.indices(PLANE_SHAPE) - 4
    h = -150 - 5800 * np.exp(-(((i - 100) / 30) ** 2)) + 120 * np.sin(j / 17)
    q = q_land_start(7)
    codes = meters_to_codes(h, q)
    shore_d = -0.25 - (SIZE - 1 - i) / 16
    water_d = np.full(PLANE_SHAPE, np.inf)
    return WstTile.from_planes(
        Tile(1, 7, 103, 50),
        flags=tile_flags(shore_d, water_d),
        q_land=q,
        codes=codes,
        shore=field_bytes(shore_d),
        water=field_bytes(water_d),
    )


def _random() -> WstTile:
    """Seeded random codes, shore and water, with inland water, a qLand that is not a whole
    number of meters, and x and y past one byte. On its face's N edge, it stores one profile, so
    its payload carries the pad byte."""
    rng = np.random.default_rng(3)
    codes = rng.integers(-1500, 1500, PLANE_SHAPE)
    shore_d = rng.uniform(-10, 10, PLANE_SHAPE)
    water_d = rng.uniform(-10, 10, PLANE_SHAPE)
    shore_d[rng.random(PLANE_SHAPE) < 0.05] = np.inf
    water_d[rng.random(PLANE_SHAPE) < 0.05] = -np.inf
    tile = Tile(5, 9, 300, 511)
    shore = field_bytes(shore_d)
    profiles, profile_shore = edge_profiles(tile, codes, shore)
    return WstTile.from_planes(
        tile,
        flags=tile_flags(shore_d, water_d),
        q_land=q_land_start(4),
        codes=codes,
        shore=shore,
        water=field_bytes(water_d),
        profiles=profiles,
        profile_shore=profile_shore,
    )


def _root() -> WstTile:
    """An L0 tile, whose four sides all store profiles: rolling relief that falls past c200 into
    a basin, a shore that follows the relief, and profiles of its own planes."""
    j, i = np.indices(PLANE_SHAPE) - 4
    h = 2400 * np.sin(i / 23) * np.cos(j / 31) - 900 * np.exp(-(((i - 180) ** 2 + j**2) / 5000))
    q = q_land_start(0)
    codes = meters_to_codes(h, q)
    shore_d = h / 40
    water_d = np.where((i - 60) ** 2 + (j - 200) ** 2 < 400, -3.0, 5.0)
    shore = field_bytes(shore_d)
    tile = Tile(2, 0, 0, 0)
    profiles, profile_shore = edge_profiles(tile, codes, shore)
    return WstTile.from_planes(
        tile,
        flags=tile_flags(shore_d, water_d),
        q_land=q,
        codes=codes,
        shore=shore,
        water=field_bytes(water_d),
        profiles=profiles,
        profile_shore=profile_shore,
    )


def _header(t: WstTile) -> dict[str, Any]:
    return {
        "face": t.tile.face,
        "level": t.tile.level,
        "x": t.tile.x,
        "y": t.tile.y,
        "flags": t.flags,
        "qLand": t.q_land,
        "qDeep": t.q_deep,
        "codeMid": t.code_mid,
        "codeMin": t.code_min,
        "codeMax": t.code_max,
    }


def _sha256(values: np.ndarray) -> str:
    """The sha256 of an array's values as little-endian bytes."""
    return hashlib.sha256(_little(values)).hexdigest()


def _little(values: np.ndarray) -> bytes:
    return values.astype(values.dtype.newbyteorder("<")).tobytes()


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _json_rows(rows: list[dict[str, Any]]) -> str:
    """A JSON array with one row per line; floats in shortest round-trip form."""
    return "[\n" + ",\n".join(json.dumps(row) for row in rows) + "\n]\n"
