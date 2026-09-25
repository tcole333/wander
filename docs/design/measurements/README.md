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
- `e1/results/browser-features-*.json`: what each browser offers. No browser decompresses zstd
  natively. Safari has neither `requestIdleCallback` nor `scheduler.postTask`. Firefox lacks
  `KHR_parallel_shader_compile`, `EXT_clip_control` and timer queries, and its texture size limit is
  8,192. Chromium's timer queries give 64 bits for elapsed time and 0 for timestamps.
- `e2/results/gpu-pool-*.json`: the pool smoke test (streaming.md 5.5) passes in Safari and Firefox
  with the same GL calls and exact readbacks as in Chromium, so the pool path holds on WebKit; E2
  still times the uploads.
