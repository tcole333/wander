# The shipped bakes' surface inputs

The region layer `ee095df5` and the global layer `78f401c3` record the same `inputs.code`:
`07a04a65765ced8063726fa8d91cc4676e38be460e4f339060317ab6a650a499`. This is the tree hash of
`CODE_PATHS` at `3aca3c2a21a8a28f829c9f7c76d9105b125db6ee`, computed from the Git blobs with
`hashing.py`'s SHA-256 lines rule. Both coverage and surface records hold it. Neither record holds
individual code-file hashes, so their code hash cannot simply be reduced to the surface files.

`app/src/test/bakeInputs.ts` accepts that one old code hash against the reviewed surface code at
`6154f13` (28 September 2026). Its `SURFACE_CODE_PATHS` hash is
`a804ffaf4e0ad24cef5f23e4ece67821624538657e29450b803dd99717809da7`. The comparison of those two
trees found these changes:

- `borders.py`, `events.py`, `meanwhile.py`, `media.py`, `modera.py` and `wikidata.py`, and their
  configs, add independent stages. They do not produce the surface tiles or their coverage.
- `cli.py` registers those stages and adds the story and offline arguments. `profiles.py` adds
  those two fields to the context; the surface's profile, output paths, cache and jobs are unchanged.
- `config.py` adds event config readers and their constants. The surface config readers and the
  shared parsing functions they call are unchanged.
- `surface.py` moves staging and publication into `layers.py`. The tile encoder, bounds encoder,
  tile iteration, quantization and record contents are unchanged. The new publisher also checks
  that the staging folder still holds the files just built before renaming it; it changes failure
  handling, not successful output bytes.
- `pyproject.toml` and `uv.lock` add Pillow for media. Every existing dependency pin is unchanged.
- `shared/constants.json` adds `formats.borderField`. The surface formats and cube constants are
  unchanged.

All other surface code is byte-identical. The compatibility fingerprint includes the shared
modules above, the dependencies and the complete constants file, so another edit there makes
the old bake stale. Only the six independent stage modules are left out. Configs are checked
separately against the hashes in the records: `l7.yaml` and `water.yaml` for global, plus
`regions-milestone1.yaml` for region. The GEBCO and Natural Earth hashes must still be pinned in
`sources.toml`, and coverage and surface must name identical inputs and availability.

This compatibility pair is deliberately finite: a bake with an unknown code hash still needs
an exact match against the working tree's full `CODE_PATHS` hash. The linked bakes and their
records stay untouched. Future surface changes need a new bake; changing this fingerprint alone
would lose the evidence that makes these two old records usable.

The comparison can be read with:

```sh
git diff 3aca3c2a21a8a28f829c9f7c76d9105b125db6ee 6154f13 -- \
  pipeline/src pipeline/config pipeline/pyproject.toml pipeline/uv.lock shared/constants.json
```
