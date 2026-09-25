import pytest


@pytest.fixture(autouse=True)
def no_raw_data(monkeypatch, tmp_path_factory):
    """Tests never read the raw-data folder: WANDER_DATA names a folder that does not exist."""
    monkeypatch.setenv("WANDER_DATA", str(tmp_path_factory.getbasetemp() / "no-wander-data"))
