"""Read the shipped tiles and raw sources to diagnose the 28 September terrain-bound misses.

From pipeline/: uv run python ../docs/design/measurements/work/surface-bake/classify-cross-face.py
Prints JSON to stdout. Does not build, write stages or change the verifier's freshness rule.
"""

import json
import math
import re
from functools import cache
from pathlib import Path

import numpy as np

from prebuild.codes import codes_to_meters, field_bytes, meters_to_codes
from prebuild.config import load_water
from prebuild.cube import (
    BORDER,
    EARTH_RADIUS_M,
    TILE,
    corner,
    dir_to_lonlat,
    face_st,
    neighbor,
    parse_tile_key,
    st_to_dir,
    texel_center,
)
from prebuild.fields import FieldVectors, shore_distance
from prebuild.footprint import cell_window, subsample_lonlat
from prebuild.gebco import GEBCO, GEBCO_NC, bilinear, read_window
from prebuild.height import texel_means
from prebuild.natural_earth import load_vectors
from prebuild.profiles import Profile, make_context
from prebuild.sources import verified_path
from prebuild.tiles import clamp_coastal
from prebuild.wst import from_file

REPO = Path(__file__).resolve().parents[5]
REPORT = json.loads(Path(__file__).with_name("global-verify-2026-09-28.json").read_text())
LAYER = REPO / "build/out/surf" / REPORT["ver8"]
DETAILS = {
    "5/4/31/31 E k=0 along=244: 102 vs 49..86",
    "5/1/28/31 N k=1 along=79: 10 vs -5..1",
    "6/4/63/62 E k=1 along=164: 38 vs -6..3",
}


@cache
def load(key):
    return from_file((LAYER / f"{key}.wst").read_bytes(), parse_tile_key(key))


def direction(tile, i, j):
    return st_to_dir(
        tile.face,
        texel_center(tile.level, TILE * tile.x + i),
        texel_center(tile.level, TILE * tile.y + j),
    )


def corner_direction(tile, i, j):
    return st_to_dir(
        tile.face,
        corner(tile.level, TILE * tile.x + i),
        corner(tile.level, TILE * tile.y + j),
    )


def source_patch(decoded, i, j, radius, nc, vectors):
    t = decoded.tile
    rows = range(TILE * t.y + j - radius, TILE * t.y + j + radius + 1)
    cols = range(TILE * t.x + i - radius, TILE * t.x + i + radius + 1)
    lon, lat = subsample_lonlat(t.face, t.level, rows, cols)
    raster = read_window(nc, *cell_window(lon, lat, 15))
    raw = texel_means(t.face, t.level, rows, cols, raster)
    shore = shore_distance(t.face, t.level, rows, cols, vectors)
    clamped = clamp_coastal(raw, shore)
    expected = meters_to_codes(clamped, decoded.q_land)
    window = np.s_[
        j + BORDER - radius : j + BORDER + radius + 1, i + BORDER - radius : i + BORDER + radius + 1
    ]
    assert np.array_equal(expected, decoded.codes[window]), (t.key(), i, j, "codes")
    assert np.array_equal(field_bytes(shore), decoded.shore[window]), (t.key(), i, j, "shore")
    samples = bilinear(raster, lon, lat).reshape(len(rows), 4, len(cols), 4)
    return raw, shore, clamped, expected, samples[radius, :, radius, :]


def bilinear_code(decoded, p):
    t = decoded.tile
    s, u = face_st(t.face, p)
    n = TILE * 2**t.level
    x = (s + 1) * n / 2 - 0.5 - TILE * t.x + BORDER
    y = (u + 1) * n / 2 - 0.5 - TILE * t.y + BORDER
    size = TILE + 2 * BORDER
    assert -1e-8 <= x <= size - 1 + 1e-8, x
    assert -1e-8 <= y <= size - 1 + 1e-8, y
    x, y = np.clip([x, y], 0, size - 1)
    i, j = min(int(np.floor(x)), size - 2), min(int(np.floor(y)), size - 2)
    a, b = x - i, y - j
    codes = decoded.codes[j : j + 2, i : i + 2].astype(float)
    return float(
        (1 - b) * ((1 - a) * codes[0, 0] + a * codes[0, 1])
        + b * ((1 - a) * codes[1, 0] + a * codes[1, 1])
    )


def normal_comparison(mine, theirs, i, j):
    # Both fields use these same physical points, including a one-sided stencil at k=3.
    il, ih = max(-1, -BORDER - i), min(1, TILE + BORDER - 1 - i)
    jl, jh = max(-1, -BORDER - j), min(1, TILE + BORDER - 1 - j)
    offsets = [(il, 0), (ih, 0), (0, jl), (0, jh)]
    p = np.array([direction(mine.tile, i + di, j + dj) for di, dj in offsets])
    codes = np.array([[bilinear_code(d, point) for point in p] for d in [mine, theirs]])
    heights = np.array([codes_to_meters(codes[n], d.q_land) for n, d in enumerate([mine, theirs])])
    angles = {}
    for exaggeration in [8, 2]:
        pos = (EARTH_RADIUS_M + exaggeration * heights)[:, :, None] * p[None, :, :]
        normals = np.cross(pos[:, 1] - pos[:, 0], pos[:, 3] - pos[:, 2])
        normals /= np.linalg.norm(normals, axis=1)[:, None]
        normals *= np.sign(normals @ direction(mine.tile, i, j))[:, None]
        angles[f"x{exaggeration}"] = float(
            np.degrees(np.arctan2(np.linalg.norm(np.cross(*normals)), np.dot(*normals)))
        )
    return {
        "offsetsIJ": offsets,
        "borderStencilCodes": codes[0].tolist(),
        "neighborStencilCodes": codes[1].tolist(),
        "angleDegrees": angles,
    }


def single_texel_normal_change(mine, theirs, i, j):
    """Isolate this texel by substituting the neighbor's sample in adjacent bilinear cells."""
    replacement = bilinear_code(theirs, direction(mine.tile, i, j))
    by_relief = {8: [], 2: []}
    for i0, j0 in [(i - 1, j - 1), (i, j - 1), (i - 1, j), (i, j)]:
        if not (-BORDER <= i0 < TILE + BORDER - 1 and -BORDER <= j0 < TILE + BORDER - 1):
            continue
        ij = [(i0, j0), (i0 + 1, j0), (i0, j0 + 1), (i0 + 1, j0 + 1)]
        directions = np.array([direction(mine.tile, x, y) for x, y in ij])
        before = np.array([float(mine.codes[y + BORDER, x + BORDER]) for x, y in ij])
        after = before.copy()
        after[ij.index((i, j))] = replacement
        heights = codes_to_meters(np.array([before, after]), mine.q_land)
        for relief, measured in by_relief.items():
            pos = (EARTH_RADIUS_M + relief * heights)[:, :, None] * directions[None, :, :]
            ds = (pos[:, 1] - pos[:, 0] + pos[:, 3] - pos[:, 2]) / 2
            dt = (pos[:, 2] - pos[:, 0] + pos[:, 3] - pos[:, 1]) / 2
            normals = np.cross(ds, dt)
            normals /= np.linalg.norm(normals, axis=1)[:, None]
            angle = float(
                np.degrees(np.arctan2(np.linalg.norm(np.cross(*normals)), np.dot(*normals)))
            )
            measured.append({"cellLowerIJ": [i0, j0], "degrees": angle})
    return {
        "neighborReplacementCode": replacement,
        "borderMinusNeighborMeters": float(
            codes_to_meters(mine.codes[j + BORDER, i + BORDER], mine.q_land)
            - codes_to_meters(replacement, theirs.q_land)
        ),
        "maxAngleDegrees": {
            f"x{relief}": max(cells, key=lambda cell: cell["degrees"])
            for relief, cells in by_relief.items()
        },
        "adjacentCellsChecked": len(by_relief[8]),
    }


def finite_json(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            return "Infinity" if value > 0 else "-Infinity"
        return round(value, 9)
    if isinstance(value, dict):
        return {k: finite_json(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [finite_json(v) for v in value]
    return value


def main():
    ctx = make_context(Profile.GLOBAL, 1, REPO)
    nc = verified_path(ctx, GEBCO, GEBCO_NC)
    water = load_water(REPO / "pipeline/config/water.yaml")
    vectors = FieldVectors.build(load_vectors(ctx, water), water)
    cases, centers = [], {}
    for line in REPORT["misses"]:
        match = re.fullmatch(
            r"(\S+) ([NESW]) k=(\d+) along=(\d+): (-?\d+) vs (-?\d+)\.\.(-?\d+)", line
        )
        assert match, line
        key, edge, k, along, recorded, low_recorded, high_recorded = match.groups()
        k, along = int(k), int(along)
        mine = load(key)
        t = mine.tile
        other = neighbor(t, edge)
        theirs = load(other.tile.key())
        assert mine.q_land == theirs.q_land
        i, j = {
            "E": (TILE + k, along),
            "W": (-1 - k, along),
            "N": (along, TILE + k),
            "S": (along, -1 - k),
        }[edge]
        p = direction(t, i, j)
        s, u = face_st(other.tile.face, p)
        n = TILE * 2**t.level
        si = int(np.floor((s + 1) * n / 2)) - TILE * other.tile.x
        sj = int(np.floor((u + 1) * n / 2)) - TILE * other.tile.y
        column = {"W": si, "E": TILE - 1 - si, "S": sj, "N": TILE - 1 - sj}[other.edge]
        assert column == k
        raw, shore, clamped, encoded, samples = source_patch(mine, i, j, 0, nc, vectors)
        nr, ns, nh, ne, _ = source_patch(theirs, si, sj, 1, nc, vectors)
        raw_codes = meters_to_codes(nr, theirs.q_land)
        code, d = int(encoded[0, 0]), float(shore[0, 0])
        near = abs(int(mine.shore[j + BORDER, i + BORDER]) - 128) <= 32
        low = min(int(ne.min()), 0) if near else int(ne.min())
        high = max(int(ne.max()), 0) if near else int(ne.max())
        sides = np.sign(
            theirs.shore[
                sj + BORDER - 1 : sj + BORDER + 2, si + BORDER - 1 : si + BORDER + 2
            ].astype(int)
            - 128
        )
        split = near and d != 0 and np.sign(d) not in sides
        assert (code, low, high) == (int(recorded), int(low_recorded), int(high_recorded))
        assert (
            code < low - 2 - (high - low) / 3 or code > high + 2 + (high - low) / 3
        ) and not split
        if np.array_equal(raw_codes, ne):
            cause = "different GEBCO sampling footprints"
        else:
            # All nine coastal cases would fit the raw GEBCO code range before clamping.
            assert int(raw_codes.min()) <= code <= int(raw_codes.max())
            cause = "coastal clamp reach" if abs(d) > 2 else "coastal clamp sign"
        centers[key] = list(map(float, dir_to_lonlat(corner_direction(t, 128, 128))))
        case = {
            "miss": line,
            "classification": "neither side departs from its source",
            "cause": cause,
            "texelCenterLonLat": list(map(float, dir_to_lonlat(p))),
            "qLandMeters": mine.q_land,
            "borderGebcoMeanMeters": float(raw[0, 0]),
            "borderShoreDistanceTexels": d,
            "borderAfterClampMeters": float(clamped[0, 0]),
            "borderExpectedAndStoredCode": code,
            "neighborTile": other.tile.key(),
            "neighborCenterIJ": [si, sj],
            "neighborRawCodeRange": [int(raw_codes.min()), int(raw_codes.max())],
            "neighborStoredCodeRange": [int(ne.min()), int(ne.max())],
            "normalComparison": normal_comparison(mine, theirs, i, j),
            "singleTexelNormalChange": single_texel_normal_change(mine, theirs, i, j),
        }
        if line in DETAILS:
            case["footprintEvidence"] = {
                "borderCornersLonLat": [
                    list(map(float, dir_to_lonlat(corner_direction(t, i + di, j + dj))))
                    for di, dj in [(0, 0), (1, 0), (1, 1), (0, 1)]
                ],
                "borderBilinearSubsamplesMeters": samples.tolist(),
                "neighborGebcoMeansMeters": nr.tolist(),
                "neighborShoreDistanceTexels": ns.tolist(),
                "neighborAfterClampMeters": nh.tolist(),
                "neighborExpectedAndStoredCodes": ne.tolist(),
            }
        cases.append(case)
    result = {
        "date": "2026-09-28",
        "commandFromPipeline": (
            "uv run python ../docs/design/measurements/work/surface-bake/classify-cross-face.py"
        ),
        "recipe": (
            "Production cube mapping; 4x4 bilinear subsamples of GEBCO's 15-arcsecond grid "
            "per texel; Natural Earth shore distance; two-texel coastal clamp; stored level "
            "qLand and half-away rounding."
        ),
        "checkedBorderTexels": len(cases),
        "checkedNeighborTexels": 9 * len(cases),
        "maxCodeDifferenceFromRecomputedSource": 0,
        "allRecomputedShoreBytesMatch": True,
        "conclusion": (
            "All twelve are terrain-bound false positives, with no encoder or column-mapping "
            "defect found: three from different GEBCO sampling footprints, six from the coastal "
            "clamp's two-texel reach and three from its land/sea sign. Both sides follow the "
            "specified encoder."
        ),
        "normalMethod": {
            "singleTexelNormalChange": (
                "To isolate each miss, replace only its border code with the neighbor grid's "
                "bilinear code at the same physical center. Compare geometric normals at the "
                "centers of the four adjacent mip-0 bilinear cells (two at outermost k=3); "
                "report the maximum rotation at each relief and the cell where it occurs. "
                "This is a diagnostic substitution, not a proposed correction to source data."
            ),
            "singleTexelCalculation": (
                "For each cell's four corners form P=(6371008.8+k*h)*direction, k=8 or 2, "
                "using codes_to_meters. At its center take the s tangent as the mean of its "
                "two s-edge chords and the t tangent as the mean of its two t-edge chords. "
                "Normalize their cross product before and after the single-code substitution; "
                "the angle is atan2(|a cross b|, a dot b) in degrees."
            ),
            "normalComparison": (
                "Also compare both decoded mip-0 fields' secant normals at the offending "
                "border center on the same physical stencil. Sample one texel before and "
                "after along each border-face axis; at k=3 use the center and inward sample "
                "on that axis. offsetsIJ lists s-low, s-high, t-low, t-high. Map each point "
                "into each face, bilinearly interpolate codes, form P as above, and compare "
                "normalized (P_sHigh-P_sLow) cross (P_tHigh-P_tLow). This compares whole "
                "local fields, rather than isolating one texel."
            ),
            "limit": (
                "These are CPU geometric slope diagnostics. They do not measure drawn mesh "
                "normals or the look shader's filtered, stylized, view-dependent normals. "
                "Border centers lie outside the face edge; rendered shading remains E2 work."
            ),
        },
        "tileCentersLonLat": centers,
        "cases": cases,
        "limits": [
            "The source comparison covers twelve border texels and twelve 3x3 neighbor patches; "
            "it is not another full-bake verification.",
            "Raw GEBCO and Natural Earth files were read after checking their pinned sizes; "
            "their full SHA-256 hashes were not recomputed.",
            "Infinity shore distances mean no shoreline within the raster's search reach; "
            "their stored shore bytes still match. Longitude and latitude are in degrees; "
            "matrix rows increase in face t, columns in face s.",
        ],
    }
    print(json.dumps(finite_json(result), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
