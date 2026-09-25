import pytest

from prebuild.cube import Tile
from prebuild.profiles import Profile, make_context
from prebuild.tiles import Surface, TileSources, open_sources, surface


@pytest.fixture(autouse=True)
def no_raw_data(monkeypatch, tmp_path_factory):
    """Tests never read the raw-data folder: WANDER_DATA names a folder that does not exist."""
    monkeypatch.setenv("WANDER_DATA", str(tmp_path_factory.getbasetemp() / "no-wander-data"))


@pytest.fixture(scope="session")
def fixture_sources() -> TileSources:
    """The fixture profile's sources: the committed GEBCO and Natural Earth excerpts."""
    return open_sources(make_context(Profile.FIXTURE, 1))


@pytest.fixture(scope="session")
def fixture_surface(fixture_sources):
    """A fixture tile's surface, computed once per test session."""
    computed: dict[Tile, Surface] = {}

    def get(tile: Tile) -> Surface:
        if tile not in computed:
            computed[tile] = surface(tile, fixture_sources)
        return computed[tile]

    return get
