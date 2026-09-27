// Every sound in src/audio/ rendered offline in headless Chromium from the audition page
// (prototype-audio.html; the takes are in src/prototype/audio/render.ts) to 48 kHz 16-bit stereo
// WAV in <out>: each voice several times over, a detent scrub, a flight's whir, the Tambora bed at
// three moments and each cue. Prints each file's peak and RMS level in dBFS, writes them to
// <out>/levels.json, and fails when a file clips. Plain Node, run from app/ with `npm run dev` up
// (--url defaults to its address):
//
//   node scripts/renderSounds.ts --out <dir> [--url http://localhost:5173] [--takes a,b]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

interface Rendered {
  wav: string;
  seconds: number;
  peakDb: number;
  rmsDb: number;
}
interface SoundWindow {
  __sound?: {
    takes: string[];
    render(name: string): Promise<Rendered>;
  };
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    out: { type: 'string' },
    takes: { type: 'string' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const problems: string[] = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

const levels: Record<string, Omit<Rendered, 'wav'> & { clips: boolean }> = {};
try {
  await page.goto(`${values.url}/prototype-audio.html`);
  await page.waitForFunction(() => (window as SoundWindow).__sound !== undefined);
  const takes =
    values.takes?.split(',') ??
    (await page.evaluate(() => (window as SoundWindow).__sound?.takes ?? []));
  for (const name of takes) {
    const rendered = await page.evaluate((t) => (window as SoundWindow).__sound?.render(t), name);
    if (!rendered) throw new Error(`the page rendered nothing for ${name}`);
    const { wav, ...level } = rendered;
    writeFileSync(join(out, `${name}.wav`), Buffer.from(wav, 'base64'));
    const clips = level.peakDb >= 0;
    levels[name] = { ...level, clips };
    const [peak, rms] = [level.peakDb, level.rmsDb].map((db) => db.toFixed(1).padStart(6));
    console.log(`${name.padEnd(20)} peak ${peak} dBFS  RMS ${rms} dBFS${clips ? '  CLIPS' : ''}`);
  }
} finally {
  await browser.close();
}

writeFileSync(join(out, 'levels.json'), `${JSON.stringify({ levels, problems }, null, 2)}\n`);
for (const problem of problems) console.error(problem);
const clipped = Object.keys(levels).filter((name) => levels[name]?.clips);
if (clipped.length + problems.length > 0) {
  console.error(`clipped: ${clipped.join(', ') || 'none'}`);
  process.exitCode = 1;
}
