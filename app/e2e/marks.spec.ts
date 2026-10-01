// Explore's marks as the look draws them (e2e/marks.html, marksProbe.ts), on the fixture: each
// mark placed in view changes its pixels and none past the limb changes any; the atlas letters its
// sea names as it does without the glyph shelf; the look's program reads no more samplers than it
// does without marks; and under the lamp's own reflection, in every variant, no mark but
// the focal one reaches the bloom's threshold, which the focal one's ember passes. The sea names'
// boxes are checked here rather than in Vitest, whose Node environment has no canvas to letter in.
import { expect, test } from '@playwright/test';
import type { MarksProbe } from './marksProbe';
import { closeIdle } from './idle';
import { DATA_URL, DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};
const BLOOM_THRESHOLD = 1.05;
/**
 * The look's fragment samplers with marks, as many as without them under three 0.186: the surface
 * pools, the sea-name atlas, climate, borders, three for routes (their cells heading the index
 * table), the marks' table, the environment, three's DFG table and the lamp's shadow, of the 16
 * WebGL 2 guarantees.
 */
const SAMPLERS_MAX = 12;

let report: MarksProbe;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  // About 4 s on Metal on the M5 and 25 s on SwiftShader.
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/marks.html?data=${DATA_URL.fixture}`);
  report = await page.evaluate(() => {
    if (!window.marksProbe) throw new Error('e2e/marks.html did not start the probe');
    return window.marksProbe;
  });
  await closeIdle(page);
  await context.close();
});

test('runs on the renderer its project names, without errors', () => {
  expect(report.renderer).toMatch(RENDERER[test.info().project.name] ?? /^$/);
  expect(problems).toEqual([]);
});

test('changes the pixels of every mark placed in view', () => {
  expect(report.covered).toHaveLength(6);
  expect(report.covered.filter(({ change }) => change < 0.02)).toEqual([]);
});

test('draws nothing past the limb', () => {
  expect(report.pastLimb).toEqual({ placed: 0, change: 0 });
});

test('letters the sea names as the atlas without marks does, the glyphs on a shelf below', () => {
  expect(report.seaNames).toEqual({ boxesSame: true, namesSame: true, shelfRows: 96 });
});

test('reads the marks’ table within the samplers the look reads without marks', () => {
  expect(report.samplers.names).toContain('lookMarkTable');
  expect(report.samplers.count).toBeLessThanOrEqual(SAMPLERS_MAX);
});

test('keeps every mark but the focal one under the bloom, at the lamp’s reflection', () => {
  expect(report.light).toHaveLength(8);
  for (const { variant, pose, cluster, ground, marks, focal } of report.light) {
    expect(cluster, `${variant}'s cluster in view at ${pose}`).toBeGreaterThan(0);
    expect(ground, `the ground under ${variant}'s cluster at ${pose}`).toBeGreaterThan(0);
    expect(marks, `${variant} at ${pose}`).toBeLessThan(BLOOM_THRESHOLD);
    expect(focal, `${variant}'s ember at ${pose}`).toBeGreaterThan(BLOOM_THRESHOLD);
  }
});
