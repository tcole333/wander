// The border steps' bake checks (borderBake.ts) on synthetic faces, and its decoders on the
// fixture's two real steps and their preview chunk (streaming.md 3.3, 7.3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, test } from 'vitest';
import type { BorderStepsRelease } from '../data/release';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  TEXEL_KM,
  decodeChunk,
  decodeStep,
  drawnLeaves,
  innerDistance,
  leafFindings,
  outerDistance,
  owedTally,
  previewAgreement,
  shoreBand,
  shoreRuns,
  stepHolding,
} from './borderBake';
import { REPO_ROOT, assertFixtureFresh, readStageRecord } from './fixture';

const SIZE = 64;
const LAKE = { x: 32, y: 32, radius: 10 };

/** A face with a round lake: the shore distance as R stores it, + off the lake. */
function shores(): Uint8Array {
  const bytes = new Uint8Array(6 * SIZE * SIZE).fill(255);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = Math.hypot(x + 0.5 - LAKE.x, y + 0.5 - LAKE.y) - LAKE.radius;
      bytes[y * SIZE + x] = Math.round(128 + 16 * Math.max(-8, Math.min(8, d)));
    }
  }
  return bytes.map((b) => Math.min(255, b));
}

/** R and G far from any border, with R's bytes set where `border` says. */
function planes(border: (x: number, y: number) => boolean): Uint8Array {
  const bytes = new Uint8Array(6 * SIZE * SIZE * 2);
  for (let k = 0; k < 6 * SIZE * SIZE; k += 1) {
    const x = k % SIZE;
    const y = Math.floor(k / SIZE) % SIZE;
    const face = Math.floor(k / (SIZE * SIZE));
    bytes[2 * k] = face === 0 && border(x, y) ? 128 : 255;
    bytes[2 * k + 1] = 127;
  }
  return bytes;
}

describe('shoreRuns', () => {
  test('finds a border crossing a lake beside its shore for a texel or two', () => {
    const across = planes((x) => x === LAKE.x);
    const runs = shoreRuns(across, shoreBand(shores(), SIZE), SIZE, 0);
    expect(runs).toHaveLength(2);
    expect(Math.max(...runs.map((run) => run.km))).toBeLessThan(3 * TEXEL_KM);
  });

  test('finds a border ringing a lake all around its shore', () => {
    const lake = shores();
    const ring = planes((x, y) => {
      const d = outerDistance(lake[y * SIZE + x]!);
      return d > 0 && d <= 1;
    });
    const [run] = shoreRuns(ring, shoreBand(lake, SIZE), SIZE, 0);
    expect(run?.km).toBeGreaterThan(2 * LAKE.radius * TEXEL_KM);
    expect(run?.texels).toBeGreaterThan(40);
  });

  test("keeps each plane's borders apart when asked", () => {
    // A ring round the lake, R on its northern half and G on its southern.
    const lake = shores();
    const ring = new Uint8Array(6 * SIZE * SIZE * 2);
    for (let k = 0; k < SIZE * SIZE; k += 1) {
      const y = Math.floor(k / SIZE);
      const d = outerDistance(lake[k]!);
      const shore = d > 0 && d <= 1;
      ring[2 * k] = shore && y < LAKE.y ? 128 : 255;
      ring[2 * k + 1] = shore && y >= LAKE.y ? 64 : 127;
    }
    const band = shoreBand(lake, SIZE);
    const [both] = shoreRuns(ring, band, SIZE, 0);
    const [outer] = shoreRuns(ring, band, SIZE, 0, 'R');
    const [inner] = shoreRuns(ring, band, SIZE, 0, 'G');
    expect(outer!.box[3]).toBeLessThan(LAKE.y);
    expect(inner!.box[1]).toBeGreaterThanOrEqual(LAKE.y);
    expect(outer!.texels + inner!.texels).toBe(both!.texels);
    expect(Math.max(outer!.km, inner!.km)).toBeLessThan(both!.km);
  });

  test('finds none on another face', () => {
    expect(
      shoreRuns(
        planes(() => true),
        shoreBand(shores(), SIZE),
        SIZE,
        1,
      ),
    ).toEqual([]);
  });

  test('finds none along a lake too narrow to hold a border clear of its shores', () => {
    // A lake a texel and a half wide, running north to south, with a border along its axis.
    const narrow = new Uint8Array(6 * SIZE * SIZE).fill(255);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const d = Math.abs(x + 0.5 - 31.5) - 0.75;
        narrow[y * SIZE + x] = Math.min(255, Math.round(128 + 16 * Math.max(-8, Math.min(8, d))));
      }
    }
    const along = planes((x) => x === 31);
    expect(shoreRuns(along, shoreBand(narrow, SIZE), SIZE, 0)).toEqual([]);
  });
});

describe('previewAgreement', () => {
  // A face of 16² texels: R +3 texels west of column 8 and −3 east of it, as if a border ran down
  // column 8, except a sign jump in rows 12-15.
  const size = 16;
  const planes = new Uint8Array(6 * size * size * 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const west = x < 8 ? 3 : -3;
      planes[2 * (y * size + x)] = 128 + 16 * (y >= 12 && x === 2 ? -west : west);
    }
  }
  const q = (d: number) => Math.round(64 + 8 * d) << 1;

  test('compares land texels near an R border, well clear of it and of any sign jump', () => {
    const map = {
      texel: Int32Array.from([4 * size + 3, 4 * size + 12, 5 * size + 3, 13 * size + 3, 6 * size]),
      land: Uint8Array.from([1, 1, 1, 1, 0]),
    };
    const layer = Uint8Array.from([q(1), q(-2), q(-1), q(1), q(1)]);
    expect(innerDistance(layer[0]! >> 1)).toBe(1);
    expect(previewAgreement(planes, layer, map, size)).toEqual({ compared: 3, agreed: 2 });
  });
});

test('drawnLeaves counts the names not in parentheses each step lists', () => {
  const polities = {
    Duchy: { id: 3, wikidata: [], steps: [[1800, 1810, 'Duchy'] as [number, number, string]] },
    '(Empire)': {
      id: 2,
      wikidata: [],
      steps: [[1800, 1820, '(Empire)'] as [number, number, string]],
    },
    County: {
      id: 4,
      wikidata: [],
      steps: [
        [1800, 1800, 'County'] as [number, number, string],
        [1820, 1820, '(Empire)'] as [number, number, string],
      ],
    },
  };
  expect(drawnLeaves(polities, [1800, 1810, 1820])).toEqual([2, 1, 1]);
  expect(stepHolding([1800, 1810, 1820], 1815)).toBe(1);
  expect(stepHolding([1800, 1810, 1820], 1799)).toBe(-1);
});

describe('leafFindings', () => {
  const entry = (leaves: number, added: string[] = [], removed: string[] = []) => ({
    leaves,
    drawn: 0,
    added,
    removed,
    unexplained: [],
  });
  const none = {};

  test('passes steps that draw their rows valid, with what corrections add and take away', () => {
    const byStep = { 1800: entry(3), 1810: entry(3, ['Mexico'], ['Duchy', 'March']) };
    expect(leafFindings([1800, 1810], [3, 2], byStep, none)).toEqual([]);
  });

  test('names a step whose leaves drawn do not add up, corrections or not', () => {
    const byStep = { 1800: entry(3), 1810: entry(3, ['Mexico']) };
    expect(leafFindings([1800, 1810], [2, 3], byStep, none)).toEqual([
      '1800: 2 leaves drawn, not 3 rows valid, 0 added and 0 taken away',
      '1810: 3 leaves drawn, not 3 rows valid, 1 added and 0 taken away',
    ]);
  });

  test('names the leaves no correction names, and a step with no record of them', () => {
    const lost = { leaves: 2, drawn: 1, added: [], removed: ['Beta'], unexplained: ['Beta'] };
    const findings = leafFindings(
      [1800, 1810],
      [1, 2],
      { 1800: lost, 1810: { leaves: 2, drawn: 2 } },
      none,
    );
    expect(findings).toEqual([
      '1800: no correction names Beta',
      '1810: its review entry records no leaves added or taken away',
    ]);
  });

  test("checks the compared years' rows valid in every step, corrections or not", () => {
    const byStep = {
      1497: { ...entry(129), corrections: ['1000-1499.yaml correction 10 (pocket, 1450-1914)'] },
    };
    expect(leafFindings([1497], [129], byStep, { 1500: 130 })).toEqual([
      "1500: 129 rows valid, not the comparison's 130",
    ]);
  });
});

describe('owedTally', () => {
  const known = { verdict: 'known gap', decided: '2026-10-01', why: 'no line is cited' };

  test('counts the owed places acknowledged as known gaps and names the rest', () => {
    const owed = {
      holes: [{ id: 'hole 347..357 67E 30N', acknowledged: known }],
      gaps: [{ id: 'gap 1294..1313 70E 26N', acknowledged: known }, { id: 'gap 476..479 6E 44N' }],
    };
    expect(owedTally({ owed })).toEqual({
      acknowledged: 2,
      unacknowledged: ['gap 476..479 6E 44N'],
      lapsed: [],
    });
  });

  test('names the acknowledged ids the steps no longer owe', () => {
    const owed = { holes: [], gaps: [], lapsed: ['hole 347..357 67E 30N'] };
    expect(owedTally({ owed }).lapsed).toEqual(['hole 347..357 67E 30N']);
  });

  test('owes nothing for a record without an owed list', () => {
    expect(owedTally({})).toEqual({ acknowledged: 0, unacknowledged: [], lapsed: [] });
  });
});

describe('the decoders', () => {
  test('read a WBF2 step and refuse another format', () => {
    const header = Buffer.alloc(16);
    header.write('WBF2', 0, 'ascii');
    header.writeUInt8(1, 4);
    header.writeUInt8(6, 5);
    header.writeUInt16LE(2, 6);
    header.writeUInt16LE(4, 8);
    header.writeInt16LE(-3399, 10);
    header.writeUInt8(2, 12);
    const body = Buffer.alloc(6 * 2 * 2 * 2, 7);
    const step = decodeStep(gzipSync(Buffer.concat([header, body])));
    expect([step.year, step.size, step.apron, step.planes.length]).toEqual([-3399, 2, 4, 48]);
    header.write('WBP2', 0, 'ascii');
    expect(() => decodeStep(gzipSync(Buffer.concat([header, body])))).toThrow(/not a version/);
  });

  test('sum a WBP2 chunk back from its differences', () => {
    const cells = PREVIEW_WIDTH * PREVIEW_HEIGHT;
    const header = Buffer.alloc(12 + 8);
    header.write('WBP2', 0, 'ascii');
    header.writeUInt8(1, 4);
    header.writeUInt16LE(2, 6);
    header.writeUInt16LE(PREVIEW_WIDTH, 8);
    header.writeUInt16LE(PREVIEW_HEIGHT, 10);
    header.writeInt32LE(1815, 12);
    header.writeInt32LE(1830, 16);
    const first = Buffer.alloc(cells, 250);
    const delta = Buffer.alloc(cells, 10); // 250 + 10 wraps to 4
    const { years, layers } = decodeChunk(gzipSync(Buffer.concat([header, first, delta])));
    expect(years).toEqual([1815, 1830]);
    expect([layers[0]![0], layers[1]![0]]).toEqual([250, 4]);
  });
});

describe("the fixture's border steps", () => {
  let steps: BorderStepsRelease;
  const read = (key: string) =>
    new Uint8Array(readFileSync(join(REPO_ROOT, 'build', 'fixture', key)));

  beforeAll(() => {
    assertFixtureFresh();
    steps = readStageRecord<{ steps: BorderStepsRelease }>('borders').steps;
  });

  test('decode as their years, and their chunk as both previews', () => {
    expect(steps.years).toEqual([1815, 1830]);
    steps.keys.forEach((key, k) => {
      const step = decodeStep(read(key));
      expect([step.year, step.size, step.apron]).toEqual([steps.years[k], 1024, 4]);
    });
    const { years, layers } = decodeChunk(read(steps.previews.keys[0]!));
    expect(years).toEqual([1815, 1830]);
    expect(layers).toHaveLength(2);
  });
});
