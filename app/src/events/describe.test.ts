import { expect, test } from 'vitest';
import type { EventsRelease } from '../data/release';
import { dayFromIso } from '../story/dates';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { indexOf, pageOf } from '../test/events';
import { describe } from './describe';
import { decodePage } from './page';
import { EventIndex } from './residency';

test('a row gives its label, its parent label and its dates', () => {
  const index = indexOf([
    pageOf([
      { row: 0, qid: 78994, label: 'Napoleonic Wars', t0: 1, t1: 400 },
      { row: 3, qid: 48314, label: 'Battle of Waterloo', parent: 0, t0: 7, t1: 7 },
    ]),
  ]);
  expect(describe(index, 3)).toEqual({
    row: 3,
    qid: 48314,
    label: 'Battle of Waterloo',
    parent: 'Napoleonic Wars',
    t0: 7,
    t1: 7,
    prec: 11,
  });
  expect(describe(index, 0)).not.toHaveProperty('parent');
  expect(describe(index, 0)).not.toHaveProperty('partial');
});

test('a parent no resident page holds leaves the child partial; an absent row is undefined', () => {
  const index = indexOf([pageOf([{ row: 5, parent: 2 }])]);
  expect(describe(index, 5)).not.toHaveProperty('parent');
  expect(describe(index, 5)).toHaveProperty('partial', true);
  expect(describe(index, 2)).toBeUndefined();
});

test('the fixture describes Waterloo within its campaign', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const index = new EventIndex(release);
  index.plan();
  for (const f of release.files)
    index.add(f.key, await decodePage(readFixtureFile(f.key).buffer, f));
  const waterloo = index.qid(48314)!;
  expect(describe(index, waterloo.page.row[waterloo.i]!)).toMatchObject({
    qid: 48314,
    label: 'Battle of Waterloo',
    parent: 'Waterloo Campaign',
    t0: dayFromIso('1815-06-18'),
    t1: dayFromIso('1815-06-18'),
    prec: 11,
  });
});
