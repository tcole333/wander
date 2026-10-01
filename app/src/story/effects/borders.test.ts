// The walk's borders: the field loads in the background and goes to the GPU a face a frame; once
// every face is in, the borders ease in on the beats that list them, out on the others and as the
// view closes in; without a borders section nothing loads or draws, and the walk goes on, the
// field no beat's readiness item. Where the look holds the border steps, the beats' layers gate
// the steps over borderFade, never with previews; a beat that lists borders names its step from
// the flight's start and is ready only once the steps hold it; the lobby preloads the story's first
// border step; and a story without border beats never drives them.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { BordersFrame, ClockBorders, StepShown } from '../../borders/clockBorders';
import { tunables } from '../../config/tunables';
import { BORDER_FACES, BORDER_TEXELS } from '../../data/borders';
import type { BordersRelease } from '../../data/release';
import { createBorderUniforms } from '../../look/bordersHook';
import type { WalkState } from '../contract';
import { parseStory } from '../story';
import { StepBorders, WalkBorders } from './borders';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const magellan = parseStory(
  readFileSync(new URL('../../../../stories/magellan/story.md', import.meta.url), 'utf8'),
);

const BORDERS: BordersRelease = {
  ver: 'f00dcafe',
  stems: ['1815'],
  years: [1815],
  files: {
    '1815': { key: 'fd/borders/f00dcafe/1815.bin', bytes: 0, notice: 'n.txt', source: 's.geojson' },
  },
};

/** A stored 1815 field whose faces are all as far from a border as a field reaches. */
function stored(): ArrayBuffer {
  const header = Buffer.alloc(16);
  header.write('WBF1', 0, 'ascii');
  header.writeUInt8(1, 4);
  header.writeUInt8(BORDER_FACES, 5);
  header.writeUInt16LE(BORDER_TEXELS, 6);
  header.writeUInt16LE(4, 8);
  header.writeInt16LE(1815, 10);
  const faces = Buffer.alloc(BORDER_FACES * BORDER_TEXELS * BORDER_TEXELS, 255);
  const gz = gzipSync(Buffer.concat([header, faces]));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

function pausedOn(id: string): WalkState {
  const beat = story.beats.findIndex((b) => b.id === id);
  const day = story.beats[beat]?.day ?? 0;
  return { story, beat, mode: 'paused', flight: null, flying: false, day, advanceIn: null };
}

/** A second of frames at 30 per second, over a view `viewKm` across. */
function aSecondOn(borders: WalkBorders, state: WalkState, viewKm = 3000): void {
  for (let frame = 0; frame < 30; frame += 1) borders.update(state, 1 / 30, viewKm, 1);
}

/**
 * Frames from the room's opening until every face is uploaded; how many that took. Inflating the
 * 24 MiB field takes real time, several times longer on CI's runners, so time bounds the wait, not
 * a frame count.
 */
async function loaded(borders: WalkBorders): Promise<number> {
  let frames = 0;
  const giveUp = Date.now() + 10_000;
  while (!borders.ready && Date.now() < giveUp) {
    borders.background();
    frames += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return frames;
}

describe('the walk borders', () => {
  it('upload a face a frame, then ease in on a beat that lists them', async () => {
    const uniforms = createBorderUniforms();
    const load = vi.fn(() => Promise.resolve(stored()));
    const borders = new WalkBorders(
      story,
      { dataHost: 'https://data.test', borders: BORDERS },
      uniforms,
      load,
    );
    aSecondOn(borders, pausedOn('europe-1816'));
    expect(borders.shown).toBeNull();
    expect(await loaded(borders)).toBeGreaterThanOrEqual(BORDER_FACES);
    expect(load).toHaveBeenCalledWith('https://data.test/fd/borders/f00dcafe/1815.bin');
    aSecondOn(borders, pausedOn('europe-1816'));
    expect(borders.shown).toEqual({ year: 1815, strength: 1 });
    expect(uniforms.lookBorderStrength.value).toBe(1);
    borders.hide();
    expect([borders.shown, uniforms.lookBorderStrength.value]).toEqual([null, 0]);
    borders.background();
    aSecondOn(borders, pausedOn('europe-1816'));
    expect(borders.shown).toEqual({ year: 1815, strength: 1 });
    expect(load).toHaveBeenCalledOnce();
  });

  it('ease out on a beat without them, and as the view closes in', async () => {
    const uniforms = createBorderUniforms();
    const source = { dataHost: '', borders: BORDERS };
    const borders = new WalkBorders(story, source, uniforms, () => Promise.resolve(stored()));
    await loaded(borders);
    aSecondOn(borders, pausedOn('europe-1816'), 150);
    expect(borders.shown).toBeNull();
    aSecondOn(borders, pausedOn('europe-1816'));
    aSecondOn(borders, pausedOn('sumbawa'));
    expect([borders.shown, uniforms.lookBorderStrength.value]).toEqual([null, 0]);
  });

  it('draw nothing and fetch nothing without a borders section', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn();
    const borders = new WalkBorders(story, { dataHost: '' }, createBorderUniforms(), load);
    borders.background();
    aSecondOn(borders, pausedOn('europe-1816'));
    expect([borders.shown, load.mock.calls.length, warn.mock.calls.length]).toEqual([null, 0, 1]);
    warn.mockRestore();
  });

  it('never hold a beat: the field loads from the room, no readiness item', () => {
    const load = vi.fn(() => new Promise<ArrayBuffer>(() => {}));
    const source = { dataHost: '', borders: BORDERS };
    const borders = new WalkBorders(story, source, createBorderUniforms(), load);
    borders.background();
    expect([borders.ready, borders.beatReady()]).toEqual([false, true]);
  });
});

/**
 * The border steps' runtime as the walk sees it: the frames it is asked for, and its calls. It
 * holds the steps of the days `held` names.
 */
function fakeSteps(shown: StepShown | null = null, held: (day: number) => boolean = () => false) {
  const frames: BordersFrame[] = [];
  const steps = {
    shown,
    update: vi.fn((frame: BordersFrame) => frames.push(frame)),
    preload: vi.fn(),
    holds: vi.fn(held),
    hide: vi.fn(),
    end: vi.fn(),
  };
  return { steps, frames, clock: steps as unknown as ClockBorders };
}

/** On the way to beat `id`, a tenth of the flight flown, in `mode`. */
function flyingTo(id: string, mode: WalkState['mode'] = 'paused'): WalkState {
  return { ...pausedOn(id), mode, flight: 0.1, flying: true };
}

/** A beat's day, by its id. */
const dayOf = (id: string) => story.beats.find((beat) => beat.id === id)?.day ?? NaN;

/** `ms` of frames at 60 a second, over a view 3,000 km across, at the walk's strength. */
function framesOn(borders: StepBorders, state: WalkState, ms: number, strength = 1): void {
  const frames = Math.round((ms * 60) / 1000);
  for (let frame = 0; frame < frames; frame += 1) borders.update(state, 1 / 60, 3000, strength);
}

describe('the walk borders on the border steps', () => {
  it('ease the steps in over borderFade on a beat that lists them, never with previews', () => {
    const { frames, clock } = fakeSteps();
    const borders = new StepBorders(story, clock);
    framesOn(borders, pausedOn('europe-1816'), tunables.borderFade / 2, 0.8);
    // Half way through the easing, smoothstep's midpoint, at the walk's strength.
    expect(frames.at(-1)?.strength).toBeCloseTo(0.5 * 0.8, 3);
    framesOn(borders, pausedOn('europe-1816'), tunables.borderFade, 0.8);
    expect(frames.at(-1)).toMatchObject({ wanted: true, viewKm: 3000, strength: 0.8 });
    expect(frames.every((frame) => !frame.previews)).toBe(true);
  });

  it('ease them out on a beat without them, until they are not wanted', () => {
    const { frames, clock } = fakeSteps();
    const borders = new StepBorders(story, clock);
    framesOn(borders, pausedOn('europe-1816'), 2 * tunables.borderFade);
    framesOn(borders, pausedOn('sumbawa'), tunables.borderFade / 2);
    expect(frames.at(-1)).toMatchObject({ wanted: true });
    expect(frames.at(-1)?.strength).toBeCloseTo(0.5, 3);
    framesOn(borders, pausedOn('sumbawa'), tunables.borderFade);
    expect(frames.at(-1)).toMatchObject({ wanted: false, strength: 0 });
  });

  it('show only a step drawn from its slot, never a preview', () => {
    const drawn = fakeSteps({ year: 1815, strength: 0.7, preview: false });
    expect(new StepBorders(story, drawn.clock).shown).toEqual({ year: 1815, strength: 0.7 });
    const preview = fakeSteps({ year: 1815, strength: 0.7, preview: true });
    expect(new StepBorders(story, preview.clock).shown).toBeNull();
  });

  it('clear the lobby keeping the slots: hide, never end', () => {
    const { steps, frames, clock } = fakeSteps();
    const borders = new StepBorders(story, clock);
    framesOn(borders, pausedOn('europe-1816'), 2 * tunables.borderFade);
    borders.hide();
    expect([steps.hide.mock.calls.length, steps.end.mock.calls.length]).toEqual([1, 0]);
    borders.update(pausedOn('europe-1816'), 1 / 60, 3000, 1);
    expect(frames.at(-1)?.strength).toBeLessThan(0.01);
  });

  it('never drive the steps in a story without border beats', () => {
    const { steps, clock } = fakeSteps();
    const borders = new StepBorders(magellan, clock);
    const beat = 0;
    const day = magellan.beats[beat]?.day ?? 0;
    const state: WalkState = {
      story: magellan,
      beat,
      mode: 'paused',
      flight: null,
      flying: false,
      day,
      advanceIn: null,
    };
    framesOn(borders, state, 1000);
    borders.background(true);
    expect(borders.beatReady(state)).toBe(true);
    borders.hide();
    borders.dispose();
    expect(steps.update).not.toHaveBeenCalled();
    expect(steps.preload).not.toHaveBeenCalled();
    expect(steps.hide).not.toHaveBeenCalled();
    expect(steps.end).not.toHaveBeenCalled();
  });

  it("name a border beat's step from the flight's start, and none on other beats or in a break-out", () => {
    const { frames, clock } = fakeSteps();
    const borders = new StepBorders(story, clock);
    borders.update(flyingTo('europe-1816'), 1 / 60, 3000, 1);
    expect(frames.at(-1)?.beat).toBe(dayOf('europe-1816'));
    borders.update(pausedOn('europe-1816'), 1 / 60, 3000, 1);
    expect(frames.at(-1)?.beat).toBe(dayOf('europe-1816'));
    borders.update(flyingTo('sumbawa'), 1 / 60, 3000, 1);
    expect(frames.at(-1)?.beat).toBeNull();
    borders.update({ ...pausedOn('europe-1816'), mode: 'breakout' }, 1 / 60, 3000, 1);
    expect(frames.at(-1)?.beat).toBeNull();
  });

  it('are ready on a border beat only once the steps hold its step, and at once elsewhere', () => {
    let held = false;
    const { steps, clock } = fakeSteps(null, () => held);
    const borders = new StepBorders(story, clock);
    expect(borders.beatReady(flyingTo('europe-1816'))).toBe(false);
    expect(steps.holds).toHaveBeenLastCalledWith(dayOf('europe-1816'));
    held = true;
    expect(borders.beatReady(flyingTo('europe-1816'))).toBe(true);
    held = false;
    expect(borders.beatReady(pausedOn('sumbawa'))).toBe(true);
    expect(borders.beatReady({ ...pausedOn('europe-1816'), mode: 'breakout' })).toBe(true);
  });

  it("preload the story's first border step while the lobby stands, and only then", () => {
    const { steps, clock } = fakeSteps();
    const borders = new StepBorders(story, clock);
    borders.background(false);
    expect(steps.preload).not.toHaveBeenCalled();
    borders.background(true);
    // The walk's first beat, 1 April 1815, lists borders.
    expect(steps.preload).toHaveBeenCalledWith(dayOf('world-1815'));
  });
});
