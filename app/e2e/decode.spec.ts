// The decode path in a real browser (streaming.md 5.1, 7.3): e2e/decode.html reads the fixture's
// release from its data server, fetches every available tile cross-origin and decodes it in the
// two decode workers. Each tile must decode to the same planes as Node's decodeWst and to the
// bounds in bounds.bin.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO_ROOT } from '../src/test/fixture';
import type { DecodeProbeReport } from '../src/workers/decodeProbe';
import { mismatches, nodeDigests } from './decodeChecks';
import { DATA_URL, DEV_URL } from './servers';

// All of L0-L1, the Sumbawa chain and its L7 neighbor, and the 18 Kirkuk corner tiles (7.3).
const FIXTURE_TILES = 55;

let report: DecodeProbeReport;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(`${DEV_URL}/e2e/decode.html?data=${DATA_URL.fixture}`);
  const probe = await page.evaluate(() => window.decodeProbe);
  if (!probe) throw new Error('e2e/decode.html did not start the probe');
  report = probe;
  await page.close();
});

test('decodes every available fixture tile, with no errors', () => {
  expect(report.errors).toEqual([]);
  expect(report.available).toBe(FIXTURE_TILES);
  expect(report.tiles).toHaveLength(FIXTURE_TILES);
});

test('decodes each tile to the planes Node decodes', async () => {
  const layer = join(REPO_ROOT, 'build/fixture/surf', report.release.ver);
  const node = await nodeDigests(
    layer,
    report.tiles.map((tile) => tile.key),
  );
  expect(mismatches(report, node)).toEqual([]);
});

test('decodes each tile to its bounds in bounds.bin', () => {
  expect(report.tiles.filter((tile) => !tile.boundsMatch).map((tile) => tile.key)).toEqual([]);
});
