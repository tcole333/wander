import { describe, expect, it, vi } from 'vitest';
import { dayFromHistorical, dayFromIso, historicalCivil } from '../story/dates';
import { WorldClock } from './worldClock';
import {
  ExploreTime,
  HISTORY,
  MAX_EXPLORE_DAYS,
  MIN_EXPLORE_DAYS,
  tapeWindow,
  wheelPixels,
} from './exploreTime';
import { YEAR_DAYS } from './overviewScale';

const WATERLOO = dayFromIso('1815-06-18');
const Y200 = 200 * YEAR_DAYS;

function setup(day = WATERLOO, openYears: number | null = 200, reduced = false) {
  const clock = new WorldClock();
  const time = new ExploreTime(clock, HISTORY, day, {
    openYears: openYears ?? undefined,
    reducedMotion: () => reduced,
  });
  let now = 1000;
  /** Runs frames at 60 Hz until nothing moves, or for `ms` when given. */
  const run = (ms?: number) => {
    const until = now + (ms ?? 5000);
    time.tick(now);
    while (now < until) {
      now += 1000 / 60;
      time.tick(now);
      if (ms === undefined && !time.moving) break;
    }
  };
  return { clock, time, run };
}

describe('Explore’s time', () => {
  it('holds all of 10,000 BCE through 2000 CE in the historical calendar', () => {
    expect(historicalCivil(HISTORY.start)).toEqual({ year: -9999, month: 1, day: 1 });
    expect(historicalCivil(HISTORY.end)).toEqual({ year: 2000, month: 12, day: 31 });
  });

  it('opens its span centred on the day, the widest by default', () => {
    const { clock, time } = setup(WATERLOO, null);
    expect(clock.state()).toEqual({ day: WATERLOO, spanDays: MAX_EXPLORE_DAYS });
    expect(MAX_EXPLORE_DAYS).toBe(5000 * YEAR_DAYS);
    expect((time.span.start + time.span.end) / 2).toBe(WATERLOO);
  });

  it('keeps the span centred on the day even where it runs past history', () => {
    const late = dayFromIso('1990-01-01');
    const { clock, time } = setup(late);
    expect(clock.state()).toEqual({ day: late, spanDays: Y200 });
    expect(time.span.end).toBeGreaterThan(HISTORY.end + 1);
    expect((time.span.start + time.span.end) / 2).toBe(late);
    expect(tapeWindow(clock.state()).end).toBe(HISTORY.end);
  });

  it('keeps the day within history however far it is sent', () => {
    const { clock, time } = setup();
    time.seek(-1e9);
    expect(clock.state().day).toBe(HISTORY.start);
    time.pan(1e12);
    expect(clock.state().day).toBe(HISTORY.end);
  });

  it('zooms about the needle, never moving the date, between 10 days and 5,000 years', () => {
    const { clock, time } = setup();
    for (const factor of [0.5, 3, 1e-9, 1e9]) {
      time.zoomBy(factor);
      expect(clock.state().day).toBe(WATERLOO);
      expect((time.span.start + time.span.end) / 2).toBe(WATERLOO);
    }
    expect(clock.state().spanDays).toBe(MAX_EXPLORE_DAYS);
    time.zoomBy(1e-12);
    expect(clock.state().spanDays).toBe(MIN_EXPLORE_DAYS);
    expect(MIN_EXPLORE_DAYS).toBe(10);
  });

  it('pans the needle along, keeping the span', () => {
    const { clock, time } = setup();
    time.pan(-365);
    expect(clock.state()).toEqual({ day: WATERLOO - 365, spanDays: Y200 });
  });

  it('flies to a date, landing exactly on it', () => {
    const { clock, time, run } = setup();
    const hastings = dayFromHistorical({ year: 1066, month: 10, day: 14 });
    time.fly(hastings, 20 * YEAR_DAYS, { jump: true });
    expect(time.flying).toBe(true);
    run();
    expect(time.moving).toBe(false);
    expect(clock.state()).toEqual({ day: hastings, spanDays: 20 * YEAR_DAYS });
  });

  it('leaves a return point on a jump past half a span, and back() toggles', () => {
    const { clock, time, run } = setup();
    time.fly(WATERLOO + 0.4 * Y200, Y200, { jump: true });
    run();
    expect(time.returnDay).toBeNull();
    time.seek(WATERLOO);
    const far = dayFromHistorical({ year: 1066, month: 7, day: 2 });
    time.fly(far, Y200, { jump: true });
    run();
    expect(time.returnDay).toBe(WATERLOO);
    expect(time.back()).toBe(true);
    run();
    expect(clock.state().day).toBe(WATERLOO);
    expect(time.returnDay).toBe(far);
    time.back();
    run();
    expect(clock.state().day).toBe(far);
  });

  it('counts keys during a flight from where it is going', () => {
    const { clock, time, run } = setup();
    time.detent(1);
    time.detent(1);
    run();
    expect(clock.state().spanDays).toBeCloseTo(1000 * YEAR_DAYS, 6);
    time.detent(-1);
    time.detent(-1);
    time.detent(-1);
    run();
    expect(clock.state().spanDays).toBeCloseTo(100 * YEAR_DAYS, 6);
    expect(clock.state().day).toBe(WATERLOO);
  });

  it('steps onto the ticks the tape engraves', () => {
    const { clock, time, run } = setup();
    time.step(1, 'fine');
    run();
    expect(historicalCivil(clock.state().day)).toEqual({ year: 1816, month: 1, day: 1 });
    time.step(1, 'label');
    run();
    expect(historicalCivil(clock.state().day).year).toBe(1820);
    // On a labelled tick, a span's step lands on one.
    time.step(-1, 'span');
    run();
    expect(historicalCivil(clock.state().day)).toEqual({ year: 1620, month: 1, day: 1 });
  });

  it('steps exactly a span off a labelled tick, and back again without drifting', () => {
    const hastings = dayFromIso('1066-10-14');
    const { clock, time, run } = setup(hastings);
    for (let press = 0; press < 3; press += 1) {
      time.step(1, 'span');
      run();
    }
    const there = clock.state().day;
    for (let press = 0; press < 3; press += 1) {
      time.step(-1, 'span');
      run();
    }
    expect([there, clock.state().day]).toEqual([hastings + 3 * Y200, hastings]);
  });

  it('steps a span between labelled ticks that each step undoes, whatever the span', () => {
    const { clock, time, run } = setup(dayFromHistorical({ year: 1500, month: 1, day: 1 }));
    // A span no labelled step divides: its step snaps, by under half a label, to a tick.
    time.zoomTo(237 * YEAR_DAYS);
    const start = clock.state().day;
    time.step(1, 'span');
    run();
    const there = historicalCivil(clock.state().day);
    time.step(-1, 'span');
    run();
    // 1500 + 237 years is 1737; the tape labels every 20 years there.
    expect([there, clock.state().day]).toEqual([{ year: 1740, month: 1, day: 1 }, start]);
  });

  it('hands a flight to a hand at the span it was going to', () => {
    const { clock, time, run } = setup();
    time.fly(dayFromIso('1066-10-14'), 20 * YEAR_DAYS, { jump: true });
    run(200);
    const between = clock.state().day;
    expect(between).toBeLessThan(WATERLOO);
    expect(between).toBeGreaterThan(dayFromIso('1066-10-14'));
    time.interrupt();
    expect(time.moving).toBe(false);
    expect(clock.state()).toEqual({ day: between, spanDays: 20 * YEAR_DAYS });
  });

  it('coasts after a flick, at most two spans', () => {
    const hastings = dayFromIso('1066-10-14');
    const { clock, time, run } = setup(hastings);
    time.fling(1e9);
    run();
    expect(clock.state().day - hastings).toBeLessThanOrEqual(2 * Y200);
    expect(clock.state().day - hastings).toBeGreaterThan(1.9 * Y200);
  });

  it('stops a coast at history’s end, runs on a little and springs back', () => {
    const { clock, time, run } = setup(HISTORY.end - 10 * YEAR_DAYS);
    time.fling(1e9);
    run(300);
    expect(clock.state().day).toBe(HISTORY.end);
    run();
    expect(time.center).toBe(HISTORY.end);
    expect(time.moving).toBe(false);
  });

  it('gives way less and less to a pull past history’s end, springing back on release', () => {
    const { clock, time, run } = setup(HISTORY.start + YEAR_DAYS);
    time.drag(HISTORY.start - 10 * Y200);
    expect(clock.state().day).toBe(HISTORY.start);
    expect(time.center).toBeLessThan(HISTORY.start);
    expect(HISTORY.start - time.center).toBeLessThan(0.06 * Y200);
    time.release(0);
    run();
    expect(time.center).toBe(HISTORY.start);
  });

  it('glides while an arrow is held, then eases on to the next tick', () => {
    const { clock, time, run } = setup();
    time.hold(1);
    run(250);
    const stepped = clock.state().day;
    expect(historicalCivil(stepped)).toEqual({ year: 1816, month: 1, day: 1 });
    run(1000);
    const glided = clock.state().day;
    // A quarter of a span a second, rising.
    expect(glided - stepped).toBeGreaterThan(0.2 * Y200);
    time.letGo();
    run();
    const { year, month, day } = historicalCivil(clock.state().day);
    expect([month, day]).toEqual([1, 1]);
    expect(year % 2).toBe(0);
    expect(clock.state().day).toBeGreaterThan(glided);
  });

  it('with reduced motion flies in 150 ms and never coasts', () => {
    const { clock, time, run } = setup(WATERLOO, 200, true);
    time.fling(1e9);
    expect(time.moving).toBe(false);
    time.fly(dayFromIso('1066-10-14'), Y200, { jump: true });
    run(170);
    expect(time.moving).toBe(false);
    expect(clock.state().day).toBe(dayFromIso('1066-10-14'));
  });

  it('tells its listeners of each change, and of a stretch the clock does not see', () => {
    const { time } = setup(HISTORY.end);
    const seen = vi.fn();
    const stop = time.subscribe(seen);
    time.pan(0);
    expect(seen).not.toHaveBeenCalled();
    time.pan(-1);
    expect(seen).toHaveBeenCalledTimes(1);
    time.seek(HISTORY.end);
    time.drag(HISTORY.end + YEAR_DAYS);
    expect(seen).toHaveBeenCalledTimes(3);
    stop();
    time.pan(-10);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('ignores gestures that name no number', () => {
    const { clock, time } = setup();
    const before = clock.state();
    for (const factor of [0, -1, NaN, Infinity]) time.zoomBy(factor);
    time.seek(NaN);
    time.pan(Infinity);
    time.fly(NaN);
    time.drag(NaN);
    expect(clock.state()).toBe(before);
    expect(time.moving).toBe(false);
  });

  it('reads wheel lines and pages as pixels', () => {
    expect(wheelPixels(3, 1, 900)).toBe(48);
    expect(wheelPixels(0.1, 2, 900)).toBe(90);
    expect(wheelPixels(-120, 0, 900)).toBe(-120);
  });
});
