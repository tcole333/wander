# The shipped bakes' surface inputs

The region layer `ee095df5` and the global layer `78f401c3` record the same `inputs.code`:
`07a04a65765ced8063726fa8d91cc4676e38be460e4f339060317ab6a650a499`. This is the tree hash of
`CODE_PATHS` at `3aca3c2a21a8a28f829c9f7c76d9105b125db6ee`, computed from the Git blobs with
`hashing.py`'s SHA-256 lines rule. Both coverage and surface records hold it. Neither record holds
individual code-file hashes, so their code hash cannot simply be reduced to the surface files.

The 28 September 2026 global run used the working tree based on `6154f13`, with a one-off
freshness allowance subsequently committed in `2a4f59f` (rebased as `dba5e5b`). It checked the
shipped bake against the reviewed surface code at that commit. The comparison with `3aca3c2`
found these changes:

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

All other surface code was byte-identical. The run also checked the recorded config hashes
(`l7.yaml` and `water.yaml` for global; also `regions-milestone1.yaml` for region), the GEBCO
and Natural Earth pins, and agreement between the coverage and surface inputs and availability.
The linked bakes and their records were left untouched.

This note records that run's provenance. Verification again requires the exact working-tree
`CODE_PATHS` hash: any pipeline change needs a new bake. Re-verifying global therefore starts
with `uv run prebuild --profile global coverage surface` in `pipeline/`.

The comparison can be read with:

```sh
git diff 3aca3c2a21a8a28f829c9f7c76d9105b125db6ee 6154f13 -- \
  pipeline/src pipeline/config pipeline/pyproject.toml pipeline/uv.lock shared/constants.json
```
