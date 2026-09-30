// Explore's Meanwhile: the question it stands, and the worker's picks as the panel lists them.
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import type { MeanwhileEvent, MeanwhileQuery } from '../events/meanwhile';
import { FrameContext } from '../scene/frameContext';
import { dayFromHistorical } from '../story/dates';
import { byClass, fake, stubDocument, type FakeElement } from '../test/fakeDom';
import { lonLatToDir, toThree } from '../surface/cube';
import type { FocalEvent } from './exploreEvents';
import { entryOf, ExploreMeanwhile, type MeanwhileEvents } from './exploreMeanwhile';

const LIGNY = dayFromHistorical({ year: 1815, month: 6, day: 16 });

function picked(qid: number, label: string, at: [number, number], t0 = LIGNY): MeanwhileEvent {
  return { row: qid, qid, label, t0, t1: t0, prec: 11, at, cls: 0, flags: 0, score: 900 };
}

function fakeEvents() {
  const events = {
    asked: [] as MeanwhileQuery[],
    meanwhile: null as readonly MeanwhileEvent[] | null,
    focal: { qid: 48314 } as FocalEvent | null,
    askMeanwhile(query: MeanwhileQuery) {
      events.asked.push(query);
    },
    drawnQids: () => [48314, 7],
  } satisfies MeanwhileEvents & Record<string, unknown>;
  return events;
}

function frameOver(lon: number, lat: number): FrameContext {
  const scene = new Scene();
  const globe = new Group();
  scene.add(globe);
  const cam = new PerspectiveCamera(30, 1440 / 900, 0.01, 100);
  cam.position.copy(new Vector3(...toThree(lonLatToDir(lon, lat)))).multiplyScalar(10);
  cam.lookAt(0, 0, 0);
  scene.add(cam);
  scene.updateMatrixWorld(true);
  const frame = new FrameContext();
  frame.place(cam, globe, { width: 1440, height: 900 });
  return frame;
}

const VIEW = { lon: 4.4, lat: 50.7, viewKm: 30000, tilt: 0, heading: 0 };
const rows = (element: FakeElement) =>
  (byClass(element, 'wu-mw-list').children as FakeElement[]).map((item) =>
    byClass(item, 'wu-mw-entry'),
  );

beforeEach(() => {
  stubDocument();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('Explore’s Meanwhile', () => {
  it('asks for the now window around the view, leaving out what the globe draws', () => {
    const events = fakeEvents();
    const meanwhile = new ExploreMeanwhile(events, () => {});
    meanwhile.ask(frameOver(4.4, 50.7), { day: LIGNY, spanDays: 3650 }, [4.4, 50.7]);
    expect(events.asked[0]).toMatchObject({
      t0: LIGNY - 182.5,
      t1: LIGNY + 182.5,
      center: [4.4, 50.7],
      count: tunables.meanwhileCount,
      exclude: [48314, 7],
      focalQids: [48314],
    });
    expect(events.asked[0]!.view.width).toBe(1440);
  });

  it('lists the worker’s picks as history writes them, sourced, hidden before the first', () => {
    const events = fakeEvents();
    const meanwhile = new ExploreMeanwhile(events, () => {});
    const element = fake(meanwhile.element);
    const now = { day: LIGNY, spanDays: 3650 };
    meanwhile.update(VIEW, now);
    expect(element.hidden).toBe(true);
    events.meanwhile = [
      picked(1, 'Tambora (1815)', [118, -8.25]),
      picked(
        2,
        'battle of New Orleans',
        [-90, 30],
        dayFromHistorical({ year: 1815, month: 1, day: 8 }),
      ),
    ];
    meanwhile.update(VIEW, now);
    expect(element.hidden).toBe(false);
    expect(rows(element).map((row) => byClass(row, 'wu-mw-words').textContent)).toEqual([
      'Tambora16 June 1815',
      'Battle of New Orleans8 January 1815',
    ]);
    expect(entryOf(events.meanwhile[0]!).source.url).toBe(
      'https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q1',
    );
  });

  it('lets an entry go once the now window has left its dates', () => {
    const events = fakeEvents();
    const meanwhile = new ExploreMeanwhile(events, () => {});
    const element = fake(meanwhile.element);
    events.meanwhile = [picked(1, 'Ligny', [4.6, 50.5])];
    meanwhile.update(VIEW, { day: LIGNY, spanDays: 20 });
    expect(rows(element)).toHaveLength(1);
    meanwhile.update(VIEW, { day: LIGNY + 30, spanDays: 20 });
    expect(element.hidden).toBe(true);
  });

  it('hands the chosen entry’s event over to fly to', () => {
    const events = fakeEvents();
    const chosen: MeanwhileEvent[] = [];
    const meanwhile = new ExploreMeanwhile(events, (event) => chosen.push(event));
    const element = fake(meanwhile.element);
    const ligny = picked(1, 'Ligny', [4.6, 50.5]);
    events.meanwhile = [ligny];
    meanwhile.update(VIEW, { day: LIGNY, spanDays: 20 });
    rows(element)[0]!.dispatchEvent(new CustomEvent('click', { detail: 0 }));
    expect(chosen).toEqual([ligny]);
  });
});
