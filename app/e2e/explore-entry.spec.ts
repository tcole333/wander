// Explore from the production build's lobby (dist/ under vite preview, on the fixture's data server
// through ?data=). The fixture's release names its event index, so Explore's plaque stands last; it
// dives into free time over its opening (?opening= pins Waterloo), landing with the opening's
// line pinned on its plate, where the now window's events mark the globe, a mark pointed at shows
// its plate, the keyboard pins one from the events' listbox, Meanwhile flies to an entry and pins
// it, and the ruler scrubs the world clock. WANDER returns to the lobby, and Escape unpins a plate,
// then returns. A release that names no event index, as the bundled one does until the event
// files are published, shows the stories' plaques alone. Nothing logs an error, no request goes to
// Wikimedia, and once the room opens nothing more is fetched from the app's own host.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import type { ExploreEventsHook, ExploreLabelsHook } from '../src/explore/explore';
import { dayFromIso } from '../src/story/dates';
import { fetchedSinceOpening, markOpening } from './opening';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });
const WATERLOO = dayFromIso('1815-06-18');

type ExplorePage = Window & {
  __exploreEvents?: ExploreEventsHook;
  __exploreLabels?: ExploreLabelsHook;
};

/** The event pinned, `Q…`, or null. */
function pinned(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as ExplorePage).__exploreLabels?.pinned() ?? null);
}

/** Waits for the event worker, the marks' fades and Meanwhile's answer to rest. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as ExplorePage).__exploreEvents?.settled() ?? false))
    .toBe(true);
}

// CI's software renderer needs fewer pixels per frame.
test.use({ viewport: { width: 640, height: 400 } });

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

/** Collects the page's errors and its requests to Wikimedia, which each test expects none of. */
function watch(page: Page): { errors: string[]; wikimedia: string[] } {
  const errors: string[] = [];
  const wikimedia: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/(^|\.)wikimedia\.org$/.test(new URL(request.url()).hostname)) {
      wikimedia.push(request.url());
    }
  });
  return { errors, wikimedia };
}

/** Opens the lobby: the room gives way, and a key runs the rest of the opening. */
async function openLobby(page: Page, query: string): Promise<void> {
  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}${query}`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await phase(page, 'idle');
}

test('shows no Explore plaque where the release names no event index', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, wikimedia } = watch(page);
  // The fixture's release without its event index, as the bundled release stands until the event
  // files are published.
  await page.route(`${DATA_URL.fixture}/release.json`, async (route) => {
    const response = await route.fetch();
    const release = (await response.json()) as { events?: unknown };
    expect(release.events).toBeDefined();
    delete release.events;
    await route.fulfill({ response, json: release });
  });
  await markOpening(page);
  await openLobby(page, '');
  await expect(page.locator('.lobby-plaque[data-story]')).toHaveCount(2);
  await expect(page.locator('.lobby-plaque[data-choice="explore"]')).toHaveCount(0);

  expect(await fetchedSinceOpening(page, PREVIEW_URL)).toEqual([]);
  expect(wikimedia).toEqual([]);
  expect(errors).toEqual([]);
});

test('shows Explore’s plaque last, dives in, labels its marks, scrubs and returns by WANDER and Escape', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const { errors, wikimedia } = watch(page);
  await markOpening(page);
  await openLobby(page, '&opening=Q48314');

  const plaque = page.locator('.lobby-plaque[data-choice="explore"]');
  await expect(page.locator('.lobby-plaque')).toHaveCount(3);
  await expect(page.locator('.lobby-plaque').last()).toHaveAttribute('data-choice', 'explore');
  await expect(plaque.locator('.lobby-title')).toHaveText('All of History');
  const mark = page.getByRole('button', { name: 'Wander — return to lobby' });
  const clock = page.getByRole('slider', { name: 'World date' });

  await plaque.scrollIntoViewIfNeeded();
  await plaque.click();
  await phase(page, 'diving');
  await phase(page, 'gone');
  await expect(page.locator('.wu-explore .rc')).toBeVisible();
  await expect(clock).toHaveAttribute('aria-valuenow', String(WATERLOO));
  // The event worker answers from the fixture's index: the now window's events mark the globe,
  // more than the openings lock's one mark, and Waterloo's mark is the index's own.
  await expect
    .poll(async () => Number(await page.locator('.wu-explore').getAttribute('data-explore-marks')))
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as ExplorePage).__exploreEvents?.event('Q48314')?.qid ?? null),
    )
    .toBe(48314);

  // The dive lands with the opening pinned, its written line on its plate.
  const pinnedPlate = page.locator('.xl-plate.is-pinned');
  await expect(pinnedPlate).toHaveClass(/is-shown/);
  await expect(pinnedPlate.locator('.xl-line')).toHaveText(/^At Waterloo/);
  expect(await pinned(page)).toBe('Q48314');

  // A mark the pointer rests on, where nothing stands over the globe, brings its plate.
  await settled(page);
  const free = await page.evaluate(() =>
    (window as ExplorePage)
      .__exploreEvents!.placed()
      .filter(
        (mark) =>
          mark.id !== 'Q48314' &&
          mark.alpha > 0.5 &&
          document.elementFromPoint(mark.x, mark.y)?.classList.contains('walk-canvas'),
      ),
  );
  const [pointed] = free;
  if (!pointed) throw new Error('no mark stands clear of the panels');
  await page.mouse.move(pointed.x, pointed.y);
  const hoverPlate = page.locator('.xl-plate:not(.is-pinned)');
  await expect(hoverPlate).toHaveClass(/is-shown/);
  await expect(hoverPlate.locator('.xl-name')).not.toBeEmpty();
  expect(await page.evaluate(() => (window as ExplorePage).__exploreLabels?.hovered())).toBe(
    pointed.id,
  );

  // The ruler's date plaque scrubs the world clock from the keyboard.
  await clock.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => Number(await clock.getAttribute('aria-valuenow')))
    .toBeGreaterThan(WATERLOO);

  await mark.click();
  await phase(page, 'returning');
  await phase(page, 'idle');
  await expect(page.locator('.wu-explore')).toHaveCount(0);
  await expect(plaque).toBeFocused();

  // The focused plaque dives again from the keyboard.
  await page.keyboard.press('Enter');
  await phase(page, 'gone');
  await expect(clock).toHaveAttribute('aria-valuenow', String(WATERLOO));
  await expect.poll(() => pinned(page)).toBe('Q48314');
  await settled(page);

  // Tab reaches the events' listbox, which starts on the pinned mark; an arrow moves to another,
  // and Enter pins it.
  const list = page.getByRole('listbox', { name: 'Events' });
  for (
    let tab = 0;
    tab < 12 && !(await list.evaluate((el) => el === document.activeElement));
    tab++
  )
    await page.keyboard.press('Tab');
  await expect(list).toBeFocused();
  const active = () => list.getAttribute('aria-activedescendant');
  await expect.poll(active).toBe('xl-Q48314');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    if ((await active()) !== 'xl-Q48314') break;
  }
  const chosen = await active();
  expect(chosen).toMatch(/^xl-Q[0-9]+/);
  expect(chosen).not.toBe('xl-Q48314');
  await page.keyboard.press('Enter');
  await expect.poll(() => pinned(page)).toBe(/^xl-(Q[0-9]+)/.exec(chosen!)![1]);

  // Meanwhile names what happens elsewhere; choosing an entry flies there and pins it. The pin
  // changed what the globe draws, so the list stands only once its new question has been asked
  // and answered: it is read until it holds for a second.
  await settled(page);
  const entries = page.locator('.wu-meanwhile .wu-mw-entry');
  await expect(entries.first()).toBeVisible();
  let listed = '';
  await expect
    .poll(
      async () => {
        const now = (await entries.locator('.wu-mw-label').allTextContents()).join('\n');
        const held = now === listed && now !== '';
        listed = now;
        return held;
      },
      { intervals: [1000] },
    )
    .toBe(true);
  const [name] = listed.split('\n');
  await entries.first().click();
  await expect(pinnedPlate.locator('.xl-name')).toHaveText(name!);
  await expect(pinnedPlate).toHaveClass(/is-shown/);
  expect(await pinned(page)).not.toBe('Q48314');

  // Escape unpins first, then returns to the lobby.
  await page.keyboard.press('Escape');
  await expect(pinnedPlate).not.toHaveClass(/is-shown/);
  expect(await pinned(page)).toBeNull();
  await phase(page, 'gone');
  await page.keyboard.press('Escape');
  await phase(page, 'idle');
  await expect(page.locator('.wu-explore')).toHaveCount(0);

  expect(await fetchedSinceOpening(page, PREVIEW_URL)).toEqual([]);
  expect(wikimedia).toEqual([]);
  expect(errors).toEqual([]);
});
