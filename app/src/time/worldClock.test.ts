import { describe, expect, it, vi } from 'vitest';
import { dayFromIso } from '../story/dates';
import { WorldClock } from './worldClock';

describe('world time', () => {
  it('publishes the date and zoom atomically, retains snapshots, and unsubscribes', () => {
    const clock = new WorldClock(0, 40);
    const initial = clock.state();
    const seen = vi.fn();
    const stop = clock.subscribe(seen);
    const day = dayFromIso('-9999-01-01');
    clock.set(day, 12000 * 365.2425);
    expect(seen).toHaveBeenLastCalledWith(clock.state());
    expect(clock.state()).toEqual({ day, spanDays: 12000 * 365.2425 });
    expect(initial).toEqual({ day: 0, spanDays: 40 });
    expect(Object.isFrozen(clock.state())).toBe(true);
    clock.set(day, 12000 * 365.2425);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    clock.set(day + 0.25);
    expect(clock.state().day).toBe(day + 0.25);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('crosses 1 BCE to 1 CE without rounding away fractional story days', () => {
    const clock = new WorldClock(dayFromIso('0000-12-31'), 4);
    clock.set(-0.25);
    expect(clock.state()).toEqual({ day: -0.25, spanDays: 4 });
    clock.set(0);
    expect(clock.state().day).toBe(dayFromIso('0001-01-01'));
  });

  it('rejects invalid time without publishing or changing the clock', () => {
    const clock = new WorldClock();
    const initial = clock.state();
    const seen = vi.fn();
    clock.subscribe(seen);
    for (const [day, width] of [
      [NaN, 4],
      [Infinity, 4],
      [0, 0],
      [0, -1],
      [0, Infinity],
    ]) {
      expect(() => clock.set(day!, width)).toThrow(RangeError);
    }
    expect(clock.state()).toBe(initial);
    expect(seen).not.toHaveBeenCalled();
    expect(() => new WorldClock(0, NaN)).toThrow(RangeError);
  });
});
