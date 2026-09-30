// The border steps as the look draws them (e2e/borders.html, bordersProbe.ts), on synthetic steps
// and previews over the fixture's globe: at 8,000 km across only the outer lines draw, and at
// 2,000 km the inner lines too; a soft edge draws lighter than a hard one; a step dissolving into
// one with no borders draws its lines at half strength halfway; both previews of a ring cell
// decode and draw, each in its own channel; the dateline draws no seam in a preview, and a border
// along it draws; and the look reads the steps through the border field's one sampler.
import { expect, test } from '@playwright/test';
import type { BordersProbe } from './bordersProbe';
import { DATA_URL, DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};
/** The look's fragment samplers, as many as without the steps (e2e/marks.spec.ts). */
const SAMPLERS_MAX = 12;
/** A line drawn darkens the metal along it at least this much; one not drawn, at most `NONE`. */
const DRAWN = 0.2;
const NONE = 0.05;

let report: BordersProbe;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/borders.html?data=${DATA_URL.fixture}`);
  report = await page.evaluate(() => {
    if (!window.bordersProbe) throw new Error('e2e/borders.html did not start the probe');
    return window.bordersProbe;
  });
  await page.close();
});

test('runs on the renderer its project names, without errors', () => {
  expect(report.renderer).toMatch(RENDERER[test.info().project.name] ?? /^$/);
  expect(problems).toEqual([]);
});

test('reads the steps through the border field’s one sampler', () => {
  expect(report.samplers.names.filter((name) => name.startsWith('lookBorder'))).toEqual([
    'lookBorderField',
  ]);
  expect(report.samplers.count).toBeLessThanOrEqual(SAMPLERS_MAX);
});

test('draws only the outer lines at 8,000 km across, and the inner lines too at 2,000 km', () => {
  expect(report.world.outer).toBeGreaterThan(DRAWN);
  expect(report.world.inner).toBeLessThan(NONE);
  expect(report.close.outer).toBeGreaterThan(DRAWN);
  expect(report.close.inner).toBeGreaterThan(DRAWN);
});

test('draws a soft edge lighter than a hard one', () => {
  expect(report.close.soft).toBeGreaterThan(DRAWN);
  expect(report.close.soft / report.close.hard).toBeLessThan(0.9);
});

test('draws a step dissolving into one without borders at half strength halfway', () => {
  expect(report.dissolve.half / report.dissolve.whole).toBeGreaterThan(0.35);
  expect(report.dissolve.half / report.dissolve.whole).toBeLessThan(0.65);
});

test('decodes and draws both previews of a cell, each in its own channel', () => {
  expect(report.previews.r.own).toBeGreaterThan(DRAWN);
  expect(report.previews.r.other).toBeLessThan(NONE);
  expect(report.previews.g.own).toBeGreaterThan(DRAWN);
  expect(report.previews.g.other).toBeLessThan(NONE);
});

test('draws no seam at the dateline in a preview, and a border along it', () => {
  expect(report.dateline.clear).toBeLessThan(NONE);
  expect(report.dateline.border).toBeGreaterThan(DRAWN);
});
