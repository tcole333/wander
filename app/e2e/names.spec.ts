// The state names as the look draws them (e2e/names.html, namesProbe.ts), on the fixture, on
// SwiftShader in CI and on this Mac's GPU: Explore's borders bring the fixture's names for 1815's
// step and the look draws them; each letter of a name in capitals and of a Vietnamese name in small
// capitals is cut, its floor brightening the ground and its rim darkening it, and nothing changes
// past what the look may draw about a name; no name reaches the bloom's threshold; the mask draws
// every letter's floor magenta; and the look's program reads no more than the one sampler more
// the names may take.
import { expect, test } from '@playwright/test';
import { closeIdle } from './idle';
import type { NamesProbe } from './namesProbe';
import { DATA_URL, DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};
/** The look's fragment samplers with the names: the marks' 12 and the names' table. */
const SAMPLERS_MAX = 13;
const BLOOM_THRESHOLD = 1.05;
/**
 * A letter's floor brightens the ground by at least `FLOOR` of its light somewhere near its middle,
 * and its rim darkens it by at least `RIM`; past the name nothing changes by more than `NONE`.
 */
const FLOOR = 0.3;
const RIM = 0.1;
const NONE = 0.002;

let report: NamesProbe;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  // About 5 s on Metal on the M5; longer on SwiftShader.
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/names.html?data=${DATA_URL.fixture}`);
  report = await page.evaluate(() => {
    if (!window.namesProbe) throw new Error('e2e/names.html did not start the probe');
    return window.namesProbe;
  });
  await closeIdle(page);
  await context.close();
});

test('runs on the renderer its project names, without errors', () => {
  expect(report.renderer).toMatch(RENDERER[test.info().project.name] ?? /^$/);
  expect(problems).toEqual([]);
});

test('reads the names through one table beside the marks’ samplers', () => {
  expect(report.samplers.names.filter((name) => name.startsWith('lookName'))).toEqual([
    'lookNameTable',
  ]);
  expect(report.samplers.count).toBeLessThanOrEqual(SAMPLERS_MAX);
});

test('draws the names of the step the borders draw', () => {
  expect(report.fixture.length).toBeGreaterThan(0);
});

test('cuts every letter, Vietnamese ones included, and nothing past the name', () => {
  for (const name of report.synthetic) {
    expect(name.letters.length, name.text).toBeGreaterThan(0);
    for (const [i, letter] of name.letters.entries()) {
      expect(letter.bright, `${name.text} letter ${i}`).toBeGreaterThan(FLOOR);
      expect(letter.dark, `${name.text} letter ${i}`).toBeGreaterThan(RIM);
    }
    expect(name.beside, name.text).toBeLessThan(NONE);
  }
});

test('keeps every name under the bloom’s threshold', () => {
  for (const name of report.synthetic) expect(name.brightest).toBeLessThan(BLOOM_THRESHOLD);
});

test('draws every letter’s floor magenta for measuring', () => {
  for (const name of report.synthetic) expect(name.masked).toBe(name.letters.length);
});
