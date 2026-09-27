import { describe, expect, it } from 'vitest';
import { openingPose } from './opening';

const along = Array.from({ length: 401 }, (_, i) => openingPose(i / 400));

describe('the opening', () => {
  it('starts in the dark with the rings nearly edge-on and the globe turned away', () => {
    const start = openingPose(0);
    expect(start.lamp).toBe(0);
    expect(Math.abs(start.meridian)).toBeGreaterThan(60);
    expect(Math.abs(start.outer)).toBeGreaterThan(45);
    expect(start.spin).toBeGreaterThan(0);
    expect(start.reveal).toBe(0);
  });

  it('ends lit, with every part in its place', () => {
    const end = openingPose(1);
    expect([end.lamp, end.reveal]).toEqual([1, 1]);
    expect([end.meridian, end.outer, end.spin].map(Math.abs)).toEqual([0, 0, 0]);
  });

  it('turns the globe 30 degrees at most, settling past its rest and back', () => {
    const spins = along.map((pose) => pose.spin);
    expect(Math.max(...spins.map(Math.abs))).toBeLessThanOrEqual(30);
    expect(Math.min(...spins)).toBeLessThan(0);
    expect(Math.min(...spins)).toBeGreaterThan(-3);
  });
});
