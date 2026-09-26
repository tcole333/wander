// The prototype page's view state and how it moves: presets eased from one to the next, damped
// steps toward the goal the controls set, drags that slide the view center under the cursor and
// wheel zoom. Pure functions; the page owns the state.
import { EARTH_RADIUS_KM } from '../../globe/viewCamera';

export interface ViewState {
  lon: number;
  lat: number;
  /** The visible width at the view center, across the viewport, in km (viewCamera.ts View). */
  viewKm: number;
  /** Degrees from looking straight down. */
  tilt: number;
  /** Degrees clockwise from north. */
  heading: number;
}

const DEG = Math.PI / 180;
const KM_PER_DEG = (EARTH_RADIUS_KM * Math.PI) / 180;
/** The farthest a drag takes the view center toward a pole. */
const MAX_LAT = 85;

export function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** The spike's cubic ease in and out. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The great-circle distance between two views' centers, in km. */
export function arcKm(a: ViewState, b: ViewState): number {
  const [p1, p2] = [a.lat * DEG, b.lat * DEG];
  const dLon = (b.lon - a.lon) * DEG;
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dLon);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * EARTH_RADIUS_KM;
}

/** The view `t` of the way from `a` to `b`: longitude the short way round, zoom in log space. */
export function mixViews(a: ViewState, b: ViewState, t: number): ViewState {
  return {
    lon: wrap180(a.lon + wrap180(b.lon - a.lon) * t),
    lat: a.lat + (b.lat - a.lat) * t,
    viewKm: Math.exp(Math.log(a.viewKm) + (Math.log(b.viewKm) - Math.log(a.viewKm)) * t),
    tilt: a.tilt + (b.tilt - a.tilt) * t,
    heading: wrap180(a.heading + wrap180(b.heading - a.heading) * t),
  };
}

/**
 * How much higher a flight from `a` to `b` passes, as the natural log of a zoom factor at its
 * middle: enough that the view there is a little wider than the distance between the two ends.
 */
export function flightRise(a: ViewState, b: ViewState): number {
  return Math.max(0, Math.log((1.2 * arcKm(a, b)) / Math.sqrt(a.viewKm * b.viewKm)));
}

const FLIGHT_STEPS = 64;

/**
 * The view at eased time `e` of a flight from `a` to `b`: the zoom in log space, `rise` higher at
 * the middle, and the center moving in step with the view's width, so the ground crosses the
 * screen at an even pace instead of racing past while the view is narrow.
 */
export function flightAt(a: ViewState, b: ViewState, e: number, rise: number): ViewState {
  const logA = Math.log(a.viewKm);
  const logB = Math.log(b.viewKm);
  const width = (t: number) => Math.exp(logA + (logB - logA) * t + rise * Math.sin(Math.PI * t));
  let total = 0;
  let done = 0;
  for (let i = 0; i < FLIGHT_STEPS; i += 1) {
    const w = width((i + 0.5) / FLIGHT_STEPS);
    total += w;
    done += w * Math.min(1, Math.max(0, e * FLIGHT_STEPS - i));
  }
  const moved = mixViews(a, b, done / total);
  return { ...mixViews(a, b, e), lon: moved.lon, lat: moved.lat, viewKm: width(e) };
}

/** A step of `dtS` seconds from `current` toward `goal`, closing it with time constant `tauS`. */
export function damp(current: ViewState, goal: ViewState, dtS: number, tauS: number): ViewState {
  return mixViews(current, goal, 1 - Math.exp(-dtS / tauS));
}

/** How far apart two views are, as the largest of their differences scaled to be comparable. */
export function viewGap(a: ViewState, b: ViewState): number {
  const km = Math.min(a.viewKm, b.viewKm);
  return Math.max(
    (arcKm(a, b) / km) * 100,
    Math.abs(Math.log(a.viewKm / b.viewKm)) * 100,
    Math.abs(a.tilt - b.tilt),
    Math.abs(wrap180(a.heading - b.heading)),
  );
}

/**
 * The view after dragging the ground by (dx, dy) CSS px in a viewport `widthPx` wide: the view
 * center moves the other way, so the ground follows the cursor, with the heading kept.
 */
export function dragView(view: ViewState, dx: number, dy: number, widthPx: number): ViewState {
  const kmPerPx = view.viewKm / widthPx;
  const right = -dx * kmPerPx;
  const up = dy * kmPerPx;
  const h = view.heading * DEG;
  const eastKm = right * Math.cos(h) + up * Math.sin(h);
  const northKm = up * Math.cos(h) - right * Math.sin(h);
  const lat = Math.min(MAX_LAT, Math.max(-MAX_LAT, view.lat + northKm / KM_PER_DEG));
  const lon = wrap180(view.lon + eastKm / (KM_PER_DEG * Math.max(0.05, Math.cos(lat * DEG))));
  return { ...view, lat, lon };
}

/** The view after `deltaY` px of wheel, zooming by e^(k·deltaY) within [minKm, maxKm]. */
export function zoomView(
  view: ViewState,
  deltaY: number,
  minKm: number,
  maxKm: number,
  k = 0.0015,
): ViewState {
  const viewKm = Math.min(maxKm, Math.max(minKm, view.viewKm * Math.exp(k * deltaY)));
  return { ...view, viewKm };
}

/**
 * Relief exaggeration for a view `viewKm` wide: `near` at `nearKm` wide and closer, `far` at
 * `farKm` and wider, log-linear between (PRD: relief exaggerated far beyond reality, especially
 * when zoomed out).
 */
export function reliefForWidth(
  viewKm: number,
  near: number,
  far: number,
  nearKm = 100,
  farKm = 3000,
): number {
  const t = Math.log(viewKm / nearKm) / Math.log(farKm / nearKm);
  return near + (far - near) * Math.min(1, Math.max(0, t));
}
