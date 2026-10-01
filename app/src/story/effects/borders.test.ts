// The walk's borders: where the look holds the border steps, the beats' layers gate the steps over
// borderFade, never with previews; a beat that lists borders names its step from the flight's start
// and is ready only once the steps hold it; the lobby preloads the story's first border step; and a
// story without border beats never drives them. Where the release names no steps the walk draws
// nothing, waits for nothing and says nothing.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { BordersFrame, ClockBorders, StepShown } from '../../borders/clockBorders';
import { tunables } from '../../config/tunables';
import type { WalkState } from '../contract';
import { parseStory } from '../story';
import { NO_BORDERS, StepBorders } from './borders';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const magellan = parseStory(
  readFileSync(new URL('../../../../stories/magellan/story.md', import.meta.url), 'utf8'),
);

function pausedOn(id: string): WalkState {
  const beat = story.beats.findIndex((b) => b.id === id);
  const day = story.beats[beat]?.day ?? 0;
  return { story, beat, mode: 'paused', flight: null, flying: false, day, advanceIn: null };
}

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

/** On the way to beat `id`, a tenth of the flight flown. */
function flyingTo(id: string): WalkState {
  return { ...pausedOn(id), flight: 0.1, flying: true };
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

describe('the walk borders where the release names no steps', () => {
  it('draw nothing, wait for nothing and say nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    NO_BORDERS.background(true);
    NO_BORDERS.update(pausedOn('europe-1816'), 1 / 60, 3000, 1);
    expect(NO_BORDERS.shown).toBeNull();
    expect(NO_BORDERS.beatReady(flyingTo('europe-1816'))).toBe(true);
    NO_BORDERS.hide();
    NO_BORDERS.dispose();
    expect([warn.mock.calls.length, error.mock.calls.length]).toEqual([0, 0]);
    warn.mockRestore();
    error.mockRestore();
  });
});
