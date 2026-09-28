// Screenshots and a video of the lobby (the production entry, index.html) on this Mac's GPU:
// Chromium on Metal at 1440x900. The first run shoots the opening at 0 to 4 s after it starts, the
// settled lobby, the plaque hovered, the Credits panel over the lobby, the dive at a few moments
// on its way, the landing on beat 1 with the sound knob, the Credits panel over the walk, and the
// Europe beat with the climate legend, the return, and a muted second dive. The second run
// records the opening, dive, return and re-entry to video,
// untouched by screenshots. Writes <out>/*.png, <out>/lobby.webm and <out>/lobby.json (each shot's
// time, fonts, the sound's state after the dive, any request to Wikimedia and any console errors).
// The page's data-lobby attribute names the lobby's phase (lobby/lobby.ts). Plain Node, run from
// app/ with the Vite dev server (or vite preview) and a data server up:
//
//   node scripts/lobbyShots.ts --url http://127.0.0.1:5430 --out <dir> [--query 'data=global']
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** The opening's frames, in seconds after it starts. */
const OPENING_AT = [0, 1, 2, 3, 4];
/** The dive's frames, in ms after the plaque is chosen. */
const DIVE_AT = [500, 1100, 1700, 2300];
/** The Europe beat, the first the climate draws on: its place in the story, 0-based. */
const EUROPE = 5;
/** Long enough for the lobby's turn to be under way, and for fades to finish. */
const SETTLE_MS = 3000;
const FADE_MS = 1500;
const VIEWPORT = { width: 1440, height: 900 };

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5430' },
    out: { type: 'string' },
    query: { type: 'string', default: '' },
    timeout: { type: 'string', default: '90' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const timeoutMs = Number(values.timeout) * 1000;
const entry = `${values.url}/${values.query ? `?${values.query}` : ''}`;

// Sound waits for a gesture, as in the browsers the visitor uses.
const browser = await chromium.launch({
  args: ['--use-angle=metal', '--autoplay-policy=user-gesture-required'],
});
const problems: string[] = [];
const wikimedia: string[] = [];
const shots: { name: string; atMs: number | null }[] = [];

try {
  const shooting = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // The page's AudioContexts, to tell whether the plaque's press started sound.
  await shooting.addInitScript(() => {
    const heard = window as unknown as { contexts: AudioContext[] };
    heard.contexts = [];
    window.AudioContext = class extends AudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        heard.contexts.push(this);
      }
    };
  });
  const page = await open(shooting);
  const shoot = async (name: string, atMs: number | null = null) => {
    const png = join(out, `${name}.png`);
    await page.screenshot({ path: png });
    shots.push({ name, atMs });
    console.log(png, atMs === null ? '' : `${atMs} ms`);
  };

  // The opening, timed from the moment it starts.
  await phase(page, 'opening', 'raf');
  const opened = Date.now();
  for (const s of OPENING_AT) {
    await page.waitForTimeout(Math.max(0, opened + s * 1000 - Date.now()));
    await shoot(`opening-${s}s`, Date.now() - opened);
  }
  await phase(page, 'idle');
  await page.waitForTimeout(SETTLE_MS);
  await shoot('lobby');
  await page.hover('.lobby-plaque');
  await page.waitForTimeout(600);
  await shoot('lobby-hover');

  await page.click('.lobby-credits');
  await page.waitForTimeout(700);
  await shoot('credits-lobby');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await page.click('.lobby-plaque');
  const chosen = Date.now();
  for (const ms of DIVE_AT) {
    await page.waitForTimeout(Math.max(0, chosen + ms - Date.now()));
    await shoot(`dive-${ms}ms`, Date.now() - chosen);
  }
  await phase(page, 'gone');
  const landedMs = Date.now() - chosen;
  await page.waitForTimeout(FADE_MS + 1000);
  await shoot('beat-1');
  const sound = await page.evaluate(() =>
    (window as unknown as { contexts: AudioContext[] }).contexts.map((ctx) => ctx.state),
  );

  await page.click('.wu-card-credits');
  await page.waitForTimeout(700);
  await shoot('credits-walk');
  await page.keyboard.press('Escape');

  for (let beat = 0; beat < EUROPE; beat += 1) await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.wu-legend.is-shown', { timeout: timeoutMs });
  await page.waitForTimeout(FADE_MS);
  await shoot('europe');

  await page.click('.wu-mark');
  const returning = Date.now();
  for (const ms of DIVE_AT) {
    await page.waitForTimeout(Math.max(0, returning + ms - Date.now()));
    await shoot(`return-${ms}ms`, Date.now() - returning);
  }
  await phase(page, 'idle');
  await page.waitForTimeout(FADE_MS);
  await shoot('lobby-returned');
  await page.click('.wu-sound');
  await shoot('lobby-muted');
  await page.click('.lobby-plaque');
  await phase(page, 'gone');
  await page.waitForTimeout(FADE_MS);
  await shoot('beat-1-muted-again');

  const report = await page.evaluate(() => ({
    fonts: {
      libreBaskerville: document.fonts.check('16px "Libre Baskerville"'),
      sourceSerif4: document.fonts.check('16px "Source Serif 4"'),
    },
    panelClosed: !document.querySelector<HTMLDialogElement>('dialog.cp')?.open,
    knobs: document.querySelectorAll('.wu-sound').length,
    mutedAfterReturn: document.querySelector('.wu-sound')?.getAttribute('aria-pressed'),
  }));
  await shooting.close();

  // The video: the opening, a moment in the lobby, the plaque hovered and chosen, and the dive.
  const recording = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size: VIEWPORT },
  });
  const filmed = await open(recording);
  await phase(filmed, 'idle');
  await filmed.waitForTimeout(SETTLE_MS);
  await filmed.hover('.lobby-plaque');
  await filmed.waitForTimeout(1000);
  await filmed.click('.lobby-plaque');
  await phase(filmed, 'gone');
  await filmed.waitForTimeout(FADE_MS + 1500);
  await filmed.keyboard.press('ArrowRight');
  await filmed.waitForTimeout(6500);
  await filmed.click('.wu-mark');
  await phase(filmed, 'idle');
  await filmed.waitForTimeout(FADE_MS);
  await filmed.click('.wu-sound');
  await filmed.click('.lobby-plaque');
  await phase(filmed, 'gone');
  await filmed.waitForTimeout(FADE_MS);
  const video = filmed.video();
  await recording.close();
  if (video) renameSync(await video.path(), join(out, 'lobby.webm'));

  writeFileSync(
    join(out, 'lobby.json'),
    JSON.stringify({ ...report, landedMs, sound, shots, wikimedia, problems }, null, 2),
  );
  for (const problem of problems) console.log(`  ${problem}`);
  for (const url of wikimedia) console.log(`  requested from Wikimedia: ${url}`);
} finally {
  await browser.close();
}

/** A page at the production entry, its console's errors and warnings noted. */
async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => {
    if (/(^|\.)wikimedia\.org$/.test(new URL(request.url()).hostname))
      wikimedia.push(request.url());
  });
  await page.goto(entry);
  return page;
}

/** Waits for the lobby to reach `name`. */
async function phase(page: Page, name: string, polling: 'raf' | number = 100): Promise<void> {
  await page.waitForFunction((want) => document.body.dataset.lobby === want, name, {
    timeout: timeoutMs,
    polling,
  });
}
