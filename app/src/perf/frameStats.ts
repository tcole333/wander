// Frame timing as streaming.md 6 gates it: presented-frame p95, missed vsyncs, and rAF gaps over
// twice the refresh interval. Pure functions over rAF deltas, so the lab, the tier probe (5.8) and
// the governor read frames the same way. Percentiles are nearest-rank, as in the region bake's
// measurements.

/** The value at rank ⌈p·n⌉ of the sorted values, or NaN for none. */
export function nearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? NaN;
}

/** Vsyncs a frame of `deltaMs` missed at `intervalMs`: 0 when it presented on the next one. */
export function missedVsyncs(deltaMs: number, intervalMs: number): number {
  return Math.max(0, Math.round(deltaMs / intervalMs) - 1);
}

/**
 * The refresh interval the frames ran at: the median of the fastest quarter of the deltas. A
 * steady cap (a 60 Hz display, or Energy Saver holding a 120 Hz one at 30 fps) is then the
 * interval rather than a miss on every frame (5.8, a fixed frame cap is not a miss).
 */
export function refreshInterval(deltas: readonly number[]): number {
  const sorted = [...deltas].sort((a, b) => a - b);
  const fastest = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
  return nearestRank(fastest, 0.5);
}

export interface FrameSummary {
  frames: number;
  intervalMs: number;
  p50: number;
  p95: number;
  max: number;
  /** Missed vsyncs over the vsyncs the frames spanned. */
  missedFraction: number;
  /**
   * Frames over twice the interval (a gate during flights), counted in whole vsyncs: a frame that
   * spanned three or more, so timestamp jitter on a single miss never counts.
   */
  gaps: number;
}

export function summarizeFrames(deltas: readonly number[], intervalMs?: number): FrameSummary {
  const interval = intervalMs ?? refreshInterval(deltas);
  let missed = 0;
  let vsyncs = 0;
  let gaps = 0;
  for (const delta of deltas) {
    const miss = missedVsyncs(delta, interval);
    missed += miss;
    vsyncs += miss + 1;
    if (miss >= 2) gaps += 1;
  }
  return {
    frames: deltas.length,
    intervalMs: interval,
    p50: nearestRank(deltas, 0.5),
    p95: nearestRank(deltas, 0.95),
    max: deltas.length ? Math.max(...deltas) : NaN,
    missedFraction: vsyncs ? missed / vsyncs : 0,
    gaps,
  };
}
