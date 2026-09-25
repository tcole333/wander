// The GPU timer (src/perf/gpuTimer.ts) in a real browser: e2e/gpu-timer.html times one and eight
// heavy full-target draws. Everywhere the extension exists, every pass's time must arrive, finite
// and positive, and nested timing must be refused. On this Mac's GPU, eight draws must measure at
// least four times one; SwiftShader runs on the CPU, so its times say nothing about GPU work.
import { expect, test } from '@playwright/test';
import { nearestRank } from '../src/perf/frameStats';
import type { GpuTimerReport } from '../src/perf/gpuTimerProbe';
import { DEV_URL } from './servers';

let report: GpuTimerReport;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(`${DEV_URL}/e2e/gpu-timer.html`);
  const probe = await page.evaluate(() => window.gpuTimerProbe);
  if (!probe) throw new Error('e2e/gpu-timer.html did not start the probe');
  report = probe;
  await page.close();
});

const times = (label: string) => report.times.filter((t) => t.label === label).map((t) => t.ms);

test('times every pass, with finite positive times', () => {
  expect(report.available).toBe(true);
  expect(report.voided).toBe(0);
  for (const label of ['one', 'eight']) {
    expect(times(label), label).toHaveLength(7);
    expect(
      times(label).every((ms) => Number.isFinite(ms) && ms > 0),
      label,
    ).toBe(true);
  }
});

test('refuses to time one pass inside another', () => {
  expect(report.nestingRefused).toBe(true);
});

test('raises no GL error', () => {
  expect(report.glError).toBe(0);
});

test('on this GPU, eight draws take at least four times one', () => {
  test.skip(test.info().project.name !== 'gpu-chromium', 'SwiftShader times the CPU, not a GPU');
  expect(nearestRank(times('eight'), 0.5)).toBeGreaterThan(4 * nearestRank(times('one'), 0.5));
});
