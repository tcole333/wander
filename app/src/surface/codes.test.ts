import { describe, expect, it } from 'vitest';
import { c200, codeToMeters, roundHalfAway } from './codes';

// qLand's starting value per level L0-L7 and its c200, as pipeline/tests/test_codes.py has them.
const Q_START = [39.09375, 19.546875, 9.78125, 4.890625, 2.453125, 2, 2, 2];
const C200 = [-5, -10, -20, -41, -82, -100, -100, -100];

describe('roundHalfAway', () => {
  it('rounds halves away from zero', () => {
    const values = [0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.49, -2.51];
    expect(values.map(roundHalfAway)).toEqual([1, -1, 2, -2, 3, -3, 0, -3]);
  });

  it('never gives negative zero', () => {
    expect(Object.is(roundHalfAway(-0.3), 0)).toBe(true);
  });
});

describe('codeToMeters', () => {
  it('puts c200 at the rounded code of −200 m', () => {
    expect(Q_START.map(c200)).toEqual(C200);
  });

  it('steps by qLand at or above c200 and by 4·qLand below it', () => {
    for (const q of Q_START) {
      const deep = c200(q);
      const meters = [-2, -1, 0, 1, 2].map((d) => codeToMeters(deep + d, q));
      const steps = meters.slice(1).map((m, k) => m - (meters[k] ?? NaN));
      expect(steps).toEqual([4 * q, 4 * q, q, q]);
      expect(meters[2]).toBe(deep * q);
    }
  });

  it('maps a mean of codes below c200 on the deep step', () => {
    expect(codeToMeters(-300.25, 2)).toBe(-200 + (-300.25 + 100) * 8);
    expect(codeToMeters(-70.5, 2)).toBe(-141);
  });
});
