// Explore's climate at the clock's date: it fetches nothing while the ruler is wider than
// climateMonthlySpan, keeps the day's year and two either side, nearest first, drops them as the
// day moves on and all of them at the end, decodes one year and rewrites the field at most once a
// frame, names months as the ruler does, and eases out where monthly frames are not drawn.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseClimate, type ClimateFile } from '../data/climate';
import type { ModeraRelease } from '../data/release';
import { createClimateUniforms } from '../look/climateHook';
import { MemoryAccount } from '../perf/memory';
import { dayFromHistorical, dayFromIso } from '../story/dates';
import { syntheticYear } from '../test/climate';
import type { WorldTime } from '../time/worldClock';
import { CLOCK_CLIMATE_OWNER, ClockClimate, type ClockClimateOptions } from './clock';
import { ClimateField } from './field';

const MODERA: ModeraRelease = {
  ver: 'test',
  years: [1421, 2008],
  lat: Array.from({ length: 96 }, (_, i) => 88.572169 - 1.864677 * i),
  lon0: -180,
  dlon: 1.875,
  bytes: { mean: {}, spread: {}, annual: 0 },
};
const SOURCE = { dataHost: 'https://data.test', modera: MODERA };
const YEAR = 365.2425;

const yearOf = (url: string) => Number(/(\d{4})\.bin$/.exec(url)?.[1]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A synthetic year file as the data host would answer it, inflated already. */
const stored = (year: number) => syntheticYear(96, 192, year).buffer as ArrayBuffer;
const at = (iso: string, spanYears = 10): WorldTime => ({
  day: dayFromIso(iso),
  spanDays: spanYears * YEAR,
});

/** A climate whose fetches and decodes are counted, and answer at once unless held. */
function setup(options: ClockClimateOptions = {}) {
  const uniforms = createClimateUniforms();
  const field = new ClimateField(uniforms);
  const fetched: number[] = [];
  const fetch = vi.fn((url: string) => {
    fetched.push(yearOf(url));
    return Promise.resolve(stored(yearOf(url)));
  });
  const decode = vi.fn((stored: ArrayBuffer): Promise<ClimateFile> =>
    Promise.resolve(parseClimate(new Uint8Array(stored))),
  );
  const climate = new ClockClimate(SOURCE, field, { fetch, decode, ...options });
  /** Frames at 30 per second, letting the loads answer between them. */
  const frames = async (time: WorldTime, count = 30) => {
    for (let frame = 0; frame < count; frame += 1) {
      climate.update(time, 1 / 30);
      await flush();
    }
  };
  return { uniforms, climate, fetched, fetch, decode, frames };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the clock's climate", () => {
  it('fetches nothing while the ruler shows more than 20 years', async () => {
    const { climate, fetch, uniforms, frames } = setup();
    await frames(at('1816-07-01', 200));
    await frames(at('1816-07-01', 21));
    expect(fetch).not.toHaveBeenCalled();
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([0, null]);
  });

  it("draws the day's month in full at 20 years or closer", async () => {
    const { climate, uniforms, frames } = setup();
    await frames(at('1816-07-01', 20));
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([
      1,
      { year: 1816, month: 7 },
    ]);
  });

  it("fetches the day's year first, two at a time, and keeps two years either side", async () => {
    const { climate, fetched, frames } = setup();
    climate.update(at('1816-07-01'), 1 / 30);
    expect(fetched).toEqual([1816, 1815]);
    await frames(at('1816-07-01'));
    expect(fetched).toEqual([1816, 1815, 1817, 1814, 1818]);
    expect(climate.years).toEqual([1814, 1815, 1816, 1817, 1818]);
  });

  it("fetches the blend's earlier year first in early January", () => {
    const { climate, fetched } = setup();
    climate.update(at('1817-01-05'), 1 / 30);
    expect(fetched).toEqual([1816, 1817]);
  });

  it('drops the years the day leaves', async () => {
    const { climate, frames } = setup();
    await frames(at('1816-07-01'));
    await frames(at('1830-07-01'));
    expect(climate.years).toEqual([1828, 1829, 1830, 1831, 1832]);
  });

  it('keeps no years at the ends of the data or beyond them', async () => {
    const { climate, fetched, frames, uniforms } = setup();
    await frames(at('2008-07-01'));
    expect(climate.years).toEqual([2006, 2007, 2008]);
    await frames(at('1300-07-01'));
    expect(climate.years).toEqual([]);
    expect(fetched.every((year) => year >= 1421 && year <= 2008)).toBe(true);
    expect(uniforms.lookClimateStrength.value).toBe(0);
  });

  it('decodes at most one year and rewrites the field at most once a frame', async () => {
    const { climate, decode, uniforms } = setup();
    const texture = uniforms.lookClimateField.value;
    let most = { decodes: 0, uploads: 0 };
    for (const iso of ['1816-07-01', '1816-07-02', '1816-07-03', '1840-01-10', '1840-01-11']) {
      for (let frame = 0; frame < 10; frame += 1) {
        const [decodes, uploads] = [decode.mock.calls.length, texture.version];
        climate.update(at(iso), 1 / 30);
        climate.update(at(iso), 1 / 30);
        most = {
          decodes: Math.max(most.decodes, decode.mock.calls.length - decodes),
          uploads: Math.max(most.uploads, texture.version - uploads),
        };
        await flush();
      }
    }
    expect(most).toEqual({ decodes: 1, uploads: 1 });
  });

  it('eases out when the ruler widens past 20 years, and back in', async () => {
    const { uniforms, frames } = setup();
    await frames(at('1816-07-01'));
    await frames(at('1816-07-01', 40));
    expect(uniforms.lookClimateStrength.value).toBe(0);
    await frames(at('1816-07-01'));
    expect(uniforms.lookClimateStrength.value).toBe(1);
  });

  it('eases out while the years of a distant day are on their way', async () => {
    const held: (() => void)[] = [];
    const { climate, uniforms, frames } = setup({
      fetch: (url) =>
        yearOf(url) < 1890
          ? Promise.resolve(stored(yearOf(url)))
          : new Promise((resolve) => {
              held.push(() => resolve(stored(yearOf(url))));
            }),
    });
    await frames(at('1816-07-01'));
    await frames(at('1900-07-01'));
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([0, null]);
    for (const answer of held) answer();
    await frames(at('1900-07-01'));
    expect(climate.month).toEqual({ year: 1900, month: 7 });
  });

  it('names no month once the day has left the one drawn, while the layer eases out', async () => {
    const { climate, frames } = setup({
      fetch: (url) =>
        yearOf(url) < 1890 ? Promise.resolve(stored(yearOf(url))) : new Promise(() => {}),
    });
    await frames(at('1816-07-01'));
    climate.update(at('1900-07-01'), 1 / 30);
    expect([climate.drawn > 0, climate.month]).toEqual([true, null]);
  });

  it('names the months as the ruler does, Julian before the reform', async () => {
    const { climate, frames } = setup();
    // 25 February 1500 in the Julian calendar, 6 March in the Gregorian.
    await frames({ day: dayFromHistorical({ year: 1500, month: 2, day: 25 }), spanDays: 400 });
    expect(climate.month).toEqual({ year: 1500, month: 2 });
  });

  it('empties its years at the end, keeping none that arrive later', async () => {
    let answer: (() => void) | null = null;
    const { climate, uniforms, frames } = setup({
      fetch: (url) =>
        yearOf(url) !== 1818
          ? Promise.resolve(stored(yearOf(url)))
          : new Promise((resolve) => {
              answer = () => resolve(stored(yearOf(url)));
            }),
    });
    await frames(at('1816-07-01'));
    const before = new MemoryAccount();
    climate.inspectMemory(before);
    expect(before.owners[CLOCK_CLIMATE_OWNER]?.arrayBuffers).toBeGreaterThan(4 * 200_000);

    climate.end();
    (answer as (() => void) | null)?.();
    await flush();
    const after = new MemoryAccount();
    climate.inspectMemory(after);
    expect(after.owners[CLOCK_CLIMATE_OWNER]?.arrayBuffers).toBe(0);
    expect([climate.years, uniforms.lookClimateStrength.value, climate.month]).toEqual([
      [],
      0,
      null,
    ]);
  });

  it('logs a failed year once and draws no climate after it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = vi.fn(() => Promise.reject(new Error('the data host is down')));
    const { climate, uniforms, frames } = setup({ fetch: down });
    await frames(at('1816-07-01'));
    await frames(at('1830-07-01'));
    expect(warn).toHaveBeenCalledOnce();
    // The two fetches of the first frame, and none after.
    expect(down).toHaveBeenCalledTimes(2);
    expect([uniforms.lookClimateStrength.value, climate.month, climate.years]).toEqual([
      0,
      null,
      [],
    ]);
  });

  it('draws nothing and fetches nothing without a modera section', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn();
    const uniforms = createClimateUniforms();
    const field = new ClimateField(uniforms);
    const climate = new ClockClimate({ dataHost: 'https://data.test' }, field, { fetch });
    for (let frame = 0; frame < 30; frame += 1) climate.update(at('1816-07-01'), 1 / 30);
    expect(fetch).not.toHaveBeenCalled();
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([0, null]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
