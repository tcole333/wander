import pytest

from prebuild import layers
from prebuild.hashing import layer_version, sha256_bytes


def stage(layer, files: dict[str, bytes]):
    """A staging folder in `layer` holding `files`, and the digests the build took of them."""
    staging = layer / ".tmp-1"
    for name, data in files.items():
        (staging / name).parent.mkdir(parents=True, exist_ok=True)
        (staging / name).write_bytes(data)
    return staging, {name: sha256_bytes(data) for name, data in files.items()}


def test_publishing_renames_the_staged_layer_to_its_version(tmp_path):
    staging, digests = stage(tmp_path, {"0/0/0/0.wst": b"tile"})
    ver = layers.publish(staging, tmp_path, digests)
    assert ver == layer_version(digests)
    assert (tmp_path / ver / "0/0/0/0.wst").read_bytes() == b"tile"
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
    staging, digests = stage(tmp_path, files)
    target = tmp_path / layer_version(digests)
    target.mkdir()
    (target / "a.wst").write_bytes(b"tile")
    if same:
        layers.publish(staging, tmp_path, digests)
    else:
        with pytest.raises(layers.LayerConflict):
            layers.publish(staging, tmp_path, digests)
    assert (target / "a.wst").read_bytes() == b"tile"


def test_a_staging_folder_that_lost_files_is_never_published(tmp_path):
    staging, digests = stage(tmp_path, {"a.wst": b"tile", "b.wst": b"more"})
    (staging / "a.wst").unlink()  # a second run of the stage cleared the folder midway
    with pytest.raises(layers.LayerConflict, match="files this build hashed"):
        layers.publish(staging, tmp_path, digests)
    assert [path.name for path in tmp_path.iterdir()] == [".tmp-1"]
