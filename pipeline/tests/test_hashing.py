import hashlib

import pytest

from prebuild.hashing import layer_version, lines_sha, tree_files, tree_sha, ver8


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def tree(tmp_path):
    (tmp_path / "pipeline" / "src" / "prebuild").mkdir(parents=True)
    (tmp_path / "pipeline" / "src" / "prebuild" / "cube.py").write_text("TILE = 256\n")
    (tmp_path / "pipeline" / "uv.lock").write_text("version = 1\n")
    (tmp_path / "shared").mkdir()
    (tmp_path / "shared" / "constants.json").write_text("{}\n")
    return tmp_path


PATHS = ("pipeline/src", "pipeline/uv.lock", "shared/constants.json", "pipeline/tests/data")


def test_lines_are_path_space_digest_sorted_bytewise():
    assert lines_sha({"b": "2", "a/c": "3", "a": "1"}) == sha(b"a 1\na/c 3\nb 2\n")


def test_ver8_hashes_layer_relative_paths():
    files = {"bounds.bin": b"bounds", "7/1/103/50.wst": b"tile"}
    lines = f"7/1/103/50.wst {sha(b'tile')}\nbounds.bin {sha(b'bounds')}\n"
    assert ver8(files) == sha(lines.encode())[:8]


def test_a_layer_version_from_digests_matches_one_from_bytes():
    files = {"bounds.bin": b"bounds", "7/1/103/50.wst": b"tile"}
    assert layer_version({path: sha(data) for path, data in files.items()}) == ver8(files)


def test_tree_files_are_repo_relative_and_skip_missing_paths(tree):
    assert tree_files(PATHS, tree) == [
        "pipeline/src/prebuild/cube.py",
        "pipeline/uv.lock",
        "shared/constants.json",
    ]


def test_tree_sha_hashes_each_file_by_its_path(tree):
    lines = [
        f"pipeline/src/prebuild/cube.py {sha(b'TILE = 256\n')}\n",
        f"pipeline/uv.lock {sha(b'version = 1\n')}\n",
        f"shared/constants.json {sha(b'{}\n')}\n",
    ]
    assert tree_sha(PATHS, tree) == sha("".join(lines).encode())


def test_tree_sha_ignores_caches_and_finder_files(tree):
    before = tree_sha(PATHS, tree)
    cache = tree / "pipeline" / "src" / "prebuild" / "__pycache__"
    cache.mkdir()
    (cache / "cube.cpython-314.pyc").write_bytes(b"\x00")
    (tree / "pipeline" / "src" / ".DS_Store").write_bytes(b"\x00")
    assert tree_sha(PATHS, tree) == before


def test_tree_sha_skips_symlinks(tree):
    before = tree_sha(PATHS, tree)
    (tree / "pipeline" / "src" / "link.py").symlink_to(tree / "pipeline" / "uv.lock")
    assert tree_sha(PATHS, tree) == before


@pytest.mark.parametrize(
    "change",
    [
        lambda root: (root / "pipeline" / "src" / "prebuild" / "cube.py").write_text(
            "TILE = 128\n"
        ),
        lambda root: (root / "pipeline" / "src" / "prebuild" / "new.py").write_text(""),
        lambda root: (root / "pipeline" / "uv.lock").unlink(),
        lambda root: (root / "pipeline" / "src" / "prebuild" / "cube.py").rename(
            root / "pipeline" / "src" / "prebuild" / "cube2.py"
        ),
        lambda root: (
            (root / "pipeline" / "tests" / "data").mkdir(parents=True)
            or (root / "pipeline" / "tests" / "data" / "x.i16.gz").write_bytes(b"\x1f\x8b")
        ),
    ],
)
def test_tree_sha_changes_when_any_file_changes(tree, change):
    before = tree_sha(PATHS, tree)
    change(tree)
    assert tree_sha(PATHS, tree) != before
