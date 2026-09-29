// Explore's marks as the look draws them (e2e/marks.html, marksProbe.ts), on the fixture: each
// mark placed in view changes its pixels and none past the limb changes any; the atlas letters its
// sea names as it does without the glyph shelf; the look's program stays within the samplers every
// WebGL 2 fragment stage has; and under the lamp's own reflection, in every variant, no mark but
// the focal one reaches the bloom's threshold, which the focal one's ember passes.
import { expect, test } from '@playwright/test';
import type { MarksProbe } from './marksProbe';
import { DATA_URL, DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};
const BLOOM_THRESHOLD = 1.05;
/**
 * The look's fragment samplers with marks: the 12 it reads without them under three 0.186 (the
 * surface pools, the sea-name atlas, climate, borders, four for routes, the environment, three's
 * DFG table and the lamp's shadow) and the marks' table, of the 16 WebGL 2 guarantees.
 */
const SAMPLERS_MAX = 13;

let report: MarksProbe;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  // About 4 s on Metal on the M5 and 25 s on SwiftShader.
  test.setTimeout(240_000);
  const page = await browser.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/marks.html?data=${DATA_URL.fixture}`);
  report = await page.evaluate(() => {
    if (!window.marksProbe) throw new Error('e2e/marks.html did not start the probe');
    return window.marksProbe;
  });
  await page.close();
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

test('adds one sampler to the look, within those WebGL 2 guarantees', () => {
  expect(report.samplers.names).toContain('lookMarkTable');
  expect(report.samplers.count).toBeLessThanOrEqual(SAMPLERS_MAX);
});

test('keeps every mark but the focal one under the bloom, at the lamp’s reflection', () => {
  expect(report.light).toHaveLength(8);
  for (const { variant, pose, marks, focal } of report.light) {
    expect(marks, `${variant} at ${pose}`).toBeLessThan(BLOOM_THRESHOLD);
    expect(focal, `${variant}'s ember at ${pose}`).toBeGreaterThan(BLOOM_THRESHOLD);
  }
});
