// The look's one climate field: it rewrites and uploads only for a blend it does not hold, so a
// story's month drawn after Explore's draws again instead of keeping Explore's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { monthsAround, parseClimate } from '../data/climate';
import type { ModeraRelease } from '../data/release';
import { createClimateUniforms } from '../look/climateHook';
import type { WalkState } from '../story/contract';
import { dayFromIso } from '../story/dates';
import { StoryClimate } from '../story/effects/climate';
import { parseStory } from '../story/story';
import { syntheticYear } from '../test/climate';
import { ClockClimate } from './clock';
import { climateFieldOf, ClimateField } from './field';

const story = parseStory(
  readFileSync(new URL('../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

const MODERA: ModeraRelease = {
  ver: 'test',
  years: [1421, 2008],
  lat: Array.from({ length: 96 }, (_, i) => 88.572169 - 1.864677 * i),
  lon0: -180,
  dlon: 1.875,
  bytes: { mean: {}, spread: {}, annual: 0 },
};
const SOURCE = { dataHost: 'https://data.test', modera: MODERA };

const yearOf = (url: string) => Number(/(\d{4})\.bin$/.exec(url)?.[1]);
const read = (year: number) => parseClimate(syntheticYear(96, 192, year));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A synthetic year file as the data host would answer it, inflated already. */
const stored = (year: number) => syntheticYear(96, 192, year).buffer as ArrayBuffer;

/** The field's packed texels, to compare what it holds. */
const texels = (uniforms: ReturnType<typeof createClimateUniforms>) =>
  Array.from(uniforms.lookClimateField.value.image.data as Uint16Array);

describe('the climate field', () => {
  it('is one per look', () => {
    const uniforms = createClimateUniforms();
    expect(climateFieldOf(uniforms)).toBe(climateFieldOf(uniforms));
    expect(climateFieldOf(createClimateUniforms())).not.toBe(climateFieldOf(uniforms));
    expect(climateFieldOf(undefined)).toBeUndefined();
  });

  it('uploads a blend once, however often it is asked for', () => {
    const uniforms = createClimateUniforms();
    const field = new ClimateField(uniforms);
    const texture = uniforms.lookClimateField.value;
    const [a, b] = [read(1816), read(1816)];
    const blend = monthsAround(dayFromIso('1816-07-01'));
    const before = texture.version;
    expect(field.draw(a, b, blend)).toBe(true);
    expect(field.draw(a, b, blend)).toBe(false);
    expect(field.draw(a, b, { ...blend, w: blend.w + 1e-5 })).toBe(false);
    expect(texture.version - before).toBe(1);
  });

  it('rewrites for another month, another weight or another file', () => {
    const field = new ClimateField(createClimateUniforms());
    const [a, b] = [read(1816), read(1816)];
    const july = monthsAround(dayFromIso('1816-07-01'));
    field.draw(a, a, july);
    expect(field.draw(a, a, monthsAround(dayFromIso('1816-07-02')))).toBe(true);
    expect(field.draw(a, a, monthsAround(dayFromIso('1816-08-20')))).toBe(true);
    expect(field.draw(b, b, monthsAround(dayFromIso('1816-08-20')))).toBe(true);
  });

  it("redraws a story's month after Explore has drawn another", async () => {
    const uniforms = createClimateUniforms();
    const field = climateFieldOf(uniforms);
    const load = (url: string) => Promise.resolve(read(yearOf(url)));
    const tambora = new StoryClimate(story, SOURCE, field, load);
    const beat = story.beats.findIndex((b) => b.id === 'europe-1816');
    const onEurope: WalkState = {
      story,
      beat,
      mode: 'paused',
      flight: null,
      flying: false,
      day: story.beats[beat]?.day ?? 0,
      advanceIn: null,
    };
    tambora.load();
    await flush();
    tambora.update(onEurope, 1 / 30, 1);
    const europe = texels(uniforms);

    // Explore draws January 1900 into the same field, then ends.
    const explore = new ClockClimate(SOURCE, field, {
      fetch: (url) => Promise.resolve(stored(yearOf(url))),
      decode: (stored) => Promise.resolve(parseClimate(new Uint8Array(stored))),
    });
    const january1900 = { day: dayFromIso('1900-01-20'), spanDays: 365 };
    for (let frame = 0; frame < 20; frame += 1) {
      explore.update(january1900, 1 / 30);
      await flush();
    }
    expect(explore.month).toEqual({ year: 1900, month: 1 });
    expect(texels(uniforms)).not.toEqual(europe);
    explore.end();

    tambora.update(onEurope, 1 / 30, 1);
    expect(texels(uniforms)).toEqual(europe);
  });
});
