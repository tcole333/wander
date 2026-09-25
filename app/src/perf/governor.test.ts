// The render-scale governor (streaming.md 5.8, section 10 `governor`), frame by frame on a fake
// clock at 60 Hz.
import { describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { Governor } from './governor';

const INTERVAL = 1000 / 60;
const rules = tunables.governor;

/** Feeds whole frames of `deltaMs` for about `ms` after `t`; returns the time of the last. */
function run(
  governor: Governor,
  t: number,
  ms: number,
  frame: { deltaMs?: number; gpuMs?: number | null; moving?: boolean } = {},
): number {
  const deltaMs = frame.deltaMs ?? INTERVAL;
  const count = Math.round(ms / deltaMs);
  for (let i = 1; i <= count; i += 1) {
    governor.frame({
      now: t + i * deltaMs,
      deltaMs,
      intervalMs: INTERVAL,
      gpuMs: frame.gpuMs ?? null,
      moving: frame.moving ?? false,
    });
  }
  return t + count * deltaMs;
}

describe('stepping down', () => {
  test('steps down once more than a tenth of vsyncs are missed over the window', () => {
    const governor = new Governor('full', { timerQueries: true, start: 1.5 });
    // Every frame misses one vsync: half of all vsyncs missed.
    run(governor, 0, (rules.downWindowFrames - 1) * 2 * INTERVAL, { deltaMs: 2 * INTERVAL });
    expect(governor.scale).toBe(1.5);
    run(governor, 10_000, 2 * INTERVAL, { deltaMs: 2 * INTERVAL });
    expect(governor.scale).toBe(1.25);
  });

  test('waits while a flight or gesture runs', () => {
    const governor = new Governor('full', { timerQueries: true, start: 1.5 });
    const t = run(governor, 0, 5000, { deltaMs: 2 * INTERVAL, moving: true });
    expect(governor.scale).toBe(1.5);
    run(governor, t, 2 * INTERVAL, { deltaMs: 2 * INTERVAL });
    expect(governor.scale).toBe(1.25);
  });

  test('never leaves the tier range', () => {
    const governor = new Governor('lite', { timerQueries: true, start: 0.75 });
    run(governor, 0, 60_000, { deltaMs: 2 * INTERVAL });
    expect(governor.scale).toBe(tunables.renderScale.lite.min);
  });
});

describe('stepping up with timer queries', () => {
  test('steps up after upAfter with GPU p90 under its share of the interval', () => {
    const governor = new Governor('full', { timerQueries: true });
    const quick = rules.upGpuP90Frac * INTERVAL - 1;
    const t = run(governor, 0, rules.upAfter - 100, { gpuMs: quick });
    expect(governor.scale).toBe(1);
    run(governor, t, 200, { gpuMs: quick });
    expect(governor.scale).toBe(1.25);
  });

  test('stays when the GPU is busier than that', () => {
    const governor = new Governor('full', { timerQueries: true });
    run(governor, 0, 3 * rules.upAfter, { gpuMs: rules.upGpuP90Frac * INTERVAL + 1 });
    expect(governor.scale).toBe(1);
  });

  test('never passes maxScale, the GPU cap', () => {
    const governor = new Governor('full', { timerQueries: true, maxScale: 1.25 });
    run(governor, 0, 10 * rules.upAfter, { gpuMs: 1 });
    expect(governor.scale).toBe(1.25);
  });
});

describe('stepping up without timer queries', () => {
  test('steps up after an upProbe with no missed vsync', () => {
    const governor = new Governor('full', { timerQueries: false });
    const t = run(governor, 0, rules.upProbe - 100);
    expect(governor.scale).toBe(1);
    run(governor, t, 200);
    expect(governor.scale).toBe(1.25);
  });
});

describe('a step up that misses', () => {
  test('goes back, then waits out the backoff before trying again', () => {
    const governor = new Governor('full', { timerQueries: false });
    let t = run(governor, 0, rules.upProbe + 100);
    expect(governor.scale).toBe(1.25);
    // Every frame misses after the step up: it goes back within the watch.
    t = run(governor, t, 500, { deltaMs: 2 * INTERVAL });
    expect(governor.scale).toBe(1);
    // Smooth again, but inside the backoff: no new step up.
    t = run(governor, t, rules.backoff - 1000);
    expect(governor.scale).toBe(1);
    // Past it, with more than upProbe without a miss, the next frame steps up.
    run(governor, t, 2000);
    expect(governor.scale).toBe(1.25);
  });
});
