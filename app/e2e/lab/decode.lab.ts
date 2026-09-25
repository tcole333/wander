// The decode path on the region bake in Chromium on Metal and the installed Safari and Firefox
// (`npm run lab`): every available tile, fetched cross-origin from the region's data server and
// decoded in the two decode workers, must match Node's decodeWst and bounds.bin. It also records
// E1's `.wst` decode time on this Mac (streaming.md 8.2) in
// build/lab/decode-summary-<browser>.json.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startDataServer, type DataServer } from '../../scripts/dataServer';
import { layerFiles, readRegionBake } from '../../src/test/region';
import type { DecodeProbeReport } from '../../src/workers/decodeProbe';
import { mismatches, nodeDigests } from '../decodeChecks';
import { DATA_URL, DEV_URL } from '../servers';
import { EXTERNAL_BROWSERS, runInBrowser } from './external';
import { labReportPath } from './reports';

const TIMEOUT = 5 * 60_000;
const PAGE = `e2e/decode.html?data=${encodeURIComponent(DATA_URL.region)}`;

let node: Map<string, string>;
let server: DataServer | undefined;

test.beforeAll(async () => {
  test.setTimeout(TIMEOUT);
  // Fails, naming the command, when the bake is missing or stale.
  const bake = readRegionBake();
  server = await startDataServer({ profile: 'region' });
  node = await nodeDigests(bake.layer, layerFiles(bake).tiles);
});

test.afterAll(() => server?.close());

function check(browser: string, report: DecodeProbeReport): void {
  writeFileSync(
    labReportPath(`decode-summary-${browser}`),
    JSON.stringify(summary(report), null, 1),
  );
  expect(report.errors).toEqual([]);
  expect(report.tiles).toHaveLength(node.size);
  expect(mismatches(report, node)).toEqual([]);
  expect(report.tiles.filter((tile) => !tile.boundsMatch).map((tile) => tile.key)).toEqual([]);
}

test('Chromium on Metal decodes the region bake as Node does', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  await page.goto(`${DEV_URL}/${PAGE}&report=chromium`);
  const report = await page.evaluate(() => window.decodeProbe);
  if (!report) throw new Error('e2e/decode.html did not start the probe');
  check('chromium', report);
});

for (const browser of EXTERNAL_BROWSERS) {
  test(`${browser.name} decodes the region bake as Node does`, async () => {
    test.setTimeout(TIMEOUT);
    const report = await runInBrowser<DecodeProbeReport>(browser, PAGE, 'decode', TIMEOUT - 10_000);
    check(browser.name, report);
  });
}

/** Decode time in the worker and stored size, by level: what E1 records. */
function summary(report: DecodeProbeReport) {
  const byLevel: Record<number, { tiles: number; ms: number[]; kb: number[] }> = {};
  for (const tile of report.tiles) {
    const level = Number(tile.key.split('/')[0]);
    const entry = (byLevel[level] ??= { tiles: 0, ms: [], kb: [] });
    entry.tiles += 1;
    entry.ms.push(tile.ms);
    entry.kb.push(tile.bytes / 1000);
  }
  const rank = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round((sorted[Math.ceil(p * sorted.length) - 1] ?? NaN) * 100) / 100;
  };
  const all = report.tiles.map((tile) => tile.ms);
  // Tiles decode coarsest first, so level and position in the run go together; by decile of the
  // order they finished in, a slowdown partway through shows apart from one by level.
  const byDecile = Array.from({ length: 10 }, (_, decile) => {
    const ms = report.tiles
      .filter((tile) => Math.floor((10 * tile.order) / report.tiles.length) === decile)
      .map((tile) => tile.ms);
    return { decile, tiles: ms.length, p50: rank(ms, 0.5), p90: rank(ms, 0.9) };
  });
  return {
    release: report.release,
    workers: report.workers,
    tiles: report.tiles.length,
    wallMs: Math.round(report.wallMs),
    decodeMs: { p50: rank(all, 0.5), p90: rank(all, 0.9), max: rank(all, 1) },
    byDecile,
    byLevel: Object.fromEntries(
      Object.entries(byLevel).map(([level, { tiles, ms, kb }]) => [
        level,
        {
          tiles,
          decodeMs: { p50: rank(ms, 0.5), p90: rank(ms, 0.9), max: rank(ms, 1) },
          storedKB: { p50: rank(kb, 0.5), max: rank(kb, 1) },
        },
      ]),
    ),
  };
}
