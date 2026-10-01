// The vertex mirror (streaming.md 5.6): the shader's rules in float32. Its helpers are exact where
// the rules need them to be; on the fixture, every instance holding a shared lattice point gets it
// bit for bit, a node drawing its own tile with no seam flags reproduces the decoder's 33² grid, a
// node deep under its source samples the source's mip where the rules say, and skirts hang radially
// below their tops. The sweep over every fixture family runs per tier in vertexMirror.lite.test.ts
// and vertexMirror.full.test.ts, beside this file.
import { beforeAll, describe, expect, test } from 'vitest';
import { codeToMeters } from '../surface/codes';
import { EDGES, tileKey } from '../surface/cube';
import { GRID, MIP_SIZES } from '../surface/wst';
import { mipCodes, sideProfile, type Mip } from '../test/seams';
import {
  fixtureTile,
  fixtureTiles,
  gridVertex,
  mirrorScenario,
  sharedGroups,
  sharedMismatches,
  skirtCheck,
  type MirroredScenario,
  type VertexRef,
} from '../test/meshMirror';
import { flagsNeedUp } from './instances';
import {
  combinationKey,
  combinationsOf,
  EXCLUDED,
  fixtureBakes,
  fixtureFamilies,
  l1Globe,
  loneNode,
  matches,
  REQUIRED_COMBINATIONS,
  TIERS as TIER_NAMES,
  type Combination,
} from './meshScenarios';
import { ancestorAt, checkCover, seamFlags, vertexMip } from './seamFlags';
import { GRID_SEGMENTS, SKIRT } from './tileGrid';
import { QUARTER_PI, wanderDisplace, wanderPow2, wanderTan, wanderTanQ } from './vertexMirror';

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

  test('is ±1 at ±1 even where tan misses 1 by an ulp', () => {
    // wanderTan at float32 π/4 rounds to 1, but a GPU that fuses its multiply-adds need not.
    const high = () => f(1 + 2 ** -23);
    expect([wanderTanQ(1, high), wanderTanQ(-1, high)]).toEqual([1, -1]);
  });

  test('is odd', () => {
    const off = samples.filter((s) => wanderTanQ(-s) !== -wanderTanQ(s));
    expect(off).toEqual([]);
  });

  test('is a float32 within 2^-22 of tan(πs/4), relatively', () => {
    // The argument rounds twice in float32 and tan's slope near π/4 doubles that, then the
    // polynomial lands within a float32 step of tan: 2.5·2^-24 at worst.
    const off = samples.filter((s) => {
      const r = wanderTanQ(s);
      const exact = Math.tan((Math.PI * s) / 4);
      return f(r) !== r || Math.abs(r - exact) > 2 ** -22 * Math.abs(exact);
    });
    expect(off).toEqual([]);
  });
});

describe('wanderTan', () => {
  test('lands within one float32 step of Math.tan at every argument wanderTanQ takes', () => {
    // |s| = j/2048 on the full tier at L7, and a subset of those at coarser nodes and on lite.
    const off: string[] = [];
    for (let j = 0; j < 2048; j += 1) {
      const x = f((j / 2048) * QUARTER_PI);
      const tan = f(Math.tan(x));
      const step = tan === 0 ? 2 ** -149 : 2 ** (Math.floor(Math.log2(tan)) - 23);
      if (!(Math.abs(wanderTan(x) - tan) <= step)) off.push(`${x}: ${wanderTan(x)} vs ${tan}`);
    }
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

  test('with a tanQ an ulp off ±1 at |s| = 1, every face-edge point splits across faces', async () => {
    // As a GPU's tan may give without tanQ's exact ±1: a face's ±1 term then no longer matches
    // the ±tanQ term the face across writes in the same component.
    const withTan = await mirrorScenario(l1Globe(), segments, {
      tanQ: (s) => (Math.abs(s) === 1 ? Math.sign(s) * f(1 + 2 ** -23) : wanderTanQ(s)),
    });
    const split = new Set(sharedMismatches(withTan, groups, ['dir']).map((m) => m.split(' ')[0]));
    expect([...split].sort()).toEqual(
      faceEdgeGroups()
        .map(([point]) => point)
        .sort(),
    );
  });

  test('skirt bottoms are their tops lowered radially by skirtTexels node texels', () => {
    // One float32 step for components below 2: rounding the bottom costs at most half of it, and
    // the normal's own rounding, scaled by the depth, far less than the other half.
    const { worst, at } = skirtCheck(mirrored);
    expect(worst, at).toBeLessThanOrEqual(2 ** -23);
  });
});

test('skirts hang skirtTexels texels of the node’s own level, not its source’s', async () => {
  // Tambora's L7 tile drawn on its L2 source, two texels deep: 610 m, not 19.5 km.
  const deep = loneNode({ face: 1, level: 7, x: 103, y: 50 }, 2);
  for (const segments of Object.values(GRID_SEGMENTS)) {
    const check = skirtCheck(await mirrorScenario(deep, segments, { skirtTexels: 2 }));
    expect(check.deep).toBeGreaterThan(0);
    expect(check.worst, check.at).toBeLessThanOrEqual(2 ** -23);
  }
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

const FAMILIES = fixtureFamilies();

describe('the fixture families', () => {
  const scenarios = FAMILIES.flatMap((family) => family.scenarios);

  test('every scenario is a cover checkCover accepts, with a name of its own', () => {
    const refused = scenarios.flatMap(({ name, nodes, partial }) => {
      try {
        checkCover(nodes, { partial });
        return [];
      } catch (error) {
        return [`${name}: ${String(error)}`];
      }
    });
    expect(refused).toEqual([]);
    expect(new Set(scenarios.map((s) => s.name)).size).toBe(scenarios.length);
  });

  test('every scenario reads only tiles the fixture bakes, sources and up tiles alike', () => {
    const baked = new Set(fixtureTiles().map(tileKey));
    const missing = scenarios.flatMap(({ name, nodes, partial }) => {
      const flags = seamFlags(nodes, { partial });
      return nodes.flatMap(({ tile, source }) => {
        const reads = [ancestorAt(tile, source)];
        if (flagsNeedUp(flags.get(tileKey(tile)) ?? 0)) reads.push(ancestorAt(tile, source - 1));
        return reads.filter((t) => !baked.has(tileKey(t))).map((t) => `${name}: ${tileKey(t)}`);
      });
    });
    expect(missing).toEqual([]);
  });

  test('fixtureBakes names exactly the tiles the fixture holds', () => {
    const named: string[] = [];
    for (let level = 0; level <= 7; level += 1) {
      for (let face = 0; face < 6; face += 1) {
        for (let y = 0; y < 2 ** level; y += 1) {
          for (let x = 0; x < 2 ** level; x += 1) {
            const tile = { face, level, x, y };
            if (fixtureBakes(tile)) named.push(tileKey(tile));
          }
        }
      }
    }
    expect(named.sort()).toEqual(fixtureTiles().map(tileKey).sort());
  });
});

describe('coverage', () => {
  let reached: Set<string>;
  beforeAll(() => {
    reached = new Set(
      FAMILIES.flatMap(({ scenarios }) =>
        scenarios.flatMap((s) => TIER_NAMES.flatMap((tier) => [...combinationsOf(s, tier)])),
      ),
    );
  });
  const excluded = (c: Combination) => EXCLUDED.some(({ where }) => matches(c, where));

  test('the families reach every required combination but the excluded ones', () => {
    const missing = REQUIRED_COMBINATIONS.filter((c) => !excluded(c))
      .map(combinationKey)
      .filter((key) => !reached.has(key));
    expect(missing).toEqual([]);
  });

  test('they reach no excluded combination, and nothing the rules do not name', () => {
    const required = new Set(REQUIRED_COMBINATIONS.map(combinationKey));
    const excludedKeys = new Set(REQUIRED_COMBINATIONS.filter(excluded).map(combinationKey));
    expect([...reached].filter((key) => excludedKeys.has(key) || !required.has(key))).toEqual([]);
  });

  test('every exclusion gives its reason and rules out a required combination', () => {
    const idle = EXCLUDED.filter(
      ({ where, reason }) =>
        reason.trim() === '' || !REQUIRED_COMBINATIONS.some((c) => matches(c, where)),
    );
    expect(idle).toEqual([]);
  });
});
