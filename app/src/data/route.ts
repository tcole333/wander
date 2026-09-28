/** streaming.md 3.6. Flags belong to the segment LEAVING a point; the last repeats them. */
export type RoutePoint = [lon: number, lat: number, dayOffset: number, flags: number];
export interface RouteData {
  v: 1;
  epochDay: number;
  pts: RoutePoint[];
  labels: { i: number; text: string }[];
}

export const ROUTE_UNCERTAIN = 1;
export const ROUTE_SEA = 2;

/** Validate before any point or date reaches a GPU texture. Stays and equal dates are valid. */
export function parseRoute(bytes: ArrayBuffer): RouteData {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as RouteData;
  if (
    value.v !== 1 ||
    !Number.isInteger(value.epochDay) ||
    !Array.isArray(value.pts) ||
    value.pts.length < 2
  ) {
    throw new Error('invalid route header');
  }
  let previous = -Infinity;
  for (const p of value.pts) {
    if (
      !Array.isArray(p) ||
      p.length !== 4 ||
      !p.every(Number.isFinite) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90 ||
      p[2] < previous ||
      !Number.isInteger(p[3]) ||
      p[3] < 0 ||
      p[3] > 3
    ) {
      throw new Error('invalid route point or date order');
    }
    previous = p[2];
  }
  if (
    !Array.isArray(value.labels) ||
    value.labels.some(
      ({ i, text }) =>
        !Number.isInteger(i) || i < 0 || i >= value.pts.length || typeof text !== 'string',
    )
  ) {
    throw new Error('invalid route labels');
  }
  return value;
}
