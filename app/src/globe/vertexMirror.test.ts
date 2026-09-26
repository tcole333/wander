// The vertex mirror (streaming.md 5.6): the shader's rules in float32. Its helpers are exact where
// the rules need them to be; on the fixture, every instance holding a shared lattice point gets it
// bit for bit, a node drawing its own tile with no seam flags reproduces the decoder's 33² grid, a
// node deep under its source samples the source's mip where the rules say, and skirts hang radially
// below their tops.
import { beforeAll, describe, expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import { codeToMeters } from '../surface/codes';
import { EDGES, tileKey, type Vec3 } from '../surface/cube';
import { GRID, MIP_SIZES } from '../surface/wst';
import { mipCodes, sideProfile, type Mip } from '../test/seams';
import {
  fixtureTile,
  fixtureTiles,
  gridVertex,
  mirrorScenario,
  sharedGroups,
  sharedMismatches,
  type MirroredScenario,
  type VertexRef,
} from '../test/meshMirror';
import { l1Globe, loneNode } from './meshScenarios';
import { ancestorAt, vertexMip } from './seamFlags';
import { GRID_SEGMENTS, SKIRT } from './tileGrid';
import { wanderDisplace, wanderPow2, wanderTanQ } from './vertexMirror';

const f = Math.fround;
const TIERS = Object.entries(GRID_SEGMENTS);

describe('wanderPow2', () => {
  test('is 2^e exactly over the normal float32 exponents', () => {
    for (let e = -126; e <= 127; e += 1) expect(wanderPow2(e), `e = ${e}`).toBe(2 ** e);
  });
});

describe('wanderTanQ', () => {
  const samples = Array.from({ length: 4097 }, (_, i) => f(-1 + i / 2048));

  test('is exactly 0 at 0 and ±1 at ±1', () => {
    expect([wanderTanQ(0), wanderTanQ(1), wanderTanQ(-1)]).toEqual([0, 1, -1]);
  });

  test('is odd', () => {
    const off = samples.filter((s) => wanderTanQ(-s) !== -wanderTanQ(s));
    expect(off).toEqual([]);
  });

  test('is a float32 within 2^-22 of tan(πs/4), relatively', () => {
    // The argument rounds twice in float32 and tan's slope near π/4 doubles that, then the result
    // rounds once: about 2.6·2^-24 at worst.
    const off = samples.filter((s) => {
      const r = wanderTanQ(s);
      const exact = Math.tan((Math.PI * s) / 4);
      return f(r) !== r || Math.abs(r - exact) > 2 ** -22 * Math.abs(exact);
    });
    expect(off).toEqual([]);
  });
});

describe('wanderDisplace (rule 7, owner decision 18)', () => {
  test('raises land above sea level by kLand', () => {
    expect(wanderDisplace(100, true, 8, 8)).toBe(800);
  });

  test('keeps land below sea level at 0 m', () => {
    expect(wanderDisplace(-1168, true, 8, 8)).toBe(0);
  });

  test('lowers the sea by kSeaEff and never raises it', () => {
    expect(wanderDisplace(-100, false, 8, 8)).toBe(-800);
    expect(Math.abs(wanderDisplace(-100, false, 8, 0))).toBe(0);
    expect(wanderDisplace(50, false, 8, 8)).toBe(0);
  });
});

describe.each(TIERS)('l1-globe (%s)', (_tier, segments) => {
  let mirrored: MirroredScenario;
  let groups: Map<string, VertexRef[]>;
  beforeAll(async () => {
    mirrored = await mirrorScenario(l1Globe(), segments);
    groups = sharedGroups(mirrored);
  });
  const G = segments;
  const faceEdgeGroups = () =>
    [...groups].filter(([, members]) =>
      members.some(({ instance, vertex }) => mirrored.vertices[instance]?.[vertex]?.faceEdge),
    );

  test('shares 8 cube corners, 18 four-node points and every other seam point pairwise', () => {
    // Per face edge: 2 cube corners, a midpoint on four nodes and 2G − 2 pairs; per face, a
    // center on four nodes and two in-face seams of 2G − 2 pairs each.
    const sizes = new Map<number, number>();
    for (const members of groups.values()) {
      sizes.set(members.length, (sizes.get(members.length) ?? 0) + 1);
    }
    expect(Object.fromEntries(sizes)).toEqual({ 2: 24 * (2 * G - 2), 3: 8, 4: 18 });
    expect(faceEdgeGroups().length).toBe(12 * (2 * G - 1) + 8);
  });

  test('every instance holding a shared point gets its code, shore, land, h, direction and position bit for bit', () => {
    expect(sharedMismatches(mirrored, groups)).toEqual([]);
  });

  test('with Math.tan for wanderTanQ, every face-edge point splits across faces', async () => {
    // Math.tan(π/4) is 0.9999999999999999, as a GPU's tan may miss 1, so a face's ±1 term no
    // longer matches the ±tan term the face across writes in the same component.
    const withTan = await mirrorScenario(l1Globe(), segments, {
      tanQ: (s) => Math.tan((s * Math.PI) / 4),
    });
    const split = new Set(sharedMismatches(withTan, groups, ['dir']).map((m) => m.split(' ')[0]));
    expect([...split].sort()).toEqual(
      faceEdgeGroups()
        .map(([point]) => point)
        .sort(),
    );
  });

  test('skirt bottoms are their tops lowered radially by skirtTexels node texels', () => {
    const worst = { error: 0, at: '' };
    mirrored.vertices.forEach((vertices, instance) => {
      const { tile } = mirrored.packed.instances[instance]?.node ?? {};
      if (!tile) throw new RangeError(`no instance ${instance}`);
      const depth = (tunables.skirtTexels * (Math.PI / 2)) / (256 * 2 ** tile.level);
      vertices.forEach((bottom, v) => {
        const [k, l, role] = gridVertex(mirrored.grid, v);
        if (role !== SKIRT) return;
        const top = vertices[l * (G + 1) + k];
        if (!top) throw new RangeError(`no top at (${k}, ${l})`);
        const radial = unit(top.position);
        for (let i = 0; i < 3; i += 1) {
          const drop = (top.position[i] ?? NaN) - (bottom.position[i] ?? NaN);
          const error = Math.abs(drop - (radial[i] ?? NaN) * depth);
          if (!(error <= worst.error))
            Object.assign(worst, { error, at: `${tileKey(tile)} (${k}, ${l})` });
        }
      });
    });
    // One float32 step for components below 2: rounding the bottom costs at most half of it, and
    // the normal's own rounding, scaled by the depth, far less than the other half.
    expect(worst.error, worst.at).toBeLessThanOrEqual(2 ** -23);
  });
});

describe('the decoder grid', () => {
  test.each(TIERS)(
    'a node drawing its own tile with no seam flags samples every fixture tile’s 33² grid bit for bit (%s)',
    async (_tier, segments) => {
      // A lite vertex (k, l) sits where a full one sits at (2k, 2l), and takes the same mip.
      const step = (GRID - 1) / segments;
      const off: string[] = [];
      for (const tile of fixtureTiles()) {
        const { vertices, grid } = await mirrorScenario(loneNode(tile), segments);
        const { grid: meters } = await fixtureTile(tile);
        vertices[0]?.forEach((vertex, v) => {
          const [k, l, role] = gridVertex(grid, v);
          if (role === SKIRT) return;
          const expected = meters[step * l * GRID + step * k];
          if (!Object.is(vertex.h, expected)) {
            off.push(`${tileKey(tile)} (${k}, ${l}): ${vertex.h} vs ${expected}`);
          }
        });
      }
      expect(off).toEqual([]);
    },
  );
});

describe('a node deep under its source', () => {
  test.each(TIERS)(
    'samples the source’s mip-m codes and shore bytes bilinearly at its corner coordinates (%s)',
    async (_tier, segments) => {
      // Every fixture tile at L7 over its ancestors 1, 3 and 5 levels up: mips 1 and 0 on the full
      // tier, with quarter-texel weights at 5 levels, and the profile lerp on face edges.
      const G = segments;
      const off: string[] = [];
      let lerps = 0;
      for (const tile of fixtureTiles().filter((t) => t.level === 7)) {
        for (const d of [1, 3, 5]) {
          const source = ancestorAt(tile, tile.level - d);
          const decoded = await fixtureTile(source);
          const { vertices, grid, ctx } = await mirrorScenario(loneNode(tile, source.level), G);
          const m: Mip = vertexMip(G, tile.level, source.level);
          const codes = mipCodes(decoded, m);
          const size = MIP_SIZES[m];
          const span = G * 2 ** tile.level;
          vertices[0]?.forEach((vertex, v) => {
            const [k, l, role] = gridVertex(grid, v);
            if (role === SKIRT) return;
            // Corner coordinates in the source tile, 0..256.
            const cx = (((tile.x % 2 ** d) * G + k) * 256) / (G * 2 ** d);
            const cy = (((tile.y % 2 ** d) * G + l) * 256) / (G * 2 ** d);
            const gx = tile.x * G + k;
            const gy = tile.y * G + l;
            let code = 0;
            let shore = 0;
            if (gx === 0 || gy === 0 || gx === span || gy === span) {
              const e = gy === span ? 0 : gy === 0 ? 2 : gx === span ? 1 : 3;
              const profile = sideProfile(decoded, EDGES[e] ?? 'N', m);
              const x = (e === 0 || e === 2 ? cx : cy) / 2 ** m;
              const i = Math.floor(x);
              const lerp = (entries: number[]) =>
                (entries[i] ?? NaN) + ((entries[i + 1] ?? NaN) - (entries[i] ?? NaN)) * (x - i);
              if (x > i) lerps += 1;
              code = x > i ? lerp(profile.codes) : (profile.codes[i] ?? NaN);
              shore = x > i ? lerp(profile.shore) : (profile.shore[i] ?? NaN);
            } else {
              const tx = (4 + cx) / 2 ** m - 0.5;
              const ty = (4 + cy) / 2 ** m - 0.5;
              const [i, j] = [Math.floor(tx), Math.floor(ty)];
              const [fx, fy] = [tx - i, ty - j];
              for (const [di, dj, w] of [
                [0, 0, (1 - fx) * (1 - fy)],
                [1, 0, fx * (1 - fy)],
                [0, 1, (1 - fx) * fy],
                [1, 1, fx * fy],
              ] as const) {
                const at = (j + dj) * size + i + di;
                code += (codes[at] ?? NaN) * w;
                shore += (decoded.channelMips[m][2 * at] ?? NaN) * w;
              }
            }
            const h = f(codeToMeters(code, ctx.qLand[source.level] ?? NaN));
            if (vertex.code !== code || vertex.shore !== shore || !Object.is(vertex.h, h)) {
              off.push(
                `${tileKey(tile)} on L${source.level} (${k}, ${l}): ` +
                  `${vertex.code}/${vertex.shore}/${vertex.h} vs ${code}/${shore}/${h}`,
              );
            }
          });
        }
      }
      expect(off).toEqual([]);
      if (G === GRID_SEGMENTS.full) expect(lerps).toBeGreaterThan(0);
    },
  );
});

function unit(p: Vec3): Vec3 {
  const length = Math.hypot(...p);
  return [p[0] / length, p[1] / length, p[2] / length];
}
