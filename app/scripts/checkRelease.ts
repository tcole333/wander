// npm run check-release: is the bundled release's data live on its data host, as the deployed page
// will read it? It HEADs rel/<id>.json (never a GET: the edge caches a 404 for hours), which
// publish-data uploads last. Only once that answers 200 does it GET the surface's bounds.bin and
// its six L0 tiles, the climate years the walk loads as it starts when the release has a modera
// section, the border step that holds 1815 with its preview chunk and notice when it has a
// borderSteps section, the event overview Explore reads first when it names the event files, and
// each story's first image, as the page fetches them, cross-origin from the app's origin, so it
// never leaves a 404 cached for a key about to be uploaded, and checks each answers 200 with R2's
// headers and its Content-Type (streaming.md 4.2).
// CI runs it as its own job, which the Pages deploy waits for, so the app never ships naming data
// that is not there. Plain Node:
//
//   npm run check-release
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BorderStepsRelease, Release } from '../src/data/release.ts';
import { lockedImage, type StoryLock } from '../src/story/lock.ts';
import { objectHeaders } from './objectHeaders.ts';
import { REPO_ROOT } from './release.ts';

/** The origin the deployed page fetches from, which R2's CORS rule must answer. */
export const APP_ORIGIN = 'https://wander.traviscole.xyz';

/** The headers every data object answers with (4.2), with the Content-Type its key's. */
function expected(key: string): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'content-type': objectHeaders(key)?.['Content-Type'] ?? 'none',
    'cache-control': 'public, max-age=31536000, immutable',
  };
}

/**
 * The climate years the check reads: those the walk loads as it starts, for the Tambora story's
 * monthly climate beats (story/effects/climate.ts climateYears). One missing turns climate off.
 */
export const CLIMATE_YEARS = [1815, 1816, 1817];

/** Join each story's opening beat to its lock and probe its small JPEG, as the card's preview. */
export function firstStoryImages(): string[] {
  const root = join(REPO_ROOT, 'stories');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => {
      const lock = JSON.parse(
        readFileSync(join(root, name, 'story.lock.json'), 'utf8'),
      ) as StoryLock;
      const text = readFileSync(join(root, name, 'story.md'), 'utf8');
      const block = /^```beat\s*\n([\s\S]*?)^```/m.exec(text)?.[1];
      if (!block) throw new Error(`${name}: no opening beat`);
      // Plain Node with no packages (CI runs this without npm ci): the lock matches an image by
      // its sha1 and crop, both single-line fields in the beat's block.
      const sha1 = /^\s*sha1:\s*"?([0-9a-f]{40})"?\s*$/m.exec(block)?.[1];
      const crop = /^\s*crop:\s*(\[[^\]\n]*\])\s*$/m.exec(block)?.[1];
      if (!sha1 || !crop) throw new Error(`${name}: the opening beat's image has no sha1 or crop`);
      const opening = { sha1, crop: JSON.parse(crop) as number[] };
      const image = lockedImage(lock, opening as Parameters<typeof lockedImage>[1])?.files.find(
        (file) => file.w === 256 && file.key.endsWith('.jpg'),
      );
      if (!image) throw new Error(`${name}: the first image has no 256w JPEG in its lock`);
      return image.key;
    });
}

/** The year whose border step, preview chunk and notice the check reads: Tambora's (3.3). */
export const BORDER_YEAR = 1815;

/** The border step holding `year`, its preview chunk and the steps' notice; none before the first. */
export function borderStepKeys(steps: BorderStepsRelease, year = BORDER_YEAR): string[] {
  let index = -1;
  while (index + 1 < steps.years.length && steps.years[index + 1]! <= year) index += 1;
  if (index < 0) return [steps.notice];
  const chunk = steps.previews.keys[Math.floor(index / steps.previews.per)];
  return [steps.keys[index]!, ...(chunk ? [chunk] : []), steps.notice];
}

/**
 * The keys the check reads: the release's copy, then bounds.bin, the L0 tiles, with a modera
 * section the climate's mean for each of CLIMATE_YEARS, with a borderSteps section the step
 * holding BORDER_YEAR, its preview chunk and the notice, with an events section its overview (3.4),
 * and each story's first image.
 */
export function releaseKeys(release: Release): { copy: string; data: string[] } {
  const { ver, bounds } = release.surface;
  const roots = [0, 1, 2, 3, 4, 5].map((face) => `surf/${ver}/0/${face}/0/0.wst`);
  const modera = release.modera;
  const climate = modera
    ? CLIMATE_YEARS.map((year) => `fd/modera/${modera.ver}/mean/${year}.bin`)
    : [];
  const steps = release.borderSteps ? borderStepKeys(release.borderSteps) : [];
  const events = release.events ? [release.events.overview] : [];
  const images = firstStoryImages();
  return {
    copy: `rel/${release.id}.json`,
    data: [bounds, ...roots, ...climate, ...steps, ...events, ...new Set(images)],
  };
}

/** What is wrong with the release's data on its host; empty when it is all live. */
export async function checkRelease(release: Release): Promise<string[]> {
  const { copy, data } = releaseKeys(release);
  const problems: string[] = [];
  for (const key of firstStoryImages()) {
    if (!release.media.images.includes(key))
      problems.push(`${key}: the release omits a story's first image`);
  }
  if (problems.length > 0) return problems;
  const url = (key: string) => `${release.dataHost}/${key}`;
  const ask = async (key: string, method: 'HEAD' | 'GET'): Promise<Response | null> => {
    try {
      return await fetch(url(key), { method, headers: { Origin: APP_ORIGIN } });
    } catch (error) {
      problems.push(`${key}: ${String(error)}`);
      return null;
    }
  };

  const head = await ask(copy, 'HEAD');
  if (head && head.status !== 200) problems.push(`${copy}: HTTP ${head.status}`);
  if (problems.length > 0) return problems;
  for (const key of data) {
    const response = await ask(key, 'GET');
    if (!response) continue;
    await response.arrayBuffer();
    if (response.status !== 200) {
      problems.push(`${key}: HTTP ${response.status}`);
      continue;
    }
    for (const [name, value] of Object.entries(expected(key))) {
      const got = response.headers.get(name);
      if (got !== value) problems.push(`${key}: ${name} is ${got ?? 'missing'}, not ${value}`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../src/generated/release.json', import.meta.url);
  const release = JSON.parse(readFileSync(path, 'utf8')) as Release;
  const problems = await checkRelease(release);
  if (problems.length > 0) {
    console.error(
      [
        `check-release: release ${release.id}'s data is not live on ${release.dataHost}:`,
        ...problems.map((problem) => `  ${problem}`),
        'Run `npm run publish-data` in app/ on the machine with the bake, commit',
        'app/src/generated/release.json, and push.',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`check-release: release ${release.id} is live on ${release.dataHost}`);
}
