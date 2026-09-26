import base64
import dataclasses
import gzip
import hashlib
import json
import struct

import numpy as np
import pytest

from prebuild import coverage, surface
from prebuild.codes import q_land_start
from prebuild.cube import Tile, avail_set, available_nodes, node_count, node_from_index
from prebuild.expect import POINTS, write_surface_expectations
from prebuild.hashing import ver8
from prebuild.profiles import Profile, make_context
from prebuild.records import MissingStageRecord, read_record, write_record
from prebuild.tiles import build_tile
from prebuild.tiles import surface as tile_surface
from prebuild.wst import bounds_m, edge_texels, from_file, grid33, to_file

SUMBAWA_EAST = Tile(1, 7, 103, 50)


def fixture_context(root, jobs: int):
    """The fixture profile, building into a temporary folder in place of build/."""
    return dataclasses.replace(
        make_context(Profile.FIXTURE, jobs),
        out=root / "fixture",
        stages_dir=root / "stages",
        cache=root / "cache",
    )


def bake(root, jobs: int):
    ctx = fixture_context(root, jobs)
    coverage.run(ctx)
    surface.run(ctx)
    return ctx


@pytest.fixture(scope="module")
def baked(tmp_path_factory):
    """The fixture bake with four workers."""
    return bake(tmp_path_factory.mktemp("four"), 4)


@pytest.fixture(scope="module")
def record(baked):
    return read_record(baked, "surface")


def layer_files(ctx, record) -> dict[str, bytes]:
    layer = ctx.out / "surf" / record["ver"]
    return {
        path.relative_to(layer).as_posix(): path.read_bytes()
        for path in sorted(layer.rglob("*"))
        if path.is_file()
    }


def test_one_worker_and_four_bake_the_same_layer(baked, record, tmp_path):
    alone = bake(tmp_path, 1)
    assert read_record(alone, "surface") == record
    assert layer_files(alone, record) == layer_files(baked, record)


def test_the_version_recomputes_from_the_files(baked, record):
    assert ver8(layer_files(baked, record)) == record["ver"]
    assert [p.name for p in (baked.out / "surf").iterdir()] == [record["ver"]]


def test_every_available_node_has_a_file_and_nothing_else_does(baked, record):
    nodes = available_nodes(base64.b64decode(record["avail"]))
    tiles = [f"{node_from_index(k).key()}.wst" for k in nodes]
    assert sorted(layer_files(baked, record)) == sorted([*tiles, "bounds.bin"])


def test_the_surface_record(baked, record):
    cover = read_record(baked, "coverage")
    assert record == {
        "ver": record["ver"],
        "maxLevel": 7,
        "avail": cover["avail"],
        "bounds": f"surf/{record['ver']}/bounds.bin",
        "inputs": cover["inputs"],
    }


def test_bounds_bin_holds_every_available_tile_s_meter_bounds(baked, record):
    files = layer_files(baked, record)
    max_level, entries = surface.read_bounds(files["bounds.bin"])
    nodes = available_nodes(base64.b64decode(record["avail"]))
    assert max_level == 7 and len(entries) == len(nodes)
    for k, entry in zip(nodes, entries, strict=True):
        tile = node_from_index(k)
        assert entry == bounds_m(from_file(files[f"{tile.key()}.wst"], tile)), tile.key()


def test_each_tile_uses_its_level_s_q_land(baked, record):
    q_land = read_record(baked, "coverage")["qLand"]
    files = layer_files(baked, record)
    for k in available_nodes(base64.b64decode(record["avail"])):
        tile = node_from_index(k)
        assert from_file(files[f"{tile.key()}.wst"], tile).q_land == q_land[tile.level]


def test_a_worker_bakes_what_the_parent_would(baked, record, fixture_sources):
    """The prepared layers survive the trip to the workers as WKB."""
    built = build_tile(tile_surface(SUMBAWA_EAST, fixture_sources), q_land_start(7))
    assert layer_files(baked, record)[f"{SUMBAWA_EAST.key()}.wst"] == to_file(built)


# Freshness


@pytest.fixture
def fresh(baked, tmp_path):
    """A build folder holding the bake's coverage record, and a way to change its inputs."""
    ctx = fixture_context(tmp_path, 1)
    cover = read_record(baked, "coverage")

    def with_inputs(change) -> None:
        inputs = json.loads(json.dumps(cover["inputs"]))
        change(inputs)
        write_record(ctx, "coverage", {**cover, "inputs": inputs})

    return ctx, with_inputs


@pytest.mark.parametrize(
    ("change", "named"),
    [
        (lambda inputs: inputs.update(code="0" * 64), "code"),
        (lambda inputs: inputs.update(gebco="0" * 64), "gebco"),
        (lambda inputs: inputs["ne"].update(land="0" * 64), "ne"),
        (lambda inputs: inputs["configs"].update({"water.yaml": "0" * 64}), "configs"),
    ],
    ids=["code", "gebco", "ne", "configs"],
)
def test_surface_refuses_stale_coverage(fresh, change, named):
    ctx, with_inputs = fresh
    with_inputs(change)
    with pytest.raises(coverage.StaleCoverage, match=rf"\({named} changed\).*coverage`"):
        surface.run(ctx)
    assert not (ctx.out / "surf").exists()


def test_surface_needs_a_coverage_record(tmp_path):
    ctx = fixture_context(tmp_path, 1)
    with pytest.raises(MissingStageRecord, match="prebuild --profile fixture coverage"):
        surface.run(ctx)


# bounds.bin and publishing


def avail_of(nodes: list[int], max_level: int = 0) -> bytearray:
    avail = bytearray((node_count(max_level) + 7) // 8)
    for k in nodes:
        avail_set(avail, k)
    return avail


def test_bounds_bin_is_a_header_and_i16_pairs_in_node_order():
    stored = surface.bounds_bin(avail_of([1, 4]), 0, {4: (-10994, 8848), 1: (-3, 12)})
    assert stored[4:8] == b"\0\0\0\0"  # gzip mtime 0
    raw = gzip.decompress(stored)
    assert raw[:12] == b"WSB1" + struct.pack("<BBHI", 1, 0, 0, 2)
    assert np.frombuffer(raw, "<i2", offset=12).tolist() == [-3, 12, -10994, 8848]
    assert surface.read_bounds(stored) == (0, [(-3, 12), (-10994, 8848)])


def test_bounds_bin_takes_exactly_the_available_nodes():
    with pytest.raises(ValueError, match="every available node"):
        surface.bounds_bin(avail_of([1, 4]), 0, {1: (0, 1)})
    with pytest.raises(ValueError, match="every available node"):
        surface.bounds_bin(avail_of([1]), 0, {1: (0, 1), 2: (0, 1)})
    with pytest.raises(ValueError, match="maxLevel"):
        surface.bounds_bin(avail_of([1]), 1, {1: (0, 1)})
    with pytest.raises(ValueError, match="i16"):
        surface.bounds_bin(avail_of([1]), 0, {1: (0, 40000)})


def test_publishing_renames_the_staged_layer(tmp_path):
    staging = tmp_path / ".tmp-1"
    (staging / "0/0/0").mkdir(parents=True)
    (staging / "0/0/0/0.wst").write_bytes(b"tile")
    surface.publish(staging, tmp_path / "abcd1234")
    assert (tmp_path / "abcd1234" / "0/0/0/0.wst").read_bytes() == b"tile"
    assert not staging.exists()


@pytest.mark.parametrize(
    ("files", "same"),
    [
        ({"a.wst": b"tile"}, True),
        ({"a.wst": b"tilf"}, False),
        ({"a.wst": b"tile", "b.wst": b"more"}, False),
        ({"b.wst": b"tile"}, False),
    ],
    ids=["same", "other-bytes", "extra-file", "other-name"],
)
def test_a_published_layer_is_kept_only_when_it_holds_the_same_bytes(tmp_path, files, same):
    target = tmp_path / "abcd1234"
    target.mkdir()
    (target / "a.wst").write_bytes(b"tile")
    staging = tmp_path / ".tmp-1"
    staging.mkdir()
    for name, data in files.items():
        (staging / name).write_bytes(data)
    if same:
        surface.publish(staging, target)
    else:
        with pytest.raises(surface.LayerConflict):
            surface.publish(staging, target)
    assert (target / "a.wst").read_bytes() == b"tile"


def test_a_run_clears_what_an_interrupted_run_left_in_the_layer(baked, tmp_path):
    ctx = fixture_context(tmp_path, 4)
    write_record(ctx, "coverage", read_record(baked, "coverage"))
    partial = ctx.out / "surf" / ".tmp-999999" / "0/0/0/0.wst"
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"partial")
    surface.run(ctx)
    assert [p.name for p in (ctx.out / "surf").iterdir()] == [read_record(ctx, "surface")["ver"]]


# The fixture's sidecars


def test_tiles_json_describes_every_tile_in_node_order(baked, record):
    tiles = json.loads((baked.stages_dir / "expect" / "tiles.json").read_text())
    nodes = available_nodes(base64.b64decode(record["avail"]))
    assert list(tiles) == [node_from_index(k).key() for k in nodes]
    files = layer_files(baked, record)
    for key, row in tiles.items():
        t = from_file(files[f"{key}.wst"], node_from_index(row["node"]))
        planes = {
            "codes": t.codes,
            "shore": t.shore,
            "water": t.water,
            "edges": edge_texels(t),
            "grid": grid33(t),
        }
        digests = {
            name: hashlib.sha256(v.astype(v.dtype.newbyteorder("<")).tobytes()).hexdigest()
            for name, v in planes.items()
        }
        assert row["sha256"] == digests
        assert row["boundsM"] == list(bounds_m(t))
        assert (row["header"]["codeMin"], row["header"]["codeMax"]) == (t.code_min, t.code_max)


def test_points_json_locates_each_known_place(baked):
    points = json.loads((baked.stages_dir / "expect" / "points.json").read_text())
    assert [p["name"] for p in points] == [name for name, *_ in POINTS]
    by_name = {p["name"]: p for p in points}
    assert by_name["tambora-summit"]["key"] == SUMBAWA_EAST.key()
    assert 2550 < by_name["tambora-summit"]["meters"] < 2586.4
    assert by_name["flores-sea"]["shoreSign"] == -1
    assert by_name["lake-urmia"]["waterSign"] == -1
    assert by_name["tigris"]["waterSign"] == -1


def test_other_profiles_write_no_sidecars(baked):
    region = dataclasses.replace(baked, profile=Profile.REGION)
    with pytest.raises(ValueError, match="fixture build"):
        write_surface_expectations(region, {})
