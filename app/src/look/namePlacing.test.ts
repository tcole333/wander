// Which state names show and where (namePlacing.ts): their reveal by size, a region's form and
// level, their places kept apart with hysteresis, and their tiles.
import { describe, expect, test } from 'vitest';
import {
  binFootprints,
  CHOICE_MARGIN,
  chooseInRegion,
  keepApart,
  nameGrid,
  ROOM_PX,
  sizeFade,
  type Contender,
  type Footprint,
  type Obstacles,
  type RegionEntry,
} from './namePlacing';

const SIZE = { in: [7, 9] as const, cap: 26, out: [40, 50] as const };

describe('a name’s reveal by its em on screen', () => {
  test('fades in, holds, and fades out as its region’s windows take over', () => {
    expect(sizeFade(6, SIZE)).toBe(0);
    expect(sizeFade(8, SIZE)).toBeGreaterThan(0);
    expect(sizeFade(8, SIZE)).toBeLessThan(1);
    expect(sizeFade(30, SIZE)).toBe(1);
    expect(sizeFade(45, SIZE)).toBeLessThan(1);
    expect(sizeFade(51, SIZE)).toBe(0);
  });
});

describe('a region’s choice', () => {
  const entry = (level: number, short: boolean, reveal: number, emPx = 20): RegionEntry => ({
    level,
    short,
    reveal,
    emPx,
  });

  test('shows the short name far and the full name close, past a margin either way', () => {
    const at = (emPx: number) => [entry(0, false, 1, emPx), entry(0, true, 1, emPx * 1.5)];
    expect(chooseInRegion(at(10), 12, undefined)).toEqual({ level: 0, short: true });
    expect(chooseInRegion(at(14), 12, undefined)).toEqual({ level: 0, short: false });
    const short = { level: 0, short: true };
    const full = { level: 0, short: false };
    expect(chooseInRegion(at(12 + CHOICE_MARGIN.px / 2), 12, short)?.short).toBe(true);
    expect(chooseInRegion(at(12 - CHOICE_MARGIN.px / 2), 12, full)?.short).toBe(false);
  });

  test('takes the lowest level standing at full strength, else the lowest shown', () => {
    expect(chooseInRegion([entry(0, false, 0.3), entry(1, false, 1)], 12, undefined)?.level).toBe(
      1,
    );
    expect(chooseInRegion([entry(0, false, 0.3), entry(1, false, 0.5)], 12, undefined)?.level).toBe(
      0,
    );
    expect(chooseInRegion([entry(0, false, 0)], 12, undefined)).toBeNull();
  });

  test('keeps its level while it holds, until a lower one stands at full strength', () => {
    const held = { level: 1, short: false };
    const both = (zero: number, one: number) => [entry(0, false, zero), entry(1, false, one)];
    expect(
      chooseInRegion(both(0.85, CHOICE_MARGIN.keep), 12, { level: 2, short: false })?.level,
    ).toBe(0);
    expect(chooseInRegion(both(0.7, CHOICE_MARGIN.keep + 0.1), 12, held)?.level).toBe(1);
    expect(chooseInRegion(both(0.9, 1), 12, held)?.level).toBe(0);
    expect(chooseInRegion(both(0.5, CHOICE_MARGIN.keep - 0.1), 12, held)?.level).toBe(0);
  });

  test('shows a window’s full name', () => {
    expect(chooseInRegion([entry(1, false, 1), entry(0, true, 0)], 12, undefined)).toEqual({
      level: 1,
      short: false,
    });
  });
});

/** A straight footprint from (x0, y) to (x1, y), discs of radius r every r. */
function line(x0: number, x1: number, y: number, r: number): Footprint {
  const discs = Math.max(2, Math.ceil((x1 - x0) / r) + 1);
  const out = new Float64Array(3 * discs);
  for (let k = 0; k < discs; k++) out.set([x0 + ((x1 - x0) * k) / (discs - 1), y, r], 3 * k);
  return out;
}

const NONE: Obstacles = { discs: [], boxes: [] };

function contender(id: string, footprint: Footprint, more: Partial<Contender> = {}): Contender {
  return { id, name: id, sources: 2, footprint, core: 0.5, kept: false, ...more };
}

describe('names kept apart', () => {
  test('the stronger keeps its place where two would overlap', () => {
    const kept = keepApart(
      [contender('big', line(0, 200, 100, 10)), contender('small', line(150, 300, 110, 10))],
      NONE,
      1000,
    );
    expect([...kept]).toEqual(['big']);
  });

  test('a name kept needs less room to stay than a new one needs to come', () => {
    const gap = 20 + ROOM_PX.come / 2;
    const near = (kept: boolean) =>
      keepApart(
        [
          contender('a', line(0, 200, 100, 10)),
          contender('b', line(0, 200, 100 + gap, 10), { kept }),
        ],
        NONE,
        1000,
      );
    expect(near(false).has('b')).toBe(false);
    expect(near(true).has('b')).toBe(true);
  });

  test('an obstacle over its letters holds a name back, one over its band alone does not', () => {
    const name = contender('name', line(0, 200, 100, 20));
    const onLetters = { discs: [{ x: 100, y: 100, r: 4 }], boxes: [] };
    const onBand = { discs: [{ x: 100, y: 119, r: 1 }], boxes: [] };
    const box = { discs: [], boxes: [{ x0: 90, y0: 95, x1: 110, y1: 105 }] };
    expect(keepApart([name], onLetters, 1000).size).toBe(0);
    expect(keepApart([name], onBand, 1000).size).toBe(1);
    expect(keepApart([name], box, 1000).size).toBe(0);
  });

  test('copies of a name stand far apart, and a name crossfading between steps is not held back', () => {
    const copies = keepApart(
      [contender('one', line(0, 50, 0, 5)), contender('two', line(0, 50, 300, 5), { name: 'one' })],
      NONE,
      500,
    );
    expect([...copies]).toEqual(['one']);
    const crossfade = keepApart(
      [
        contender('was', line(0, 200, 100, 10), { name: 'state', sources: 1 }),
        contender('now', line(10, 210, 104, 10), { name: 'state', sources: 2 }),
      ],
      NONE,
      500,
    );
    expect(crossfade.size).toBe(2);
  });
});

describe('the names’ tiles', () => {
  test('hold a name in every tile its discs reach, in priority order', () => {
    const grid = nameGrid(128, 64, 32, 8192);
    expect(grid).toEqual({ tilePx: 32, across: 4, down: 2 });
    const bins = binFootprints([line(10, 70, 16, 4), line(40, 50, 40, 2)], grid, 6, 100);
    expect([...bins.binned]).toEqual([1, 1]);
    const tilesOf = (n: number) =>
      [...bins.counts.keys()].filter((t) => {
        const start = bins.starts[t] ?? 0;
        return [...bins.slots.slice(start, start + (bins.counts[t] ?? 0))].includes(n);
      });
    expect(tilesOf(0)).toEqual([0, 1, 2]);
    expect(tilesOf(1)).toEqual([5]);
  });

  test('leave out a name a full tile would cut, and grow each disc as asked', () => {
    const grid = nameGrid(64, 32, 32, 8192);
    const bins = binFootprints([line(4, 8, 16, 2), line(4, 8, 16, 2)], grid, 1, 100);
    expect([...bins.binned]).toEqual([1, 0]);
    const grown = binFootprints([line(4, 8, 16, 2)], grid, 6, 100, 15);
    expect([...grown.counts]).toEqual([1, 1]);
  });

  test('double their side on a screen with more tiles than the table holds', () => {
    expect(nameGrid(1000, 1000, 32, 100).tilePx).toBe(128);
  });
});
