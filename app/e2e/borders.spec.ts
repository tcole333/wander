// The border steps as the look draws them (e2e/borders.html, bordersProbe.ts), on synthetic steps
// and previews over the fixture's globe: each line an etched cut brighter than the metal with a
// shadow beside it; at 10,000 km across only the outer lines draw, and at 2,000 km the inner lines
// too; a soft edge draws dimmer than a hard one, without its shadow; a step dissolving into one
// with no borders draws its lines at half strength halfway; both previews of a ring cell decode
// and draw, each in its own channel; the dateline draws no seam in a preview, and a border along it
// draws; and the look reads the steps through the border field's one sampler.
import { expect, test } from '@playwright/test';
import type { BordersProbe, LineChange } from './bordersProbe';
import { closeIdle } from './idle';
import { DATA_URL, DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};
/** The look's fragment samplers, as many as without the steps (e2e/marks.spec.ts). */
const SAMPLERS_MAX = 12;
/**
 * A line drawn brightens the metal along it by at least `DRAWN` of its light, and an outer line's
 * shadow, a hairline under a pixel wide at CI's pixel ratio, darkens it by at least `SHADOWED`; one
 * not drawn changes it by at most `NONE`. An inner line's shadow, half a CSS px, darkens it less.
 */
const DRAWN = 0.2;
const SHADOWED = 0.1;
const NONE = 0.05;

const drawn = (line: LineChange) => expect(line.bright).toBeGreaterThan(DRAWN);
const shadowed = (line: LineChange) => {
  drawn(line);
  expect(line.dark).toBeGreaterThan(SHADOWED);
};
const none = (line: LineChange) => {
  expect(line.bright).toBeLessThan(NONE);
  expect(line.dark).toBeLessThan(NONE);
};

let report: BordersProbe;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/borders.html?data=${DATA_URL.fixture}`);
  report = await page.evaluate(() => {
    if (!window.bordersProbe) throw new Error('e2e/borders.html did not start the probe');
    return window.bordersProbe;
  });
  await closeIdle(page);
  await context.close();
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

test('draws only the outer lines at 10,000 km across, and the inner lines too at 2,000 km', () => {
  shadowed(report.world.outer);
  none(report.world.inner);
  shadowed(report.close.outer);
  drawn(report.close.inner);
});

test('draws a soft edge dimmer than a hard one, without its shadow', () => {
  expect(report.close.soft.bright).toBeGreaterThan(DRAWN);
  expect(report.close.soft.bright / report.close.hard.bright).toBeLessThan(0.9);
  expect(report.close.soft.dark).toBeLessThan(NONE);
  expect(report.close.hard.dark).toBeGreaterThan(SHADOWED);
});

test('draws a step dissolving into one without borders at half strength halfway', () => {
  // The shadow darkens the metal in proportion to the line's share; the cut's light does not.
  expect(report.dissolve.half.dark / report.dissolve.whole.dark).toBeGreaterThan(0.35);
  expect(report.dissolve.half.dark / report.dissolve.whole.dark).toBeLessThan(0.65);
  expect(report.dissolve.half.bright).toBeLessThan(report.dissolve.whole.bright);
});

test('decodes and draws both previews of a cell, each in its own channel', () => {
  shadowed(report.previews.r.own);
  none(report.previews.r.other);
  shadowed(report.previews.g.own);
  none(report.previews.g.other);
});

test('draws no seam at the dateline in a preview, and a border along it', () => {
  none(report.dateline.clear);
  shadowed(report.dateline.border);
});
