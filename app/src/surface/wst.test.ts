// The decoder's pure steps on hand-built planes. wst.crosscheck.test.ts decodes the fixture's
// synthetic tiles and compares every output with the Python encoder's, bit for bit.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { intToHalfBits } from './half';
import {
  EDGE_ENTRIES,
  EDGE_ROWS,
  GRID,
  MAX_PAYLOAD_BYTES,
  MIP_ENTRIES,
  MIP_START,
  PROFILE_ENTRIES,
  SIZE,
  buildMips,
  inflate,
  payloadBytes,
  type WstHeader,
  type WstPlanes,
} from './wst';

const [N, E, S, W] = [0, 1, 2, 3] as const;
/** An L0 tile, whose four sides all lie on face edges and store profiles. */
const ROOT = { face: 2, level: 0, x: 0, y: 0 };
/** A tile along its face's N edge, which stores N alone. */
const NORTH_ONLY = { face: 4, level: 2, x: 1, y: 3 };

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
    profiles: new Int16Array(4 * PROFILE_ENTRIES),
    profileShore: new Uint8Array(4 * PROFILE_ENTRIES),
  };
}

/** The index of entry k of side e at mip m in a profile layout. */
function entry(e: number, m: number, k: number): number {
  return e * PROFILE_ENTRIES + (MIP_START[m] ?? NaN) + k;
}

/** The (R, G) half-float bits of texel k in row 4m + e of the edge texture. */
function edgeTexel(edges: Uint16Array, e: number, m: number, k: number): [number, number] {
  const at = 2 * ((4 * m + e) * EDGE_ENTRIES + k);
  return [edges[at] ?? NaN, edges[at + 1] ?? NaN];
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

  it('stores heights and profile codes as half-float offsets from codeMid', () => {
    const p = planes();
    p.codes.fill(1000);
    p.codes[5] = 3048;
    p.profiles.fill(1000);
    p.profiles[entry(N, 0, 100)] = -1048;
    const at = { ...ROOT, codeMid: 1000, codeMin: -1048, codeMax: 3048 };
    const decoded = buildMips(p, header(at));
    expect(decoded.heightMips[0][5]).toBe(intToHalfBits(2048));
    expect(decoded.heightMips[0][6]).toBe(0);
    expect(edgeTexel(decoded.edges, N, 0, 100)[0]).toBe(intToHalfBits(-2048));
    expect(edgeTexel(decoded.edges, N, 0, 101)[0]).toBe(0);
    expect(decoded.heightMips.map((mip) => mip.length)).toEqual([264 * 264, 132 * 132, 66 * 66]);
  });

  it('lays each stored side at mip m in edge row 4m + e, texel k holding its entry k', () => {
    const p = planes();
    for (const e of [N, E, S, W]) {
      MIP_ENTRIES.forEach((count, m) => {
        for (let k = 0; k < count; k += 1) {
          p.profiles[entry(e, m, k)] = 1000 * e + 300 * m + k;
          p.profileShore[entry(e, m, k)] = (e * 60 + m * 20 + k) % 256;
        }
      });
    }
    const { edges } = buildMips(p, header({ ...ROOT, codeMid: 1800, codeMax: 3664 }));
    expect(edges).toHaveLength(2 * EDGE_ROWS * EDGE_ENTRIES);
    const texels = [
      [N, 0, 0],
      [E, 0, 256],
      [S, 1, 128],
      [W, 1, 7],
      [E, 2, 64],
      [W, 2, 0],
    ] as const;
    for (const [e, m, k] of texels) {
      expect(edgeTexel(edges, e, m, k), `side ${e} mip ${m} entry ${k}`).toEqual([
        intToHalfBits(1000 * e + 300 * m + k - 1800),
        intToHalfBits((e * 60 + m * 20 + k) % 256),
      ]);
    }
  });

  it('leaves the edge texels past the last entry of mips 1 and 2 at 0', () => {
    const p = planes();
    p.profiles.fill(7);
    p.profileShore.fill(9);
    const { edges } = buildMips(p, header({ ...ROOT, codeMin: 7, codeMax: 7 }));
    for (const e of [N, E, S, W]) {
      expect(edgeTexel(edges, e, 1, 128)).toEqual([intToHalfBits(7), intToHalfBits(9)]);
      expect(edgeTexel(edges, e, 1, 129)).toEqual([0, 0]);
      expect(edgeTexel(edges, e, 2, 64)).toEqual([intToHalfBits(7), intToHalfBits(9)]);
      expect(edgeTexel(edges, e, 2, 65)).toEqual([0, 0]);
    }
  });

  it('writes only the rows of the sides its key stores', () => {
    const p = planes();
    p.profiles.fill(7);
    p.profileShore.fill(9);
    const north = buildMips(p, header({ ...NORTH_ONLY, codeMin: 7, codeMax: 7 })).edges;
    const rows = Array.from({ length: EDGE_ROWS }, (_, row) =>
      north.subarray(2 * row * EDGE_ENTRIES, 2 * (row + 1) * EDGE_ENTRIES).some((bits) => bits),
    );
    // Rows 0, 4 and 8 hold N at mips 0, 1 and 2.
    expect(rows.flatMap((written, row) => (written ? [row] : []))).toEqual([0, 4, 8]);
    const inFace = buildMips(p, header({ codeMin: 7, codeMax: 7 })).edges;
    expect(inFace.every((bits) => bits === 0)).toBe(true);
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

  it('gives grid vertices on a stored side h of its mip-2 entry at their corner', () => {
    // Vertex i along a side sits at corner 8i, mip-2 entry 2i. The sides share their corners.
    const p = planes();
    for (let k = 0; k < MIP_ENTRIES[2]; k += 1) {
      p.profiles[entry(N, 2, k)] = 500 + k;
      p.profiles[entry(E, 2, k)] = 1000 + k;
      p.profiles[entry(S, 2, k)] = -500 - k;
      p.profiles[entry(W, 2, k)] = -1000 - k;
    }
    const at = { ...ROOT, codeMin: -1064, codeMax: 1064, qLand: 0.5, qDeep: 2 };
    const { grid } = buildMips(p, header(at));
    const h = (c: number) => (c >= -400 ? c * 0.5 : -200 + (c + 400) * 2); // c200 = −400
    expect(grid[1]).toBe(h(-502)); // S entry 2
    expect(grid[GRID - 2]).toBe(h(-562)); // S entry 62
    expect(grid[4]).toBe(h(-508)); // S entry 8
    expect(grid[(GRID - 1) * GRID + 4]).toBe(h(508)); // N entry 8
    expect(grid[4 * GRID]).toBe(h(-1008)); // W entry 8
    expect(grid[4 * GRID + GRID - 1]).toBe(h(1008)); // E entry 8
  });

  it('gives grid vertices on a side inside the face h of the mean of the mip-2 codes there', () => {
    // NORTH_ONLY stores N alone. Vertex (5, 0) on S sits between mip-2 columns 10 and 11 and rows
    // 0 and 1: stored texels 40..47 across and 0..7 up. Vertex (0, 5) on W: 0..7 and 40..47.
    const p = planes();
    fill(p.codes, 40, 48, 0, 8, 12);
    fill(p.codes, 0, 8, 40, 48, -8);
    for (let k = 0; k < MIP_ENTRIES[2]; k += 1) p.profiles[entry(N, 2, k)] = 300 + k;
    const { grid } = buildMips(p, header({ ...NORTH_ONLY, codeMin: -8, codeMax: 364 }));
    expect(grid[5]).toBe(24);
    expect(grid[5 * GRID]).toBe(-16);
    expect(grid[(GRID - 1) * GRID + 5]).toBe(620); // N entry 10, 310 codes of 2 m
    expect(grid[GRID - 1]).toBe(0); // E and S are inside the face, so the SE corner is a mean
  });

  it('rounds the meter bounds outward', () => {
    // qLand 2.453125: code 3 is 7.359375 m; code −83 is one deep step below c200 = −82, at
    // −201.15625 − 9.8125 = −210.96875 m.
    const { boundsM } = buildMips(planes(), header({ qLand: 2.453125, codeMin: -83, codeMax: 3 }));
    expect(boundsM).toEqual([-211, 8]);
  });
});

describe('payloadBytes', () => {
  it('counts the header, 1,353 bytes a stored side, a pad for an odd count, and the planes', () => {
    expect([0, 1, 2, 4].map(payloadBytes)).toEqual([278_810, 280_164, 281_516, 284_222]);
    expect(MAX_PAYLOAD_BYTES).toBe(payloadBytes(4));
  });
});

describe('inflate', () => {
  it('gunzips and leaves the stored bytes intact', async () => {
    const payload = Uint8Array.from({ length: 1000 }, (_, k) => k % 251);
    const stored = new Uint8Array(gzipSync(payload)).buffer;
    const out = await inflate(stored, MAX_PAYLOAD_BYTES);
    expect([...out]).toEqual([...payload]);
    expect(stored.byteLength).toBeGreaterThan(0);
  });

  it('refuses output past its limit', async () => {
    const stored = new Uint8Array(gzipSync(new Uint8Array(MAX_PAYLOAD_BYTES + 1))).buffer;
    await expect(inflate(stored, MAX_PAYLOAD_BYTES)).rejects.toThrow(/inflates past/);
  });

  it('refuses bytes that are not gzip', async () => {
    await expect(inflate(new Uint8Array([1, 2, 3, 4]).buffer, MAX_PAYLOAD_BYTES)).rejects.toThrow();
  });
});
