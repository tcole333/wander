// The render-scale governor (streaming.md 5.8, section 10 `governor`), frame by frame on a fake
// clock at 60 Hz. Each rule is pinned at its threshold.
import { describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { Governor, type GovernorFrame } from './governor';

const INTERVAL = 1000 / 60;
const rules = tunables.governor;

/** A governor and a clock; `feed` sends frames and advances the clock by their deltas. */
function setUp(options: ConstructorParameters<typeof Governor>[1]) {
  const governor = new Governor('full', options);
  let now = 0;
  const feed = (
    count: number,
    frame: Partial<Omit<GovernorFrame, 'now' | 'intervalMs'>> = {},
  ): number => {
    for (let i = 0; i < count; i += 1) {
      const deltaMs = frame.deltaMs ?? INTERVAL;
      now += deltaMs;
      governor.frame({
        now,
        deltaMs,
        intervalMs: INTERVAL,
        gpuMs: frame.gpuMs ?? null,
        moving: frame.moving ?? false,
        resumed: frame.resumed,
      });
    }
    return governor.scale;
  };
  /** Wall time passing with nothing animated (drawing on demand). */
  const idle = (ms: number) => (now += ms);
  return { governor, feed, idle };
}

/** Frames that fill `ms` of animated time at one vsync each. */
const frames = (ms: number) => Math.round(ms / INTERVAL);

describe('stepping down', () => {
  // k misses among the window's frames: k / (frames + k) > 10% from k = 14 of 120.
  test('holds at 13 missed vsyncs in the window', () => {
    const { feed } = setUp({ timerQueries: true, start: 1.5 });
    feed(rules.downWindowFrames - 13);
    expect(feed(13, { deltaMs: 2 * INTERVAL })).toBe(1.5);
  });

  test('steps down at 14', () => {
    const { feed } = setUp({ timerQueries: true, start: 1.5 });
    feed(rules.downWindowFrames - 14);
    expect(feed(14, { deltaMs: 2 * INTERVAL })).toBe(1.25);
  });

  test('then waits for a whole new window before stepping again', () => {
    const { feed } = setUp({ timerQueries: true, start: 1.5 });
    feed(rules.downWindowFrames, { deltaMs: 2 * INTERVAL });
    expect(feed(rules.downWindowFrames - 1, { deltaMs: 2 * INTERVAL })).toBe(1.25);
    expect(feed(1, { deltaMs: 2 * INTERVAL })).toBe(1);
  });

  test('waits while a flight or gesture runs, then steps', () => {
    const { feed } = setUp({ timerQueries: true, start: 1.5 });
    expect(feed(300, { deltaMs: 2 * INTERVAL, moving: true })).toBe(1.5);
    expect(feed(1, { deltaMs: 2 * INTERVAL })).toBe(1.25);
  });

  test('never goes below the tier minimum', () => {
    const governor = new Governor('lite', { timerQueries: true, start: 0.75 });
    for (let i = 1; i <= 2000; i += 1) {
      governor.frame({
        now: i * 2 * INTERVAL,
        deltaMs: 2 * INTERVAL,
        intervalMs: INTERVAL,
        gpuMs: null,
        moving: false,
      });
    }
    expect(governor.scale).toBe(tunables.renderScale.lite.min);
  });

  test('ignores the idle gap before the first frame of an animated run', () => {
    const { feed, idle } = setUp({ timerQueries: true, start: 1.5 });
    feed(rules.downWindowFrames - 1);
    idle(15_000);
    expect(feed(1, { deltaMs: 15_000, resumed: true })).toBe(1.5);
    expect(feed(5)).toBe(1.5);
  });
});

describe('stepping up with timer queries', () => {
  const quick = rules.upGpuP90Frac * INTERVAL - 1;

  test('steps up once upAfter of animated time has GPU p90 under its share of the interval', () => {
    const { feed } = setUp({ timerQueries: true });
    expect(feed(frames(rules.upAfter) - 1, { gpuMs: quick })).toBe(1);
    expect(feed(1, { gpuMs: quick })).toBe(1.25);
  });

  test('stays when the GPU p90 is over it, however long it runs', () => {
    const { feed } = setUp({ timerQueries: true });
    // A fifth of the frames over the line puts the p90 over it.
    for (let i = 0; i < frames(10 * rules.upAfter) / 5; i += 1) {
      feed(4, { gpuMs: quick });
      feed(1, { gpuMs: rules.upGpuP90Frac * INTERVAL + 5 });
    }
    expect(feed(0)).toBe(1);
  });

  test('does not count time drawn on demand as headroom', () => {
    const { feed, idle } = setUp({ timerQueries: true });
    feed(60, { gpuMs: quick });
    idle(rules.upAfter + rules.upProbe);
    feed(1, { deltaMs: INTERVAL, resumed: true });
    expect(feed(2, { gpuMs: quick })).toBe(1);
  });

  test('climbs to the tier maximum and no further', () => {
    const { feed } = setUp({ timerQueries: true });
    expect(feed(20 * frames(rules.upAfter), { gpuMs: 1 })).toBe(tunables.renderScale.full.max);
  });

  test('never passes maxScale, the GPU cap', () => {
    const { feed } = setUp({ timerQueries: true, maxScale: 1.25 });
    expect(feed(10 * frames(rules.upAfter), { gpuMs: 1 })).toBe(1.25);
  });
});

describe('stepping up without timer queries', () => {
  test('steps up after upProbe of animated time with no missed vsync', () => {
    const { feed } = setUp({ timerQueries: false });
    expect(feed(frames(rules.upProbe) - 1)).toBe(1);
    expect(feed(1)).toBe(1.25);
  });

  test('restarts the probe from a miss', () => {
    const { feed } = setUp({ timerQueries: false });
    feed(frames(rules.upProbe / 2));
    feed(1, { deltaMs: 2 * INTERVAL });
    expect(feed(frames(rules.upProbe) - 1)).toBe(1);
    expect(feed(2)).toBe(1.25);
  });
});

describe('after a step up', () => {
  /** A governor just stepped up to 1.25 by the no-miss probe. */
  function steppedUp() {
    const set = setUp({ timerQueries: false });
    set.feed(frames(rules.upProbe));
    expect(set.governor.scale).toBe(1.25);
    return set;
  }
  // The window spans revertWindow / INTERVAL = 300 vsyncs; 5% of that is 15 misses.

  test('one hitch (the resize) keeps the step', () => {
    const { feed } = steppedUp();
    feed(1, { deltaMs: 3 * INTERVAL });
    expect(feed(frames(rules.revertWindow))).toBe(1.25);
  });

  test('15 missed vsyncs spread through the window keep it', () => {
    const { feed } = steppedUp();
    for (let i = 0; i < 15; i += 1) {
      feed(18);
      feed(1, { deltaMs: 2 * INTERVAL });
    }
    expect(feed(frames(rules.revertWindow))).toBe(1.25);
  });

  test('16 go back, and step-ups rest for the backoff', () => {
    const { feed, idle } = steppedUp();
    // 15 × (17 + 2) = 285 vsyncs, so the 16th miss still falls inside the 300-vsync window.
    for (let i = 0; i < 15; i += 1) {
      feed(17);
      feed(1, { deltaMs: 2 * INTERVAL });
    }
    expect(feed(1, { deltaMs: 2 * INTERVAL })).toBe(1);
    // More than upProbe without a miss, inside the backoff: no step up.
    expect(feed(frames(rules.backoff - 1000))).toBe(1);
    idle(1000);
    expect(feed(1)).toBe(1.25);
  });

  test('misses after the window fall to the down rule, with no backoff', () => {
    const { feed } = steppedUp();
    feed(frames(rules.revertWindow) + 1);
    expect(feed(rules.downWindowFrames, { deltaMs: 2 * INTERVAL })).toBe(1);
    expect(feed(frames(rules.upProbe))).toBe(1.25);
  });

  test('a flight across the end of the window does not bring later misses into it', () => {
    const { feed } = steppedUp();
    feed(frames(rules.revertWindow) + 1, { moving: true });
    feed(20, { deltaMs: 2 * INTERVAL, moving: true });
    // The down rule takes the misses, without the backoff a revert would start.
    expect(feed(1)).toBe(1);
    expect(feed(frames(rules.upProbe))).toBe(1.25);
  });
});
