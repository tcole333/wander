// The walk's climate without a modera section in the release: it fetches nothing, draws nothing and
// says why once, so the walk goes on.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createClimateUniforms } from '../../look/climateHook';
import type { WalkState } from '../contract';
import { parseStory } from '../story';
import { WalkClimate } from './climate';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

describe('the walk climate', () => {
  it('draws nothing and fetches nothing without a modera section', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn();
    const uniforms = createClimateUniforms();
    const climate = new WalkClimate(story, { dataHost: 'https://data.test' }, uniforms, load);
    const beat = story.beats.findIndex((b) => b.id === 'europe-1816');
    const state: WalkState = {
      story,
      beat,
      mode: 'paused',
      flight: null,
      day: story.beats[beat]?.day ?? 0,
      advanceIn: null,
    };
    for (let frame = 0; frame < 60; frame += 1) climate.update(state, 1 / 30, 1);

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
