import json
import math

import numpy as np
import pytest

from prebuild.cube import TILE, face_st, lonlat_to_dir, st_to_dir, texel_center
from prebuild.expect import KIRKUK_VERTEX, sample_points, write_expectations
from prebuild.hashing import FIXTURE_PATHS, tree_sha
from prebuild.profiles import Profile, make_context

FIELDS = ["lon", "lat", "L", "f", "x", "y", "node", "s", "t", "i", "j", "center"]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    repo = tmp_path_factory.mktemp("repo")
    (repo / "pipeline" / "src").mkdir(parents=True)
    (repo / "pipeline" / "src" / "stage.py").write_text("print('stage')\n")
    ctx = make_context(Profile.FIXTURE, jobs=1, repo=repo)
    write_expectations(ctx, tree_sha(FIXTURE_PATHS, repo))
    samples = json.loads((ctx.stages_dir / "expect" / "cube-samples.json").read_text())
    return ctx, samples


def test_the_samples_cover_the_grid_and_the_named_points(built):
    _, samples = built
    assert len(samples) == len(sample_points()) == 48 * 37 + 8 * 15
    assert [list(sample) for sample in samples[:1]] == [FIELDS]


def test_the_samples_cover_every_face_and_level(built):
    _, samples = built
    assert {sample["f"] for sample in samples} == set(range(6))
    assert {sample["L"] for sample in samples} == set(range(8))


def test_the_kirkuk_samples_fall_on_the_three_corner_tiles(built):
    _, samples = built
    near = [s for s in samples if math.isclose(s["lon"], KIRKUK_VERTEX[0], abs_tol=2e-4)]
    near = [s for s in near if math.isclose(s["lat"], KIRKUK_VERTEX[1], abs_tol=2e-4)]
    assert {s["f"] for s in near} == {0, 1, 4}
    for s in near:
        last = (1 << s["L"]) - 1
        assert (s["x"], s["y"]) == {0: (last, last), 1: (0, last), 4: (last, 0)}[s["f"]]


def test_each_sample_agrees_with_cube_py(built):
    _, samples = built
    for sample in samples:
        p = lonlat_to_dir(sample["lon"], sample["lat"])
        assert (sample["s"], sample["t"]) == tuple(float(v) for v in face_st(sample["f"], p))
        n = 1 << sample["L"]
        assert sample["node"] == 2 * (n * n - 1) + (sample["f"] * n + sample["y"]) * n + sample["x"]
        s = texel_center(sample["L"], TILE * sample["x"] + sample["i"])
        t = texel_center(sample["L"], TILE * sample["y"] + sample["j"])
        assert sample["center"] == st_to_dir(sample["f"], s, t).tolist()
        # Within half a texel, give or take the rounding of s + 1 at a texel edge.
        assert abs(s - sample["s"]) <= 1 / (TILE * n) + 1e-15
        assert abs(t - sample["t"]) <= 1 / (TILE * n) + 1e-15


def test_the_stamp_hashes_the_fixture_inputs(built):
    ctx, _ = built
    stamp = json.loads((ctx.stages_dir / "stamp.json").read_text())
    assert stamp == {"inputs": tree_sha(FIXTURE_PATHS, ctx.repo), "paths": list(FIXTURE_PATHS)}


def test_the_fixture_output_root_exists(built):
    ctx, _ = built
    assert ctx.out.is_dir()


def test_expectations_belong_to_the_fixture_profile(tmp_path):
    with pytest.raises(ValueError):
        write_expectations(make_context(Profile.GLOBAL, jobs=1, repo=tmp_path), "0" * 64)


def test_sample_floats_survive_json_exactly(built):
    _, samples = built
    values = np.array([[s["s"], s["t"], *s["center"]] for s in samples])
    assert np.array_equal(np.array(json.loads(json.dumps(values.tolist()))), values)
