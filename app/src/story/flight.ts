// Camera flights between views (streaming.md 5.7, Flights): van Wijk and Nuij's smooth zooming and
// panning path, which widens the view as it travels so the ground never races past, then narrows
// onto the destination. The view center follows the great circle: u is the distance along it and
// w the view's width, both in km, as the path needs them in one unit. Tilt and heading ease
// alongside. The caller eases time into the path's parameter.
import { EARTH_RADIUS_KM } from '../globe/viewCamera';
import { arcKm, mixViews, type ViewState } from '../view/viewState';

/** How strongly the path trades zooming out for panning. */
export const RHO = 1.42;

/** A flight lasts its path length over this, within the clamp below, in seconds. */
const LENGTH_PER_S = 0.8;
const MIN_S = 2.4;
const MAX_S = 5;

const DEG = Math.PI / 180;

export interface FlightPath {
  /** The path's length S, in e-folds of zoom over rho; it sets the duration. */
  length: number;
  /** The view `t` of the way along the path, 0 to 1. */
  at(t: number): ViewState;
}

/** The steepest start flightEase takes before it would overshoot. */
export const MAX_LEAD = 2.5;

/** clamp(S / 0.8, 2.4, 5) seconds. */
export function flightSeconds(length: number): number {
  return Math.min(MAX_S, Math.max(MIN_S, length / LENGTH_PER_S));
}

/**
 * The share of the path covered `t` of the way through a flight: it starts and lands without a
 * jolt (smootherstep). A flight that takes over from one under way starts at slope `lead`
 * instead, so the camera keeps its pace (a quintic Hermite; up to MAX_LEAD it never backs up).
 */
export function flightEase(t: number, lead = 0): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (10 - 15 * u + 6 * u * u) + lead * u * (1 - u) ** 3 * (1 + 3 * u);
}

export function flightPath(from: ViewState, to: ViewState, rho = RHO): FlightPath {
  const w0 = from.viewKm;
  const w1 = to.viewKm;
  const u1 = arcKm(from, to);
  const rho2 = rho * rho;

  // Nearly the same center: a pure zoom, evenly in log space.
  if (u1 < 1e-6 * Math.min(w0, w1)) {
    return {
      length: Math.abs(Math.log(w1 / w0)) / rho,
      at: (t) => viewAt(from, to, t, t, w0 * Math.exp(Math.log(w1 / w0) * t)),
    };
  }

  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const length = (r1 - r0) / rho;
  return {
    length,
    at(t) {
      const r = rho * t * length + r0;
      const u = (w0 / (rho2 * u1)) * (Math.cosh(r0) * Math.tanh(r) - Math.sinh(r0));
      return viewAt(from, to, t, u, (w0 * Math.cosh(r0)) / Math.cosh(r));
    },
  };
}

/** The view `f` of the way along the great circle, `widthKm` wide, tilt and heading at `t`. */
function viewAt(from: ViewState, to: ViewState, t: number, f: number, widthKm: number): ViewState {
  if (t >= 1) return { ...to };
  if (t <= 0) return { ...from };
  const [lon, lat] = greatCircle(from, to, f);
  const { tilt, heading } = mixViews(from, to, t);
  return { lon, lat, viewKm: widthKm, tilt, heading };
}

/** The point `f` of the way from `a`'s center to `b`'s along the great circle, [lon, lat]. */
function greatCircle(a: ViewState, b: ViewState, f: number): [number, number] {
  const omega = arcKm(a, b) / EARTH_RADIUS_KM;
  const sinOmega = Math.sin(omega);
  if (sinOmega < 1e-9) {
    const mixed = mixViews(a, b, f);
    return [mixed.lon, mixed.lat];
  }
  const ka = Math.sin((1 - f) * omega) / sinOmega;
  const kb = Math.sin(f * omega) / sinOmega;
  const [ax, ay, az] = unit(a);
  const [bx, by, bz] = unit(b);
  const x = ka * ax + kb * bx;
  const y = ka * ay + kb * by;
  const z = ka * az + kb * bz;
  return [Math.atan2(y, x) / DEG, Math.atan2(z, Math.hypot(x, y)) / DEG];
}

function unit(view: ViewState): [number, number, number] {
  const lon = view.lon * DEG;
  const lat = view.lat * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
