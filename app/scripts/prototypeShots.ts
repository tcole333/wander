// Screenshots of the look prototype (prototype.html) on this Mac's GPU: Chromium on Metal at
// 1440x900, each preset opened fresh with ?ui=0, shot once the streamer has been idle for a second
// and the view has settled. Writes <out>/<preset>.png and <out>/stats.json. Plain Node, run from
// app/ with the Vite dev server and a data server up:
//
//   node scripts/prototypeShots.ts --url http://127.0.0.1:5184 --out <dir>
//     [--views world,sunda] [--query 'kLand=10&data=region'] [--timeout 90]
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

interface Proto {
  presets: string[];
  ready(): boolean;
  stats(): unknown;
  error?: string;
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5184' },
    out: { type: 'string' },
    views: { type: 'string' },
    query: { type: 'string', default: '' },
    timeout: { type: 'string', default: '90' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const timeoutMs = Number(values.timeout) * 1000;

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const problems: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`${message.type()}: ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

const open = async (view: string) => {
  const extra = values.query ? `&${values.query}` : '';
  await page.goto(`${values.url}/prototype.html?view=${view}&ui=0${extra}`);
  await page.waitForFunction(() => (window as { __proto?: Proto }).__proto !== undefined, null, {
    timeout: timeoutMs,
  });
};

const results: Record<string, unknown> = {};
try {
  await open('world');
  const page0 = await page.evaluate(() => {
    const { presets, error } = (window as unknown as { __proto: Proto }).__proto;
    return { presets, error };
  });
  if (page0.error) throw new Error(page0.error);
  const views = values.views?.split(',') ?? page0.presets;
  for (const [i, view] of views.entries()) {
    const started = Date.now();
    const before = problems.length;
    if (i > 0 || view !== 'world') await open(view);
    await waitReady(page);
    const png = join(out, `${view}.png`);
    await page.screenshot({ path: png });
    const stats = await page.evaluate(() =>
      (window as unknown as { __proto: Proto }).__proto.stats(),
    );
    results[view] = {
      settleS: (Date.now() - started) / 1000,
      stats,
      problems: problems.slice(before),
    };
    console.log(`${view}: ${png} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    for (const problem of problems.slice(before)) console.log(`  ${problem}`);
  }
} finally {
  writeFileSync(join(out, 'stats.json'), JSON.stringify(results, null, 2));
  await browser.close();
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const proto = (window as { __proto?: Proto }).__proto;
      if (proto?.error) throw new Error(proto.error);
      return proto?.ready() ?? false;
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  );
}
