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
import { createWalkAudio, type WalkAudio } from './walkAudio';

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
const LOBBY: ViewState = { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 };

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
  const clock = audioClock();
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
  const cached = () => {
    const account = new MemoryAccount();
    engine.inspectMemory(account);
    const noise = Object.entries(account.owners).filter(([owner]) =>
      owner.startsWith('audio.noise'),
    );
    return {
      bytes: noise.reduce((sum, [, totals]) => sum + totals.audioSamples, 0),
      buffers: (account.details.audio as { cachedNoiseBuffers: number }).cachedNoiseBuffers,
    };
  };
  /** The return: the lobby's flight, whirring, then its landing and a few seconds in the lobby. */
  const back = (audio: WalkAudio) => {
    audio.leave();
    run(2, () => ({ heard: null, view: LOBBY }), true);
    audio.finish();
    run(4, () => ({ heard: null, view: LOBBY }));
  };
  return { audio, run, cached, back };
}

describe('the lobby after a walk', () => {
  it('holds no cached noise once the return has landed', () => {
    const { audio, run, cached, back } = page();
    const control = new ViewControl(LOBBY);
    control.minKmAt = () => 1;
    const walk = createWalk(story, control, { ready: () => true, arrive: 'fly' });
    audio.start(true);
    const walking = () => {
      walk.update(0, DT);
      control.step(0, DT);
      return {
        heard: { state: walk.state(), unit: 'day' as const },
        view: drawnView(control.current),
      };
    };
    run(8, walking);
    walk.goTo(2);
    run(8, walking);
    // The walk's noise, bed and cues included, is cached while it plays.
    expect(cached().bytes).toBeGreaterThan(8 * 2 ** 20);
    back(audio);
    expect(cached()).toEqual({ bytes: 0, buffers: 0 });
    walk.dispose();
    audio.dispose();
  });

  it('holds none after Explore either, whose next dive caches its own again', () => {
    const { audio, run, cached, back } = page();
    const waterloo = dayFromHistorical({ year: 1815, month: 6, day: 18 });
    for (let trip = 0; trip < 2; trip += 1) {
      audio.start(true);
      let day = waterloo;
      run(1, () => ({
        heard: { clock: { day, unit: 'year', yearStep: 10 }, flying: true },
        view: LOBBY,
      }));
      run(3, () => {
        day -= 40;
        return {
          heard: { clock: { day, unit: 'year', yearStep: 10 }, flying: false },
          view: LOBBY,
        };
      });
      expect(cached().buffers).toBeGreaterThan(0);
      back(audio);
      expect(cached()).toEqual({ bytes: 0, buffers: 0 });
    }
    audio.dispose();
  });
});
