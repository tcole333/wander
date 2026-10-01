// Explore's events against the event worker's own query engine, run in place of the worker, and a
// camera over the globe as the boot places it: what the marks layer is handed, frame by frame.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { tunables } from '../config/tunables';
import { describe as describeRow, type EventDescription } from '../events/describe';
import { meanwhileEvents, type MeanwhileQuery } from '../events/meanwhile';
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
import { HISTORY } from '../time/exploreTime';
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
  /** Replies the next drain adds after its own, as a worker failing would send them. */
  extra: EventReply[] = [];
  /** The error each result's plan carries, as a window past the index cap gives it. */
  planError: string | undefined;
  /** Meanwhile's questions, as stood each frame. */
  meanwhileAsked: MeanwhileQuery[] = [];
  /** Keeps the question asked unanswered, as a worker still busy with it would. */
  busy = false;
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
    if (this.#pending && !this.busy) {
      const result = this.engine.query(this.#pending, now);
      const planned = this.planError ? { ...plan, error: this.planError } : plan;
      replies.push({ type: 'result', generation: ++this.#generation, result, plan: planned });
      this.#pending = undefined;
    }
    replies.push(...this.extra);
    this.extra = [];
    return replies;
  }
  idle(): boolean {
    return !this.#pending;
  }
  description(row: number): EventDescription | undefined {
    return describeRow(this.index, row);
  }
  /** Answers at once, on the next drain, as the client would once the question has rested. */
  meanwhile(query: MeanwhileQuery): void {
    this.meanwhileAsked.push(query);
    this.extra.push({
      type: 'meanwhile',
      generation: 1,
      events: meanwhileEvents(this.index, query),
    });
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** The look's marks as Explore hands them over: the last list set, and its strength. */
function marksLayer(): Omit<EventMarks, 'sizePx'> & {
  specs: MarkSpec[];
  sets: number;
  under: string | null;
  sizePx: number;
} {
  const layer = {
    specs: [] as MarkSpec[],
    sets: 0,
    strength: 1,
    sizePx: 16,
    set(source: string, specs: readonly MarkSpec[]) {
      expect(source).toBe('events');
      layer.specs = [...specs];
      layer.sets++;
    },
    placed: (): PlacedMark[] =>
      layer.specs.map((s) => ({ id: s.id, x: 0, y: 0, rPx: 8, alpha: s.opacity })),
    /** The mark the pointer is over, as the test puts it there. */
    under: null as string | null,
    hit: () => layer.under,
    span: (id: string) =>
      layer.specs.some((s) => s.id === id) ? { x0: 0, y0: 0, x1: 0, y1: -9 } : null,
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
const dayOf = (year: number, month: number, day: number) => dayFromHistorical({ year, month, day });
/** The ruler at either end of history, 400 years wide: its now window reaches 20 years past it. */
const HISTORY_END = at(HISTORY.end, 400 * 365.2425);
const HISTORY_START = at(HISTORY.start, 400 * 365.2425);
const WORLD = frameOver(10, 45, 9);
const byId = (specs: MarkSpec[], qid: number, hollow = false) =>
  specs.find((s) => s.id === markIdOf(qid, hollow));

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

  it('asks for a declutter cell four marks across at the size the look draws them', () => {
    const { worker, marks } = setup([]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, at(5000, 3650), 0);
    expect(worker.asked[0]?.cellPx).toBe(4 * 16);
    marks.sizePx = 44;
    events.update(WORLD, at(5000, 3650), 16);
    expect(worker.asked.map((query) => query.cellPx)).toEqual([64, 176]);
  });

  it('marks nothing after 2000 with the ruler at history’s end', () => {
    const kosovo = { t0: dayOf(1999, 3, 24), t1: dayOf(1999, 6, 10) };
    // The Arab Spring and the Syrian Civil War: in the index, but past history's end.
    const arabSpring = { t0: dayOf(2010, 12, 17), t1: dayOf(2012, 12, 31) };
    const syria = { t0: dayOf(2011, 3, 15), t1: dayOf(2024, 12, 8) };
    const { worker, marks } = setup([
      { row: 0, qid: 1, lon: 20, lat: 42, ...kosovo, cls: WAR },
      { row: 1, qid: 2, lon: 10, lat: 34, ...arabSpring, cls: WAR },
      { row: 2, qid: 3, lon: 38, lat: 35, ...syria, cls: WAR },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, HISTORY_END, 0);
    events.update(WORLD, HISTORY_END, tunables.eventFade * 2);
    expect(marks.specs.map((s) => s.id)).toEqual(['Q1']);
  });

  it('marks nothing before 10,000 BCE with the ruler at history’s start', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 1, lon: 20, lat: 42, t0: HISTORY.start + 90, t1: HISTORY.start + 90 },
      { row: 1, qid: 2, lon: 10, lat: 34, t0: HISTORY.start - 3650, t1: HISTORY.start - 3650 },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, HISTORY_START, 0);
    events.update(WORLD, HISTORY_START, tunables.eventFade * 2);
    expect(marks.specs.map((s) => s.id)).toEqual(['Q1']);
  });

  it('drops a focal event dated after 2000 once the ruler reaches history’s end', () => {
    const arabSpring = { t0: dayOf(2010, 12, 17), t1: dayOf(2012, 12, 31) };
    const { worker, marks } = setup([{ row: 0, qid: 33761, lon: 10, lat: 34, ...arabSpring }]);
    const events = new ExploreEvents({ client: worker, marks });
    events.focus({ qid: 33761, span: arabSpring });
    events.update(WORLD, HISTORY_END, 0);
    expect(events.focal).toBeNull();
  });

  it('holds the focal event while its dates are on the tape, dropping it once they leave', () => {
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

    // A scrub within the glass keeps it whole.
    events.update(WORLD, at(1008), 400);
    expect(events.focal?.qid).toBe(48314);
    expect(events.focalNow).toBe(true);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: true, opacity: 1 });

    // A 50-day step on a 200-day tape takes it out of the glass, not off the tape: it holds, its
    // mark easing to half strength, and comes back whole inside the glass.
    events.update(WORLD, at(1050), 416);
    expect(events.focal?.qid).toBe(48314);
    expect(events.focalNow).toBe(false);
    for (let ms = 500; ms <= 1000; ms += 50) events.update(WORLD, at(1050), ms);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: true, opacity: 0.5 });
    for (let ms = 1050; ms <= 1600; ms += 50) events.update(WORLD, at(1002), ms);
    expect(events.focalNow).toBe(true);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: true, opacity: 1 });

    // Off the tape, the focal event drops at once: an ordinary mark, fading out with the window.
    events.update(WORLD, at(1500), 1800);
    expect(events.focal).toBeNull();
    expect(worker.asked.at(-1)!.focalQids).toEqual([]);
    expect(byId(marks.specs, 48314)).toMatchObject({ focal: false });
    events.update(WORLD, at(1500), 1800 + tunables.eventFade * 2);
    expect(byId(marks.specs, 48314)).toBeUndefined();

    // Back in its window, it returns as one mark among the others.
    events.update(WORLD, at(1000), 3000);
    events.update(WORLD, at(1000), 3000 + tunables.eventFade * 2);
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
    // The tape, 1200 to 1400, still holds its last day.
    events.update(WORLD, at(1300), 32);
    expect(events.focal?.qid).toBe(7);
    events.update(WORLD, at(1400), 48);
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
      { id: 'Q100/outline', hollow: true, soft: true },
    ]);
    expect(byId(marks.specs, 100, true)!.ringRad).toBeCloseTo(
      ringRadOf({ at: [10, 45], extent: [0, 38, 22, 52] })!,
      9,
    );
  });

  it('crossfades a splitting war’s solid mark and its hollow one as two marks of one event', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 100, lon: 10, lat: 45, t0: 900, t1: 1100, cls: WAR, ext: [0, 38, 22, 52] },
      { row: 1, qid: 101, lon: 4, lat: 50, t0: 990, t1: 990, parent: 0, cls: BATTLE },
      { row: 2, qid: 102, lon: 16, lat: 48, t0: 1005, t1: 1005, parent: 0, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, at(1000), 0);
    events.update(WORLD, at(1000), tunables.eventFade * 2);
    const close = frameOver(10, 45, 1);
    events.update(close, at(1000), 1000);
    events.update(close, at(1000), 1000 + tunables.eventFade / 2);
    const ids = marks.specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(byId(marks.specs, 100)).toMatchObject({ hollow: false, opacity: 0.5 });
    expect(byId(marks.specs, 100, true)).toMatchObject({ hollow: true, opacity: 0.5 });
    // Each mark tells its own record, and the war counts once.
    expect(events.event(markIdOf(100))?.context).toBe(false);
    expect(events.event(markIdOf(100, true))?.context).toBe(true);
    expect(events.placed()).toHaveLength(4);
    expect(events.markedInView()).toBe(3);
  });

  it('lets a hollow parent give way to one standing on its place, until that one goes', () => {
    // Two wars borrow one place; each has a battle in view in 1000, the second in 1050 too.
    const war = { lon: 10, lat: 45, t0: 900, cls: WAR, flags: 1 };
    const { worker, marks } = setup([
      { row: 0, qid: 200, ...war, t1: 1010, ext: [0, 38, 22, 52] },
      { row: 1, qid: 201, ...war, t1: 1100, ext: [2, 40, 20, 50] },
      { row: 2, qid: 202, lon: 4, lat: 50, t0: 1000, t1: 1000, parent: 0, cls: BATTLE },
      { row: 3, qid: 203, lon: 16, lat: 48, t0: 1000, t1: 1000, parent: 1, cls: BATTLE },
      { row: 4, qid: 204, lon: 16, lat: 47, t0: 1050, t1: 1050, parent: 1, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    const close = frameOver(10, 45, 1);
    const hollows = () =>
      marks.specs.filter((s) => s.hollow).map(({ id, opacity }) => ({ id, opacity }));
    events.update(close, at(1000), 0);
    events.update(close, at(1000), tunables.eventFade * 2);
    events.update(close, at(1000), tunables.eventFade * 3);
    // The higher-scored war stands; the other is not drawn over it.
    expect(hollows()).toEqual([{ id: 'Q200/outline', opacity: 1 }]);

    // Past the first war's years, it fades and the second comes through as it goes.
    events.update(close, at(1050), 1000);
    events.update(close, at(1050), 1000 + tunables.eventFade / 2);
    expect(hollows()).toEqual([
      { id: 'Q200/outline', opacity: 0.5 },
      { id: 'Q201/outline', opacity: 0.5 },
    ]);
    events.update(close, at(1050), 1000 + tunables.eventFade * 2);
    expect(hollows()).toEqual([{ id: 'Q201/outline', opacity: 1 }]);
  });

  it('takes the index’s marks off, the lock’s focal mark staying, once the worker fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { worker, marks } = setup([
      { row: 0, qid: 1, lon: 10, lat: 45, t0: 990, t1: 1010, cls: BATTLE },
    ]);
    const focal = focalOf({ qid: 'Q9', day: 1000, at: [11, 46], precision: 'day', class: 'war' });
    const events = new ExploreEvents({ client: worker, marks, focal });
    events.update(WORLD, at(1000), 0);
    events.update(WORLD, at(1000), tunables.eventFade * 2);
    expect(marks.specs.map((s) => s.id)).toEqual(['Q1', 'Q9']);

    worker.extra.push({ type: 'error', message: 'out of memory' });
    events.update(WORLD, at(1005), 1000);
    const asked = worker.asked.length;
    // Its marks go at once rather than stand for other times as the clock moves on.
    events.update(WORLD, at(1008), 1016);
    expect(marks.specs).toMatchObject([{ id: 'Q9', focal: true }]);
    expect(events.event('Q9')).toBeNull();
    expect(worker.asked).toHaveLength(asked);
    expect(events.settled()).toBe(true);
    events.update(WORLD, at(5000), 1032);
    expect(marks.specs).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs once when a result’s plan says the window does not fit the index', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { worker, marks } = setup([{ row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000 }]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, at(1000), 0);
    worker.planError = 'event window needs 9 B; full index cap is 8 B';
    events.update(WORLD, at(1001), 16);
    events.update(WORLD, at(1002), 32);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('index cap');
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

  it('draws the mark pointed at hovered, a hollow parent with its extent’s ring', () => {
    const war = { row: 0, qid: 100, lon: 10, lat: 45, t0: 900, t1: 1100, cls: WAR };
    const { worker, marks } = setup([
      { ...war, ext: [0, 38, 22, 52] },
      { row: 1, qid: 101, lon: 4, lat: 50, t0: 990, t1: 990, parent: 0, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    const close = frameOver(10, 45, 1);
    for (const now of [0, 1000, 2000]) events.update(close, at(1000), now);
    const hovered = () => marks.specs.filter((s) => s.hover).map((s) => s.id);
    expect(hovered()).toEqual([]);
    events.hover('Q100/outline');
    events.update(close, at(1000), 2100);
    expect(hovered()).toEqual(['Q100/outline']);
    expect(byId(marks.specs, 100, true)!.ringRad).toBeGreaterThan(0);
    events.hover(null);
    events.update(close, at(1000), 2200);
    expect(hovered()).toEqual([]);
  });

  it('stands a parent made focal while split solid and focal at once, before the worker answers', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 100, lon: 10, lat: 45, t0: 900, t1: 1100, cls: WAR, ext: [0, 38, 22, 52] },
      { row: 1, qid: 101, lon: 4, lat: 50, t0: 990, t1: 990, parent: 0, cls: BATTLE },
      { row: 2, qid: 102, lon: 16, lat: 48, t0: 1005, t1: 1005, parent: 0, cls: BATTLE },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    const close = frameOver(10, 45, 1);
    for (const now of [0, 1000, 2000]) events.update(close, at(1000), now);
    const war = () =>
      marks.specs
        .filter((s) => s.id.startsWith('Q100'))
        .map(({ id, focal, hollow, opacity }) => ({ id, focal, hollow, opacity }));
    expect(war()).toEqual([{ id: 'Q100/outline', focal: false, hollow: true, opacity: 1 }]);

    // Pinned, the war's ember stands at once, the worker still busy with the question.
    worker.busy = true;
    events.focus({ qid: 100 });
    events.update(close, at(1000), 2100);
    const solid = [{ id: 'Q100', focal: true, hollow: false, opacity: 1 }];
    expect(war()).toEqual(solid);
    expect(events.event(markIdOf(100))?.qid).toBe(100);
    // Its answer draws the same mark.
    worker.busy = false;
    events.update(close, at(1000), 2200);
    expect(war()).toEqual(solid);
  });

  it('picks only its own marks under the pointer', () => {
    const { worker, marks } = setup([{ row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000 }]);
    const events = new ExploreEvents({ client: worker, marks });
    for (const now of [0, 1000]) events.update(WORLD, at(1000), now);
    marks.under = 'Q1';
    expect(events.hit(0, 0)).toBe('Q1');
    // Another layer's mark, or none.
    marks.under = 'demo-3';
    expect(events.hit(0, 0)).toBeNull();
    marks.under = null;
    expect(events.hit(0, 0)).toBeNull();
    // Where its own marks stand, lifted by the relief, and none of another layer's.
    expect(events.span('Q1')).toEqual({ x0: 0, y0: 0, x1: 0, y1: -9 });
    marks.specs.push({ ...marks.specs[0]!, id: 'demo-3' });
    expect(events.span('demo-3')).toBeNull();
  });

  it('names the events it marks in view, and describes them, a child with its parent', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 100, lon: 10, lat: 45, t0: 900, t1: 1100, label: 'Napoleonic Wars' },
      { row: 1, qid: 101, lon: 11, lat: 44, t0: 990, t1: 990, parent: 0, label: 'Battle of Ulm' },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    for (const now of [0, 1000]) events.update(WORLD, at(1000), now);
    expect(events.labels().map((label) => label.text)).toContain('Napoleonic Wars');
    expect(events.description(1)).toMatchObject({
      label: 'Battle of Ulm',
      parent: 'Napoleonic Wars',
    });
    // From afar the war stands for its battle.
    expect(events.drawnQids()).toEqual([100]);
  });

  it('stands Meanwhile’s question and keeps the worker’s answer until it leaves', () => {
    const { worker, marks } = setup([
      { row: 0, qid: 1, lon: 10, lat: 45, t0: 1000, t1: 1000 },
      // On the far side of the globe.
      { row: 1, qid: 2, lon: -170, lat: -10, t0: 1000, t1: 1000 },
    ]);
    const events = new ExploreEvents({ client: worker, marks });
    events.update(WORLD, at(1000), 0);
    expect(events.meanwhile).toBeNull();
    const view = worker.asked[0]!.view;
    const query = { t0: 990, t1: 1010, center: [10, 45] as [number, number], view };
    events.askMeanwhile({ ...query, count: 3, exclude: [1], focalQids: [] });
    events.update(WORLD, at(1000), 16);
    expect(events.meanwhile?.map((event) => event.qid)).toEqual([2]);
    events.leave();
    events.askMeanwhile({ ...query, count: 3, exclude: [], focalQids: [] });
    expect(worker.meanwhileAsked).toHaveLength(1);
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
