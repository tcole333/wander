import { describe, expect, it } from 'vitest';
import { OPENING_S, openingPose, TURN_DEG_S } from './opening';

const along = Array.from({ length: 401 }, (_, i) => openingPose(i / 400));

describe('the opening', () => {
  it('starts in the dark with the rings and the globe turned away', () => {
    const start = openingPose(0);
    expect([start.lamp, start.reveal]).toEqual([0, 0]);
    expect([start.meridian, start.outer, start.spin].every((deg) => deg !== 0)).toBe(true);
  });

  it('ends lit, with every part in its place', () => {
    const end = openingPose(1);
    expect([end.lamp, end.reveal]).toEqual([1, 1]);
    expect([end.meridian, end.outer, end.spin].map(Math.abs)).toEqual([0, 0, 0]);
  });

  it('coasts the globe into the lobby turn without swinging back', () => {
    const spins = along.map((pose) => pose.spin);
    expect(spins.every((spin, i) => i === 0 || spin <= (spins[i - 1] ?? spin))).toBe(true);
    expect(Math.min(...spins)).toBe(0);
    const step = 1e-4;
    const perS = (openingPose(1).spin - openingPose(1 - step).spin) / (step * OPENING_S);
    expect(perS).toBeCloseTo(-TURN_DEG_S, 2);
  });
});
