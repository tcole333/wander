// publish-data's decisions (streaming.md 4.3): the keys a release names in an output root, and
// which of them an upload sends given R2's listing. Nothing here reaches the network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FxRelease, Release } from '../src/data/release';
import { noticeTag, plan, releaseSections } from './publish';
import type { R2Bucket } from './r2';

// Bits 0-6: the six L0 nodes and L1 node 6 (face 0, x 0, y 0).
const SEVEN = 'fwAAAA==';
const BOUNDS = 'surf/aaaa1111/bounds.bin';
const FILES: Record<string, number> = {
  [BOUNDS]: 12,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((f) => [`surf/aaaa1111/0/${f}/0/0.wst`, 100 + f])),
  'surf/aaaa1111/1/0/0/0.wst': 200,
  // An older bake's version, left in the same output root.
  'surf/bbbb2222/0/0/0/0.wst': 300,
  'fd/modera/cccc3333/mean/1816.bin': 90,
  'fd/modera/cccc3333/spread/1816.bin': 60,
  'fd/modera/cccc3333/annual.bin': 400,
  'fd/borders/eeee5555/1815.bin': 700,
  'lic/1111222233334444.txt': 20,
  'lic/5555666677778888.geojson': 900,
  'img/cccc3333cccc3333-1024.jpg': 400,
  'img/cccc3333cccc3333-256.jpg': 40,
  'fx/1111222233334444.json': 80,
  'fx/5555666677778888.json': 90,
  'ev/eeee1111/overview.wev': 70,
  'ev/eeee1111/all.wev': 90,
  'ev/olderver/all.wev': 200,
};
const MODERA = {
  ver: 'cccc3333',
  years: [1816, 1816],
  lat: [45, -45],
  lon0: -180,
  dlon: 90,
  bytes: { mean: { '1816': 90 }, spread: { '1816': 60 }, annual: 400 },
};
const BORDERS = {
  ver: 'eeee5555',
  stems: ['1815'],
  years: [1815],
  files: {
    '1815': {
      key: 'fd/borders/eeee5555/1815.bin',
      bytes: 700,
      notice: 'lic/1111222233334444.txt',
      source: 'lic/5555666677778888.geojson',
    },
  },
};
const IMAGES = ['img/cccc3333cccc3333-1024.jpg', 'img/cccc3333cccc3333-256.jpg'];

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wander-publish-'));
  for (const [key, size] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, key)), { recursive: true });
    writeFileSync(join(root, key), Buffer.alloc(size));
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function release(avail: string, images = IMAGES): Release {
  const surface = { ver: 'aaaa1111', maxLevel: 1, qLand: [1, 1], c200: [0, 0], avail };
  const media = { images };
  return { id: '0', built: '', dataHost: '', surface: { ...surface, bounds: BOUNDS }, media };
}

/** R2 as a listing of the keys it holds, with their sizes. */
function holding(held: Record<string, number>): Pick<R2Bucket, 'list'> {
  const keys = Object.entries(held);
  return { list: (prefix) => Promise.resolve(new Map(keys.filter(([k]) => k.startsWith(prefix)))) };
}

describe('releaseSections', () => {
  test('names the event files once and verifies their sizes without publishing the source TSV', () => {
    const events = {
      ver: 'eeee1111',
      overview: 'ev/eeee1111/overview.wev',
      rows: 10,
      eraEdges: [],
      files: ['overview', 'all'].map((name, i) => ({
        key: `ev/eeee1111/${name}.wev`,
        t0: 0,
        t1: 10,
        rows: 5,
        bytes: i ? 90 : 70,
        decoded: 500,
        jsonBytes: 700,
      })),
    };
    const section = releaseSections({ ...release(SEVEN), events }, root).find((s) =>
      s.prefix.startsWith('ev/'),
    );
    expect(section?.objects.map((o) => o.key)).toEqual(events.files.map((f) => f.key));
    events.files[0]!.bytes++;
    expect(() => releaseSections({ ...release(SEVEN), events }, root)).toThrow(/70 B, not/);
  });
  const route = {
    key: 'fx/1111222233334444.json',
    kind: 'route' as const,
    epochDay: 554699,
    bbox: [-180, -54, 180, 37] as [number, number, number, number],
    bytes: 80,
  };
  const fx: FxRelease = { 'magellan/route': route, 'another/route': route };

  test('names only released effects, once each, leaving older fx assets behind', () => {
    const section = releaseSections({ ...release(SEVEN), fx }, root).find(
      (s) => s.prefix === 'fx/',
    );
    expect(section?.objects.map(({ key, size }) => [key, size])).toEqual([[route.key, 80]]);
  });

  test('refuses missing and wrong-sized effect files before publishing', () => {
    const wrongSize = { 'magellan/route': { ...route, bytes: 81 } };
    expect(() => releaseSections({ ...release(SEVEN), fx: wrongSize }, root)).toThrow(/80 B, not/);
    const missing = { 'magellan/route': { ...route, key: 'fx/missing.json' } };
    expect(() => releaseSections({ ...release(SEVEN), fx: missing }, root)).toThrow(/prebuild fx/);
  });

  test("names bounds.bin and every tile of the release's version, with their sizes", () => {
    const [surface] = releaseSections(release(SEVEN), root);
    const expected = Object.entries(FILES).filter(([key]) => key.startsWith('surf/aaaa1111/'));
    expect(surface?.prefix).toBe('surf/aaaa1111/');
    expect(surface?.objects.map(({ key, size }) => [key, size]).sort()).toEqual(expected.sort());
  });

  test('refuses a version folder with fewer tiles than the release makes available', () => {
    expect(() => releaseSections(release('/wAAAA=='), root)).toThrow(/7 tiles, not the 8/);
  });

  test('names every climate file the modera section lists, with their sizes', () => {
    const [, climate] = releaseSections({ ...release(SEVEN), modera: MODERA }, root);
    const expected = Object.entries(FILES).filter(([key]) => key.startsWith('fd/modera/'));
    expect(climate?.prefix).toBe('fd/modera/cccc3333/');
    expect(climate?.objects.map(({ key, size }) => [key, size]).sort()).toEqual(expected.sort());
  });

  test('refuses a climate file of another size than the modera section gives', () => {
    const modera = { ...MODERA, bytes: { ...MODERA.bytes, annual: 401 } };
    expect(() => releaseSections({ ...release(SEVEN), modera }, root)).toThrow(/400 B, not/);
  });

  test('names each border field, and its notice and source under lic/, with their sizes', () => {
    const [, fields, licenses] = releaseSections({ ...release(SEVEN), borders: BORDERS }, root);
    expect(fields?.prefix).toBe('fd/borders/eeee5555/');
    expect(fields?.objects.map(({ key, size }) => [key, size])).toEqual([
      ['fd/borders/eeee5555/1815.bin', 700],
    ]);
    expect(licenses?.prefix).toBe('lic/');
    expect(licenses?.objects.map(({ key, size }) => [key, size])).toEqual([
      ['lic/1111222233334444.txt', 20],
      ['lic/5555666677778888.geojson', 900],
    ]);
  });

  test("names the stories' images under img/, with their sizes", () => {
    const [, media] = releaseSections(release(SEVEN), root);
    expect(media?.prefix).toBe('img/');
    expect(media?.objects.map(({ key, size }) => [key, size])).toEqual([
      [IMAGES[0], 400],
      [IMAGES[1], 40],
    ]);
  });

  test('refuses an image the build lacks, naming the media stage', () => {
    const images = [...IMAGES, 'img/dddd4444dddd4444-256.jpg'];
    expect(() => releaseSections(release(SEVEN, images), root)).toThrow(/prebuild media --story/);
  });
});

describe('plan', () => {
  test('leaves out the keys R2 already holds at their size', async () => {
    const sections = releaseSections(release(SEVEN), root);
    const [surface] = await plan(holding({ [BOUNDS]: 12 }), sections);
    const others = surface?.objects.map(({ key }) => key).filter((key) => key !== BOUNDS);
    expect(surface?.missing.map(({ key }) => key)).toEqual(others);
  });

  test('stops on a key R2 holds at another size, before anything is uploaded', async () => {
    const sections = releaseSections(release(SEVEN), root);
    await expect(plan(holding({ [BOUNDS]: 13 }), sections)).rejects.toThrow(/13 B, not 12 B/);
  });
});

describe('noticeTag', () => {
  const withBorders = { ...release(SEVEN), borders: BORDERS };
  const missing = async (held: Record<string, number>) =>
    (await plan(holding(held), releaseSections(withBorders, root))).flatMap((p) => p.missing);

  test("names the tag the borders' notice links while R2 lacks the notice", async () => {
    expect(noticeTag(withBorders, await missing({}))).toBe('borders-eeee5555');
  });

  test('names none once R2 holds the notice', async () => {
    const held = { 'lic/1111222233334444.txt': 20 };
    expect(noticeTag(withBorders, await missing(held))).toBeNull();
  });
});
