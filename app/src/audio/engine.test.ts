import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAccount } from '../perf/memory';
import { audioClock } from '../test/audio';
import { SoundEngine } from './engine';
import { loop, Sources } from './synth';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bed noise ownership', () => {
  it('shares noise across a crossfade, releases exclusive buffers after the tail, and keeps UI noise', () => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    const outgoing = new Sources();
    const incoming = new Sources();
    const bytes = () => {
      const account = new MemoryAccount();
      engine.inspectMemory(account);
      return account.report().totals.audioSamples;
    };
    const shared = engine.noise('pink', 1, outgoing);
    const exclusive = engine.noise('brown', 1, outgoing);
    const ui = engine.noise('white', 1);
    loop(engine, shared, 0, outgoing);
    loop(engine, exclusive, 0, outgoing);
    outgoing.stop(1);
    expect(engine.noise('pink', 1, incoming)).toBe(shared);
    expect(engine.noise('white', 1, incoming)).toBe(ui);
    loop(engine, shared, 0.5, incoming);
    expect(bytes()).toBe((shared.length + exclusive.length + ui.length) * 4);
    clock.advance(0.99);
    expect(bytes()).toBe((shared.length + exclusive.length + ui.length) * 4);
    clock.advance(1);
    expect(bytes()).toBe((shared.length + ui.length) * 4);
    incoming.stop(2);
    clock.advance(2);
    expect(bytes()).toBe(ui.length * 4);
    expect(engine.noise('white', 1)).toBe(ui);
  });

  it('forgets kept noise on release, and a playing bed’s once its sources end', () => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    const account = () => {
      const memory = new MemoryAccount();
      engine.inspectMemory(memory);
      return memory;
    };
    const bed = new Sources();
    const ui = engine.noise('white', 1);
    const shared = engine.noise('pink', 1, bed);
    expect(engine.noise('pink', 1)).toBe(shared);
    loop(engine, shared, 0, bed);
    engine.releaseNoise();
    expect(account().report().totals.audioSamples).toBe(shared.length * 4);
    bed.stop(1);
    clock.advance(1);
    expect(account().report().totals.audioSamples).toBe(0);
    expect(account().details.audio).toMatchObject({ cachedNoiseBuffers: 0 });
    expect(engine.noise('white', 1)).not.toBe(ui);
  });
});
