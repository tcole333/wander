// Explore from the production build's lobby (dist/ under vite preview, on the fixture's data server
// through ?data=). Without ?explore the lobby shows the stories' plaques alone; with it, Explore's
// plaque stands last, dives into free time over its opening, where the now window's events mark
// the globe and the ruler scrubs the world clock, and WANDER or Escape returns to the lobby.
// Nothing logs an error, no request goes to Wikimedia, and once the room opens nothing more is
// fetched from the app's own host.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import { dayFromIso } from '../src/story/dates';
import { fetchedSinceOpening, markOpening } from './opening';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });
const WATERLOO = dayFromIso('1815-06-18');

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

test('shows no Explore plaque without the flag', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, wikimedia } = watch(page);
  await markOpening(page);
  await openLobby(page, '');
  await expect(page.locator('.lobby-plaque[data-story]')).toHaveCount(2);
  await expect(page.locator('.lobby-plaque[data-choice="explore"]')).toHaveCount(0);

  expect(await fetchedSinceOpening(page, PREVIEW_URL)).toEqual([]);
  expect(wikimedia).toEqual([]);
  expect(errors).toEqual([]);
});

test('dives into Explore, scrubs the clock and returns, by WANDER and by Escape', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const { errors, wikimedia } = watch(page);
  await markOpening(page);
  await openLobby(page, '&explore&opening=Q48314');

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
  // The now window's events mark the globe, Waterloo's among them.
  await expect
    .poll(async () => Number(await page.locator('.wu-explore').getAttribute('data-explore-marks')))
    .toBeGreaterThan(0);

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

  // The focused plaque dives again from the keyboard, and Escape returns.
  await page.keyboard.press('Enter');
  await phase(page, 'gone');
  await expect(clock).toHaveAttribute('aria-valuenow', String(WATERLOO));
  await page.keyboard.press('Escape');
  await phase(page, 'idle');
  await expect(page.locator('.wu-explore')).toHaveCount(0);

  expect(await fetchedSinceOpening(page, PREVIEW_URL)).toEqual([]);
  expect(wikimedia).toEqual([]);
  expect(errors).toEqual([]);
});
