// Surface uploads on the region bake in Chromium on Metal and the installed Safari and Firefox
// (`npm run lab`): 226 L5-L7 tiles (with L0-L1's 30 fixed slots, a full-tier pool of 256) go
// through the upload queue at each tier's animated budget and read back exactly. It records E2's
// per-slot upload time on this Mac (streaming.md 8.2) in build/lab/surface-upload-summary-*.json.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startDataServer, type DataServer } from '../../scripts/dataServer';
import type { Tier } from '../../src/config/tunables';
import type { SurfaceUploadReport } from '../../src/gpu/surfaceUploadProbe';
import { readRegionBake } from '../../src/test/region';
import { DATA_URL, DEV_URL } from '../servers';
import { EXTERNAL_BROWSERS, runInBrowser } from './external';
import { labReportPath } from './reports';

const TIMEOUT = 5 * 60_000;
const TILES = 226;
const TIERS: Tier[] = ['lite', 'full'];

const page = (tier: Tier) =>
  `e2e/surface-upload.html?${new URLSearchParams({
    data: DATA_URL.region,
    tier,
    levels: '5-7',
    limit: String(TILES),
  })}`;

let server: DataServer | undefined;

test.beforeAll(async () => {
  // Fails, naming the command, when the bake is missing or stale.
  readRegionBake();
  server = await startDataServer({ profile: 'region' });
});

test.afterAll(() => server?.close());

function check(browser: string, report: SurfaceUploadReport): void {
  writeFileSync(
    labReportPath(`surface-upload-summary-${report.tier}-${browser}`),
    JSON.stringify(summary(report), null, 1),
  );
  expect(report.decodeErrors).toEqual([]);
  expect(report.uploads).toHaveLength(TILES);
  expect(report.mismatches).toEqual([]);
  expect(report.earlyPublishes).toEqual([]);
  expect(report.glError).toBe(0);
}

for (const tier of TIERS) {
  test(`Chromium on Metal uploads region tiles at the ${tier} budget`, async ({ page: tab }) => {
    test.setTimeout(TIMEOUT);
    await tab.goto(`${DEV_URL}/${page(tier)}&report=chromium`);
    const report = await tab.evaluate(() => window.surfaceUpload);
    if (!report) throw new Error('e2e/surface-upload.html did not start the probe');
    check('chromium', report);
  });

  for (const browser of EXTERNAL_BROWSERS) {
    test(`${browser.name} uploads region tiles at the ${tier} budget`, async () => {
      test.setTimeout(TIMEOUT);
      const what = `surface-upload-${tier}`;
      const report = await runInBrowser<SurfaceUploadReport>(
        browser,
        page(tier),
        what,
        TIMEOUT - 10_000,
      );
      check(browser.name, report);
    });
  }
}

/** Write and slot times, frames per tile, and why frames stopped: what E2 records. */
function summary(report: SurfaceUploadReport) {
  const rank = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round((sorted[Math.ceil(p * sorted.length) - 1] ?? NaN) * 1000) / 1000;
  };
  const stats = (values: number[]) => ({
    n: values.length,
    p50: rank(values, 0.5),
    p90: rank(values, 0.9),
    max: rank(values, 1),
  });
  const bySize: Record<number, number[]> = {};
  for (const { bytes, ms } of report.writes) (bySize[bytes] ??= []).push(ms);
  const stopped: Record<string, number> = {};
  for (const { stoppedBy } of report.frames) stopped[stoppedBy] = (stopped[stoppedBy] ?? 0) + 1;
  return {
    renderer: report.renderer,
    tier: report.tier,
    budgetBytes: report.budgetBytes,
    tiles: report.uploads.length,
    frames: report.frames.length,
    writeMsByBytes: Object.fromEntries(Object.entries(bySize).map(([b, ms]) => [b, stats(ms)])),
    slotMs: stats(report.uploads.map((upload) => upload.ms)),
    framesPerTile: stats(report.uploads.map((upload) => upload.frames)),
    frameMs: stats(report.frames.map((frame) => frame.ms)),
    stoppedBy: stopped,
  };
}
