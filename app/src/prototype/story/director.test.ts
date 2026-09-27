import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ViewControl } from '../app/viewControl';
import { beatView, createWalk, readingSeconds } from './director';
import { parseStory } from './story';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const beat = (i: number) => story.beats[i] ?? story.beats[0]!;

const DT = 1 / 60;

function setup(ready = () => true) {
  const control = new ViewControl(beatView(beat(0)));
  control.minKmAt = () => 1;
  const walk = createWalk(story, control, { ready });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      walk.update(0, DT);
      control.step(0, DT);
    }
  };
  const land = () => {
    let s = 0;
    while (walk.state().flight !== null && s < 20) {
      run(DT);
      s += DT;
    }
    return s;
  };
  return { control, walk, run, land };
}

describe('the walk', () => {
  it('starts on its first beat, paused, with the camera there', () => {
    const { control, walk } = setup();
    expect(walk.state()).toMatchObject({ beat: 0, mode: 'paused', flight: null });
    expect(walk.state().day).toBe(beat(0).day);
    expect(control.current.viewKm).toBe(beat(0).camera.viewKm);
  });

  it('flies to a beat and lands on its camera and date', () => {
    const { control, walk, run, land } = setup();
    walk.goTo(2);
    run(0.5);
    expect(walk.state().day).toBeGreaterThan(beat(0).day);
    expect(walk.state().day).toBeLessThan(beat(2).day);
    land();
    expect(walk.state().day).toBe(beat(2).day);
    expect(control.current.lon).toBeCloseTo(beat(2).camera.target[0], 6);
    expect(control.current.viewKm).toBeCloseTo(beat(2).camera.viewKm, 6);
  });

  it('holds a landing for the tiles at most 1.5 s', () => {
    const { walk, land } = setup(() => false);
    walk.goTo(5);
    const took = land();
    const [flight] = walk.flights();
    expect(flight?.heldS).toBe(1.5);
    expect(took).toBeLessThan((flight?.plannedS ?? 0) + 1.5 + 0.05);
  });

  it('plays on after the reading time and stops on the last beat', () => {
    const { walk, run, land } = setup();
    walk.togglePlay();
    run(readingSeconds(beat(0)) + 0.1);
    expect(walk.state()).toMatchObject({ beat: 1, mode: 'playing' });
    walk.goTo(story.beats.length - 1);
    land();
    expect(walk.state()).toMatchObject({ mode: 'paused', advanceIn: null });
  });

  it('coalesces rapid steps into one flight to the latest target', () => {
    const { walk, run, land } = setup();
    walk.next();
    run(0.1);
    walk.next();
    run(0.1);
    walk.next();
    land();
    expect(walk.state().beat).toBe(3);
  });

  it('holds beat and time on a break-out, and resume restores them', () => {
    const { control, walk, land } = setup();
    walk.togglePlay();
    walk.scrub(beat(0).day + 400);
    expect(walk.state()).toMatchObject({ beat: 0, mode: 'breakout', day: beat(0).day + 400 });
    control.go({ ...control.current, lon: 20, lat: 50 }, true);
    walk.resume();
    land();
    expect(walk.state()).toMatchObject({ beat: 0, mode: 'playing', day: beat(0).day });
    expect(control.current.lon).toBeCloseTo(beat(0).camera.target[0], 6);
  });
});
