// The lobby's opening (PRD, "First visit: the lobby"): a few seconds in which the lamp comes up out
// of the dark room, both armillary rings swing into place from nearly edge-on with a small
// overshoot, as pendulums do, and the globe coasts in from a short spin into the lobby's slow
// turn, never stopping or swinging back, the gears following it. One progress value, 0 to 1, gives
// the whole pose, so skipping the opening only runs the rest of it faster, and the plaques and
// glows come in once the instrument has nearly settled.

/** How long the opening plays, and how long its rest takes once skipped, in seconds. */
export const OPENING_S = 4;
export const SKIP_S = 0.25;
/** The lobby's turn, in degrees of longitude a second at world view, which the spin runs into. */
export const TURN_DEG_S = 1;

export interface OpeningPose {
  /** How far the lamp has come up: 0 dark, 1 lit. */
  lamp: number;
  /** How far each ring stands turned from its place about its upright axis, in degrees. */
  meridian: number;
  outer: number;
  /**
   * How far the globe stands turned from the view the lobby's turn starts from, in degrees of
   * longitude.
   */
  spin: number;
  /** How far the plaques and the glows have come in: 0 not yet, 1 there. */
  reveal: number;
}

/**
 * Where the rings and the globe start: the rings nearly edge-on to the camera (which looks from
 * about 12 degrees left of the instrument's front), swinging in from opposite sides, and the globe
 * a little west of its rest, so it settles turning the way the lobby then turns it.
 */
const MERIDIAN_FROM = -74;
const OUTER_FROM = 56;
const SPIN_FROM = 24;
/** How far past its place a ring's swing carries before it settles back, as the curve's bulge. */
const OVERSHOOT = 8;

/** The opening's pose `progress` of the way through it. */
export function openingPose(progress: number): OpeningPose {
  const p = clamp01(progress);
  return {
    // Up from the start, quickly at first, so the room's poster dissolves into the rising lamp.
    lamp: 1 - (1 - stretch(p, 0, 0.55)) ** 2,
    outer: OUTER_FROM * (1 - settle(stretch(p, 0.04, 0.72))),
    meridian: MERIDIAN_FROM * (1 - settle(stretch(p, 0.14, 0.84))),
    spin: coast(p),
    reveal: smooth(stretch(p, 0.55, 1)),
  };
}

/**
 * From rest at 0 to rest at 1, passing a few percent beyond 1 on the way: a smootherstep-like
 * rise with a bulge that vanishes, with its slope, at both ends.
 */
function settle(x: number): number {
  return x * x * (3 - 2 * x) + OVERSHOOT * x ** 3 * (1 - x) ** 2;
}

/**
 * The spin at `x`: from SPIN_FROM at rest down to 0, where it moves at the lobby's turn (in degrees
 * per unit of progress), so the turn carries on from it. A cubic with those ends, falling all the
 * way, as a heavy globe on its bearings coasts.
 */
function coast(x: number): number {
  const v = TURN_DEG_S * OPENING_S;
  return SPIN_FROM * (2 * x ** 3 - 3 * x ** 2 + 1) - v * (x ** 3 - x ** 2);
}

/** Where `p` falls between `from` and `to`, clamped to 0..1. */
function stretch(p: number, from: number, to: number): number {
  return clamp01((p - from) / (to - from));
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
