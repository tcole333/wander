// The walk's climate: with a modera section it draws the story day's month on the monthly climate
// beats and eases out off them or past the data's years; without one it fetches nothing, draws
// nothing and says why once, so the walk goes on.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseClimate } from '../../data/climate';
import type { ModeraRelease } from '../../data/release';
import { createClimateUniforms } from '../../look/climateHook';
import { syntheticYear } from '../../test/climate';
import type { WalkState } from '../contract';
import { dayFromIso } from '../dates';
import { parseStory } from '../story';
import { WalkClimate } from './climate';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

/** Files for 1815-1817 on the source's grid of 96 Gaussian rows, about 1.86 degrees apart. */
const MODERA: ModeraRelease = {
  ver: 'test',
  years: [1815, 1817],
  lat: Array.from({ length: 96 }, (_, i) => 88.572169 - 1.864677 * i),
  lon0: -180,
  dlon: 1.875,
  bytes: { mean: {}, spread: {}, annual: 0 },
};

/** Each year's file, read from a synthetic year named by the URL. */
const loadSynthetic = vi.fn((url: string) =>
  Promise.resolve(parseClimate(syntheticYear(96, 192, Number(/(\d{4})\.bin$/.exec(url)?.[1])))),
);

/** The walk paused on the beat `id`, at `iso` or the beat's own day. */
function pausedOn(id: string, iso?: string): WalkState {
  const beat = story.beats.findIndex((b) => b.id === id);
  const day = iso ? dayFromIso(iso) : (story.beats[beat]?.day ?? 0);
  return { story, beat, mode: 'paused', flight: null, flying: false, day, advanceIn: null };
}

/** A second of frames at 30 per second. */
function aSecondOn(climate: WalkClimate, state: WalkState): void {
  for (let frame = 0; frame < 30; frame += 1) climate.update(state, 1 / 30, 1);
}

/** The loaded climate, shown in full on the Europe beat. */
async function shownOnEurope() {
  const uniforms = createClimateUniforms();
  const source = { dataHost: 'https://data.test', modera: MODERA };
  const climate = new WalkClimate(story, source, uniforms, loadSynthetic);
  await new Promise((resolve) => setTimeout(resolve, 0));
  aSecondOn(climate, pausedOn('europe-1816'));
  return { climate, uniforms };
}

describe('the walk climate', () => {
  it("draws the story day's month in full on a monthly climate beat", async () => {
    const { climate, uniforms } = await shownOnEurope();
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([
      1,
      { year: 1816, month: 7 },
    ]);
  });

  it('eases out on a beat without climate', async () => {
    const { climate, uniforms } = await shownOnEurope();
    aSecondOn(climate, pausedOn('sumbawa'));
    expect([uniforms.lookClimateStrength.value, climate.month]).toEqual([0, null]);
  });

  it("eases out when a scrub passes the data's years", async () => {
    const { climate, uniforms } = await shownOnEurope();
    aSecondOn(climate, { ...pausedOn('europe-1816', '1818-07-01'), mode: 'breakout' });
    expect(uniforms.lookClimateStrength.value).toBe(0);
  });

  it('draws nothing and fetches nothing without a modera section', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn();
    const uniforms = createClimateUniforms();
    const climate = new WalkClimate(story, { dataHost: 'https://data.test' }, uniforms, load);
    for (let frame = 0; frame < 60; frame += 1) climate.update(pausedOn('europe-1816'), 1 / 30, 1);

    expect(load).not.toHaveBeenCalled();
    expect([uniforms.lookClimateStrength.value, climate.drawn, climate.month]).toEqual([
      0,
      0,
      null,
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
