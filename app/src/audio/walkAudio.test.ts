import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beatView, createWalk } from '../story/director';
import { parseStory } from '../story/story';
import { ViewControl } from '../view/viewControl';
import type { SoundEngine } from './engine';
import { mix } from './mix';
import { WalkScore } from './walkAudio';

/** The cues and bed the score starts, and the levels it sets cues to, heard without audio. */
const heard = vi.hoisted(() => ({
  started: [] as string[],
  levels: [] as [string, number][],
  stopped: [] as string[],
  rooms: 0,
  days: [] as number[],
}));

vi.mock('./cues', async (original) => ({
  ...(await original<typeof import('./cues')>()),
  startCue: (_engine: unknown, name: string) => {
    heard.started.push(name);
    return {
      setLevel: (db: number) => heard.levels.push([name, db]),
      stop: () => heard.stopped.push(name),
    };
  },
}));
vi.mock('./voices', () => ({
  clunk() {},
  whir: () => ({ setPace() {}, stop() {} }),
  Detents: class {
    play() {}
  },
}));
vi.mock('./bed', () => ({
  tamboraBed() {
    heard.started.push('bed');
    return {
      setDay: (day: number) => heard.days.push(day),
      toRoom: () => heard.rooms++,
      stop: () => heard.stopped.push('bed'),
    };
  },
}));

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const DT = 1 / 60;

/**
 * The walk's director, run frame by frame into a score on an engine without audio: standing on
 * its first beat, or flying in to it from the whole globe, as from the lobby.
 */
function setup(arrive: 'jump' | 'fly' = 'jump') {
  const control = new ViewControl(
    arrive === 'fly'
      ? { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 }
      : beatView(story.beats[0]!),
  );
  control.minKmAt = () => 1;
  const walk = createWalk(story, control, { ready: () => true, arrive });
  const engine = { ctx: { currentTime: 0 }, soon: () => engine.ctx.currentTime + 0.05, mix };
  const score = new WalkScore(engine as unknown as SoundEngine, walk.state(), 0.05);
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      walk.update(0, DT);
      control.step(0, DT);
      engine.ctx.currentTime += DT;
      const state = walk.state();
      score.frame({ state, unit: 'day', pace: 0, at: engine.soon(), dt: DT });
    }
  };
  return { walk, run, score, engine };
}

describe("the walk's score", () => {
  beforeEach(() => {
    heard.started = [];
    heard.levels = [];
    heard.stopped = [];
    heard.days = [];
    heard.rooms = 0;
  });

  it("starts a beat's cues on landing there, not on breaking out of the flight", () => {
    const { walk, run } = setup();
    walk.goTo(2);
    run(0.5);
    walk.breakOut();
    run(0.5);
    expect(heard.started).not.toContain('eruption');
    walk.resume();
    run(8);
    expect(heard.started).toContain('eruption');
  });

  it('brings the bed at once on a walk that stands on its first beat', () => {
    setup();
    expect(heard.started).toEqual(['bed']);
  });

  it("brings the bed and the beat's cues at the landing of a walk flying in from the lobby", () => {
    const { run } = setup('fly');
    run(0.5);
    expect(heard.started).toEqual([]);
    run(8);
    expect(heard.started.toSorted()).toEqual(['bed', ...story.beats[0]!.audioCues].toSorted());
  });

  it("ducks a beat's cues while a Meanwhile entry has the camera, until it lands back", () => {
    const { walk, run } = setup();
    walk.goTo(2);
    run(8);
    walk.flyTo([2.35, 48.86], 1500);
    run(8);
    walk.resume();
    run(8);
    expect(heard.levels).toEqual([
      ['eruption', mix.cues.eruption - 12],
      ['eruption', mix.cues.eruption],
    ]);
  });

  it('fades cues to the room and reuses the same bed after another dive', () => {
    const { walk, run, score, engine } = setup();
    walk.goTo(2);
    run(8);
    const room = score.toRoom(engine.soon());
    expect(heard.stopped).toContain('eruption');
    expect(heard.stopped).not.toContain('bed');
    expect(heard.rooms).toBe(1);
    expect(room).not.toBeNull();
    const control = new ViewControl({ lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 });
    const next = createWalk(story, control, { ready: () => true, arrive: 'fly' });
    const again = new WalkScore(
      engine as unknown as SoundEngine,
      next.state(),
      engine.soon(),
      room,
    );
    const daysBeforeLanding = heard.days.length;
    next.update(0, DT);
    again.frame({ state: next.state(), unit: 'day', pace: 0, at: engine.soon(), dt: DT });
    expect(heard.days).toHaveLength(daysBeforeLanding);
    for (let t = 0; t < 6; t += DT) next.update(0, DT);
    again.frame({ state: next.state(), unit: 'day', pace: 0, at: engine.soon(), dt: DT });
    expect(heard.started.filter((name) => name === 'bed')).toHaveLength(1);
    expect(heard.days.at(-1)).toBe(next.state().day);
    again.stop(engine.soon());
    expect(heard.stopped.filter((name) => name === 'bed')).toHaveLength(1);
  });
});
