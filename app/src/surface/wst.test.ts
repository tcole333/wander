// The decoder's pure steps on hand-built planes. wst.crosscheck.test.ts decodes the fixture's
// synthetic tiles and compares every output with the Python encoder's, bit for bit.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { intToHalfBits } from './half';
import {
  EDGE_ENTRIES,
  GRID,
  PAYLOAD_BYTES,
  SIZE,
  buildMips,
  inflate,
  type WstHeader,
  type WstPlanes,
} from './wst';

const [N, E, S, W] = [0, 1, 2, 3] as const;

function header(changes: Partial<WstHeader> = {}): WstHeader {
  return {
    face: 1,
    level: 7,
    x: 103,
    y: 50,
    flags: 0,
    qLand: 2,
    qDeep: 8,
    codeMid: 0,
    codeMin: 0,
    codeMax: 0,
    ...changes,
  };
}

function planes(): WstPlanes {
  return {
    codes: new Int16Array(SIZE * SIZE),
    shore: new Uint8Array(SIZE * SIZE),
    water: new Uint8Array(SIZE * SIZE),
    edges: new Int16Array(4 * EDGE_ENTRIES),
  };
}

/** Fill texels [i0, i1) × [j0, j1) of a 264² plane; j is the row. */
function fill(
  plane: Int16Array | Uint8Array,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  v: number,
) {
  for (let j = j0; j < j1; j += 1) plane.fill(v, j * SIZE + i0, j * SIZE + i1);
}

const FROM_HALF = new Map(
  Array.from({ length: 4097 }, (_, k) => [intToHalfBits(k - 2048), k - 2048] as const),
);

/** The integer whose half-float bits these are. */
function halfOf(bits: number | undefined): number {
  return FROM_HALF.get(bits ?? -1) ?? NaN;
}

describe('buildMips', () => {
  it('rounds each mip texel to the mean of four, half up, negative codes included', () => {
    const p = planes();
    const blocks = [
      [-3, -2, -2, -2], // mean −2.25 → −2
      [-3, -3, -2, -2], // mean −2.5 → −2
      [1, 2, 2, 2], // mean 1.75 → 2
      [5, 5, 6, 6], // mean 5.5 → 6
    ];
    blocks.forEach(([a, b, c, d], n) => {
      const k = 2 * n;
      p.codes.set([a ?? 0, b ?? 0], k);
      p.codes.set([c ?? 0, d ?? 0], SIZE + k);
    });
    const mip1 = buildMips(p, header({ codeMin: -3, codeMax: 6 })).heightMips[1];
    expect([...mip1.subarray(0, 4)].map(halfOf)).toEqual([-2, -2, 2, 6]);
  });

  it('builds mip 2 from the rounded mip 1, not from mip 0', () => {
    // Four 2×2 blocks summing 2, 2, 2 and 1 round to 1, 1, 1 and 0 at mip 1, whose mean 0.75
    // rounds to 1; the 16 texels' own mean, 7/16, would round to 0.
    const p = planes();
    p.codes.set([1, 1, 0, 1], 0);
    p.codes.set([0, 0, 1, 0], SIZE);
    p.codes.set([1, 0, 1, 0], 2 * SIZE);
    p.codes.set([1, 0, 0, 0], 3 * SIZE);
    const { heightMips } = buildMips(p, header({ codeMax: 1 }));
    expect([...heightMips[1].subarray(0, 2)].map(halfOf)).toEqual([1, 1]);
    expect(halfOf(heightMips[1][SIZE / 2])).toBe(1);
    expect(halfOf(heightMips[1][SIZE / 2 + 1])).toBe(0);
    expect(halfOf(heightMips[2][0])).toBe(1);
  });

  it('stores heights and edges as half-float offsets from codeMid', () => {
    const p = planes();
    p.codes.fill(1000);
    p.codes[5] = 3048;
    p.edges.fill(1000);
    p.edges[N * EDGE_ENTRIES + 100] = -1048;
    const decoded = buildMips(p, header({ codeMid: 1000, codeMin: -1048, codeMax: 3048 }));
    expect(decoded.heightMips[0][5]).toBe(intToHalfBits(2048));
    expect(decoded.heightMips[0][6]).toBe(0);
    expect(decoded.edges[N * EDGE_ENTRIES + 100]).toBe(intToHalfBits(-2048));
    expect(decoded.heightMips.map((mip) => mip.length)).toEqual([264 * 264, 132 * 132, 66 * 66]);
  });

  it('interleaves shore and water as RG8 at every mip', () => {
    const p = planes();
    p.shore.fill(200);
    p.water.fill(60);
    p.shore[1] = 0;
    const { channelMips } = buildMips(p, header());
    expect([...channelMips[0].subarray(0, 4)]).toEqual([200, 60, 0, 60]);
    expect([...channelMips[1].subarray(0, 2)]).toEqual([150, 60]); // (200·3 + 0 + 2) >> 2
    expect([...channelMips[2].subarray(0, 2)]).toEqual([188, 60]); // (150 + 200·3 + 2) >> 2
    expect(channelMips.map((mip) => mip.length)).toEqual([
      2 * 264 * 264,
      2 * 132 * 132,
      2 * 66 * 66,
    ]);
  });

  it('gives interior grid vertices h of the mean of the four mip-2 codes around them', () => {
    // Vertex (k, l) = (1, 2) sits at texel corner (8, 16), between mip-2 columns 2 and 3 and rows
    // 4 and 5: stored texels 8..15 across and 16..23 up. No other vertex sees those texels.
    const p = planes();
    fill(p.codes, 8, 12, 16, 20, 5);
    fill(p.codes, 12, 16, 16, 20, 6);
    fill(p.codes, 8, 12, 20, 24, -300);
    fill(p.codes, 12, 16, 20, 24, 7);
    // Vertex (3, 3): a mean of −300.25 codes, below c200 = −100.
    fill(p.codes, 24, 32, 24, 32, -300);
    fill(p.codes, 28, 32, 28, 32, -301);
    const { grid } = buildMips(p, header({ codeMin: -301, codeMax: 7 }));
    expect(grid[2 * GRID + 1]).toBe(Math.fround(((5 + 6 - 300 + 7) / 4) * 2));
    expect(grid[3 * GRID + 3]).toBe(Math.fround(-200 + (-300.25 + 100) * 8));
    expect([grid[GRID + 1], grid[3 * GRID + 1], grid[2 * GRID + 2]]).toEqual([0, 0, 0]);
  });

  it('gives boundary grid vertices h of the edge profile at their corner', () => {
    const p = planes();
    for (let k = 0; k < EDGE_ENTRIES; k += 1) {
      p.edges[N * EDGE_ENTRIES + k] = 500 + k;
      p.edges[E * EDGE_ENTRIES + k] = 1000 + k;
      p.edges[S * EDGE_ENTRIES + k] = -500 - k;
      p.edges[W * EDGE_ENTRIES + k] = -1000 - k;
    }
    const { grid } = buildMips(p, header({ codeMin: -1256, codeMax: 1256, qLand: 0.5, qDeep: 2 }));
    const h = (c: number) => (c >= -400 ? c * 0.5 : -200 + (c + 400) * 2); // c200 = −400
    expect(grid[0]).toBe(h(-500)); // S[0]
    expect(grid[GRID - 1]).toBe(h(-756)); // S[256]
    expect(grid[4]).toBe(h(-532)); // S[32]
    expect(grid[(GRID - 1) * GRID + 4]).toBe(h(532)); // N[32]
    expect(grid[4 * GRID]).toBe(h(-1032)); // W[32]
    expect(grid[4 * GRID + GRID - 1]).toBe(h(1032)); // E[32]
  });

  it('rounds the meter bounds outward', () => {
    // qLand 2.453125: code 3 is 7.359375 m; code −83 is one deep step below c200 = −82, at
    // −201.15625 − 9.8125 = −210.96875 m.
    const { boundsM } = buildMips(planes(), header({ qLand: 2.453125, codeMin: -83, codeMax: 3 }));
    expect(boundsM).toEqual([-211, 8]);
  });
});

describe('inflate', () => {
  it('gunzips and leaves the stored bytes intact', async () => {
    const payload = Uint8Array.from({ length: 1000 }, (_, k) => k % 251);
    const stored = new Uint8Array(gzipSync(payload)).buffer;
    const out = await inflate(stored, PAYLOAD_BYTES);
    expect([...out]).toEqual([...payload]);
    expect(stored.byteLength).toBeGreaterThan(0);
  });

  it('refuses output past its limit', async () => {
    const stored = new Uint8Array(gzipSync(new Uint8Array(PAYLOAD_BYTES + 1))).buffer;
    await expect(inflate(stored, PAYLOAD_BYTES)).rejects.toThrow(/inflates past/);
  });

  it('refuses bytes that are not gzip', async () => {
    await expect(inflate(new Uint8Array([1, 2, 3, 4]).buffer, PAYLOAD_BYTES)).rejects.toThrow();
  });
});
