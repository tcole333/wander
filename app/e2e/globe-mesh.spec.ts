// The surface vertex on the GPU (streaming.md 5.6, 7.3). e2e/globe-mesh.html uploads every fixture
// tile through the decode workers and the upload queue into the real surface pools, packs every
// mesh scenario, reads the vertex stage back on both tiers (meshReadback.ts) and checks it in the
// page against the other instances that share each point and against the vertex mirror. Shared
// points and the mirror's exact fields hold bit for bit; positions, which go through normalize and
// a rounded division on the GPU, hold within POSITION_TOLERANCE.
import { expect, test } from '@playwright/test';
import type { MeshReport, ScenarioCheck, TierCheck } from '../src/globe/meshProbe';
import { DEV_URL, DATA_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};

const FIXTURE_TILES = 55;
const SCENARIOS = 419;
const TIERS = ['lite', 'full'] as const;
/** R = 1: 6.4 m on the ground. */
const POSITION_TOLERANCE = 1e-6;
/** The only attributes the surface programs may declare (5.6). */
const SURFACE_ATTRIBUTES = ['position', 'normal', 'wanderNode', 'wanderPrev'];

let report: MeshReport;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  // Every scenario on both tiers: about 15 s on SwiftShader and 11 s on Metal on the M5.
  test.setTimeout(300_000);
  const page = await browser.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || /INVALID_|GL_OUT_OF_MEMORY/.test(message.text())) {
      problems.push(message.text());
    }
  });
  await page.goto(`${DEV_URL}/e2e/globe-mesh.html?data=${DATA_URL.fixture}`);
  const probe = await page.evaluate(() => window.globeMesh);
  if (!probe) throw new Error('e2e/globe-mesh.html did not start the probe');
  report = probe;
  await page.close();
});

test('runs on the renderer its project names, over every fixture tile', () => {
  expect(report.renderer).toMatch(RENDERER[test.info().project.name] ?? /^$/);
  expect(report.decodeErrors).toEqual([]);
  expect(report.tiles).toHaveLength(FIXTURE_TILES);
});

/** Scenarios failing `bad`, by name, with what the check behind it sampled. */
function failing(
  tier: TierCheck,
  bad: (s: ScenarioCheck) => boolean,
  samples?: keyof ScenarioCheck['samples'],
) {
  return tier.scenarios
    .filter(bad)
    .map((s) => ({ name: s.name, ...(samples ? { samples: s.samples[samples] } : {}) }));
}

for (const tierName of TIERS) {
  test.describe(tierName, () => {
    const tier = (): TierCheck => {
      const found = report.tiers.find((t) => t.tier === tierName);
      if (!found) throw new Error(`the probe skipped ${tierName}`);
      return found;
    };

    test('draws every vertex of every instance of every scenario once', () => {
      expect(tier().scenarios).toHaveLength(SCENARIOS);
      expect(failing(tier(), (s) => s.unwritten > 0)).toEqual([]);
    });

    test('1. every instance holding a shared point writes its position, code, shore, land and h bit for bit', () => {
      expect(tier().scenarios.every((s) => s.sharedPoints > 0)).toBe(true);
      expect(failing(tier(), (s) => s.seamMismatches > 0, 'seams')).toEqual([]);
    });

    test('2. every T-junction is fround(fround(P0 + P1)·0.5) of the coarse chord, within a float32 step', () => {
      expect(tier().scenarios.reduce((sum, s) => sum + s.tJunctions, 0)).toBeGreaterThan(0);
      expect(failing(tier(), (s) => !(s.tJunctionWorstUlp <= 1), 'tJunctions')).toEqual([]);
    });

    test('3. code, shore, land, h, m and class equal the mirror bit for bit at every vertex', () => {
      const exact = ['code', 'shore', 'land', 'h', 'disp', 'm', 'cls', 'info'] as const;
      const bad = (s: ScenarioCheck) => exact.some((field) => s.mirror[field] > 0);
      expect(failing(tier(), bad, 'mirror')).toEqual([]);
    });

    test('3. positions and uv lie within 1e-6 of the mirror', () => {
      const worst = tier().scenarios.reduce((a, b) =>
        b.mirror.posWorst > a.mirror.posWorst ? b : a,
      );
      const uv = Math.max(...tier().scenarios.map((s) => s.mirror.uvWorst));
      test.info().annotations.push({
        type: 'position error',
        description: `${worst.mirror.posWorst} R at ${worst.name}: ${worst.posWorstAt}; uv ${uv}`,
      });
      expect(worst.mirror.posWorst, worst.posWorstAt).toBeLessThanOrEqual(POSITION_TOLERANCE);
      expect(uv).toBeLessThanOrEqual(POSITION_TOLERANCE);
    });

    test('4. skirt bottoms hang skirtTexels node texels radially below their tops', () => {
      const skirts = tier().scenarios.map((s) => s.skirts);
      expect(skirts.reduce((sum, s) => sum + s.tjunctions, 0)).toBeGreaterThan(0);
      expect(skirts.reduce((sum, s) => sum + s.deep, 0)).toBeGreaterThan(0);
      expect(failing(tier(), (s) => !(s.skirts.worst <= POSITION_TOLERANCE))).toEqual([]);
    });

    test('5. one flipped cS, cN or dN bit splits shared points on the GPU as on the mirror', () => {
      for (const control of tier().controls) {
        expect(control.gpuMismatches, `${control.kind}: ${control.flip}`).toBeGreaterThan(0);
        expect(control).toMatchObject({
          gpuMismatches: control.mirrorMismatches,
          mirrorDiffs: 0,
        });
      }
      expect(tier().controls.map((c) => c.kind)).toEqual(['cS', 'cN', 'dN']);
    });

    test('6. the scenarios the GPU matched reach every required combination but the excluded', () => {
      const matched = tier().scenarios.filter(
        (s) =>
          s.unwritten === 0 &&
          s.seamMismatches === 0 &&
          s.tJunctionWorstUlp <= 1 &&
          Object.entries(s.mirror).every(([field, value]) =>
            field.endsWith('Worst') ? value <= POSITION_TOLERANCE : value === 0,
          ) &&
          s.skirts.worst <= POSITION_TOLERANCE,
      );
      const reached = new Set(matched.flatMap((s) => s.combinations));
      expect(tier().required.length).toBeGreaterThan(0);
      expect(tier().required.filter((key) => !reached.has(key))).toEqual([]);
    });
  });
}

test('7. the programs link with at most 4 active attributes, all surface ones, and no GL error', () => {
  expect(report.programs.map((p) => p.name).sort()).toEqual([
    'wander-readback-16',
    'wander-readback-32',
  ]);
  for (const { name, linked, attributes } of report.programs) {
    // WebGL 2 lists the built-in inputs the readback reads, gl_VertexID and gl_InstanceID, as
    // active attributes, but they take no attribute slot.
    const declared = attributes.filter((a) => !a.startsWith('gl_'));
    expect(linked, name).toBe(true);
    expect(declared.length, name).toBeLessThanOrEqual(4);
    expect(
      declared.filter((a) => !SURFACE_ATTRIBUTES.includes(a)),
      name,
    ).toEqual([]);
  }
  expect({ glError: report.glError, problems }).toEqual({ glError: 0, problems: [] });
});
