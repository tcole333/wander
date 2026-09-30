import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAccount } from '../perf/memory';
import { dayFromIso } from '../story/dates';
import { audioClock } from '../test/audio';
import { magellanBed, museumBed, prepareBed, rumbleLevel, tamboraBed } from './bed';
import { startCue } from './cues';
import { SoundEngine } from './engine';
import { gainOf, mix } from './mix';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the Tambora bed's rumble", () => {
  it('peaks at the eruption and recedes to room tone', () => {
    const at = (iso: string) => rumbleLevel(dayFromIso(iso));
    expect(at('1815-04-11')).toBe(1);
    expect(at('1815-03-01')).toBeLessThan(at('1815-04-05'));
    expect(at('1816-07-01')).toBeLessThan(at('1815-07-15'));
    expect(at('1818-01-01')).toBe(0);
  });
});

describe('a prepared bed', () => {
  it.each([
    ['museum', museumBed],
    ['tambora', tamboraBed],
    ['magellan', magellanBed],
  ] as const)("builds all of the %s bed's noise beforehand, and no more", (voice, bed) => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    prepareBed(engine, voice);
    vi.runAllTimers();
    const prepared = clock.buffers.length;
    bed(engine, dayFromIso('1815-04-11'), 0).stop(0);
    expect(clock.buffers).toHaveLength(prepared);
    clock.advance(2);
    const account = new MemoryAccount();
    engine.inspectMemory(account);
    expect(account.details.audio).toMatchObject({ cachedNoiseBuffers: 0 });
  });
});

describe("Magellan's bed and cues", () => {
  it.each([44100, 48000, 96000])(
    'adds no decoded buffers, even during repeated story crossfades at %i Hz',
    (rate) => {
      const clock = audioClock(rate);
      const engine = new SoundEngine(clock.ctx);
      const bytes = () => {
        const account = new MemoryAccount();
        engine.inspectMemory(account);
        return account.report().totals.audioSamples;
      };
      let bed = tamboraBed(engine, dayFromIso('1815-04-11'), 0);
      const tamboraBytes = bytes();
      const allocated = clock.buffers.length;
      // All of Magellan, including Mactan and the bell, borrows buffers already held by Tambora.
      const sea = magellanBed(engine, dayFromIso('1519-09-20'), 0);
      const bell = startCue(engine, 'ship-bell', 0);
      const shallows = startCue(engine, 'surf-shallows', 0);
      expect(clock.buffers).toHaveLength(allocated);
      expect(bytes()).toBe(tamboraBytes);
      bed.stop(0);
      clock.advance(2);
      const roomBytes = bytes();
      expect(roomBytes).toBeLessThan(tamboraBytes);
      expect(roomBytes).toBe(
        clock.buffers.slice(0, 3).reduce((sum, buffer) => sum + buffer.length * 4, 0),
      );
      bell.stop(2);
      shallows.stop(2);
      bed = sea;
      for (let k = 0; k < 6; k++) {
        const at = clock.ctx.currentTime;
        bed.stop(at);
        const volcanic = k % 2 === 0;
        bed = volcanic
          ? tamboraBed(engine, dayFromIso('1815-04-11'), at)
          : magellanBed(engine, dayFromIso('1519-09-20'), at);
        expect(bytes()).toBeLessThanOrEqual(tamboraBytes);
        clock.advance(at + 2);
        expect(bytes()).toBe(volcanic ? tamboraBytes : roomBytes);
      }
      bed.stop(clock.ctx.currentTime);
      clock.advance(clock.ctx.currentTime + 2);
      expect(bytes()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(clock.nodes.filter((node) => node.startAt < Infinity && !node.ended)).toEqual([]);
    },
  );

  it('fades all three layers to the room, keeps them silent on remix, and restores them on a dive', () => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    const day = dayFromIso('1521-02-01');
    const bed = magellanBed(engine, day, 0);
    const levels = ['surf', 'timber', 'rigging'] as const;
    const gains = levels.map((name) =>
      clock.nodes.find((node) => node.gain.value === gainOf(mix.bed[name])),
    );
    expect(gains.every(Boolean)).toBe(true);
    bed.toRoom(1);
    for (const gain of gains) expect(gain?.gain.events.at(-1)?.value).toBe(0);
    const changed = structuredClone(mix);
    changed.bed.surf = -38;
    engine.setMix(changed);
    bed.setMix(changed, 2);
    for (const gain of gains) expect(gain?.gain.events.at(-1)?.value).toBe(0);
    bed.setDay(day, 3);
    for (const [i, name] of levels.entries()) {
      expect(gains[i]?.gain.events.at(-1)?.value).toBe(gainOf(changed.bed[name]));
    }
    bed.stop(4);
    clock.advance(6);
  });

  it('keeps timber events sparse and releases each one while the bed keeps playing', () => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    const bed = magellanBed(engine, dayFromIso('1519-09-20'), 0);
    for (let t = 0.2; t <= 90; t += 0.2) clock.advance(t);
    // Rubs are reads shorter than the room buffer, with no loop join or repeated recording.
    const rubs = clock.nodes.filter(
      (node) => node.buffer && node.endAt - node.startAt < 3.3 && node.startAt >= 3.5,
    );
    expect(rubs.length).toBeGreaterThanOrEqual(3);
    expect(rubs.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < rubs.length; i++) {
      expect(rubs[i]!.startAt - rubs[i - 1]!.endAt).toBeGreaterThanOrEqual(8);
    }
    expect(rubs.filter((node) => !node.ended).length).toBeLessThanOrEqual(1);
    expect(rubs.filter((node) => node.ended).every((node) => node.disconnected)).toBe(true);
    bed.stop(90);
    clock.advance(92);
    expect(vi.getTimerCount()).toBe(0);
  });
});
