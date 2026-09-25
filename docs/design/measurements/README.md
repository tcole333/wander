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
- `e2/results/surface-upload-*.json`: 226 L5-L7 region tiles go through the upload queue into
  256-slot surface pools at each tier's animated budget and read back exactly in all three browsers,
  with no GL error. A tile publishes in two frames (heights, then the rest) at the median and three
  at most. The write calls are cheap on the main thread: one slot's seven writes take at most 1.3 ms
  in Chromium, 4 ms in Safari and 2 ms in Firefox. Safari and Firefox time at 1 ms steps, so the
  0.5 ms `uploadSlowCall` rule reads any write that crosses a tick as slow and ends the frame early:
  65 of 452 lite frames and 68 of 213 full frames in Firefox, and 16 of 452 and 18 of 187 in Safari.
  Safari and Firefox ran hidden (`pageHidden`).
