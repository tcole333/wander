// How much of the instrument shows as the camera nears it: each part fades as the camera passes
// through it, and the whole instrument goes once the camera is close to the globe's surface (PRD,
// "the armillary rings fade as the camera passes through them").

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A part's opacity for a camera `gap` away from its surface: 0 at `near` or closer, 1 at `far` or
 * farther, eased between.
 */
export function partOpacity(gap: number, near: number, far: number): number {
  return smoothstep(near, far, gap);
}

/**
 * The whole instrument's opacity for a camera `altitude` globe radii above the surface: gone at
 * `hideAltitude` and below, whole from `hideAltitude + band` up.
 */
export function instrumentOpacity(altitude: number, hideAltitude: number, band = 0.1): number {
  return smoothstep(hideAltitude, hideAltitude + band, altitude);
}
