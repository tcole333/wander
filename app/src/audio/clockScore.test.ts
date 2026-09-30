import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dayFromHistorical, type Precision } from '../story/dates';
import { HISTORY } from '../time/exploreTime';
import type { RoomBed } from './bed';
import { ClockScore } from './clockScore';
import type { SoundEngine } from './engine';

/** The detents, whir and bed the score plays, heard without audio. */
const heard = vi.hoisted(() => ({
  detents: [] as { weight: string; at: number }[],
  whir: [] as [flying: boolean, pace: number][],
  whirStops: 0,
  bed: [] as string[],
  prepared: [] as string[],
}));

vi.mock('./voices', () => ({
  Detents: class {
    play(weight: string, at: number) {
      heard.detents.push({ weight, at });
    }
  },
  FlightWhir: class {
    frame(flying: boolean, pace: number) {
      heard.whir.push([flying, pace]);
    }
    stop() {
      heard.whirStops += 1;
    }
  },
}));
vi.mock('./bed', async (original) => ({
  ...(await original<typeof import('./bed')>()),
  prepareBed: (_engine: unknown, voice: string) => heard.prepared.push(voice),
  museumBed() {
    heard.bed.push('museum');
    return {
      setDay() {},
      toRoom: () => heard.bed.push('room'),
      stop: () => heard.bed.push('stop'),
    };
  },
}));

const DT = 1 / 60;
const on = (year: number, month = 1, day = 1) => dayFromHistorical({ year, month, day });

/** A room the lobby holds, left by a walk or an earlier Explore in `voice`. */
function room(voice: string): RoomBed {
  return {
    voice,
    bed: {
      setDay() {},
      setMix() {},
      toRoom: () => heard.bed.push(`${voice} room`),
      stop: () => heard.bed.push(`${voice} stop`),
    },
  };
}

/** A score on an engine without audio, and frames of the free clock moving into it. */
function setup(day: number, lobby: RoomBed | null = null) {
  const engine = { ctx: { currentTime: 0 }, soon: () => engine.ctx.currentTime + 0.05 };
  const score = new ClockScore(engine as unknown as SoundEngine, day, lobby);
  const frame = (day: number, unit: Precision, yearStep = 1, flying = false, pace = 0) => {
    engine.ctx.currentTime += DT;
    score.frame({
      clock: { day, unit, yearStep },
      flying,
      pace,
      at: engine.soon(),
      dt: DT,
    });
  };
  /** The clock dragged from `from` to `to` over `seconds`. */
  const drag = (from: number, to: number, seconds: number, unit: Precision, yearStep = 1) => {
    const frames = Math.round(seconds / DT);
    for (let k = 1; k <= frames; k += 1) {
      frame(Math.floor(from + ((to - from) * k) / frames), unit, yearStep);
    }
  };
  return { engine, score, frame, drag };
}

describe("Explore's score", () => {
  beforeEach(() => {
    heard.detents = [];
    heard.whir = [];
    heard.whirStops = 0;
    heard.bed = [];
    heard.prepared = [];
  });

  it("whirs through the dive at the camera's pace, and brings room tone at its landing", () => {
    const { frame } = setup(on(1815, 6, 18));
    // The room tone's noise starts building as the dive begins.
    expect(heard.prepared).toEqual(['museum']);
    frame(on(1815, 6, 18), 'year', 10, true, 0.4);
    frame(on(1815, 6, 18), 'year', 10, true, 0.9);
    expect(heard.whir).toEqual([
      [true, 0.4],
      [true, 0.9],
    ]);
    expect(heard.bed).toEqual([]);
    frame(on(1815, 6, 18), 'year', 10, false);
    expect(heard.whir.at(-1)).toEqual([false, 0]);
    expect(heard.bed).toEqual(['museum']);
    frame(on(1815, 6, 18), 'year', 10, true, 0.5);
    expect(heard.bed).toEqual(['museum']);
  });

  it('sounds a detent at each labelled year it passes, walking years rather than days', () => {
    const { drag } = setup(on(1750, 6, 1));
    drag(on(1750, 6, 1), on(1950, 6, 1), 1, 'year', 100);
    expect(heard.detents.map((detent) => detent.weight)).toEqual(['year', 'year']);
    drag(on(1950, 6, 1), on(1750, 6, 1), 1, 'year', 20);
    expect(heard.detents).toHaveLength(2 + 10);
  });

  it("sounds days and months as a story's ruler does, in history's calendar", () => {
    const { drag } = setup(on(1582, 9, 20));
    drag(on(1582, 9, 20), on(1582, 11, 5), 0.5, 'month');
    expect(heard.detents.map((detent) => detent.weight)).toEqual(['month', 'month']);
    heard.detents = [];
    // From Julian 4 October to Gregorian 15 October is one day, and one detent.
    setup(on(1582, 10, 4)).drag(on(1582, 10, 4), on(1582, 10, 15), 0.1, 'day');
    expect(heard.detents.map((detent) => detent.weight)).toEqual(['day']);
  });

  it('spreads the detents a frame passes over its time, never before the clock', () => {
    const { frame, engine } = setup(on(1815, 3, 30));
    frame(on(1815, 4, 2), 'day');
    const at = engine.soon();
    const times = heard.detents.map((detent) => detent.at);
    expect(times).toHaveLength(3);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(times.every((t) => t >= engine.ctx.currentTime && t <= at)).toBe(true);
  });

  it('passes a leap across all of history as its coarse labelled years', () => {
    const { frame } = setup(HISTORY.end);
    frame(HISTORY.start, 'day');
    expect(heard.detents.length).toBeGreaterThan(0);
    expect(heard.detents.length).toBeLessThanOrEqual(400);
    expect(heard.detents.every((detent) => detent.weight === 'year')).toBe(true);
  });

  it("takes up the lobby's museum room tone at its landing rather than starting its own", () => {
    const lobby = room('museum');
    const { frame, score, engine } = setup(on(1815, 6, 18), lobby);
    frame(on(1815, 6, 18), 'year', 10, true, 0.4);
    frame(on(1815, 6, 18), 'year', 10, false);
    expect(heard.bed).toEqual([]);
    expect(score.toRoom(engine.soon())).toEqual(lobby);
    expect(heard.bed).toEqual(['museum room']);
  });

  it("crossfades a story's room tone to the museum's at its landing", () => {
    const { frame, score, engine } = setup(on(1815, 6, 18), room('tambora'));
    frame(on(1815, 6, 18), 'year', 10, true, 0.4);
    expect(heard.bed).toEqual([]);
    frame(on(1815, 6, 18), 'year', 10, false);
    expect(heard.bed).toEqual(['tambora stop', 'museum']);
    expect(score.toRoom(engine.soon())?.voice).toBe('museum');
  });

  it('hands on the room it has not yet landed on, or stops it with everything else', () => {
    const lobby = room('tambora');
    const left = setup(on(1815, 6, 18), lobby);
    left.frame(on(1815, 6, 18), 'year', 10, true, 0.4);
    expect(left.score.toRoom(left.engine.soon())).toBe(lobby);
    heard.bed = [];
    const stopped = setup(on(1815, 6, 18), room('tambora'));
    stopped.frame(on(1815, 6, 18), 'year', 10, true, 0.4);
    stopped.score.stop(stopped.engine.soon());
    expect(heard.bed).toEqual(['tambora stop']);
  });

  it('leaves room tone playing for the lobby, and stops everything when stopped', () => {
    const { frame, score, engine } = setup(on(1066, 10, 14));
    frame(on(1066, 10, 14), 'day');
    const lobby = score.toRoom(engine.soon());
    expect(heard.bed).toEqual(['museum', 'room']);
    expect(heard.whirStops).toBe(1);
    expect(lobby?.voice).toBe('museum');
    lobby?.bed.stop();
    expect(heard.bed.at(-1)).toBe('stop');
    expect(score.toRoom(engine.soon())).toBeNull();
  });
});
