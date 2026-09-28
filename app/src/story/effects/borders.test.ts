// The walk's borders: the field loads in the background and goes to the GPU a face a frame; once
// every face is in, the borders ease in on the beats that list them, out on the others and as the
// view closes in; without a borders section nothing loads or draws, and the walk goes on.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { BORDER_FACES, BORDER_TEXELS } from '../../data/borders';
import type { BordersRelease } from '../../data/release';
import { createBorderUniforms } from '../../look/bordersHook';
import type { WalkState } from '../contract';
import { parseStory } from '../story';
import { WalkBorders } from './borders';

const story = parseStory(
  readFileSync(new URL('../../../../stories/tambora/story.md', import.meta.url), 'utf8'),
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
});
