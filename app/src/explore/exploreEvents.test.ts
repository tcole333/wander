// Explore's events against the event worker's own query engine, run in place of the worker, and a
// camera over the globe as the boot places it: what the marks layer is handed, frame by frame.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { tunables } from '../config/tunables';
import type { EventPage } from '../events/page';
import { EventQueryEngine, type EventQuery } from '../events/query';
import { EventIndex } from '../events/residency';
import type { EventReply } from '../events/runtime';
import type { MarkSpec, PlacedMark } from '../marks/marks';
import { MemoryAccount } from '../perf/memory';
import { FrameContext } from '../scene/frameContext';
import { dayFromHistorical } from '../story/dates';
import { lonLatToDir, toThree } from '../surface/cube';
import { pageOf, releaseOf, type TestEvent } from '../test/events';
import type { WorldTime } from '../time/worldClock';
import {
  ExploreEvents,
  focalOf,
  inWindow,
  isSoft,
  markIdOf,
  ringRadOf,
  spanOf,
  type EventMarks,
  type EventSource,
} from './exploreEvents';

const WIDTH = 1440;
const HEIGHT = 900;
const CLASSES = [
  'battle',
  'war',
  'volcanic eruption',
  'shipwreck',
  'unheard of',
  'tropical cyclone',
];
const [BATTLE, WAR, ERUPTION, WRECK, UNKNOWN, STORM] = [0, 1, 2, 3, 4, 5];

/** The worker, run in place: each drain answers the query asked since the last one. */
class InPlaceWorker implements EventSource {
  readonly index: EventIndex;
  readonly engine: EventQueryEngine;
  asked: EventQuery[] = [];
  #pending: EventQuery | undefined;
  #stated = false;
  #generation = 0;
  disposed = false;

  constructor(pages: EventPage[], resident = pages.length) {
    this.index = new EventIndex(releaseOf(pages));
    this.index.plan();
    pages.slice(0, resident).forEach((page, i) => this.admit(page, i));
    this.engine = new EventQueryEngine(this.index);
  }
  admit(page: EventPage, i: number): void {
    this.index.add(this.index.release.files[i]!.key, page);
  }
  query(query: EventQuery): void {
    this.asked.push(query);
    this.#pending = query;
  }
  drain(now: number): EventReply[] {
    const plan = this.index.status();
    const replies: EventReply[] = [];
    if (!this.#stated) {
      this.#stated = true;
      replies.push({ type: 'state', plan, classes: this.index.classes });
    }
    if (this.#pending) {
      const result = this.engine.query(this.#pending, now);
      replies.push({ type: 'result', generation: ++this.#generation, result, plan });
      this.#pending = undefined;
    }
    return replies;
  }
  idle(): boolean {
    return !this.#pending;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** The look's marks as Explore hands them over: the last list set, and its strength. */
function marksLayer(): EventMarks & { specs: MarkSpec[]; sets: number } {
  const layer = {
    specs: [] as MarkSpec[],
    sets: 0,
    strength: 1,
    set(source: string, specs: readonly MarkSpec[]) {
      expect(source).toBe('events');
      layer.specs = [...specs];
      layer.sets++;
    },
    placed: (): PlacedMark[] =>
      layer.specs.map((s) => ({ id: s.id, x: 0, y: 0, rPx: 8, alpha: s.opacity })),
  };
  return layer;
}

/** The camera `altitude` globe radii above (lon, lat), looking down, as the boot places it. */
function frameOver(lon: number, lat: number, altitude: number): FrameContext {
  const scene = new Scene();
  const globe = new Group();
  scene.add(globe);
  const cam = new PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 100);
  cam.position.copy(new Vector3(...toThree(lonLatToDir(lon, lat)))).multiplyScalar(1 + altitude);
  cam.lookAt(0, 0, 0);
  scene.add(cam);
  scene.updateMatrixWorld(true);
  const frame = new FrameContext();
  frame.place(cam, globe, { width: WIDTH, height: HEIGHT });
  return frame;
}

const at = (day: number, spanDays = 200): WorldTime => ({ day, spanDays });
const WORLD = frameOver(10, 45, 9);
const byId = (specs: MarkSpec[], qid: number) => specs.find((s) => s.id === markIdOf(qid));

function setup(
  events: TestEvent[],
  options: { resident?: number; pages?: TestEvent[][]; arrive?: 'fly' | 'jump' } = {},
) {
  const pages = [events, ...(options.pages ?? [])].map((page) => pageOf(page, CLASSES));
  const worker = new InPlaceWorker(pages, options.resident);
  const marks = marksLayer();
  return { worker, marks, pages, arrive: options.arrive ?? 'jump' };
}

afterEach(() => vi.restoreAllMocks());

describe("Explore's events", () => {
  it('marks each event in its pace layer’s family and glyph, its fade stepped each frame', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 10, lon: 10, lat: 45, t0: 990, t1: 1010, cls: BATTLE },
      { row: 1, qid: 11, lon: 40, lat: 30, t0: 995, t1: 995, cls: ERUPTION },
      { row: 2, qid: 12, lon: -20, lat: 50, t0: 1000, t1: 1000, cls: WRECK },
      // On the globe's far side.
      { row: 3, qid: 13, lon: -170, lat: -10, t0: 1000, t1: 1000, cls: WRECK },
    ]);
    const events = new ExploreEvents({ client: worker, marks, arrive: 'jump' });
    events.update(WORLD, at(1000), 0);
    // Every mark enters at nothing, so none is set yet.
    expect(marks.specs).toEqual([]);
    events.update(WORLD, at(1000), tunables.eventFade / 2);
    expect(worker.asked).toHaveLength(1);
    expect(byId(marks.specs, 10)).toMatchObject({
      pace: 'governance',
      glyph: 'battle',
      opacity: 0.5,
      focal: false,
      hollow: false,
    });
    expect(byId(marks.specs, 11)).toMatchObject({ pace: 'nature', glyph: 'eruption' });
    expect(byId(marks.specs, 12)).toMatchObject({ pace: 'infrastructure', glyph: 'wreck' });
    events.update(WORLD, at(1000), tunables.eventFade * 2);
    expect(marks.specs.map((s) => s.opacity)).toEqual([1, 1, 1]);
    // A still view and clock ask nothing more, and set nothing once the fades are done.
    const sets = marks.sets;
    events.update(WORLD, at(1000), tunables.eventFade * 3);
    expect(worker.asked).toHaveLength(1);
    expect(marks.sets).toBe(sets);
    expect(events.settled()).toBe(true);
    expect(events.placed().map((p) => p.id)).toEqual(['Q10', 'Q11', 'Q12']);
  });

  it('mirrors a storm’s glyph south of the equator, and no other mark', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 20, lon: 10, lat: 20, t0: 1000, t1: 1000, cls: STORM },
      { row: 1, qid: 21, lon: 10, lat: -20, t0: 1000, t1: 1000, cls: STORM },
      { row: 2, qid: 22, lon: 20, lat: -20, t0: 1000, t1: 1000, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks, arrive: 'jump' });
    const frame = frameOver(10, 0, 9);
    events.update(frame, at(1000), 0);
    events.update(frame, at(1000), tunables.eventFade * 2);
    expect(marks.specs.map(({ id, glyph, mirror }) => ({ id, glyph, mirror }))).toEqual([
      { id: 'Q20', glyph: 'cyclone', mirror: false },
      { id: 'Q21', glyph: 'cyclone', mirror: true },
      { id: 'Q22', glyph: 'battle', mirror: false },
    ]);
  });

  it('asks for the now window, a tenth of the ruler, over the view the frame draws', () => {
    const { worker, marks } = setup([]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, at(5000, 3650), 0);
    expect(worker.asked[0]).toMatchObject({ t0: 5000 - 182.5, t1: 5000 + 182.5, tier: 'full' });
    expect(worker.asked[0]!.view.width).toBe(WIDTH);
    events.update(frameOver(10, 45, 2), at(5000, 3650), 16);
    events.update(frameOver(10, 45, 2), at(5001, 3650), 32);
    expect(worker.asked).toHaveLength(3);
  });

  it('drops the focal event once the now window leaves its dates, keeping it as a mark', () => {
    const waterloo = { row: 0, qid: 48314, lon: 10, lat: 45, t0: 1000, t1: 1000, cls: BATTLE };
    const { worker, marks } = setup([waterloo]);
    const focal = focalOf({
      qid: 'Q48314',
      day: 1000,
      at: [10, 45],
      precision: 'day',
      class: 'battle',
    });
    const events = new ExploreEvents({ client: worker, marks, focal });
    events.update(WORLD, at(1000), 0);
    // The focal event stands at once, its ember lit.
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: true, opacity: 1 });
    expect(worker.asked[0]!.focalQids).toEqual([48314]);

    // A scrub within the window keeps it.
    events.update(WORLD, at(1008), 400);
    expect(events.focal?.qid).toBe(48314);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: true });

    // Past it, the focal event drops at once: an ordinary mark, fading out with the window.
    events.update(WORLD, at(1500), 800);
    expect(events.focal).toBeNull();
    expect(worker.asked.at(-1)!.focalQids).toEqual([]);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: false });
    events.update(WORLD, at(1500), 800 + tunables.eventFade * 2);
    expect(byId(marks.specs, 48314)).toBeUndefined();

    // Back in its window, it returns as one mark among the others.
    events.update(WORLD, at(1000), 2000);
    events.update(WORLD, at(1000), 2000 + tunables.eventFade * 2);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: false, opacity: 1 });
    expect(events.focal).toBeNull();
  });

  it('drops the focal event by the index’s dates once it has them', () => {
    // The lock dates the war to its day; the index spans its years.
    const war = { row: 0, qid: 7, lon: 10, lat: 45, t0: 800, t1: 1200, cls: WAR };
    const { worker, marks } = setup([war]);
    const focal = focalOf({ qid: 'Q7', day: 1000, at: [10, 45], precision: 'day', class: 'war' });
    const events = new ExploreEvents({ client: worker, marks, focal });
    events.update(WORLD, at(1000), 0);
    events.update(WORLD, at(1100), 16);
    expect(events.focal?.span).toEqual({ t0: 800, t1: 1200 });
    events.update(WORLD, at(1300), 32);
    expect(events.focal).toBeNull();
  });

  it('draws the lock’s focal mark until the index holds the event, then the index’s, unbroken', () => {
    const { worker, marks, pages } = setup([{ row: 0, qid: 1, lon: 0, lat: 0, cls: BATTLE }], {
      pages: [[{ row: 5, qid: 48314, lon: 10.2, lat: 45.1, t0: 1000, t1: 1000, cls: BATTLE }]],
      resident: 1,
    });
    const focal = focalOf({
      qid: 'Q48314',
      day: 1000,
      at: [10, 45],
      precision: 'day',
      class: 'battle',
    });
    const events = new ExploreEvents({ client: worker, marks, focal });
    events.update(WORLD, at(1000), 0);
    expect(byId(marks.specs, 48314)).toMatchObject({
      at: [10, 45],
      glyph: 'battle',
      pace: 'governance',
      focal: true,
      opacity: 1,
    });
    expect(events.event(markIdOf(48314))).toBeNull();

    worker.admit(pages[1]!, 1);
    events.update(frameOver(10, 45, 8.9), at(1000), 16);
    const drawn = marks.specs.filter((s) => s.id === markIdOf(48314));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ at: [10.2, 45.1], focal: true, opacity: 1 });
    expect(events.event(markIdOf(48314))?.row).toBe(5);
  });

  it('gives way from a war to its battles as the view closes, the war staying hollow', () => {
    const war = {
      row: 0,
      qid: 100,
      lon: 10,
      lat: 45,
      t0: 900,
      t1: 1100,
      cls: WAR,
      ext: [0, 38, 22, 52],
      flags: 1,
    };
    const battles = [
      { row: 1, qid: 101, lon: 4, lat: 50, t0: 990, t1: 990, parent: 0, cls: BATTLE },
      { row: 2, qid: 102, lon: 16, lat: 48, t0: 1005, t1: 1005, parent: 0, cls: BATTLE },
    ];
    const { worker, marks } = setup([war, ...battles]);
    const events = new ExploreEvents({ client: worker, marks });
    const settle = (frame: FrameContext, from: number) => {
      events.update(frame, at(1000), from);
      events.update(frame, at(1000), from + tunables.eventFade * 2);
      events.update(frame, at(1000), from + tunables.eventFade * 4);
      return marks.specs.map(({ id, hollow, soft }) => ({ id, hollow, soft }));
    };
    // From afar the war stands for its battles, softly: its place is inherited.
    expect(settle(WORLD, 0)).toEqual([{ id: 'Q100', hollow: false, soft: true }]);
    // Closer, its battles take its place and it stays as a hollow glyph, its extent a ring.
    expect(settle(frameOver(10, 45, 1), 5000)).toEqual([
      { id: 'Q101', hollow: false, soft: false },
      { id: 'Q102', hollow: false, soft: false },
      { id: 'Q100', hollow: true, soft: true },
    ]);
    expect(byId(marks.specs, 100)!.ringRad).toBeCloseTo(
      ringRadOf({ at: [10, 45], extent: [0, 38, 22, 52] })!,
      9,
    );
  });

  it('logs a class without a mark once and draws the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { worker, marks } = setup([
      { row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000, cls: UNKNOWN },
      { row: 1, qid: 2, lon: 11, lat: 45, t0: 1000, t1: 1000, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    for (let now = 0; now <= 1000; now += 100) events.update(WORLD, at(1000), now);
    expect(marks.specs.map((s) => s.id)).toEqual(['Q2']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('eases its marks in with a dive, and out as it leaves, asking nothing more', () => {
    const { worker, marks } = setup([{ row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000 }]);
    const events = new ExploreEvents({ client: worker, marks, arrive: 'fly' });
    expect(marks.strength).toBe(0);
    for (let now = 0; now <= 1000; now += 16) events.update(WORLD, at(1000), now);
    expect(marks.strength).toBe(1);
    const asked = worker.asked.length;
    events.leave();
    for (let now = 1016; now <= 2000; now += 16) events.update(frameOver(0, 0, 3), at(9000), now);
    expect(marks.strength).toBe(0);
    expect(worker.asked).toHaveLength(asked);
  });

  it('ends the worker, takes its marks off and holds nothing once disposed', () => {
    const { worker, marks } = setup([{ row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000 }]);
    const events = new ExploreEvents({ client: worker, marks, arrive: 'fly' });
    for (let now = 0; now <= 1000; now += 100) events.update(WORLD, at(1000), now);
    const before = new MemoryAccount();
    events.inspectMemory(before);
    expect(before.owners['explore.events']?.arrayBuffers).toBeGreaterThan(0);
    events.dispose();
    expect(worker.disposed).toBe(true);
    expect(marks.specs).toEqual([]);
    expect(marks.strength).toBe(1);
    const after = new MemoryAccount();
    events.inspectMemory(after);
    expect(after.owners['explore.events']?.arrayBuffers).toBe(0);
    events.update(WORLD, at(1000), 2000);
    expect(marks.specs).toEqual([]);
  });
});

describe('an event’s mark', () => {
  it('is soft for an inherited or derived place, or a date known only to its year', () => {
    expect(isSoft({ flags: 0, prec: 11 })).toBe(false);
    expect(isSoft({ flags: 0, prec: 10 })).toBe(false);
    expect(isSoft({ flags: 1, prec: 11 })).toBe(true);
    expect(isSoft({ flags: 2, prec: 11 })).toBe(true);
    expect(isSoft({ flags: 16, prec: 11 })).toBe(false);
    expect(isSoft({ flags: 0, prec: 9 })).toBe(true);
    expect(isSoft({ flags: 0, prec: 7 })).toBe(true);
  });

  it('rings a parent’s extent from its mark, to the extent’s farthest reach', () => {
    const rad = ringRadOf({ at: [0, 0], extent: [-10, -5, 10, 5] })!;
    // The corners, 10° and 5° off, lie about 11.2° away.
    expect(rad * (180 / Math.PI)).toBeCloseTo(11.17, 1);
    expect(ringRadOf({ at: [0, 0] })).toBeUndefined();
  });

  it('takes the lock’s dates at their precision, in the historical calendar', () => {
    const kadesh = dayFromHistorical({ year: -1273, month: 4, day: 20 });
    expect(spanOf(kadesh, 'month')).toEqual({
      t0: dayFromHistorical({ year: -1273, month: 4, day: 1 }),
      t1: dayFromHistorical({ year: -1273, month: 4, day: 30 }),
    });
    const famine = dayFromHistorical({ year: 1845, month: 1, day: 1 });
    expect(spanOf(famine, 'year')).toEqual({
      t0: famine,
      t1: dayFromHistorical({ year: 1845, month: 12, day: 31 }),
    });
    const december = dayFromHistorical({ year: 1066, month: 12, day: 25 });
    expect(spanOf(december, 'month').t1).toBe(
      dayFromHistorical({ year: 1066, month: 12, day: 31 }),
    );
    expect(spanOf(december, 'day')).toEqual({ t0: december, t1: december });
  });

  it('counts as now while its span meets the window, as the query does', () => {
    expect(inWindow({ t0: 10, t1: 10 }, { start: 9.5, end: 10.5 })).toBe(true);
    expect(inWindow({ t0: 10, t1: 10 }, { start: 10.5, end: 11.5 })).toBe(false);
    expect(inWindow({ t0: 0, t1: 100 }, { start: 50, end: 60 })).toBe(true);
  });
});
