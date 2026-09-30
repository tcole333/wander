// The release's surface section (streaming.md 3.8) from the coverage and surface records (7.2),
// its events section from the event-files record, which must hold the committed openings (3.4),
// and its media section from the stories' locks (3.9), which the bundled release must match.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import bundled from '../src/generated/release.json';
import type { EventsRelease } from '../src/data/release';
import { readStageRecord } from '../src/test/fixture';
import {
  eventsRelease,
  historyOwed,
  localRelease,
  mediaRelease,
  snapshotRelease,
  surfaceRelease,
} from './release';

test('the event-files record, less its inputs, becomes the release events section', () => {
  const stages = mkdtempSync(join(tmpdir(), 'wander-events-release-'));
  const record = readStageRecord<EventsRelease & { inputs: unknown }>('event-files');
  try {
    writeFileSync(join(stages, 'coverage.json'), JSON.stringify(coverage));
    writeFileSync(join(stages, 'surface.json'), JSON.stringify(surface));
    const before = localRelease(stages, 'https://data.example');
    writeFileSync(join(stages, 'event-files.json'), JSON.stringify(record));
    const release = localRelease(stages, 'https://data.example');
    expect(release.events).toEqual({ ...record, inputs: undefined });
    expect(release.events).not.toHaveProperty('inputs');
    expect(release.id).not.toBe(before.id);
    expect(localRelease(stages, 'https://data.example').id).toBe(release.id);
  } finally {
    rmSync(stages, { recursive: true, force: true });
  }
});

describe('the events section', () => {
  const record = { ver: '65f8a73a', overview: 'ev/65f8a73a/overview.wev', rows: 1, eraEdges: [] };
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

  /** A lock of `text` in a folder of its own, and stage records under `<folder>/global`. */
  function build(text: string): { lock: string; stages: string; done: () => void } {
    const folder = mkdtempSync(join(tmpdir(), 'wander-openings-'));
    const lock = join(folder, 'openings.lock.json');
    const stages = join(folder, 'global');
    writeFileSync(lock, text);
    mkdirSync(stages);
    writeFileSync(join(stages, 'coverage.json'), JSON.stringify(coverage));
    writeFileSync(join(stages, 'surface.json'), JSON.stringify(surface));
    return { lock, stages, done: () => rmSync(folder, { recursive: true, force: true }) };
  }

  test('is refused, naming the stage, when the overview holds another openings lock', () => {
    const { lock, stages, done } = build('{"openings": ["Q48314"]}');
    try {
      const stale = { ...record, files: [], inputs: { openings: sha256('{"openings": []}') } };
      expect(() => eventsRelease(stale, stages, lock)).toThrow(
        'run `uv run prebuild --profile global event-files` in pipeline/',
      );
    } finally {
      done();
    }
  });

  test('is refused when the record names no openings lock', () => {
    const { lock, stages, done } = build('{"openings": ["Q48314"]}');
    try {
      expect(() => eventsRelease({ ...record, files: [] }, stages, lock)).toThrow(
        /another explore\/openings.lock.json/,
      );
    } finally {
      done();
    }
  });

  // A line edited in the lock changes no .wev byte, so no key and no release.
  test('keeps the release id when only the openings lock changed', () => {
    const { lock, stages, done } = build('{"line": "one"}');
    try {
      const ids = ['{"line": "one"}', '{"line": "two"}'].map((text) => {
        writeFileSync(lock, text);
        const current = { ...record, files: [], inputs: { openings: sha256(text) } };
        writeFileSync(join(stages, 'event-files.json'), JSON.stringify(current));
        return localRelease(stages, 'https://data.example', lock).id;
      });
      expect(ids[1]).toBe(ids[0]);
    } finally {
      done();
    }
  });
});

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

describe('the borders record', () => {
  const steps = {
    ver: '83a2d0b1',
    size: 1024,
    apron: 4,
    years: [1815, 1830],
    keys: ['fd/borders/s/9fd988832a6537c0.bin', 'fd/borders/s/1e38b63efeefa830.bin'],
    bytes: [874934, 929092],
    previews: { per: 16, keys: ['fd/borders/p/57c487dbf7e52a78.bin'], bytes: [62439] },
    polities: 'fd/borders/m/54214a9f67b739f7.json',
    notice: 'lic/b3239215fd491ae4.txt',
  };
  const snapshot = {
    ver: 'f75bdb69',
    stems: ['1815'],
    years: [1815],
    files: {
      '1815': {
        key: 'fd/borders/f75bdb69/1815.bin',
        bytes: 1267355,
        notice: 'lic/62c9984143cffea2.txt',
        source: 'lic/1d7cceb7ee875ed1.geojson',
      },
    },
  };
  const owed = {
    unacknowledged: [
      { polities: ['British Cape Colony', 'Napoleonic Batavia Republic'], steps: [1815] },
    ],
    unclassified: { composites: ['(Mughal Empire)'], relations: [] },
  };

  function released(record: object, options?: { borderSteps?: boolean }) {
    const stages = mkdtempSync(join(tmpdir(), 'wander-borders-release-'));
    try {
      writeFileSync(join(stages, 'coverage.json'), JSON.stringify(coverage));
      writeFileSync(join(stages, 'surface.json'), JSON.stringify(surface));
      writeFileSync(join(stages, 'borders.json'), JSON.stringify(record));
      return localRelease(stages, 'https://data.example', undefined, options);
    } finally {
      rmSync(stages, { recursive: true, force: true });
    }
  }

  test('gives the borderSteps section as its steps and the borders section as the 1815 field', () => {
    const release = released({ steps, beats: {}, ...owed, inputs: { code: 'x' }, ...snapshot });
    expect(release.borderSteps).toEqual(steps);
    expect(release.borders).toEqual(snapshot);
  });

  test('leaves the steps out when asked, as publish-data does until their first publish', () => {
    const held = released({ steps, beats: {}, ...snapshot }, { borderSteps: false });
    expect(held.borderSteps).toBeUndefined();
    expect(held.borders).toEqual(snapshot);
    expect(held.id).not.toBe(released({ steps, beats: {}, ...snapshot }).id);
  });

  test('leaves out the section a profile does not bake', () => {
    expect(released({ steps, beats: {}, ...owed }).borders).toBeUndefined();
    expect(released(snapshot).borderSteps).toBeUndefined();
  });

  test('owes the history pass each unacknowledged pair and each unclassified entry', () => {
    expect(historyOwed(owed)).toEqual([
      'overlap of British Cape Colony and Napoleonic Batavia Republic (1815)',
      'unclassified (Mughal Empire)',
    ]);
    expect(
      historyOwed({ unacknowledged: [], unclassified: { composites: [], relations: [] } }),
    ).toEqual([]);
    expect(snapshotRelease({ steps })).toBeUndefined();
  });
});
