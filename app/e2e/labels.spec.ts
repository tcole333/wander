// The label faces (story/ui/fonts.ts, streaming.md 6): once a boot where Explore stands has loaded
// them, label text in any script the event index holds draws without fetching another face, since
// nothing is fetched from Pages after boot.
import { expect, test } from '@playwright/test';
import type { LabelsProbe } from './labelsProbe';
import { DEV_URL } from './servers';

test('draws Vietnamese and Cyrillic labels without fetching a face', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/labels.html`);
  await page.waitForFunction(() => window.labelsProbe !== undefined);
  const report = await page.evaluate(() => window.labelsProbe as LabelsProbe);
  expect(report.faces).toEqual([
    { weight: '400', status: 'loaded' },
    { weight: '400', status: 'loaded' },
    { weight: '600', status: 'loaded' },
    { weight: '600', status: 'loaded' },
  ]);
  expect(new Set(report.families)).toEqual(new Set(['"Wander Label", serif']));
  expect(report.fetched).toEqual([]);
  expect(problems).toEqual([]);
});
