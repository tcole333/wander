import { expect, test } from 'vitest';
import { tunables } from '../config/tunables';
import type { EventsRelease } from '../data/release';
import { dayFromIso } from '../story/dates';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { indexOf, pageOf, viewOf } from '../test/events';
import { decodePage } from './page';
import { meanwhileEvents, type MeanwhileQuery } from './meanwhile';
import { EventIndex } from './residency';

const EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;
function km([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const cos =
    Math.sin(lat1 * DEG) * Math.sin(lat2 * DEG) +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * EARTH_KM;
}
// Rows are in score order. At the equator 30° of longitude is 3,336 km. viewOf(span) looks
// straight down on the unit globe, `span` radii across a 1440x900 viewport: 0.2 shows ±6°.
const base: MeanwhileQuery = {
  t0: 1,
  t1: 10,
  center: [0, 0],
  view: viewOf(0.2),
  count: 3,
  exclude: [],
};
const rows = (query: Partial<MeanwhileQuery>, index = spread()) =>
  meanwhileEvents(index, { ...base, ...query }).map((e) => e.row);
function spread() {
  return indexOf([
    pageOf([
      { row: 0, lon: 0, lat: 0 },
      { row: 1, lon: 30, lat: 0 },
      { row: 2, lon: 31, lat: 0 },
      { row: 3, lon: -40, lat: 0, t0: 50, t1: 60 },
      { row: 4, lon: -40, lat: 0 },
      { row: 5, lon: 0, lat: 60 },
      { row: 6, lon: 90, lat: 0 },
    ]),
  ]);
}

test('picks the best-scored events in the now window, away from the view and each other', () => {
  expect(rows({})).toEqual([1, 4, 5]);
});

test('what the screen shows stays out, however far from the center', () => {
  // 1.2 radii across shows 37° of longitude either side of the center and 22° of latitude.
  expect(rows({ view: viewOf(1.2) })).toEqual([4, 5, 6]);
});

test("what lies past the viewport's edges or the limb is elsewhere, however near", () => {
  const index = indexOf([
    pageOf([
      { row: 0, lon: 25, lat: 0 },
      { row: 1, lon: 0, lat: 25 },
      { row: 2, lon: 100, lat: 0 },
    ]),
  ]);
  expect(rows({ view: viewOf(1.2) }, index)).toEqual([1, 2]);
});

test('at world view, Meanwhile names what happens on the far side of the globe', () => {
  const index = indexOf([
    pageOf([
      { row: 0, lon: 60, lat: 0 },
      { row: 1, lon: -80, lat: 30 },
      { row: 2, lon: 180, lat: 0 },
      { row: 3, lon: -120, lat: 10 },
      { row: 4, lon: 110, lat: -40 },
    ]),
  ]);
  expect(rows({ view: viewOf(2.2) }, index)).toEqual([2, 3, 4]);
});

test('an excluded event, drawn on the globe, leaves room for the next', () => {
  expect(rows({ exclude: [2] })).toEqual([2, 4, 5]);
});

test('an event longer than the window and 92 days stays out of it', () => {
  const index = indexOf([
    pageOf([
      { row: 0, lon: 30, t0: 1, t1: 200 },
      { row: 1, lon: -60 },
    ]),
  ]);
  expect(rows({}, index)).toEqual([1]);
  expect(rows({ t0: 1, t1: 91 }, index)).toEqual([1]);
  expect(rows({ t0: 1, t1: 250 }, index)).toEqual([0, 1]);
});

test('a parent never stands with its child, whichever scores higher', () => {
  const warFirst = indexOf([
    pageOf([
      { row: 0, lon: 30 },
      { row: 1, lon: 60, parent: 0 },
      { row: 2, lon: -60 },
    ]),
  ]);
  expect(rows({}, warFirst)).toEqual([0, 2]);
  const battleFirst = indexOf([
    pageOf([
      { row: 0, lon: 60, parent: 1 },
      { row: 1, lon: 30 },
      { row: 2, lon: -60 },
    ]),
  ]);
  expect(rows({}, battleFirst)).toEqual([0, 2]);
});

test('entries describe themselves: label, parent, dates and place', () => {
  const index = indexOf([
    pageOf([
      { row: 0, qid: 78994, label: 'Napoleonic Wars', lon: 30 },
      { row: 1, qid: 26013, label: 'War of 1812', lon: -60, lat: 40, t0: 2, t1: 9 },
    ]),
  ]);
  const [, entry] = meanwhileEvents(index, base);
  expect(entry).toEqual({
    row: 1,
    qid: 26013,
    label: 'War of 1812',
    t0: 2,
    t1: 9,
    prec: 11,
    at: [-60, 40],
    cls: 0,
    flags: 0,
    score: 999,
  });
});

test('no count asks for nothing, and a malformed question throws', () => {
  expect(rows({ count: 0 })).toEqual([]);
  for (const bad of [
    { t0: 10, t1: 1 },
    { center: [0, 91] as [number, number] },
    { center: [Number.NaN, 0] as [number, number] },
    { count: 1.5 },
    { exclude: [0.5] },
  ])
    expect(() => meanwhileEvents(spread(), { ...base, ...bad })).toThrow('invalid meanwhile');
  const flat = { ...base, view: { ...base.view, width: 0 } };
  expect(() => meanwhileEvents(spread(), flat)).toThrow('invalid event view');
});

test('the fixture at Waterloo finds short events of June 1815, far from Belgium', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const index = new EventIndex(release);
  index.plan();
  for (const f of release.files)
    index.add(f.key, await decodePage(readFixtureFile(f.key).buffer, f));
  const day = dayFromIso('1815-06-18');
  const window = (365.2425 * 0.1) / 2;
  const query: MeanwhileQuery = {
    t0: day - window,
    t1: day + window,
    center: [4.41222, 50.67806],
    view: viewOf(3000 / 6371, 4.41222, 50.67806),
    count: tunables.meanwhileCount,
    exclude: [48314],
  };
  const picks = meanwhileEvents(index, query);
  // The fixture holds 1815-1817 around Europe: two such events of June 1815 lie 2,000 km away.
  expect(picks.length).toBeGreaterThan(0);
  expect(picks.length).toBeLessThanOrEqual(tunables.meanwhileCount);
  for (const [n, pick] of picks.entries()) {
    expect(pick.t0 <= query.t1 && pick.t1 >= query.t0).toBe(true);
    expect(pick.t1 - pick.t0 + 1).toBeLessThanOrEqual(92);
    expect(km(pick.at, query.center)).toBeGreaterThanOrEqual(tunables.meanwhileMinKm);
    for (const other of picks.slice(0, n))
      expect(km(pick.at, other.at)).toBeGreaterThanOrEqual(tunables.meanwhileMinKm);
  }
  expect(picks.map((p) => p.score)).toEqual(picks.map((p) => p.score).sort((a, b) => b - a));
});
