import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAccount } from '../perf/memory';
import { dayFromHistorical } from '../story/dates';
import { createWalk } from '../story/director';
import { parseStory } from '../story/story';
import { audioClock } from '../test/audio';
import { ViewControl } from '../view/viewControl';
import { drawnView, type ViewState } from '../view/viewState';
import type { ModeAudio } from '../walk/mode';
import { SoundEngine } from './engine';
import { primeAtLeast } from './synth';
import { createWalkAudio } from './walkAudio';

/** The page's live engine: a real one, on an audio clock without audio. */
const live = vi.hoisted(() => ({ engine: undefined as SoundEngine | undefined }));
vi.mock('./engine', async (original) => ({
  ...(await original<typeof import('./engine')>()),
  unlockedSound: () => live.engine,
  unlockSound: () => live.engine,
}));

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const DT = 1 / 60;
const RATE = 48000;
const LOBBY: ViewState = { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 };
/** The museum's room tone, as bed.ts makes it: its air in each ear and the ventilation's hush. */
const ROOM_TONE = ['brown 10.1', 'pink 7.3', 'pink 8.9'];
/** Tambora's bed: the room tone and the mountain's two rumbling loops. */
const TAMBORA = [...ROOM_TONE, 'brown 11.3', 'brown 12.7'].toSorted();
/** The lengths of the beds' noise buffers, in samples. */
const BED_LENGTHS = new Set([7.3, 8.9, 10.1, 11.3, 12.7].map((s) => primeAtLeast(s * RATE)));

beforeEach(() => {
  vi.useFakeTimers();
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('localStorage', { getItem: () => '0', setItem() {} });
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
    vi.stubGlobal(name, class {});
  }
});
afterEach(() => {
  live.engine = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The page's sound on a real engine, run frame by frame as the boot runs it. */
function page() {
  const clock = audioClock(RATE);
  const engine = new SoundEngine(clock.ctx);
  live.engine = engine;
  const audio = createWalkAudio();
  let now = 0;
  const run = (
    seconds: number,
    frame: () => { heard: ModeAudio; view: ViewState },
    back = false,
  ) => {
    for (let t = 0; t < seconds; t += DT) {
      now += DT;
      clock.advance(now);
      const { heard, view } = frame();
      audio.update(heard, view, DT, back);
    }
  };
  const lobby = () => ({ heard: null, view: LOBBY });
  /** The noise the engine holds, by color and length in seconds. */
  const cached = () => {
    const account = new MemoryAccount();
    engine.inspectMemory(account);
    return Object.keys(account.owners)
      .filter((owner) => owner.startsWith('audio.noise.'))
      .map((owner) => {
        const [color, length] = owner.slice('audio.noise.'.length).split(' ');
        return `${color} ${(Number(length) / RATE).toFixed(1)}`;
      })
      .toSorted();
  };
  /** How many beds' noise buffers the engine has made. */
  const bedBuffers = () => clock.buffers.filter((buffer) => BED_LENGTHS.has(buffer.length)).length;
  /** The return: the lobby's flight, whirring, then its landing and a few seconds in the lobby. */
  const back = () => {
    audio.leave();
    run(2, lobby, true);
    audio.finish();
    run(4, lobby);
  };
  /** A walk from the lobby: the dive, its landing, and `beats` more beats. */
  const walk = (beats: number) => {
    const control = new ViewControl(LOBBY);
    control.minKmAt = () => 1;
    const director = createWalk(story, control, { ready: () => true, arrive: 'fly' });
    audio.start(true);
    const walking = () => {
      director.update(0, DT);
      control.step(0, DT);
      return {
        heard: { state: director.state(), unit: 'day' as const },
        view: drawnView(control.current),
      };
    };
    run(8, walking);
    for (let beat = 1; beat <= beats; beat += 1) {
      director.goTo(beat);
      run(8, walking);
    }
    const walked = cached();
    back();
    director.dispose();
    return walked;
  };
  /** Explore from the lobby: the dive, its landing and a scrub back through the years. */
  const explore = () => {
    audio.start(true);
    let day = dayFromHistorical({ year: 1815, month: 6, day: 18 });
    run(1, () => ({
      heard: { clock: { day, unit: 'year', yearStep: 10 }, flying: true },
      view: LOBBY,
    }));
    run(3, () => {
      day -= 40;
      return { heard: { clock: { day, unit: 'year', yearStep: 10 }, flying: false }, view: LOBBY };
    });
    back();
  };
  return { audio, run, lobby, cached, bedBuffers, walk, explore };
}

describe('the lobby after a walk', () => {
  it("keeps only its room tone's noise once the return has landed, and none once it stops", () => {
    const { audio, run, lobby, cached, walk } = page();
    const walked = walk(2);
    expect(walked).toEqual(expect.arrayContaining(TAMBORA));
    expect(walked.length).toBeGreaterThan(TAMBORA.length + 4);
    // The cues' and the mechanism's noise are gone; the bed playing room tone keeps its own.
    expect(cached()).toEqual(TAMBORA);
    audio.dispose();
    run(3, lobby);
    expect(cached()).toEqual([]);
  });

  it("carries the room tone into the next walk's landing, building no bed of its own", () => {
    const { audio, cached, bedBuffers, walk } = page();
    walk(2);
    const built = bedBuffers();
    walk(1);
    expect(bedBuffers()).toBe(built);
    expect(cached()).toEqual(TAMBORA);
    audio.dispose();
  });

  it("gives Explore the museum's room tone from the walk's noise, and the lobby keeps only that", () => {
    const { audio, cached, bedBuffers, walk, explore } = page();
    walk(1);
    const built = bedBuffers();
    explore();
    expect(bedBuffers()).toBe(built);
    expect(cached()).toEqual(ROOM_TONE);
    // Another trip reuses that room tone.
    explore();
    expect(bedBuffers()).toBe(built);
    expect(cached()).toEqual(ROOM_TONE);
    audio.dispose();
  });
});
