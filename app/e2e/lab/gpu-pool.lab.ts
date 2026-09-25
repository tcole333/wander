// The pool smoke test in the installed Safari and Firefox (`npm run lab`): E2's check that the pool
// path works on WebKit before anything builds on it (streaming.md 8.2, E2 "If it fails"). Each
// browser opens e2e/gpu-pool.html, which posts its report; the assertions are the Chromium
// projects' own (e2e/gpuPoolTests.ts). Page errors reach the report as a posted error, and neither
// browser exposes WebGL warnings to the spec.
import { test } from '@playwright/test';
import type { ProbeReport } from '../../src/gpu/gpuPoolProbe';
import { definePoolTests } from '../gpuPoolTests';
import { EXTERNAL_BROWSERS, runInBrowser } from './external';

for (const browser of EXTERNAL_BROWSERS) {
  test.describe(browser.name, () => {
    let report: ProbeReport;

    test.beforeAll(async () => {
      report = await runInBrowser<ProbeReport>(browser, 'e2e/gpu-pool.html', 'gpu-pool', 60_000);
    });

    definePoolTests(() => ({ report, renderer: browser.renderer, problems: [] }));
  });
}
