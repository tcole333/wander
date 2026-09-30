// check-release against the local data server on the fixture build, which serves R2's headers:
// from a root that also holds the release's copy and each story's first image it passes, and
// without the event files it names the missing overview; from the build alone, which holds
// neither copy nor images, it names the missing copy and fetches nothing else. On the bundled
// release it reads every climate year the walk loads as it starts, and the 1815 border field.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Release } from '../src/data/release';
import bundled from '../src/generated/release.json' with { type: 'json' };
import { climateYears } from '../src/story/effects/climate';
import { parseStory } from '../src/story/story';
import { assertFixtureFresh, REPO_ROOT } from '../src/test/fixture';
import { checkRelease, releaseKeys } from './checkRelease';
import { startDataServer, type DataServer } from './dataServer';

const servers: DataServer[] = [];
let scratch = '';

beforeAll(() => {
  assertFixtureFresh();
  scratch = mkdtempSync(join(tmpdir(), 'check-release-'));
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
  rmSync(scratch, { recursive: true, force: true });
});

async function serve(repo?: string): Promise<Release> {
  const server = await startDataServer({ profile: 'fixture', port: 0, repo });
  servers.push(server);
  return (await (await fetch(`${server.url}/release.json`)).json()) as Release;
}

/**
 * A release served from a repo whose fixture root is the build's surface and climate, the event
 * files when `events`, the release's copy and stand-ins for the story images the check reads.
 */
async function hosted(events: boolean): Promise<Release> {
  const repo = mkdtempSync(join(scratch, 'repo-'));
  const root = join(repo, 'build', 'fixture');
  mkdirSync(join(root, 'rel'), { recursive: true });
  mkdirSync(join(repo, 'build', 'stages'), { recursive: true });
  const linked = events ? ['surf', 'fd', 'ev'] : ['surf', 'fd'];
  for (const dir of linked) symlinkSync(join(REPO_ROOT, 'build', 'fixture', dir), join(root, dir));
  symlinkSync(
    join(REPO_ROOT, 'build', 'stages', 'fixture'),
    join(repo, 'build', 'stages', 'fixture'),
  );
  const release = await serve(repo);
  writeFileSync(join(root, 'rel', `${release.id}.json`), JSON.stringify(release));
  // The fixture bakes no story images, so stand-ins answer for the openings the check reads.
  mkdirSync(join(root, 'img'), { recursive: true });
  for (const key of releaseKeys(release).data.filter((key) => key.startsWith('img/'))) {
    writeFileSync(join(root, key), Buffer.alloc(64));
  }
  return release;
}

describe('check-release', () => {
  test('passes a release whose copy and data are on the host', async () => {
    const release = await hosted(true);
    expect(await checkRelease(release)).toEqual([]);
  });

  test("names a release's event overview that is not on the host", async () => {
    const release = await hosted(false);
    expect(await checkRelease(release)).toEqual([`${release.events?.overview}: HTTP 404`]);
  });

  test('reads no event file when the release names none', async () => {
    const release = { ...(await serve()), events: undefined };
    expect(releaseKeys(release).data.filter((key) => key.startsWith('ev/'))).toEqual([]);
  });

  test('names a release whose copy is not on the host', async () => {
    const release = await serve();
    expect(await checkRelease(release)).toEqual([`rel/${release.id}.json: HTTP 404`]);
  });

  test('reads every climate year the walk loads as it starts', () => {
    const story = parseStory(readFileSync(join(REPO_ROOT, 'stories/tambora/story.md'), 'utf8'));
    const release = bundled as Release;
    const climate = climateYears(story).map(
      (year) => `fd/modera/${release.modera?.ver}/mean/${year}.bin`,
    );
    const { data } = releaseKeys(release);
    expect(data.filter((key) => key.startsWith('fd/modera/'))).toEqual(climate);
  });

  test('reads the 1815 border field', () => {
    const release = bundled as Release;
    const field = release.borders?.files['1815']?.key;
    expect(field).toMatch(/^fd\/borders\/[0-9a-f]{8}\/1815\.bin$/);
    expect(releaseKeys(release).data).toContain(field);
  });
});
