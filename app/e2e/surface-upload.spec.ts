// Surface uploads on the fixture (streaming.md 5.4, 5.5): e2e/surface-upload.html decodes every
// fixture tile in the decode workers, uploads each through the upload queue at the lite animated
// budget and reads every slot back. Each slot must hold exactly its tile's decoded planes, each
// tile must be published only after all its parts, and no frame may pass the byte budget unless
// it sent a single part.
import { expect, test } from '@playwright/test';
import type { SurfaceUploadReport } from '../src/gpu/surfaceUploadProbe';
import { DATA_URL, DEV_URL } from './servers';

const FIXTURE_TILES = 55;

let report: SurfaceUploadReport;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(`${DEV_URL}/e2e/surface-upload.html?data=${DATA_URL.fixture}&tier=lite`);
  const probe = await page.evaluate(() => window.surfaceUpload);
  if (!probe) throw new Error('e2e/surface-upload.html did not start the probe');
  report = probe;
  await page.close();
});

test('uploads every fixture tile, each once', () => {
  expect(report.decodeErrors).toEqual([]);
  expect(report.uploads.map((upload) => upload.key).sort()).toEqual([...report.tiles].sort());
  expect(report.tiles).toHaveLength(FIXTURE_TILES);
});

test('each slot reads back exactly its tile at every level, and the edge profiles', () => {
  expect(report.mismatches).toEqual([]);
});

test('publishes each tile only after all its parts have landed', () => {
  expect(report.earlyPublishes).toEqual([]);
});

test('no frame passes the byte budget unless it sent a single part', () => {
  const over = report.frames.filter((frame) => frame.parts > 1 && frame.bytes > report.budgetBytes);
  expect(over).toEqual([]);
});

test('puts L0-L1 in their fixed slots and nothing else below slot 30', () => {
  for (const { key, slot } of report.uploads) {
    const level = Number(key.split('/')[0]);
    expect(level <= 1 ? slot < 30 : slot >= 30, `${key} in slot ${slot}`).toBe(true);
  }
});

test('raises no GL error', () => {
  expect(report.glError).toBe(0);
});
