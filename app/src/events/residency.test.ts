import { expect, test } from 'vitest';
import { EventIndex, INDEX_BYTES } from './residency';
import { pageOf, releaseOf } from '../test/events';

const MiB = 1024 ** 2;
function paged() {
  const overview = pageOf([{ row: 0 }]);
  const release = releaseOf([overview]);
  release.files[0]!.decoded = MiB;
  release.files.push({
    key: 'ev/test/long.wev',
    t0: -100,
    t1: 1000,
    rows: 1,
    bytes: 1,
    jsonBytes: 1,
    decoded: MiB,
  });
  release.files.push(
    ...Array.from({ length: 24 }, (_, bin) => ({
      key: `ev/test/p${bin.toString().padStart(2, '0')}.wev`,
      bin,
      t0: bin * 10,
      t1: bin * 10 + 9,
      rows: 1,
      bytes: 1,
      jsonBytes: 1,
      decoded: 3 * MiB,
    })),
  );
  const index = new EventIndex(release);
  const fill = () => {
    for (const key of index.status().needs) {
      const file = release.files.find((f) => f.key === key)!;
      // Planner test costs; decodePage independently checks real arrays against file.decoded.
      index.add(key, { ...overview, bytes: file.decoded });
    }
  };
  return { index, release, fill };
}

test('a corpus that fits stays resident across time windows and tiers', () => {
  const p = pageOf([{ row: 0 }]);
  const index = new EventIndex(releaseOf([p, p]));
  const plan = index.plan({ t0: 0, t1: 5, tier: 'lite' });
  for (const key of plan.needs) index.add(key, p);
  expect(index.plan({ t0: 200, t1: 210, tier: 'full' }).resident).toHaveLength(2);
  expect(index.status().complete).toBe(true);
});

test('large corpora keep overview, long rows, the window ±1 bin, and prefetch in scrub direction', () => {
  const { index, fill } = paged();
  expect(index.plan().needs).toEqual(['ev/test/overview.wev']);
  index.plan({ t0: 35, t1: 35, tier: 'lite' });
  fill();
  expect(index.status().resident.sort()).toEqual(
    [
      'ev/test/overview.wev',
      'ev/test/long.wev',
      'ev/test/p02.wev',
      'ev/test/p03.wev',
      'ev/test/p04.wev',
    ].sort(),
  );
  const later = index.plan({ t0: 45, t1: 45, tier: 'lite' });
  expect(later.needs).toContain('ev/test/p05.wev');
  expect(later.needs).toContain('ev/test/p06.wev');
  fill();
  expect(index.bytes).toBeLessThanOrEqual(INDEX_BYTES.lite);
  expect(index.pages.has('ev/test/p02.wev')).toBe(false);
  const backward = index.plan({ t0: 35, t1: 35, tier: 'lite' });
  expect(backward.needs).toContain('ev/test/p01.wev');
  fill();
  expect(index.bytes).toBeLessThanOrEqual(INDEX_BYTES.lite);
});

test('LRU evicts stale pages, and a late load cannot resurrect a superseded page', () => {
  const { index, fill } = paged();
  index.plan({ t0: 35, t1: 35, tier: 'lite' });
  fill();
  index.plan({ t0: 85, t1: 85, tier: 'lite' });
  fill();
  expect(index.pages.has('ev/test/p03.wev')).toBe(false);
  expect(index.add('ev/test/p02.wev', pageOf([{ row: 4 }]))).toBe(false);
  expect(index.status().complete).toBe(true);
});

test('a too-large working set reports capacity instead of silently dropping rows', () => {
  const { index } = paged();
  const plan = index.plan({ t0: 0, t1: 240, tier: 'lite' });
  expect(plan.error).toMatch(/index cap/);
  expect(plan.complete).toBe(false);
  expect(plan.needs).toEqual(['ev/test/overview.wev']);
});
