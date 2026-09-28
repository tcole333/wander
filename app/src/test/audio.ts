// A controllable audio clock for graph/lifetime tests. It records envelopes and source ends;
// sound quality and actual DSP are checked with the Sound Cabinet's browser renders.
import { vi } from 'vitest';

export class Param {
  value: number;
  readonly events: { kind: string; value: number | Float32Array; at: number; duration?: number }[] =
    [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, at: number): void {
    this.events.push({ kind: 'value', value, at });
  }
  linearRampToValueAtTime(value: number, at: number): void {
    this.events.push({ kind: 'linear', value, at });
  }
  exponentialRampToValueAtTime(value: number, at: number): void {
    this.events.push({ kind: 'exponential', value, at });
  }
  setTargetAtTime(value: number, at: number, duration: number): void {
    this.events.push({ kind: 'target', value, at, duration });
  }
  setValueCurveAtTime(value: Float32Array, at: number, duration: number): void {
    this.events.push({ kind: 'curve', value, at, duration });
  }
  cancelScheduledValues(at: number): void {
    this.events.push({ kind: 'cancel', value: 0, at });
  }
}

export function audioClock(sampleRate = 48000) {
  const nodes: Node[] = [];
  const buffers: AudioBuffer[] = [];
  class Node extends EventTarget {
    readonly gain: Param;
    readonly frequency: Param;
    readonly Q: Param;
    readonly pan: Param;
    readonly offset: Param;
    readonly connections: (Node | Param)[] = [];
    readonly buffer: AudioBuffer | null;
    readonly loop: boolean;
    startAt = Infinity;
    endAt = Infinity;
    ended = false;
    disconnected = false;

    constructor(_ctx?: unknown, options: Record<string, unknown> = {}) {
      super();
      this.gain = new Param(Number(options.gain ?? 1));
      this.frequency = new Param(Number(options.frequency ?? 440));
      this.Q = new Param(Number(options.Q ?? 1));
      this.pan = new Param(Number(options.pan ?? 0));
      this.offset = new Param(Number(options.offset ?? 1));
      this.buffer = (options.buffer as AudioBuffer | undefined) ?? null;
      this.loop = Boolean(options.loop);
      nodes.push(this);
    }
    connect<T extends Node | Param>(to: T): T {
      this.connections.push(to);
      return to;
    }
    disconnect(): void {
      this.disconnected = true;
      this.connections.length = 0;
    }
    setPeriodicWave(): void {}
    start(at: number, offset = 0): void {
      this.startAt = at;
      if (this.buffer && !this.loop) this.endAt = at + this.buffer.duration - offset;
    }
    stop(at: number): void {
      this.endAt = at;
    }
  }
  for (const name of [
    'GainNode',
    'DynamicsCompressorNode',
    'BiquadFilterNode',
    'StereoPannerNode',
    'OscillatorNode',
    'ConstantSourceNode',
    'AudioBufferSourceNode',
  ]) {
    vi.stubGlobal(name, Node);
  }
  const ctx = {
    currentTime: 0,
    sampleRate,
    state: 'running',
    destination: new Node(),
    createPeriodicWave: () => ({}),
    createBuffer(channels: number, length: number, rate: number) {
      const buffer = {
        length,
        sampleRate: rate,
        duration: length / rate,
        numberOfChannels: channels,
        copyToChannel() {},
      } as unknown as AudioBuffer;
      buffers.push(buffer);
      return buffer;
    },
  };
  return {
    ctx: ctx as unknown as BaseAudioContext,
    nodes,
    buffers,
    advance(at: number) {
      ctx.currentTime = at;
      for (const node of nodes) {
        if (node.ended || node.endAt > at) continue;
        node.ended = true;
        node.dispatchEvent(new Event('ended'));
      }
      vi.advanceTimersByTime(200);
    },
  };
}
