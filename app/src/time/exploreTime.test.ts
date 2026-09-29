import { describe, expect, it, vi } from 'vitest';
import { civilFromDay, dayFromIso } from '../story/dates';
import { WorldClock } from './worldClock';
import { ExploreTime, HISTORY, MIN_EXPLORE_DAYS, wheelZoom } from './exploreTime';

function setup() {
  const clock = new WorldClock();
  const explore = new ExploreTime(clock);
  return { clock, explore };
}

describe('the free ruler', () => {
  it('opens at 1 CE with all of 10,000 BCE through 2000 CE in view', () => {
    const { clock, explore } = setup();
    expect(civilFromDay(HISTORY.start)).toEqual({ year: -9999, month: 1, day: 1 });
    expect(civilFromDay(HISTORY.end)).toEqual({ year: 2000, month: 12, day: 31 });
    expect(explore.span).toEqual({ start: HISTORY.start, end: HISTORY.end + 1 });
    expect(clock.state()).toEqual({ day: 0, spanDays: HISTORY.end - HISTORY.start + 1 });
  });

  it('zooms about the pointer date and publishes the same width as the view', () => {
    const { clock, explore } = setup();
    for (const share of [0.1, 0.5, 0.9]) {
      const before = explore.span;
      const pivot = before.start + share * (before.end - before.start);
      explore.zoom(0.5, share);
      const after = explore.span;
      expect(after.start + share * (after.end - after.start)).toBeCloseTo(pivot, 8);
      expect(clock.state().spanDays).toBeCloseTo(after.end - after.start, 8);
      expect(clock.state().day).toBeGreaterThanOrEqual(after.start);
      expect(clock.state().day).toBeLessThan(after.end);
    }
  });

  it('keeps a visible date on zoom, otherwise brings it to the nearest whole day in view', () => {
    const { clock, explore } = setup();
    const share = (0 - explore.span.start) / (explore.span.end - explore.span.start);
    explore.zoom(0.5, share);
    expect(clock.state().day).toBe(0);
    explore.zoom(0.1, 0.1);
    expect(clock.state().day).toBe(Math.ceil(explore.span.end) - 1);
  });

  it.each([HISTORY.start, HISTORY.end])(
    'reaches and holds the history limit %s at every zoom',
    (end) => {
      const { clock, explore } = setup();
      const earlier = end === HISTORY.start;
      explore.scrub(earlier ? -1e9 : 1e9);
      expect(clock.state().day).toBe(end);
      for (let i = 0; i < 30; i += 1) {
        explore.zoom(0.5, earlier ? 0 : 1);
        expect(clock.state().day).toBe(end);
        expect(explore.span.start).toBeGreaterThanOrEqual(HISTORY.start);
        expect(explore.span.end).toBeLessThanOrEqual(HISTORY.end + 1);
      }
      expect(clock.state().spanDays).toBe(MIN_EXPLORE_DAYS);
      explore.seek(earlier ? HISTORY.end : HISTORY.start);
      expect(clock.state().day).toBe(earlier ? HISTORY.end : HISTORY.start);
      explore.zoom(1e12, 0.5);
      expect(explore.span).toEqual(explore.extent);
    },
  );

  it('scrubs through the era seam in whole days and moves the zoomed view with it', () => {
    const { clock, explore } = setup();
    explore.zoom(1e-9, 0.5);
    explore.seek(dayFromIso('0000-12-31'));
    explore.scrub(-0.25);
    expect(clock.state().day).toBe(-1);
    explore.scrub(0);
    expect(clock.state().day).toBe(dayFromIso('0001-01-01'));
    explore.scrub(100);
    expect(explore.span.start).toBeLessThan(100);
    expect(explore.span.end).toBeGreaterThan(100);
  });

  it('notifies a recenter even when the day and zoom stay the same; detaches cleanly', () => {
    const { clock, explore } = setup();
    explore.zoom(0.25, 0.5);
    const before = clock.state();
    const span = explore.span;
    const seen = vi.fn();
    const stop = explore.subscribe(seen);
    explore.seek(before.day);
    expect(clock.state()).toBe(before);
    expect(explore.span).not.toEqual(span);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    explore.scrub(before.day - 10);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('normalizes wheel units and ignores invalid gestures', () => {
    expect(wheelZoom(3, 1, 900)).toBe(wheelZoom(48, 0, 900));
    expect(wheelZoom(0.1, 2, 900)).toBe(wheelZoom(90, 0, 900));
    expect(wheelZoom(-120, 0, 900)).toBeLessThan(1);
    const { clock, explore } = setup();
    const before = clock.state();
    for (const factor of [0, -1, NaN, Infinity]) explore.zoom(factor, 0.5);
    explore.scrub(NaN);
    explore.seek(Infinity);
    expect(clock.state()).toBe(before);
  });
});
