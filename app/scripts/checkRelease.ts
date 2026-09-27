// npm run check-release: is the bundled release's data live on its data host, as the deployed page
// will read it? It HEADs rel/<id>.json (never a GET: the edge caches a 404 for hours), which
// publish-data uploads last. Only once that answers 200 does it GET the surface's bounds.bin and
// its six L0 tiles as the page fetches them, cross-origin from the app's origin, so it never
// leaves a 404 cached for a key about to be uploaded, and checks each answers 200 with R2's
// headers (streaming.md 4.2). CI runs it on every pull request and again just before the Pages
// deploy, so the app never ships naming data that is not there. Plain Node:
//
//   npm run check-release
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Release } from '../src/data/release.ts';

/** The origin the deployed page fetches from, which R2's CORS rule must answer. */
export const APP_ORIGIN = 'https://wander.traviscole.xyz';

/** The headers every data object answers with (4.2). */
const EXPECTED: Record<string, string> = {
  'access-control-allow-origin': '*',
  'content-type': 'application/octet-stream',
  'cache-control': 'public, max-age=31536000, immutable',
};

/** The keys the check reads: the release's copy, then bounds.bin and the L0 tiles. */
export function releaseKeys(release: Release): { copy: string; data: string[] } {
  const { ver, bounds } = release.surface;
  const roots = [0, 1, 2, 3, 4, 5].map((face) => `surf/${ver}/0/${face}/0/0.wst`);
  return { copy: `rel/${release.id}.json`, data: [bounds, ...roots] };
}

/** What is wrong with the release's data on its host; empty when it is all live. */
export async function checkRelease(release: Release): Promise<string[]> {
  const { copy, data } = releaseKeys(release);
  const problems: string[] = [];
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
    for (const [name, value] of Object.entries(EXPECTED)) {
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
