// Frame timing as streaming.md 6 gates it.
import { describe, expect, test } from 'vitest';
import { missedVsyncs, nearestRank, refreshInterval, summarizeFrames } from './frameStats';

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;

describe('nearestRank', () => {
  test('takes the value at rank ceil(p n)', () => {
    const values = [5, 1, 4, 2, 3];
    expect(nearestRank(values, 0.5)).toBe(3);
    expect(nearestRank(values, 0.95)).toBe(5);
    expect(nearestRank(values, 0.2)).toBe(1);
  });

  test('is NaN for no values', () => {
    expect(nearestRank([], 0.5)).toBeNaN();
  });
});

describe('missedVsyncs', () => {
  test('counts the vsyncs a frame skipped', () => {
    expect(missedVsyncs(HZ60, HZ60)).toBe(0);
    expect(missedVsyncs(2 * HZ60, HZ60)).toBe(1);
    expect(missedVsyncs(3 * HZ120, HZ120)).toBe(2);
  });

  test('forgives jitter under half an interval', () => {
    expect(missedVsyncs(1.4 * HZ60, HZ60)).toBe(0);
  });
});

describe('refreshInterval', () => {
  test('finds the display rate under occasional misses', () => {
    const deltas = [...Array<number>(90).fill(HZ120), ...Array<number>(10).fill(2 * HZ120)];
    expect(refreshInterval(deltas)).toBeCloseTo(HZ120);
  });

  test('takes a steady cap as the interval, not as misses', () => {
    const capped = Array<number>(200).fill(1000 / 30);
    expect(summarizeFrames(capped).missedFraction).toBe(0);
  });
});

describe('summarizeFrames', () => {
  test('reports p50, p95, missed vsyncs and gaps', () => {
    const deltas = [...Array<number>(95).fill(HZ60), ...Array<number>(5).fill(3 * HZ60)];
    const summary = summarizeFrames(deltas, HZ60);
    expect(summary.p50).toBeCloseTo(HZ60);
    expect(summary.p95).toBeCloseTo(HZ60);
    expect(summary.missedFraction).toBeCloseTo(10 / 110);
    expect(summary.gaps).toBe(5);
  });

  test('does not count a single miss with jitter as a gap', () => {
    const jittered = [...Array<number>(90).fill(16.6), ...Array<number>(10).fill(33.4)];
    expect(summarizeFrames(jittered).gaps).toBe(0);
  });

  test('puts a frame just over the gate in p95', () => {
    const deltas = [...Array<number>(94).fill(HZ60), ...Array<number>(6).fill(23)];
    expect(summarizeFrames(deltas, HZ60).p95).toBe(23);
  });
});
