import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tunables } from '../config/tunables';
import { audioClock, Param } from '../test/audio';
import { SoundEngine } from './engine';
import { crossfadeLoop, Sources } from './synth';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shared-buffer loop joins', () => {
  it('overlaps reads by loopCrossfade without copying samples, and skips a stalled clock', () => {
    const clock = audioClock();
    const engine = new SoundEngine(clock.ctx);
    const sources = new Sources();
    const buffer = engine.noise('pink', 1);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    crossfadeLoop(engine, buffer, 0, sources);
    clock.advance(0.6);
    const reads = clock.nodes.filter((node) => node.buffer);
    expect(reads).toHaveLength(2);
    const first = reads[0]!;
    const second = reads[1]!;
    const fade = tunables.loopCrossfade / 1000;
    expect(first.endAt - second.startAt).toBeCloseTo(fade, 10);
    expect(first.buffer).toBe(second.buffer);
    expect(clock.buffers).toHaveLength(1);
    const envelope = first.connections[0]!;
    expect(envelope).not.toBeInstanceOf(Param);
    if (!('gain' in envelope)) throw new Error('missing join envelope');
    const [up, down] = envelope.gain.events;
    expect(up?.duration).toBe(fade);
    expect(down?.duration).toBe(fade);
    const rise = up!.value as Float32Array;
    const fall = down!.value as Float32Array;
    for (let i = 0; i < rise.length; i++) {
      expect(rise[i]! ** 2 + fall[i]! ** 2).toBeCloseTo(1, 6);
    }
    clock.advance(60);
    expect(clock.nodes.filter((node) => node.buffer && node.startAt >= 60)).toHaveLength(1);
    sources.stop(60.2);
    clock.advance(61);
    expect(clock.nodes.filter((node) => node.buffer && !node.ended)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops future events placed by stop callbacks, without lengthening shorter one-shots', () => {
    const clock = audioClock();
    const sources = new Sources();
    const short = sources.add(new OscillatorNode(clock.ctx), 0.5);
    short.start(0);
    short.stop(0.5);
    sources.onStop(() => {
      const future = sources.add(new OscillatorNode(clock.ctx), 9);
      future.start(1);
      future.stop(9);
    });
    const release = vi.fn();
    sources.onEnded(release);
    sources.stop(2);
    const scheduled = clock.nodes.filter((node) => node.startAt < Infinity);
    expect(scheduled.map((node) => node.endAt)).toEqual([0.5, 2]);
    clock.advance(1);
    expect(release).not.toHaveBeenCalled();
    clock.advance(2);
    expect(release).toHaveBeenCalledOnce();
    sources.stop(3);
    expect(release).toHaveBeenCalledOnce();
  });
});
