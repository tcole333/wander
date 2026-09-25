import re
from pathlib import Path, PurePosixPath

import pytest

from prebuild.profiles import Profile, make_context
from prebuild.sources import (
    SourceFile,
    SourcesError,
    SourceUnavailable,
    Unzipped,
    load_sources,
    verified_path,
)

HEX64 = re.compile(r"[0-9a-f]{64}")
SHA = "0" * 64


def test_the_registry_pins_the_surface_core_inputs():
    pinned = {
        source_id: sorted(PurePosixPath(p.path).name for p in source.pinned())
        for source_id, source in load_sources().items()
    }
    assert pinned == {
        "gebco-2026": [
            "GEBCO_2026.nc",
            "GEBCO_2026.zip",
            "GEBCO_Grid_docmentation.pdf",
            "GEBCO_Grid_terms_of_use.pdf",
        ],
        "natural-earth-10m-physical": [
            "ne_10m_lakes.zip",
            "ne_10m_land.zip",
            "ne_10m_rivers_lake_centerlines_scale_rank.zip",
        ],
        "natural-earth-10m-minor-islands": ["ne_10m_minor_islands.zip"],
    }


def test_every_pin_is_a_full_sha256_under_its_source_folder():
    for source_id, source in load_sources().items():
        for pinned in source.pinned():
            assert HEX64.fullmatch(pinned.sha256)
            assert pinned.path.startswith(f"sources/{source_id}/")
            assert pinned.bytes > 0


def test_pinned_paths_are_unique():
    paths = [p.path for source in load_sources().values() for p in source.pinned()]
    assert len(paths) == len(set(paths))


def test_each_unzipped_member_comes_from_a_listed_zip():
    for source in load_sources().values():
        zips = {f.path for f in source.files}
        assert all(u.from_ in zips for u in source.unzipped)


def test_natural_earth_downloads_from_the_pinned_release():
    for source_id in ("natural-earth-10m-physical", "natural-earth-10m-minor-islands"):
        source = load_sources()[source_id]
        assert source.version == "5.1.2"
        for f in source.files:
            name = PurePosixPath(f.path).name
            assert (
                f.source_url == f"https://naturalearth.s3.amazonaws.com/5.1.2/10m_physical/{name}"
            )


def test_gebco_pins_the_unzipped_grid_beside_its_zip():
    gebco = load_sources()["gebco-2026"]
    nc = next(u for u in gebco.unzipped if u.member == "GEBCO_2026.nc")
    assert nc.path == "sources/gebco-2026/GEBCO_2026.nc"
    assert nc.bytes == 7_466_018_396


def write_registry(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "sources.toml"
    path.write_text(text, encoding="utf-8")
    return path


GOOD = f"""
[demo]
name = "Demo"
version = "1"
license = "Public domain"
license_url = "https://example.org/license"
attribution = "Demo"
retrieved = "2026-09-25"

[[demo.files]]
path = "sources/demo/a.zip"
source_url = "https://example.org/a.zip"
bytes = 10
sha256 = "{SHA}"

[[demo.unzipped]]
from = "sources/demo/a.zip"
member = "a.txt"
path = "sources/demo/a.txt"
bytes = 3
sha256 = "{SHA}"
"""


def test_a_registry_with_every_field_loads(tmp_path):
    demo = load_sources(write_registry(tmp_path, GOOD))["demo"]
    assert demo.files == (SourceFile("sources/demo/a.zip", 10, SHA, "https://example.org/a.zip"),)
    assert demo.unzipped == (Unzipped("sources/demo/a.zip", "a.txt", "sources/demo/a.txt", 3, SHA),)
    assert demo.landing_page is None


@pytest.mark.parametrize(
    ("old", "new", "complaint"),
    [
        ('version = "1"\n', "", "missing keys version"),
        ('version = "1"', 'version = "1"\nurl = "x"', "unknown keys url"),
        ("bytes = 10", "bytes = 10\ncolor = 1", "unknown keys color"),
        (f'"{SHA}"', '"abc"', "64 lowercase hex"),
        ("bytes = 10", "bytes = 0", "positive integer"),
        ("sources/demo/a.zip", "sources/else/a.zip", "not under sources/demo/"),
        ('from = "sources/demo/a', 'from = "sources/demo/b', "b.zip, not a listed file"),
        ("sources/demo/a.txt", "sources/demo/a.zip", "more than once"),
        ("demo", "Demo", "lowercase"),
    ],
)
def test_a_malformed_registry_is_refused(tmp_path, old, new, complaint):
    with pytest.raises(SourcesError, match=complaint):
        load_sources(write_registry(tmp_path, GOOD.replace(old, new)))


def context(profile: Profile, data: Path, monkeypatch):
    monkeypatch.setenv("WANDER_DATA", str(data))
    return make_context(profile, 1, data.parent)


def demo_sources(tmp_path):
    return load_sources(write_registry(tmp_path, GOOD))


def test_verified_path_checks_the_size_and_not_the_hash(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "sources" / "demo").mkdir(parents=True)
    (data / "sources" / "demo" / "a.txt").write_bytes(b"abc")  # the pin's sha256 is all zeros
    ctx = context(Profile.REGION, data, monkeypatch)
    path = verified_path(ctx, "demo", "a.txt", demo_sources(tmp_path))
    assert path == data / "sources" / "demo" / "a.txt"


def test_verified_path_refuses_a_file_of_another_size(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "sources" / "demo").mkdir(parents=True)
    (data / "sources" / "demo" / "a.txt").write_bytes(b"abcd")
    ctx = context(Profile.GLOBAL, data, monkeypatch)
    with pytest.raises(SourceUnavailable, match=r"4 bytes, not the pinned 3: run `uv run prebuild"):
        verified_path(ctx, "demo", "a.txt", demo_sources(tmp_path))


def test_verified_path_names_fetch_for_a_missing_file(tmp_path, monkeypatch):
    ctx = context(Profile.GLOBAL, tmp_path / "data", monkeypatch)
    with pytest.raises(SourceUnavailable, match="missing: run `uv run prebuild fetch`"):
        verified_path(ctx, "demo", "a.zip", demo_sources(tmp_path))


def test_verified_path_raises_under_the_fixture_profile(tmp_path):
    ctx = make_context(Profile.FIXTURE, 1, tmp_path)
    with pytest.raises(SourceUnavailable, match="committed excerpts"):
        verified_path(ctx, "demo", "a.zip", demo_sources(tmp_path))


def test_verified_path_refuses_a_file_the_source_does_not_pin(tmp_path, monkeypatch):
    ctx = context(Profile.GLOBAL, tmp_path / "data", monkeypatch)
    with pytest.raises(SourcesError, match=r"no file named 'b\.zip'"):
        verified_path(ctx, "demo", "b.zip", demo_sources(tmp_path))
