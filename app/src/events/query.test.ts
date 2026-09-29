import { describe, expect, test } from 'vitest';
import { Matrix4, PerspectiveCamera } from 'three';
import type { EventsRelease } from '../data/release';
import { dayFromIso } from '../story/dates';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { lonLatToDir, toThree } from '../surface/cube';
import { decodePage } from './page';
import {
  EventQueryEngine,
  fadeOpacity,
  type EventQuery,
  type Fading,
  type EventMark,
} from './query';
import { EventIndex } from './residency';
import { indexOf, pageOf, viewOf } from './testSupport';
import { extentPixels, project } from './view';

const active = (marks: Fading<EventMark>[]) => marks.filter((m) => m.fade.to === 1);
const base: EventQuery = { t0: 1, t1: 10, tier: 'lite', view: viewOf() };

describe('the detail budget', () => {
  test.each(['lite', 'full'] as const)(
    '%s has its marker and label limits, and two per cell',
    (tier) => {
      const rows = Array.from({ length: 360 }, (_, row) => ({
        row,
        lon: -60 + (row % 24) * 5,
        lat: -35 + Math.floor(row / 24) * 5,
      }));
      const engine = new EventQueryEngine(indexOf([pageOf(rows)]));
      const result = engine.query({ ...base, tier, view: viewOf(2.2, 0, 0, 4000, 2500) }, 0);
      expect(result.markers).toHaveLength(tier === 'lite' ? 80 : 140);
      expect(result.labels).toHaveLength(tier === 'lite' ? 24 : 40);
      const cells = new Map<string, number>();
      for (const m of result.markers) {
        const cell = `${Math.floor(m.x / 64)},${Math.floor(m.y / 64)}`;
        cells.set(cell, (cells.get(cell) ?? 0) + 1);
      }
      expect(Math.max(...cells.values())).toBeLessThanOrEqual(2);
    },
  );
  test('labels share two slots per cell, including a split parent context', () => {
    const engine = new EventQueryEngine(
      indexOf([
        pageOf([
          { row: 0, ext: [-20, -5, 20, 5] },
          { row: 1, parent: 0 },
          { row: 2, parent: 0 },
        ]),
      ]),
    );
    const result = engine.query(base, 0);
    expect(active(result.markers).map((m) => m.row)).toEqual([1, 2]);
    expect(active(result.labels).map((m) => m.row)).toEqual([0, 1]);
    expect(result.labels[0]?.context).toBe(true);
  });
  test('inclusive spans, horizon, viewport and focal exemption are independent', () => {
    const engine = new EventQueryEngine(
      indexOf([
        pageOf([
          { row: 0, lon: 180 },
          { row: 1, lon: 70 },
          { row: 2, t0: 10 },
          { row: 3, t0: 11, t1: 12 },
          { row: 4, t0: -50, t1: -40 },
          { row: 5, t0: -50, t1: -40 },
          { row: 6, t0: -50, t1: -40 },
        ]),
      ]),
    );
    const result = engine.query({ ...base, view: viewOf(0.5), focalQids: [5, 6, 7, 999] }, 0);
    expect(result.markers.map((m) => m.row)).toEqual([2, 4, 5, 6]);
    expect(result.labels).toHaveLength(4);
    expect(result.missingFocal).toEqual([999]);
    expect(project(base.view, 180, 0)).toBeUndefined();
  });
  test.each([19, 20])('a newcomer needs a full 20-point margin (%i)', (margin) => {
    const engine = new EventQueryEngine(
      indexOf([
        pageOf([
          { row: 0, score: 1000 },
          { row: 1, score: 700 + margin, t0: 2 },
          { row: 2, score: 700 },
        ]),
      ]),
    );
    expect(active(engine.query({ ...base, t1: 1 }, 0).markers).map((m) => m.row)).toEqual([0, 2]);
    const next = engine.query(base, 400);
    expect(active(next.markers).map((m) => m.row)).toEqual(margin < 20 ? [0, 2] : [0, 1]);
    expect(active(next.labels).map((m) => m.row)).toEqual(margin < 20 ? [0, 2] : [0, 1]);
  });
  test('fades are reversible in presentation time and expired exits release their state', () => {
    const engine = new EventQueryEngine(indexOf([pageOf([{ row: 0 }])]));
    const first = engine.query(base, 0).markers[0]!;
    expect(first.fade.phase).toBe('in');
    expect(fadeOpacity(first.fade, 150)).toBe(0.5);
    const out = engine.query({ ...base, t0: 20, t1: 30 }, 150).markers[0]!;
    expect(out.fade.phase).toBe('out');
    const reversed = engine.query(base, 300).markers[0]!;
    expect(reversed.fade.from).toBe(0.25);
    expect(engine.query(base, 600).markers[0]!.fade.phase).toBe('steady');
    engine.query({ ...base, t0: 20, t1: 30 }, 700);
    expect(engine.query({ ...base, t0: 20, t1: 30 }, 1000).markers).toEqual([]);
  });
});

test('a family splits above 150px and returns below 120px, with parent context and labels', () => {
  const extent: [number, number, number, number] = [-10, -2, 10, 2];
  const engine = new EventQueryEngine(
    indexOf([
      pageOf([
        { row: 0, ext: extent },
        { row: 1, lon: -8, parent: 0 },
        { row: 2, lon: 8, parent: 0 },
      ]),
    ]),
  );
  const at = (px: number, now: number) => {
    const view = viewOf(1);
    const span = extentPixels(view, extent) / px;
    return engine.query({ ...base, view: viewOf(span) }, now);
  };
  expect(active(at(140, 0).markers).map((m) => m.row)).toEqual([0]);
  const split = at(151, 400);
  expect(active(split.markers).map((m) => m.row)).toEqual([1, 2]);
  expect(split.outlines[0]?.row).toBe(0);
  expect(active(split.labels).some((l) => l.row === 0 && l.context)).toBe(true);
  expect(active(at(130, 800).markers).map((m) => m.row)).toEqual([1, 2]);
  expect(active(at(119, 1200).markers).map((m) => m.row)).toEqual([0]);
});

test('an absent parent never suppresses a resident child; overlapping pages yield one marker', () => {
  const a = pageOf([{ row: 1, parent: 0 }]);
  const engine = new EventQueryEngine(indexOf([a, a]));
  expect(engine.query(base, 0).markers.map((m) => m.row)).toEqual([1]);
});

test('three nesting levels reveal each generation and retain every expanded ancestor', () => {
  const engine = new EventQueryEngine(
    indexOf([
      pageOf([
        { row: 0, qid: 78994, label: 'Napoleonic Wars', ext: [-20, -10, 20, 10] },
        { row: 1, qid: 199955, label: 'Hundred Days', parent: 0, ext: [-5, -2, 5, 2] },
        { row: 2, qid: 18643473, label: 'Waterloo campaign', parent: 1, ext: [-1, -0.5, 1, 0.5] },
        { row: 3, qid: 48314, label: 'Battle of Waterloo', parent: 2 },
      ]),
    ]),
  );
  for (const [step, span] of [8, 2, 0.5, 0.1, 0.5, 2.2, 9].entries()) {
    const level = step <= 3 ? step : 6 - step;
    const result = engine.query({ ...base, view: viewOf(span) }, step * 400);
    expect(active(result.markers).map((m) => m.row)).toEqual([level]);
    expect(
      active(result.outlines)
        .map((m) => m.row)
        .sort(),
    ).toEqual(Array.from({ length: level }, (_, i) => i));
  }
});

test('a collapsed parent beyond the horizon never hides its visible child at the limb', () => {
  const engine = new EventQueryEngine(
    indexOf([
      pageOf([
        { row: 0, ext: [0, 0, 11, 0] },
        { row: 1, lon: 11, parent: 0 },
      ]),
    ]),
  );
  expect(
    active(engine.query({ ...base, view: viewOf(2.2, 90) }, 0).markers).map((m) => m.row),
  ).toEqual([1]);
});

test('an island-scale view within a large parent extent still reveals the child', () => {
  const camera = new PerspectiveCamera(40, 1440 / 900, 0.00001, 10);
  camera.position.fromArray(toThree(lonLatToDir(7, 3))).multiplyScalar(1.001);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const view = {
    matrix: new Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .toArray(),
    camera: camera.position.toArray(),
    width: 1440,
    height: 900,
  };
  const engine = new EventQueryEngine(
    indexOf([
      pageOf([
        { row: 0, ext: [-60, -30, 60, 30] },
        { row: 1, lon: 7, lat: 3, parent: 0 },
      ]),
    ]),
  );
  const result = engine.query({ ...base, view }, 0);
  expect(active(result.markers).map((m) => m.row)).toEqual([1]);
  expect(result.outlines[0]?.anchorVisible).toBe(false);
});

test('exiting marks follow the camera and disappear behind the horizon during a fade', () => {
  const engine = new EventQueryEngine(indexOf([pageOf([{ row: 0 }])]));
  const first = engine.query(base, 0);
  const next = engine.query({ ...base, view: viewOf(2.2, 180) }, 200);
  expect(next.markers[0]?.fade.phase).toBe('out');
  expect(next.markers[0]?.anchorVisible).toBe(false);
  expect(first.markers[0]?.fade.phase).toBe('in'); // prior results are value snapshots
});

test('the real fixture can be queried at Waterloo with both budgets, without a worker', async () => {
  const release = readStageRecord<EventsRelease>('event-files');
  const index = new EventIndex(release);
  index.plan();
  for (const f of release.files)
    index.add(f.key, await decodePage(readFixtureFile(f.key).buffer, f));
  const engine = new EventQueryEngine(index);
  const day = dayFromIso('1815-06-18');
  for (const tier of ['lite', 'full'] as const) {
    const result = engine.query(
      { t0: day, t1: day, tier, view: viewOf(0.02, 4.41222, 50.67806) },
      0,
    );
    expect(result.markers.some((m) => m.qid === 48314 && !m.focal)).toBe(true);
    expect(result.labels.some((m) => m.text === 'Battle of Waterloo')).toBe(true);
    expect(
      active(result.outlines)
        .map((m) => m.qid)
        .sort(),
    ).toEqual([78994, 199955, 18643473].sort());
    expect(result.markers.length).toBeLessThanOrEqual(tier === 'lite' ? 80 : 140);
  }
});
