// The local data server (streaming.md 7.3) on the fixture build: stored bytes with the production
// headers (4.2), the release for the build, and nothing outside it.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assertFixtureFresh, REPO_ROOT } from '../src/test/fixture';
import { startDataServer, type DataServer } from './dataServer';
import type { Release } from '../src/data/release';

const TAMBORA = '7/1/103/50';

let server: DataServer | undefined;
let ver: string;

beforeAll(async () => {
  assertFixtureFresh();
  server = await startDataServer({ profile: 'fixture', port: 0 });
  const surface = JSON.parse(
    readFileSync(join(REPO_ROOT, 'build/stages/fixture/surface.json'), 'utf8'),
  ) as { ver: string };
  ver = surface.ver;
});

afterAll(() => server?.close());

function url(): string {
  if (!server) throw new Error('the data server did not start');
  return server.url;
}

/**
 * A request with the path sent as written, which fetch() would normalize first. The server
 * normalizes dot segments itself, so only an encoded separator (%2f) reaches its root guard.
 */
function rawGet(path: string): Promise<number> {
  const { hostname, port } = new URL(url());
  return new Promise((done, fail) => {
    request({ hostname, port, path }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    })
      .on('error', fail)
      .end();
  });
}

describe('a tile', () => {
  test('is the stored bytes', async () => {
    const response = await fetch(`${url()}/surf/${ver}/${TAMBORA}.wst`);
    const stored = readFileSync(join(REPO_ROOT, `build/fixture/surf/${ver}/${TAMBORA}.wst`));
    expect(Buffer.from(await response.arrayBuffer()).equals(stored)).toBe(true);
  });

  test('carries the production headers and no Content-Encoding', async () => {
    const response = await fetch(`${url()}/surf/${ver}/${TAMBORA}.wst`, { method: 'HEAD' });
    const headers = Object.fromEntries(response.headers);
    expect(headers).toMatchObject({
      'access-control-allow-origin': '*',
      'timing-allow-origin': '*',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': 'application/octet-stream',
    });
    expect(headers['content-encoding']).toBeUndefined();
  });

  test('is not found when the build lacks it', async () => {
    const response = await fetch(`${url()}/surf/${ver}/7/1/0/0.wst`);
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('the release', () => {
  let release: Release;

  beforeAll(async () => {
    const response = await fetch(`${url()}/release.json`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    release = (await response.json()) as Release;
  });

  test('merges the coverage and surface records', () => {
    const read = (stage: string) =>
      JSON.parse(readFileSync(join(REPO_ROOT, `build/stages/fixture/${stage}.json`), 'utf8')) as {
        [key: string]: unknown;
      };
    const coverage = read('coverage');
    const surface = read('surface');
    expect(release.surface).toEqual({
      ver: surface.ver,
      maxLevel: surface.maxLevel,
      qLand: coverage.qLand,
      c200: coverage.c200,
      avail: surface.avail,
      bounds: surface.bounds,
    });
  });

  test('names this server as its data host and has a 16-digit id', () => {
    expect(release.dataHost).toBe(url());
    expect(release.id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('is the same on every request', async () => {
    const again = (await (await fetch(`${url()}/release.json`)).json()) as Release;
    expect(again).toEqual(release);
  });

  test('points at a bounds.bin the server serves', async () => {
    const response = await fetch(`${url()}/${release.surface.bounds}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
  });
});

describe('outside the build', () => {
  test.each([
    // Stopped by URL normalization before the root guard.
    '/../../app/package.json',
    '/%2e%2e/%2e%2e/app/package.json',
    // Stopped only by the root guard: these files exist and are types the server serves.
    '/..%2f..%2fapp%2fpackage.json',
    '/%2e%2e%2f%2e%2e%2fapp%2fpackage.json',
    '/..%2fstages%2ffixture%2fsurface.json',
    // Folders.
    '/surf',
    `/surf/${'x'.repeat(8)}/`,
  ])('%s is not found', async (path) => {
    expect(await rawGet(path)).toBe(404);
  });

  test('only GET and HEAD are served', async () => {
    const response = await fetch(`${url()}/release.json`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});

test('a missing build fails to start, naming the command that makes it', async () => {
  const nowhere = join(tmpdir(), `wander-no-build-${process.pid}`);
  await expect(startDataServer({ profile: 'region', port: 0, repo: nowhere })).rejects.toThrow(
    /uv run prebuild --profile region/,
  );
});
