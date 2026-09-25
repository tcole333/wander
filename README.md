# Wander

Explore history on a 3D globe built like a brass museum orrery. Follow guided stories through
eruptions, voyages, plagues, and booms; scrub through time and zoom from the whole world down to a
single island.

Coming to [wander.traviscole.xyz](https://wander.traviscole.xyz).

![The target look](docs/reference/spike-region.jpg)

## Status

Milestone 1 (the Tambora slice) is under way. See [the product requirements](docs/PRD.md) and
[the asset streaming design](docs/design/streaming.md).

## Raw data and the real bake

A fresh clone runs the app and its tests without the raw data: the tests use small excerpts
committed under `pipeline/tests/data/`. The prebuild's real bakes read the raw sources
from a folder outside the repo, `~/projects/wander-data` unless `WANDER_DATA` names another.
`pipeline/sources.toml` pins every file they read. In `pipeline/`, with uv installed:

```sh
uv sync
uv run prebuild fetch               # downloads what is missing (GEBCO_2026 alone is a 4.3 GB zip,
                                    # 7.5 GB unzipped) and checks every sha256
uv run prebuild --profile region    # the milestone-1 bake into build/region/, about 2.5 min
```

Then `npm run verify:bake` in `app/` checks the bake. `CLAUDE.md` lists the other commands.

## License

Code is MIT-licensed (see `LICENSE`). Data comes from Natural Earth, GEBCO, ModE-RA, RESOLVE,
USGS, GMBA, historical-basemaps, and Wikidata under their own terms; attributions ship in the app's
Credits panel. Border geometry derived from historical-basemaps is GPL-3.0.
