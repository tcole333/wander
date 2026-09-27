import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beatView, createWalk } from '../story/director';
import { parseStory } from '../story/story';
import { ViewControl } from '../view/viewControl';
import type { SoundEngine } from './engine';
import { mix } from './mix';
import { WalkScore } from './walkAudio';

/** The cues the score starts, and the levels it sets them to, heard without audio. */
const heard = vi.hoisted(() => ({ started: [] as string[], levels: [] as [string, number][] }));

vi.mock('./cues', async (original) => ({
  ...(await original<typeof import('./cues')>()),
  startCue: (_engine: unknown, name: string) => {
    heard.started.push(name);
    return { setLevel: (db: number) => heard.levels.push([name, db]), stop() {} };
  },
}));
vi.mock('./voices', () => ({
  clunk() {},
  whir: () => ({ setPace() {}, stop() {} }),
  Detents: class {
    play() {}
  },
}));
vi.mock('./bed', () => ({ tamboraBed: () => ({ setDay() {}, stop() {} }) }));

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const DT = 1 / 60;

/** The walk's director, run frame by frame into a score on an engine without audio. */
function setup() {
  const control = new ViewControl(beatView(story.beats[0]!));
  control.minKmAt = () => 1;
  const walk = createWalk(story, control, { ready: () => true });
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
  return { walk, run };
}

describe("the walk's score", () => {
  beforeEach(() => {
    heard.started = [];
    heard.levels = [];
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
});
