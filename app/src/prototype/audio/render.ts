// Every sound rendered offline for listening away from the page (scripts/renderSounds.ts): each
// voice several times over, a scrub by months and one by days, a flight, the Tambora bed at three
// moments (and room tone alone) and each cue, as 48 kHz 16-bit stereo WAV with its peak and RMS.
import { tamboraBed } from '../../audio/bed';
import { CUE_NAMES, startCue, type CueName } from '../../audio/cues';
import { SoundEngine } from '../../audio/engine';
import type { Mix } from '../../audio/mix';
import { clunk, detent, type DetentWeight } from '../../audio/voices';
import { dayFromIso } from '../../story/dates';
import { flight, scrub } from './demos';

const RATE = 48000;

interface Take {
  seconds: number;
  /** Plays the take into a render `seconds` long. */
  play(engine: SoundEngine, seconds: number): void;
}

const spaced = (count: number, gap: number, play: (engine: SoundEngine, at: number) => void) => ({
  seconds: 0.4 + count * gap,
  play(engine: SoundEngine) {
    for (let k = 0; k < count; k += 1) play(engine, 0.2 + k * gap);
  },
});

const detents = (weight: DetentWeight, gap: number) =>
  spaced(8, gap, (engine, at) => detent(engine, weight, at));

const bed = (iso: string): Take => ({
  seconds: 60,
  play(engine, seconds) {
    tamboraBed(engine, dayFromIso(iso), 0).stop(seconds - 1.5, 1.2);
  },
});

const cue = (name: CueName): Take => ({
  seconds: 20,
  play(engine, seconds) {
    startCue(engine, name, 0.05).stop(seconds - 1.4, 1.2);
  },
});

export const TAKES: Record<string, Take> = {
  'voice-detent-day': detents('day', 0.45),
  'voice-detent-month': detents('month', 0.55),
  'voice-detent-year': detents('year', 0.7),
  'voice-clunk': spaced(6, 1.1, (engine, at) => clunk(engine, at)),
  'voice-whir': {
    seconds: 9.4,
    play(engine) {
      let at = 0.2;
      for (const peak of [0.35, 0.65, 1]) at = flight(engine, 2.4, at, peak) + 0.6;
    },
  },
  'detent-scrub': {
    seconds: 5.2,
    play(engine) {
      const [from, to] = [dayFromIso('1815-01-01'), dayFromIso('1818-01-01')];
      const back = scrub(engine, from, to, 2, 0.2) + 0.9;
      scrub(engine, to, from, 1.6, back);
    },
  },
  'detent-scrub-days': {
    seconds: 3.4,
    play(engine) {
      const [from, to] = [dayFromIso('1815-03-20'), dayFromIso('1815-04-20')];
      const back = scrub(engine, from, to, 1.4, 0.2, 'day') + 0.4;
      scrub(engine, to, from, 1.12, back, 'day');
    },
  },
  'whir-flight': {
    seconds: 4.8,
    play(engine) {
      flight(engine, 4, 0.2);
    },
  },
  'bed-1815-03-01': bed('1815-03-01'),
  'bed-1815-04-11': bed('1815-04-11'),
  'bed-1816-07-01': bed('1816-07-01'),
  // Room tone alone, once the mountain is quiet.
  'bed-1818-01-01': bed('1818-01-01'),
  ...Object.fromEntries(CUE_NAMES.map((name) => [`cue-${name}`, cue(name)])),
};

export interface Rendered {
  /** The WAV file, base64. */
  wav: string;
  seconds: number;
  peakDb: number;
  rmsDb: number;
}

export async function render(name: string, mix: Mix): Promise<Rendered> {
  const take = takeNamed(name);
  const channels = await play(take, mix);
  let peak = 0;
  let power = 0;
  for (const channel of channels) {
    for (const v of channel) {
      peak = Math.max(peak, Math.abs(v));
      power += v * v;
    }
  }
  const db = (v: number) => Math.round(200 * Math.log10(Math.max(v, 1e-10))) / 10;
  const frames = channels[0]?.length ?? 1;
  return {
    wav: base64(wav(channels)),
    seconds: take.seconds,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(power / (2 * frames))),
  };
}

function takeNamed(name: string): Take {
  const take = TAKES[name];
  if (!take) throw new Error(`no take named ${name}`);
  return take;
}

async function play(take: Take, mix: Mix): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(2, Math.round(take.seconds * RATE), RATE);
  take.play(new SoundEngine(ctx, mix), take.seconds);
  const buffer = await ctx.startRendering();
  return [buffer.getChannelData(0), buffer.getChannelData(1)];
}

/** 16-bit PCM WAV, interleaved, with triangular dither. */
function wav(channels: Float32Array[]): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i += 1) {
    for (const [c, channel] of channels.entries()) {
      const dither = Math.random() - Math.random();
      const v = Math.round((channel[i] ?? 0) * 32767 + dither);
      view.setInt16(44 + i * 4 + c * 2, Math.max(-32768, Math.min(32767, v)), true);
    }
  }
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
