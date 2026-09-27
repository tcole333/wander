import pytest

from prebuild import layers


def test_publishing_renames_the_staged_layer(tmp_path):
    staging = tmp_path / ".tmp-1"
    (staging / "0/0/0").mkdir(parents=True)
    (staging / "0/0/0/0.wst").write_bytes(b"tile")
    layers.publish(staging, tmp_path / "abcd1234")
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
        layers.publish(staging, target)
    else:
        with pytest.raises(layers.LayerConflict):
            layers.publish(staging, target)
    assert (target / "a.wst").read_bytes() == b"tile"
