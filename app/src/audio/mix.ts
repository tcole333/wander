// The mix: every level in Wander's sound, in dB, tuned here and nowhere else. The audition page
// (prototype-audio.html) edits a copy live and copies it out as JSON to paste back over `mix`.
// Voices and cues are levels at their loudest; the rumble's is its level at the eruption, and story
// time scales it (bed.ts). The master runs into a gentle limiter (engine.ts).
import type { CueName } from './cues';

export interface Mix {
  master: number;
  buses: { ui: number; bed: number; cue: number };
  voices: {
    detentDay: number;
    detentMonth: number;
    detentYear: number;
    clunk: number;
    whir: number;
  };
  bed: { room: number; rumble: number };
  cues: Record<CueName, number>;
}

export const mix: Mix = {
  master: 0,
  buses: { ui: 0, bed: 0, cue: 0 },
  voices: { detentDay: -33, detentMonth: -29, detentYear: -26, clunk: -24, whir: -31 },
  bed: { room: -48, rumble: -25 },
  cues: {
    'rumble-far': -27,
    'cannon-far': -21,
    eruption: -16,
    ashfall: -12,
    rain: -27,
    'wind-cold': -28,
  },
};

/** A level in dB as a gain; -96 dB and below is silence. */
export function gainOf(db: number): number {
  return db <= -96 ? 0 : 10 ** (db / 20);
}
