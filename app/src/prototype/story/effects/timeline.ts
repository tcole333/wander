// The walk's effects as functions of story time (a day number, dates.ts), so scrubbing backward
// shows the right state. An effect dated to a day is fully on at that day's start: a beat lands on
// its date's day number, and what happens that day shows there. Everything here is illustrative:
// shaped to the story's dates, not modeled from observations.
import { ashReachKm } from '../../look/ashHook';
import { dayFromIso } from '../dates';
import type { StoryEffect } from '../story';

export type PlumeEffect = Extract<StoryEffect, { kind: 'plume' }>;
export type PulseEffect = Extract<StoryEffect, { kind: 'pulse' }>;

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** 0 at `a`, 1 at `b`, smooth between; `a` > `b` runs downhill. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Piecewise-linear through [x, y] keys, held flat beyond the ends. */
export function lerpKeys(keys: [number, number][], x: number): number {
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [x1, y1] = sorted[i] ?? last;
    const [x0, y0] = sorted[i - 1] ?? first;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

export interface PlumeState {
  /** How hard the mountain is erupting, 0 to 1: the column's density and the ember's heat. */
  activity: number;
  /** The column's height as a share of heightKm. */
  column: number;
  /** How far downwind the ash cloud has spread, km (across the wind it reaches less). */
  cloudKm: number;
  /** Glowing ash flows around the foot of the mountain, 0 to 1. */
  flows: number;
}

/**
 * The eruption: a first blast on `start` (5 April 1815), a lull, the climax from `peak` (10 April)
 * for about two days, then a decline to nothing by `end` (15 July). The climax's cloud spreads as
 * the ashfall's front does (look/ashHook.ts), so the cloud and the ash on the ground agree.
 */
export function plumeState(plume: PlumeEffect, day: number): PlumeState {
  const { start: s, peak: p, end: e } = plume;
  const activity = lerpKeys(
    [
      [s - 0.3, 0],
      [s, 0.6],
      [s + 2, 0.35],
      [p - 0.3, 0.35],
      [p, 1],
      [p + 2, 1],
      [p + 5, 0.55],
      [p + 12, 0.3],
      [e - 5, 0.08],
      [e, 0],
    ],
    day,
  );
  const first = day > s - 0.3 ? Math.min(500, 0.6 * ashReachKm(day - s + 1, 1)) : 0;
  const climax = Math.min(1500, ashReachKm(day - p, 1));
  return {
    activity,
    column: Math.sqrt(activity),
    cloudKm: Math.max(first, climax),
    flows: day < p - 0.3 ? 0 : Math.exp(-(((day - p - 0.4) / 0.9) ** 2)),
  };
}

/** The ember's heat: a smoulder around the eruption, flaring with it. */
export function emberHeat(plume: PlumeEffect | undefined, day: number): number {
  if (!plume) return 0.6;
  return Math.max(0.4, plumeState(plume, day).activity);
}

export interface PulseState {
  /** 0 hides the pulse. */
  strength: number;
  /** The drawn radius, km. */
  radiusKm: number;
  /** Rings racing out, looping while the pulse is on; otherwise one still ring or stain. */
  racing: boolean;
}

/**
 * rumble: faint rings through its dates, louder toward the end. sound: a ring racing out across
 * its day, then its reach as a still ring for two days. contagion: a stain spreading from a
 * district-sized start to radiusKm by its end, fading a month after.
 */
export function pulseState(pulse: PulseEffect, day: number): PulseState {
  const { start: s, end: e, radiusKm: r } = pulse;
  const span = Math.max(1e-6, e - s);
  switch (pulse.style) {
    case 'rumble': {
      const on = day >= s ? 1 - smoothstep(e, e + 0.5, day) : 0;
      return {
        strength: on * (0.35 + 0.65 * clamp01((day - s) / span) ** 2),
        radiusKm: r,
        racing: true,
      };
    }
    case 'sound':
      if (day < s) return { strength: 0, radiusKm: r, racing: true };
      if (day < e) return { strength: 1, radiusKm: r, racing: true };
      return { strength: clamp01(1 - (day - e) / 2), radiusKm: r, racing: false };
    default: {
      const on = day >= s ? 1 - smoothstep(e, e + 30, day) : 0;
      const grown = 0.15 + 0.85 * Math.sqrt(clamp01((day - s) / span));
      return { strength: on, radiusKm: r * grown, racing: false };
    }
  }
}

/** The veil's anchor: Tambora's climax. */
export const VEIL_START = dayFromIso('1815-04-10');
const VEIL_SOURCE_LON = 118;
const days = (iso: string) => dayFromIso(iso) - VEIL_START;

/** The veil's poleward edges, north and south latitude, by days after VEIL_START. */
const VEIL_EDGES: [number, number, number][] = [
  [0, -4, -12],
  [25, 22, -28],
  [days('1815-06-28'), 58, -45],
  [days('1815-10-01'), 72, -65],
  [days('1816-02-01'), 90, -90],
];

/** How thick the veil is overall, by days after VEIL_START. */
const VEIL_AMOUNT: [number, number][] = [
  [0, 0.3],
  [30, 0.7],
  [200, 1],
  [days('1817-01-01'), 1],
  [days('1817-12-31'), 0.15],
  [days('1818-06-01'), 0],
];

/**
 * The veil's density at a place, 0 to 1: it spreads west around the tropics from Tambora within
 * about three weeks, reaches England by late June 1815, covers both hemispheres through 1816 and
 * thins through 1817.
 */
export function veilDensity(lon: number, lat: number, day: number): number {
  const t = day - VEIL_START;
  if (t <= 0) return 0;
  const north = lerpKeys(
    VEIL_EDGES.map(([x, n]) => [x, n]),
    t,
  );
  const south = lerpKeys(
    VEIL_EDGES.map(([x, , s]) => [x, s]),
    t,
  );
  const band = smoothstep(north + 6, north - 6, lat) * smoothstep(south - 6, south + 6, lat);
  const west = (((VEIL_SOURCE_LON - lon) % 360) + 360) % 360;
  const westFront = (360 * t) / 21;
  const eastFront = (30 * t) / 21;
  const around = Math.max(
    smoothstep(westFront + 30, westFront - 30, west),
    smoothstep(eastFront + 20, eastFront - 20, 360 - west),
  );
  const polar = 1 - 0.35 * smoothstep(25, 75, Math.abs(lat));
  return band * around * polar * lerpKeys(VEIL_AMOUNT, t);
}
