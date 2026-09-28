// A route is another FlightPath: the director still owns its clock, easing, gate and retargets.
// Its progress combines distance and days, so a port takes a little time without stopping the
// voyage for months. Reading the day back from that progress keeps ship, camera and ruler together.
import { tunables } from '../config/tunables';
import type { RouteData } from '../data/route';
import { mixViews, type ViewState } from '../view/viewState';
import { EARTH_KM } from './effects/geo';
import { routeFrame } from './effects/route';
import { flightEase, flightPath, RHO, type FlightPath } from './flight';

export interface VoyagePath extends FlightPath {
  sailedKm: number;
  followKm: number;
  durationS: number;
  dayAt(t: number): number;
}

/** Clips the loaded route to these days, forwards or backwards; absent fleet means direct flight. */
export function voyagePath(
  from: ViewState,
  to: ViewState,
  route: RouteData,
  fromDay: number,
  toDay: number,
): VoyagePath | null {
  if (fromDay === toDay) return null;
  const first = routeFrame(route, fromDay, 0).fleet;
  if (!first || !routeFrame(route, toDay, 0).fleet) return null;
  const low = Math.min(fromDay, toDay);
  const high = Math.max(fromDay, toDay);
  const interior = [...new Set(route.pts.map((p) => p[2] + route.epochDay))].filter(
    (day) => day > low && day < high,
  );
  if (toDay < fromDay) interior.reverse();
  const days = [fromDay, ...interior, toDay];
  let previous = first;
  let sailedKm = 0;
  const distances = days.map((day) => {
    const fleet = routeFrame(route, day, 0).fleet!;
    // atan2 preserves zero for a stay and precision for the prebuild's short channel segments.
    sailedKm += Math.atan2(previous.clone().cross(fleet).length(), previous.dot(fleet)) * EARTH_KM;
    previous = fleet;
    return sailedKm;
  });
  const weight = sailedKm > 1e-6 ? tunables.voyageDistanceWeight : 0;
  const progress = days.map(
    (day, i) =>
      weight * (sailedKm > 0 ? distances[i]! / sailedKm : 0) +
      (1 - weight) * ((day - fromDay) / (toDay - fromDay)),
  );
  const dayAt = (t: number) => {
    if (t <= 0) return fromDay;
    if (t >= 1) return toDay;
    // Let the framing widen before much sailing, and bring the fleet close before narrowing.
    // Value, slope and curvature meet the steady middle at the ends of these ramps.
    const blend = tunables.voyageBlend;
    const sailed =
      t < blend
        ? t * flightEase(t / blend)
        : t > 1 - blend
          ? 1 - (1 - t) * flightEase((1 - t) / blend)
          : t;
    let lo = 1;
    let hi = progress.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (progress[mid]! < sailed) lo = mid + 1;
      else hi = mid;
    }
    const f = (sailed - progress[lo - 1]!) / (progress[lo]! - progress[lo - 1]!);
    return days[lo - 1]! + (days[lo]! - days[lo - 1]!) * f;
  };

  const width = tunables.voyageWidth;
  const followKm = Math.min(width.max, Math.max(width.min, sailedKm * width.ofDistance));
  const duration = tunables.voyageDuration;
  const durationS =
    Math.min(
      duration.max,
      Math.max(duration.min, duration.base + (1000 * sailedKm) / duration.kmPerSecond),
    ) / 1000;
  const following = (t: number): ViewState => {
    const fleet = routeFrame(route, dayAt(t), 0).fleet!;
    return {
      lon: (Math.atan2(fleet.x, fleet.z) * 180) / Math.PI,
      lat: (Math.atan2(fleet.y, Math.hypot(fleet.x, fleet.z)) * 180) / Math.PI,
      viewKm: followKm,
      tilt: 0,
      heading: 0,
    };
  };
  return {
    sailedKm,
    followKm,
    durationS,
    // The two changes of framing plus the sailing at following width, in zoom/pan units.
    length:
      flightPath(from, following(0)).length +
      (RHO * sailedKm) / followKm +
      flightPath(following(1), to).length,
    dayAt,
    at(t) {
      if (t <= 0) return { ...from };
      if (t >= 1) return { ...to };
      const follow = following(t);
      const blend = tunables.voyageBlend;
      if (t < blend) return mixViews(from, follow, flightEase(t / blend));
      if (t > 1 - blend) return mixViews(follow, to, flightEase((t - (1 - blend)) / blend));
      return follow;
    },
  };
}
