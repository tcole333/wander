// check-release against the local data server on the fixture build, which serves R2's headers:
// from a root that also holds the release's copy it passes, and from the build alone, which holds
// none, it names the missing copy and fetches nothing else. On the bundled release it reads every
// climate year the walk loads as it starts.
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

describe('check-release', () => {
  test('passes a release whose copy and data are on the host', async () => {
    // A repo whose fixture root is the build's surface plus the release's copy.
    const root = join(scratch, 'build', 'fixture');
    mkdirSync(join(root, 'rel'), { recursive: true });
    mkdirSync(join(scratch, 'build', 'stages'), { recursive: true });
    symlinkSync(join(REPO_ROOT, 'build', 'fixture', 'surf'), join(root, 'surf'));
    symlinkSync(
      join(REPO_ROOT, 'build', 'stages', 'fixture'),
      join(scratch, 'build', 'stages', 'fixture'),
    );
    const release = await serve(scratch);
    writeFileSync(join(root, 'rel', `${release.id}.json`), JSON.stringify(release));
    expect(await checkRelease(release)).toEqual([]);
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
});
