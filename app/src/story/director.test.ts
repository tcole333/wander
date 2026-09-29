import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ViewControl } from '../view/viewControl';
import { viewGap } from '../view/viewState';
import type { FxRelease } from '../data/release';
import { parseRoute } from '../data/route';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import type { WalkOptions } from './contract';
import { beatView, createWalk, readingSeconds } from './director';
import { flightEase } from './flight';
import { voyagePath } from './voyageFlight';
import { parseStory } from './story';
import { WorldClock } from '../time/worldClock';
import { beatSpan, mixSpans } from './ui/format';

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const beat = (i: number) => story.beats[i] ?? story.beats[0]!;

const DT = 1 / 60;

function setup(ready = () => true, chosen = story, route?: WalkOptions['route']) {
  const control = new ViewControl(beatView(chosen.beats[0]!));
  control.minKmAt = () => 1;
  const walk = createWalk(chosen, control, { ready, route });
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
  it('drives shared world time through flights, retargets, scrubs and resume', () => {
    const clock = new WorldClock();
    const control = new ViewControl(beatView(beat(0)));
    const walk = createWalk(story, control, { ready: () => true, clock });
    const width = (i: number) => beatSpan(beat(i)).end - beatSpan(beat(i)).start;
    expect(clock.state()).toEqual({ day: walk.state().day, spanDays: width(0) });
    walk.goTo(3);
    walk.update(0, 0.5);
    const progress = walk.state().flight!;
    const expected = mixSpans(
      beatSpan(beat(0)),
      beatSpan(beat(3)),
      0.5,
      walk.state().day,
      progress * progress * (3 - 2 * progress),
    );
    expect(clock.state().day).toBe(walk.state().day);
    expect(clock.state().spanDays).toBeCloseTo(expected.end - expected.start);
    const before = clock.state();
    walk.goTo(5);
    expect(clock.state()).toEqual(before);
    walk.update(0, 0.25);
    expect(clock.state().day).toBe(walk.state().day);
    walk.scrub(beat(2).day + 0.75);
    expect(clock.state()).toEqual({ day: beat(2).day, spanDays: width(5) });
    walk.resume();
    for (let i = 0; i < 1200 && walk.state().flight !== null; i += 1) walk.update(0, DT);
    expect(clock.state()).toEqual({ day: walk.state().day, spanDays: width(5) });
    walk.dispose();
  });

  it('starts on its first beat, paused, with the camera there', () => {
    const { control, walk } = setup();
    expect(walk.state()).toMatchObject({ beat: 0, mode: 'paused', flight: null });
    expect(walk.state().day).toBe(beat(0).day);
    expect(control.current.viewKm).toBe(beat(0).camera.viewKm);
  });

  it('flies in to its first beat from the view it starts on, as from the lobby', () => {
    const control = new ViewControl({ lon: 40, lat: 15, viewKm: 30000, tilt: 0, heading: 0 });
    const walk = createWalk(story, control, { ready: () => true, arrive: 'fly' });
    expect(walk.state()).toMatchObject({ beat: 0, mode: 'paused', flight: 0 });
    expect(control.current.lon).toBe(40);
    for (let t = 0; t < 6 && walk.state().flight !== null; t += DT) walk.update(0, DT);
    expect(walk.state().flight).toBeNull();
    expect(control.current.lon).toBeCloseTo(beat(0).camera.target[0], 6);
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

  it('holds a landing for the tiles at most 0.4 s', () => {
    const { walk, land } = setup(() => false);
    walk.goTo(5);
    const took = land();
    const [flight] = walk.flights();
    expect(flight?.heldS).toBe(0.4);
    expect(took).toBeLessThan((flight?.plannedS ?? 0) + 0.4 + 0.05);
  });

  it('turns a drifting beat and closes in on the others while they are read', () => {
    const { control, walk, run, land } = setup();
    run(5);
    expect(control.current.lon).toBeCloseTo(beat(0).camera.target[0] + 2, 1);
    walk.goTo(2);
    land();
    run(readingSeconds(beat(2)) + 1);
    expect(control.current.viewKm).toBeCloseTo(beat(2).camera.viewKm * 0.95, 6);
  });

  it('lands on a spread at its window start and plays it out to the beat date', () => {
    const { walk, run, land } = setup();
    walk.goTo(4);
    land();
    expect(walk.state().day).toBe(beat(4).window[0]);
    run(8.1);
    expect(walk.state().day).toBe(beat(4).day);
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

  it('tells when the camera flies to a beat', () => {
    const { walk } = setup();
    walk.next();
    expect(walk.state().flying).toBe(true);
  });

  it('tells when the camera flies to a Meanwhile entry, and when it lands', () => {
    const { walk, run } = setup();
    walk.flyTo([2.35, 48.86], 1500);
    expect(walk.state()).toMatchObject({ flying: true, flight: null });
    run(6);
    expect(walk.state().flying).toBe(false);
  });

  it('scrubs to whole days, as the date plate reads them', () => {
    const { walk } = setup();
    walk.scrub(beat(3).day - 0.25);
    expect(walk.state().day).toBe(beat(3).day - 1);
  });
});

describe('the director’s voyage flights', () => {
  const magellan = parseStory(
    readFileSync(new URL('../../../stories/magellan/story.md', import.meta.url), 'utf8'),
  );
  const fx = readStageRecord<FxRelease>('fx');
  const route = parseRoute(readFixtureFile(fx['magellan/route']!.key).buffer);
  const loaded = (name: string) => (name === 'route' ? route : undefined);

  it('follows an adjacent beat’s route and takes story time from that path', () => {
    const { walk, control, run, land } = setup(() => true, magellan, loaded);
    const start = { ...control.current };
    const next = magellan.beats[1]!;
    const path = voyagePath(start, beatView(next), route, walk.state().day, next.day)!;
    walk.next();
    expect(control.current).toEqual(start);
    expect(walk.flights()[0]).toMatchObject({
      kind: 'voyage',
      sailedKm: path.sailedKm,
      followKm: path.followKm,
      plannedS: path.durationS,
    });
    run(path.durationS / 2);
    const e = flightEase(walk.state().flight!);
    expect(walk.state().day).toBeCloseTo(path.dayAt(e), 8);
    expect(viewGap(control.current, path.at(e))).toBeLessThan(1e-6);
    land();
    expect(walk.state().day).toBe(next.day);
    expect(viewGap(control.current, beatView(next))).toBeLessThan(1e-6);
    walk.back();
    expect(walk.flights().at(-1)?.kind).toBe('voyage');
    const before = walk.state().day;
    run(2);
    expect(walk.state().day).toBeLessThan(before);
    land();
    expect(walk.state().day).toBe(magellan.beats[0]!.day);
  });

  it.each([
    'missing data',
    'departing effect absent',
    'arriving effect absent',
    'different datasets',
  ])('keeps a direct flight with %s', (reason) => {
    const chosen = {
      ...magellan,
      beats: magellan.beats.map((b, i) => ({
        ...b,
        effects:
          (reason === 'departing effect absent' && i === 0) ||
          (reason === 'arriving effect absent' && i === 1)
            ? []
            : b.effects.map((effect) =>
                reason === 'different datasets' && i === 1 && effect.kind === 'route'
                  ? { ...effect, dataset: 'another' }
                  : effect,
              ),
      })),
    };
    const { walk, run } = setup(
      () => true,
      chosen,
      reason === 'missing data' ? () => undefined : loaded,
    );
    walk.next();
    expect(walk.flights()[0]?.kind).toBe('direct');
    run(1);
    const expected =
      chosen.beats[0]!.day +
      (chosen.beats[1]!.day - chosen.beats[0]!.day) * flightEase(walk.state().flight!);
    expect(walk.state().day).toBeCloseTo(expected, 8);
  });

  it('keeps jumps, a lobby dive, break-out resumes and free flights direct', () => {
    const { walk, control, land } = setup(() => true, magellan, loaded);
    walk.goTo(3);
    expect(walk.flights().at(-1)?.kind).toBe('direct');
    land();
    walk.scrub(magellan.beats[2]!.day);
    walk.resume();
    expect(walk.flights().at(-1)?.kind).toBe('direct');
    land();
    walk.breakOut();
    walk.next();
    expect(walk.flights().at(-1)?.kind).toBe('direct');
    walk.flyTo([0, 0], 2000);
    expect(walk.flights().at(-1)).toMatchObject({ kind: 'direct', to: null });
    const dive = createWalk(magellan, control, { ready: () => true, arrive: 'fly', route: loaded });
    expect(dive.flights()[0]?.kind).toBe('direct');
  });

  it('uses data loaded after the dive on the next adjacent transition', () => {
    let available = false;
    const { walk, land } = setup(
      () => true,
      magellan,
      (name) => (available ? loaded(name) : undefined),
    );
    walk.next();
    available = true;
    expect(walk.flights().at(-1)?.kind).toBe('direct');
    land();
    walk.next();
    expect(walk.flights().at(-1)?.kind).toBe('voyage');
  });

  it('holds a voyage before landing and records it in flights()', () => {
    const { walk, land } = setup(() => false, magellan, loaded);
    walk.next();
    const took = land();
    const flight = walk.flights()[0]!;
    expect(flight).toMatchObject({ kind: 'voyage', end: 'landed', heldS: 0.4 });
    expect(took).toBeGreaterThan(flight.plannedS);
    expect(took).toBeLessThan(flight.plannedS + 0.45);
  });

  it('carries the old course into a mid-flight retarget without a position or velocity jolt', () => {
    const first = setup(() => true, magellan, loaded);
    const continued = setup(() => true, magellan, loaded);
    for (const { walk, run } of [first, continued]) {
      walk.next();
      run(3);
    }
    const before = { ...first.control.current };
    const day = first.walk.state().day;
    first.walk.next();
    expect(first.control.current).toEqual(before);
    expect(first.walk.state().day).toBe(day);
    first.walk.update(0, 0.001);
    continued.walk.update(0, 0.001);
    expect(viewGap(first.control.current, continued.control.current)).toBeLessThan(0.001);
    first.run(0.1);
    first.walk.back();
    first.land();
    expect(first.walk.state().day).toBe(magellan.beats[1]!.day);
    expect(first.walk.flights().map((flight) => flight.end)).toEqual([
      'retargeted',
      'retargeted',
      'landed',
    ]);
  });
});
