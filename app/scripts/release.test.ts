// The release's surface section (streaming.md 3.8) from the coverage and surface records (7.2),
// and its media section from the stories' locks (3.9), which the bundled release must match.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import bundled from '../src/generated/release.json';
import { localRelease, mediaRelease, surfaceRelease } from './release';

test('the release carries the fx record unchanged, and its bytes change the release id', () => {
  const stages = mkdtempSync(join(tmpdir(), 'wander-fx-release-'));
  const fx = {
    'magellan/route': {
      key: 'fx/1234567890abcdef.json',
      kind: 'route',
      epochDay: 554699,
      bbox: [-180, -54, 180, 37],
      bytes: 240,
    },
  };
  try {
    writeFileSync(join(stages, 'coverage.json'), JSON.stringify(coverage));
    writeFileSync(join(stages, 'surface.json'), JSON.stringify(surface));
    const before = localRelease(stages, 'https://data.example');
    expect(before.fx).toBeUndefined();
    writeFileSync(join(stages, 'fx.json'), JSON.stringify(fx));
    const release = localRelease(stages, 'https://data.example');
    expect(release.fx).toEqual(fx);
    expect(release.id).not.toBe(before.id);
    expect(localRelease(stages, 'https://data.example').id).toBe(release.id);
  } finally {
    rmSync(stages, { recursive: true, force: true });
  }
});

const coverage = { qLand: [39.09375, 2], c200: [-5, -100], avail: 'Pw==' };
const surface = { ver: '4359ef83', maxLevel: 1, avail: 'Pw==', bounds: 'surf/4359ef83/bounds.bin' };

describe('surfaceRelease', () => {
  test('takes the layer from the surface record and the code scale from coverage', () => {
    expect(surfaceRelease(coverage, surface)).toEqual({
      ver: '4359ef83',
      maxLevel: 1,
      qLand: [39.09375, 2],
      c200: [-5, -100],
      avail: 'Pw==',
      bounds: 'surf/4359ef83/bounds.bin',
    });
  });

  test('refuses records built from different coverage', () => {
    expect(() => surfaceRelease(coverage, { ...surface, avail: 'Pg==' })).toThrow(
      /another coverage record/,
    );
  });

  test('refuses a code scale without one entry per level', () => {
    expect(() => surfaceRelease({ ...coverage, qLand: [39.09375] }, surface)).toThrow(
      /one entry per level 0-1/,
    );
  });
});

describe('mediaRelease', () => {
  test("lists every locked image's files once, sorted, and skips a story with no lock", () => {
    const stories = mkdtempSync(join(tmpdir(), 'wander-stories-'));
    const file = (key: string) => ({ key, w: 1, h: 1, bytes: 1 });
    const locks: Record<string, string[][]> = {
      one: [
        ['img/bb-1024.jpg', 'img/bb-256.jpg'],
        ['img/aa-1024.jpg', 'img/aa-256.jpg'],
      ],
      two: [['img/bb-1024.jpg', 'img/bb-256.jpg']],
    };
    for (const [story, images] of Object.entries(locks)) {
      mkdirSync(join(stories, story));
      const lock = { images: images.map((keys) => ({ files: keys.map(file) })) };
      writeFileSync(join(stories, story, 'story.lock.json'), JSON.stringify(lock));
    }
    mkdirSync(join(stories, 'unbaked'));
    try {
      expect(mediaRelease(stories).images).toEqual([
        'img/aa-1024.jpg',
        'img/aa-256.jpg',
        'img/bb-1024.jpg',
        'img/bb-256.jpg',
      ]);
    } finally {
      rmSync(stories, { recursive: true, force: true });
    }
  });

  // The card finds its images through the bundled locks and CI checks the bundled release, so a
  // lock rebaked without a publish would ship a card asking for keys R2 lacks.
  test('the bundled release names every key the committed locks do', () => {
    expect(bundled.media, 'run `npm run publish-data` and commit its release').toEqual(
      mediaRelease(),
    );
  });
});
