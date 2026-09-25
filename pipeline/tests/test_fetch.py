import functools
import hashlib
import http.server
import threading
import zipfile
from pathlib import Path

import pytest

from prebuild.fetch import FetchError, ensure_file, ensure_unzipped, run
from prebuild.profiles import Profile, make_context
from prebuild.sources import Source, SourceFile, SourceUnavailable, Unzipped

BODY = b"bytes a real source would hold\n" * 100


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Server:
    """A local HTTP server over a folder, recording each path it is asked for."""

    def __init__(self, root: Path):
        self.requests: list[str] = []
        requests = self.requests

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                super().do_GET()

            def log_message(self, *args):
                pass

        handler = functools.partial(Handler, directory=str(root))
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(
            target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )

    def url(self, name: str) -> str:
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}/{name}"


@pytest.fixture
def server(tmp_path):
    served = tmp_path / "served"
    served.mkdir()
    (served / "a.bin").write_bytes(BODY)
    running = Server(served)
    running.thread.start()
    yield running
    running.httpd.shutdown()
    running.httpd.server_close()


def pin(server: Server, *, digest: str = sha(BODY), size: int = len(BODY)) -> SourceFile:
    return SourceFile("sources/demo/a.bin", size, digest, server.url("a.bin"))


def test_fetch_downloads_and_verifies_a_missing_file(tmp_path, server):
    root = tmp_path / "data"
    ensure_file(root, pin(server))
    assert (root / "sources" / "demo" / "a.bin").read_bytes() == BODY
    assert server.requests == ["/a.bin"]


def test_fetch_refuses_bytes_that_miss_the_pin_and_removes_the_part_file(tmp_path, server):
    root = tmp_path / "data"
    with pytest.raises(FetchError, match="sha256"):
        ensure_file(root, pin(server, digest=sha(b"other bytes")))
    assert list((root / "sources" / "demo").iterdir()) == []


def test_fetch_refuses_a_download_of_the_wrong_size(tmp_path, server):
    root = tmp_path / "data"
    with pytest.raises(FetchError, match="bytes, not the pinned"):
        ensure_file(root, pin(server, size=len(BODY) + 1))
    assert list((root / "sources" / "demo").iterdir()) == []


def test_fetch_checks_a_file_on_disk_without_the_network(tmp_path, server):
    root = tmp_path / "data"
    (root / "sources" / "demo").mkdir(parents=True)
    (root / "sources" / "demo" / "a.bin").write_bytes(BODY)
    ensure_file(root, pin(server))
    assert server.requests == []


def test_fetch_refuses_a_file_on_disk_that_misses_the_pin_and_keeps_it(tmp_path, server):
    root = tmp_path / "data"
    (root / "sources" / "demo").mkdir(parents=True)
    (root / "sources" / "demo" / "a.bin").write_bytes(BODY[:-1] + b"?")
    with pytest.raises(FetchError, match="sha256"):
        ensure_file(root, pin(server))
    assert (root / "sources" / "demo" / "a.bin").exists()
    assert server.requests == []


def test_fetch_names_the_landing_page_of_a_missing_verify_only_file(tmp_path):
    verify_only = SourceFile("sources/demo/a.bin", len(BODY), sha(BODY), None)
    with pytest.raises(FetchError, match=r"verify-only.*https://example\.org/demo"):
        ensure_file(tmp_path, verify_only, "https://example.org/demo")


def write_zip(root: Path, members: dict[str, bytes]) -> None:
    (root / "sources" / "demo").mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(root / "sources" / "demo" / "a.zip", "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)


def member_pin(data: bytes) -> Unzipped:
    return Unzipped("sources/demo/a.zip", "grid.nc", "sources/demo/grid.nc", len(data), sha(data))


def test_fetch_extracts_a_zip_member_beside_its_zip(tmp_path):
    write_zip(tmp_path, {"grid.nc": BODY, "other.pdf": b"pdf"})
    ensure_unzipped(tmp_path, member_pin(BODY))
    assert (tmp_path / "sources" / "demo" / "grid.nc").read_bytes() == BODY
    assert not (tmp_path / "sources" / "demo" / "other.pdf").exists()


def test_fetch_refuses_a_zip_member_that_misses_the_pin(tmp_path):
    write_zip(tmp_path, {"grid.nc": BODY})
    with pytest.raises(FetchError, match="sha256"):
        ensure_unzipped(tmp_path, member_pin(BODY[::-1]))
    assert not (tmp_path / "sources" / "demo" / "grid.nc.part").exists()
    assert not (tmp_path / "sources" / "demo" / "grid.nc").exists()


def demo_source(files: tuple[SourceFile, ...], unzipped: tuple[Unzipped, ...] = ()) -> Source:
    return Source(
        id="demo",
        name="Demo",
        version="1",
        license="Public domain",
        license_url="https://example.org/license",
        attribution="Demo",
        landing_page=None,
        retrieved="2026-09-25",
        files=files,
        unzipped=unzipped,
    )


def test_the_fetch_stage_downloads_then_unzips_into_the_data_root(tmp_path, monkeypatch, server):
    archive = tmp_path / "zipped"
    write_zip(archive, {"grid.nc": BODY})
    zipped = (archive / "sources" / "demo" / "a.zip").read_bytes()
    (tmp_path / "served" / "a.zip").write_bytes(zipped)
    files = (SourceFile("sources/demo/a.zip", len(zipped), sha(zipped), server.url("a.zip")),)
    monkeypatch.setenv("WANDER_DATA", str(tmp_path / "data"))
    ctx = make_context(Profile.GLOBAL, 1, tmp_path)
    run(ctx, {"demo": demo_source(files, (member_pin(BODY),))})
    assert (tmp_path / "data" / "sources" / "demo" / "grid.nc").read_bytes() == BODY


def test_the_fetch_stage_never_runs_under_the_fixture_profile(tmp_path):
    ctx = make_context(Profile.FIXTURE, 1, tmp_path)
    with pytest.raises(SourceUnavailable):
        run(ctx, {})
