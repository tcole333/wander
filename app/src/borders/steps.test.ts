// The border steps in time: which step holds on a day, across the calendar reform of 1582, the
// year 0 and Cliopatria's first year, 3400 BCE; where a step's preview is; and the plate's words.
import { describe, expect, test } from 'vitest';
import type { BorderStepsRelease } from '../data/release';
import { dayFromCivil, dayFromJulian } from '../story/dates';
import {
  borderSteps,
  cellOf,
  chunkOf,
  firstDay,
  neighbours,
  plateLabel,
  stepAt,
  StepsError,
} from './steps';

const YEARS = [-3399, -44, -1, 0, 1, 1581, 1582, 1583, 1815, 1817];

function section(years = YEARS, per = 4): BorderStepsRelease {
  return {
    ver: 'f00dcafe',
    size: 1024,
    apron: 4,
    years,
    keys: years.map((_, i) => `fd/borders/s/${i}.bin`),
    bytes: years.map(() => 1),
    previews: {
      per,
      keys: Array.from({ length: Math.ceil(years.length / per) }, (_, i) => `p/${i}.bin`),
      bytes: [],
    },
    polities: 'fd/borders/m/0.json',
    notice: 'lic/0.txt',
  };
}

const steps = borderSteps(section());
const at = (year: number) => YEARS.indexOf(year);

describe('stepAt', () => {
  test('holds none before 3400 BCE, Cliopatria first year, and its step from its first day', () => {
    const first = dayFromJulian({ year: -3399, month: 1, day: 1 });
    expect(stepAt(steps, first - 1)).toBeNull();
    expect(stepAt(steps, first)).toBe(0);
    expect(stepAt(steps, first + 0.5)).toBe(0);
  });

  test('begins 1 BCE, astronomical 0, on its Julian 1 January, after 2 BCE', () => {
    const start = dayFromJulian({ year: 0, month: 1, day: 1 });
    expect(stepAt(steps, start - 1)).toBe(at(-1));
    expect(stepAt(steps, start)).toBe(at(0));
    expect(stepAt(steps, dayFromJulian({ year: 1, month: 1, day: 1 }))).toBe(at(1));
  });

  test('begins 1582 on its Julian 1 January, ten days after the Gregorian one', () => {
    expect(firstDay(1582)).toBe(dayFromCivil({ year: 1582, month: 1, day: 11 }));
    expect(stepAt(steps, dayFromCivil({ year: 1582, month: 1, day: 10 }))).toBe(at(1581));
    expect(stepAt(steps, dayFromCivil({ year: 1582, month: 1, day: 11 }))).toBe(at(1582));
  });

  test('begins 1583, after the reform, on the Gregorian 1 January', () => {
    expect(stepAt(steps, dayFromCivil({ year: 1582, month: 12, day: 31 }))).toBe(at(1582));
    expect(stepAt(steps, dayFromCivil({ year: 1583, month: 1, day: 1 }))).toBe(at(1583));
  });

  test('holds a step until the next begins, the last for good', () => {
    expect(stepAt(steps, dayFromCivil({ year: 1816, month: 7, day: 1 }))).toBe(at(1815));
    expect(stepAt(steps, dayFromCivil({ year: 1817, month: 8, day: 28 }))).toBe(at(1817));
    expect(stepAt(steps, dayFromCivil({ year: 2500, month: 1, day: 1 }))).toBe(at(1817));
  });
});

describe('a step', () => {
  test('has neighbours either side, none past the ends', () => {
    expect(neighbours(steps, 0)).toEqual({ before: null, after: 1 });
    expect(neighbours(steps, 4)).toEqual({ before: 3, after: 5 });
    expect(neighbours(steps, YEARS.length - 1)).toEqual({ before: 8, after: null });
  });

  test('finds its preview in its chunk, and its cell pairs it with its even or odd neighbour', () => {
    expect(chunkOf(steps, 0)).toEqual({ chunk: 0, index: 0 });
    expect(chunkOf(steps, 5)).toEqual({ chunk: 1, index: 1 });
    expect(chunkOf(steps, 9)).toEqual({ chunk: 2, index: 1 });
    expect([cellOf(4), cellOf(5)]).toEqual([
      { pair: 2, channel: 0 },
      { pair: 2, channel: 1 },
    ]);
  });

  test('names its year on the plate as history writes it', () => {
    expect(plateLabel(1815)).toBe('Borders · 1815');
    expect(plateLabel(-43)).toBe('Borders · 44 BCE');
    expect(plateLabel(0)).toBe('Borders · 1 BCE');
  });
});

describe('a borderSteps section', () => {
  test('refuses years out of order, keys that do not match, and odd chunks', () => {
    expect(() => borderSteps(section([1815, 1815]))).toThrow(StepsError);
    expect(() => borderSteps({ ...section(), keys: [] })).toThrow(StepsError);
    expect(() => borderSteps(section(YEARS, 3))).toThrow(StepsError);
  });
});
