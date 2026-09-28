// Magellan's route on the Mac's GPU, after the story-selection task is merged. Run from app/
// with Vite and the global data server running (and prebuild fx run in that profile):
//
//   node scripts/routeShots.ts --url http://127.0.0.1:5173 --out ../build/m2/route --query data=global
//
// Pacific, strait, Mactan at 120 km, the San Julián port, and forward/backward scrubs across
// the dateline. Captures the same views at pixel ratios 1 and 1.5 (production's Retina cap),
// with frame statistics and any shader/network errors. Inspect the fine brass cut at sea level,
// the ember week and fleet point, and whether the track ends/shortens at each scrub date.
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { dayFromIso } from '../src/story/dates.ts';

interface WalkWindow {
  __walk?: {
    state(): { beat: number; day: number; flight: number | null };
    goTo(beat: number): void;
    scrub(day: number): void;
    landed(): boolean;
  };
  __proto?: { ready(): boolean; error?: string; stats(): unknown };
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    out: { type: 'string' },
    query: { type: 'string', default: 'data=global' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const markdown = readFileSync(new URL('../../stories/magellan/story.md', import.meta.url), 'utf8');
const beats = [...markdown.matchAll(/^```beat\n(.*?)\n```/gms)].map(
  (match) => parse(match[1]!) as { id: string; date: string },
);
const problems: string[] = [];
const shots: unknown[] = [];
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  for (const deviceScaleFactor of [1, 1.5]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error')
        problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(String(error)));
    page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
    page.on('response', (response) => {
      if (!response.ok() && response.url().includes('/fx/')) {
        problems.push(`route response ${response.status()}: ${response.url()}`);
      }
    });
    const query = new URLSearchParams(values.query);
    query.set('story', 'magellan');
    query.set('ui', '0');
    await page.goto(`${values.url}/prototype.html?${query}`);
    await page.waitForFunction(() => (window as WalkWindow).__walk !== undefined, null, {
      timeout: 90_000,
    });
    const firstDay = await page.evaluate(() => (window as WalkWindow).__walk!.state().day);
    if (firstDay !== dayFromIso(beats[0]!.date)) {
      throw new Error('The page did not select Magellan: merge the story-selection task first.');
    }
    await settle(page);
    // The same core load as climate starts once the first view is ready. Check that it succeeded,
    // rather than recording an apparently clean, empty globe when fx has not been published.
    await page.waitForFunction(
      () =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /\/fx\/[a-f0-9]{16}\.json(?:\?|$)/.test(entry.name)),
      null,
      { timeout: 90_000 },
    );

    const shoot = async (name: string) => {
      await page.waitForTimeout(3000); // fades and the 120-frame statistics window
      const path = join(out, `${name}-${deviceScaleFactor}x.png`);
      await page.screenshot({ path });
      const report = await page.evaluate(() => ({
        state: (window as WalkWindow).__walk!.state(),
        stats: (window as WalkWindow).__proto!.stats(),
      }));
      shots.push({ path, deviceScaleFactor, ...report });
      console.log(path);
    };
    for (const id of ['pacific', 'strait', 'mactan', 'san-julian']) {
      const index = beats.findIndex((beat) => beat.id === id);
      if (index < 0) throw new Error(`no ${id} beat`);
      await page.evaluate((beat) => (window as WalkWindow).__walk!.goTo(beat), index);
      await settle(page);
      await shoot(id);
      if (id === 'pacific') {
        for (const date of [
          '1519-09-19',
          '1520-12-13',
          '1521-02-01',
          '1521-02-15',
          '1521-02-21',
          '1520-12-13',
        ]) {
          await page.evaluate((day) => (window as WalkWindow).__walk!.scrub(day), dayFromIso(date));
          await shoot(`scrub-${date}-${shots.length}`);
        }
      }
    }
    await context.close();
  }
} finally {
  writeFileSync(join(out, 'route.json'), JSON.stringify({ shots, problems }, null, 2));
  await browser.close();
}
if (problems.length) throw new Error(problems.join('\n'));

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as WalkWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return w.__walk?.landed() && w.__proto?.ready();
    },
    null,
    { timeout: 90_000, polling: 250 },
  );
}
