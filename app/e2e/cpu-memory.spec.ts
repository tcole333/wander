import { expect, test } from '@playwright/test';
import type { CpuMemoryProbe } from './cpuMemoryProbe';
import { DEV_URL } from './servers';

test('keeps GPU texels and draws intact after releasing immutable CPU sources', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/cpu-memory.html`);
  await page.waitForFunction(() => window.cpuMemoryProbe !== undefined);
  const report = await page.evaluate(() => window.cpuMemoryProbe as CpuMemoryProbe);
  expect(report.renderer).toMatch(
    test.info().project.name === 'gpu-chromium' ? /Metal/ : /SwiftShader/,
  );
  const pixels = (rgba: number[]) => [...rgba, ...rgba, ...rgba, ...rgba];
  expect(report.canvasPixels).toEqual([pixels([38, 75, 145, 255]), pixels([38, 75, 145, 255])]);
  expect(report.atlasPixels).toEqual([pixels([73, 0, 0, 255]), pixels([73, 0, 0, 255])]);
  expect(report.geometryPixels).toEqual([pixels([32, 64, 128, 255]), pixels([32, 64, 128, 255])]);
  expect(report.canvas.canvasPixels).toBe(0);
  expect(report.atlas.arrayBuffers).toBe(0);
  expect(report.geometryBytes).toBe(0);
  expect(report.glError).toBe(0);
  expect(problems).toEqual([]);
});
