// No walk leaves memory behind (owner decision 43): the production page visits every story in the
// catalog (story/catalog.ts, read through e2e/catalogProbe.ts) from the lobby, a few beats each,
// and returns to the lobby, twice over. At each return it reads the DOM's node count and the app's
// memory account by owner (?memory=1, perf/memoryHook.ts), once the account has stopped changing.
// The second pass's returns may hold no more than the first's: no node more, and no owner more
// bytes than the tolerance below. A story added to the catalog is visited with no change here.
import { expect as playwrightExpect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CatalogEntry } from './catalogProbe';
import { test } from './idle';
import { DATA_URL, DEV_URL, PREVIEW_URL } from './servers';

const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);
const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });
/** Beats each visit steps through after the first, which a dive lands on. */
const BEATS_AFTER_FIRST = 2;
/**
 * How many bytes an owner may hold more at a return of the second pass than at the first's. Every
 * return of the second pass held exactly the bytes of the first's, on Metal (four runs) and on
 * SwiftShader, so this is no allowance for growth: it is under the smallest buffer an owner holds
 * (the surface availability's 16 KiB), so a buffer a walk fails to release always shows.
 */
const TOLERANCE_BYTES = 1024;
/** The account's counts, by owner and kind, as the memory hook reports them. */
type Owners = Record<
  string,
  Record<'arrayBuffers' | 'audioSamples' | 'canvasPixels' | 'imagePixels', number>
>;

interface Reading {
  /** Every node of the document: elements, text and comments. */
  nodes: number;
  owners: Owners;
}

// CI's software renderer needs fewer pixels per frame.
test.use({ viewport: { width: 640, height: 400 } });

/** Waits for the lobby's phase. A dive or a return takes some 40 frames, slow on SwiftShader. */
async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name, { timeout: 4 * TIMEOUT });
}

async function read(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    let nodes = 0;
    while (walker.nextNode()) nodes += 1;
    const memory = (window as { __wanderMemory?: () => unknown }).__wanderMemory?.() as
      { owners: Owners } | undefined;
    return { nodes, owners: memory?.owners ?? {} };
  });
}

/** The reading once nothing a return left running (a step's load, an upload) still changes it. */
async function settled(page: Page): Promise<Reading> {
  let last = await read(page);
  for (let tries = 0; tries < 20; tries += 1) {
    await page.waitForTimeout(1500);
    const now = await read(page);
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  return last;
}

test('every story in the catalog, twice over, leaves the lobby no heavier the second time', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${DEV_URL}/e2e/catalog.html`);
  await page.waitForFunction(() => window.catalogProbe !== undefined);
  const catalog = await page.evaluate(() => window.catalogProbe as CatalogEntry[]);
  expect(catalog.length).toBeGreaterThan(0);

  await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/jpeg',
      body: JPEG,
    }),
  );
  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&memory=1`);
  await page.waitForFunction(
    () => ['opening', 'idle'].includes(document.body.dataset.lobby ?? ''),
    undefined,
    { timeout: 4 * TIMEOUT },
  );
  await page.keyboard.press('Shift');
  await phase(page, 'idle');

  const title = page.locator('.wu-story .wu-title');
  const mark = page.getByRole('button', { name: 'Wander — return to lobby' });
  const returns: Reading[][] = [[], []];
  for (const pass of returns) {
    for (const { id, beats } of catalog) {
      const plaque = page.locator(`.lobby-plaque[data-story="${id}"]`);
      await plaque.scrollIntoViewIfNeeded();
      await plaque.click();
      await phase(page, 'gone');
      await expect(title).toHaveText(beats[0]!);
      for (const next of beats.slice(1, 1 + BEATS_AFTER_FIRST)) {
        await page.keyboard.press('ArrowRight');
        await expect(title).toHaveText(next);
      }
      await mark.click();
      await phase(page, 'idle');
      pass.push(await settled(page));
    }
  }

  const [first, second] = returns as [Reading[], Reading[]];
  expect(Object.keys(first[0]!.owners).length).toBeGreaterThan(0);
  const heavier: string[] = [];
  catalog.forEach(({ id }, i) => {
    const [before, after] = [first[i]!, second[i]!];
    const nodes = after.nodes - before.nodes;
    if (nodes > 0)
      heavier.push(`${id}: ${nodes} more DOM nodes (${before.nodes} to ${after.nodes})`);
    let most = 0;
    for (const [owner, kinds] of Object.entries(after.owners)) {
      for (const [kind, bytes] of Object.entries(kinds)) {
        const was = before.owners[owner]?.[kind as keyof Owners[string]] ?? 0;
        most = Math.max(most, bytes - was);
        if (bytes - was > TOLERANCE_BYTES) {
          heavier.push(
            `${id}: ${owner} holds ${bytes - was} more ${kind} bytes (${was} to ${bytes})`,
          );
        }
      }
    }
    // What the second return held over the first's, for the report: the headroom the limits have.
    test.info().annotations.push({
      type: `return ${id}`,
      description: `${nodes} nodes, and at most ${most} bytes in one owner, over the first pass`,
    });
  });
  expect(heavier).toEqual([]);
  expect(errors).toEqual([]);
});
