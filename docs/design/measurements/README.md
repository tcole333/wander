# Design measurements

Scripts, results, and notes cited by `docs/design/streaming.md` (as `[M]`, `[M proxy]`, or
`[model]`). They come from the 2026-09-24 design work: three independent designs (Claude, Codex,
Fable), two cross-reviews, and a verification pass. Paths match the citations in the design doc.

Most measurements ran on an Apple M5 using ETOPO or GEBCO windows as stand-ins, so they are proxies
for the target laptops; the design's experiments (section 8.2) replace them with real numbers.

`work/story-first/beats.py` holds the drafted Tambora beat list (camera footprints per beat), the
starting point for the first story.

`work/surface-bake/region-bake.json` records the first bake of real cube tiles, the milestone-1
region profile (2026-09-25): runtimes, tile counts and sizes, qLand, and the cross-face border
statistics behind the seam check's bound.

`work/surface-bake/face-edge-crease.json` records what `npm run verify:bake` measures through the
vertex mirror on the version 2 region bake (2026-09-25): the non-owner crease along face edges per
level, in meters and in px at ×8 and ×16, the land choice on face edges, and the pairs and vertices
of the mirror's seam proof.

`e5/results/light.json` is E5's light answer (streaming.md 8.2), measured by `e5/parse.mjs`: the
milestone-1 events table built from the Wikidata export of 2026-09-28, its rows, stored and decoded
bytes, and the time Node 22 on the M5 takes to inflate and parse it into typed columns.

`e5/results/runtime-2026-09-29.json` records the 30,070-row runtime index, including recovered
ancestors: stored gzip, inflated JSON and resident-array bytes, overview decode time, and moving
queries at both tiers. `app/scripts/benchmarkEvents.ts` writes the machine and method with the
measurements; these Node timings on the M5 exclude worker messaging and rendering.

`e4/` holds E4 (streaming.md 8.2): `e4.py` uploaded and warmed 200 objects under `_e4/` on
2026-09-25, as `state.json` records, and reads one cohort of 50 at each checkpoint from this Mac.
`results/warm.json` is the warm, `results/24h.json` and `results/72h.json` the checkpoints, and
`results/summary.md` the table the script writes from them.

`e3/results/` holds E3, milestone 1's acceptance (streaming.md 8.2), run on the live site on
2026-09-28 by `app/scripts/e3.ts`. `live-2026-09-28.json` has the raw results: the cold loads, the
walk at 5 Mbps / 150 ms with its landings and holds, hostile input, offline, context loss,
requests to the app host, and the leak walks. `old-tab.json` is the old-tab check, run by hand
rather than by `e3.ts`: a tab loaded on release d2c7ca91d12a3ec4 (the bundle it names) walked
beats 3-8 and broke out after 9b3f8312bae73f83 deployed, with no failed request or console error.
The walk of the live lobby, dive and beats 1-3 in headless WebKit 26.6 and Firefox 155 was also
run by hand, and has no record here.

`e1/results/` and `e2/results/` hold the experiments' lab runs (`npm run lab`, streaming.md 7.3),
copied from `build/lab/`. The first ones ran on 2026-09-25 on the M5 (macOS 26.5) in Chromium 153 on
Metal through Playwright, Safari 26.5 and Firefox 156:
- `e1/results/uniform-branches-*.json`: no browser flattens a branch on a uniform that is off. With
  the block's uniform off, a draw pays 0-2% of the block's cost (`paidWhenOff`; 1 would mean
  flattened), whether the block samples with implicit derivatives, an explicit level, or is split
  over eight separately guarded blocks. Chromium's figures are GPU time from timer queries; Safari
  and Firefox have none, so theirs are wall time to a readback, at their 1 ms timer resolution.
- `e1/results/browser-features-*.json`: what each browser offers. No browser's
  `DecompressionStream` takes zstd. Safari has neither `requestIdleCallback` nor `scheduler.postTask`. Firefox lacks
  `KHR_parallel_shader_compile`, `EXT_clip_control` and timer queries, and its texture size limit is
  8,192. Chromium's timer queries give 64 bits for elapsed time and 0 for timestamps.
- `e2/results/gpu-pool-*.json`: the pool smoke test (streaming.md 5.5) passes in Safari and Firefox
  under Chromium's assertions: the same GL calls, exact reads at texel centers, from unwritten
  levels and slots and of the edge profiles, and filtered reads within one code. The pool path holds
  on WebKit; E2 still times the uploads.
- `e1/results/decode-*.json`: every tile of the region bake, fetched from `npm run data` and decoded
  in the two decode workers, matches Node's decode and `bounds.bin` in all three browsers. Decode
  time per tile, in the worker: 1.7 ms at the median (2.3 ms p90) in Chromium, 2 ms (3 ms) in
  Firefox and 2 ms (8 ms) in Safari. Safari and Firefox ran in hidden tabs (`pageHidden`) and time
  at 1 ms steps. Safari's decodes took 1-2 ms for the first 60% of the tiles in finishing order and
  about 8 ms after that, at every level, which fits its throttling of hidden pages; Firefox stayed
  at 2 ms throughout.
- `e2/results/surface-upload-*.json`: 226 tiles spread through the region bake's L5-L7 go through
  the upload queue into 256-slot surface pools at each tier's animated budget, with nothing drawn
  between frames, and read back exactly in all three browsers, with no GL error. In this run a tile
  published in two frames at the median and three at most. At lite every tile splits into its
  heights, then the rest; at full the budget runs across tiles, so a split falls wherever the budget
  runs out and some tiles land in one frame. The write calls are cheap on the main thread: one
  slot's seven writes took at most 1 ms in Chromium, 4 ms in Safari and 2 ms in Firefox. Safari and
  Firefox time at 1 ms steps, so the 0.5 ms `uploadSlowCall` rule reads any write that crosses a tick
  as slow and ends the frame early: 69 of 452 lite frames and 65 of 211 full frames in Firefox, and
  18 of 452 and 19 of 189 in Safari. Safari and Firefox ran hidden (`pageHidden`).
