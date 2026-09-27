import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStory } from '../story/story';
import { every, isCueName } from './cues';
import type { Pump, SoundEngine } from './engine';
import { Sources } from './synth';

const stories = new URL('../../../stories/', import.meta.url);

describe('the cues', () => {
  it('has a sound for every cue a story names', () => {
    const named = readdirSync(stories, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const markdown = readFileSync(new URL(`${entry.name}/story.md`, stories), 'utf8');
        return parseStory(markdown).beats.flatMap((beat) => beat.audioCues);
      });
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !isCueName(name))).toEqual([]);
  });
});

/** An engine's clock and scheduler without audio: `wake` runs its pumps as a live timer does. */
function clock() {
  const pumps = new Set<Pump>();
  const engine = {
    ctx: { currentTime: 0 },
    soon: () => engine.ctx.currentTime + 0.05,
    schedule(pump: Pump) {
      pumps.add(pump);
      pump(engine.ctx.currentTime + 0.6);
      return () => pumps.delete(pump);
    },
  };
  const wake = (time: number) => {
    engine.ctx.currentTime = time;
    for (const pump of pumps) pump(time + 0.6);
  };
  return { engine: engine as unknown as SoundEngine, wake };
}

describe('events on the audio clock', () => {
  it('skips the events a late pump missed, rather than sounding them all at once', () => {
    const { engine, wake } = clock();
    const times: number[] = [];
    every(engine, 0.1, new Sources(), (t) => {
      times.push(t);
      return t + 1;
    });
    wake(60);
    expect(times.filter((t) => t < 60)).toEqual([0.1]);
  });
});
