// Every plaque in the lobby stays within reach, in the production build (dist/ under vite preview)
// on the fixture's data server, whose release names its event index, so All of History's plaque
// stands last. Where the plaques outrun a short window, their shelf scrolls within itself with
// More below it: the wheel over the shelf and More each bring the last plaque fully into view,
// and Tab reaches every plaque, each fully in view as it takes focus. Where they fit, as at
// 1440x800, every plaque stands in view and More stays hidden.
import { expect as playwrightExpect, test, type Locator, type Page } from '@playwright/test';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });
/** The plaques, in the column's order, by their data-story or data-choice. */
const PLAQUES = ['tambora', 'magellan', 'explore'];

function plaque(page: Page, id: string): Locator {
  return page.locator(`.lobby-plaque:is([data-story="${id}"], [data-choice="${id}"])`);
}

/** Opens the lobby, a key running the rest of its opening, and collects the page's errors. */
async function openLobby(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await expect(page.locator('body')).toHaveAttribute('data-lobby', 'idle');
  await expect(page.locator('.lobby-plaque')).toHaveCount(PLAQUES.length);
  return errors;
}

/** The plaque holding the keyboard's focus, or null. */
function focusedPlaque(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const held = document.activeElement;
    if (!(held instanceof HTMLElement) || !held.classList.contains('lobby-plaque')) return null;
    return held.dataset.story ?? held.dataset.choice ?? null;
  });
}

test.describe('on a short window', () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test('the wheel, More and Tab each reach every plaque', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await openLobby(page);
    const last = plaque(page, PLAQUES.at(-1)!);
    const first = plaque(page, PLAQUES[0]!);
    const more = page.locator('.lobby-more');
    await expect(last).not.toBeInViewport({ ratio: 1 });
    await expect(more).toHaveCSS('opacity', '1');

    await page.locator('.lobby-shelf').hover();
    await page.mouse.wheel(0, 1000);
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(more).toHaveCSS('opacity', '0');
    await page.mouse.wheel(0, -1000);
    await expect(first).toBeInViewport({ ratio: 1 });

    // Each press brings the next cut-off plaque up, until the last stands in view.
    await expect(async () => {
      await more.click({ timeout: 10_000 });
      await expect(last).toBeInViewport({ ratio: 1, timeout: 10_000 });
    }).toPass({ timeout: TIMEOUT });

    // Focus may start anywhere on the page, so Tab goes round until every plaque has held it.
    const reached: string[] = [];
    for (let press = 0; press < 16 && reached.length < PLAQUES.length; press++) {
      await page.keyboard.press('Tab');
      const id = await focusedPlaque(page);
      if (id === null || reached.includes(id)) continue;
      reached.push(id);
      await expect(plaque(page, id)).toBeInViewport({ ratio: 1 });
    }
    expect(reached.toSorted()).toEqual(PLAQUES.toSorted());
    expect(errors).toEqual([]);
  });
});

test.describe('on a window the plaques fit', () => {
  test.use({ viewport: { width: 1440, height: 800 } });

  test('every plaque stands in view, with no More', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await openLobby(page);
    for (const id of PLAQUES) await expect(plaque(page, id)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.lobby-more')).toHaveCSS('opacity', '0');
    expect(errors).toEqual([]);
  });
});
