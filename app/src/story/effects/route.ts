// The dated route's geometry is a pure function of story time. All the story's route files load
// with the other core effects; no fetches or geometry rebuilding during a flight or scrub.
import { Vector3 } from 'three';
import { parseRoute, type RouteData } from '../../data/route';
import type { FxRelease } from '../../data/release';
import { fetchData } from '../../data/surfaceLayer';
import { setRouteData, type RouteUniforms } from '../../look/routeHook';
import type { WalkState } from '../contract';
import type { Story } from '../story';
import { dirOf } from './geo';
import { FleetShip, type ShipView } from './ship';
import { smoothstep } from './timeline';

export interface RouteSource {
  dataHost: string;
  fx?: FxRelease;
}

export interface RouteCursor {
  /** Every segment before this point is complete; this point's outgoing segment is partial. */
  index: number;
  fraction: number;
}

export interface RouteFrame {
  head: RouteCursor;
  /** Start of the most recent wDays of sailing; stays do not leave an invented wake. */
  tail: RouteCursor;
  /** Unit direction at sea level, null before departure. */
  fleet: Vector3 | null;
}

/** Upper-bound search: at equal dates all the source's controls on that day have been reached. */
function cursorAt(route: RouteData, offset: number): RouteCursor {
  let lo = 0;
  let hi = route.pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (route.pts[mid]![2] <= offset) lo = mid + 1;
    else hi = mid;
  }
  const index = lo - 1;
  const a = route.pts[index];
  const b = route.pts[index + 1];
  return { index, fraction: a && b ? (offset - a[2]) / (b[2] - a[2]) : 0 };
}

/** The short great-circle arc, including through ±180°. Repeated positions remain still. */
export function routeFrame(route: RouteData, day: number, wDays: number): RouteFrame {
  const offset = day - route.epochDay;
  const head = cursorAt(route, offset);
  const tail = cursorAt(route, offset - Math.max(0, wDays));
  const a = route.pts[head.index];
  if (!a) return { head, tail, fleet: null };
  const fleet = dirOf([a[0], a[1]]);
  const b = route.pts[head.index + 1];
  if (b && head.fraction > 0) {
    const end = dirOf([b[0], b[1]]);
    const angle = Math.atan2(new Vector3().crossVectors(fleet, end).length(), fleet.dot(end));
    if (angle > 1e-10) {
      fleet
        .multiplyScalar(Math.sin((1 - head.fraction) * angle))
        .addScaledVector(end, Math.sin(head.fraction * angle))
        .normalize();
    }
  }
  return { head, tail, fleet };
}

interface LoadedRoute {
  name: string;
  data: RouteData;
  shown: number;
  wDays: number;
  ship?: FleetShip;
}

export class WalkRoutes {
  readonly #story: Story;
  readonly #source: RouteSource;
  readonly #uniforms: RouteUniforms | undefined;
  readonly #fetch: (url: string) => Promise<ArrayBuffer>;
  readonly #labelRoot: HTMLElement | undefined;
  #loading?: Promise<void>;
  #routes: LoadedRoute[] = [];
  #disposed = false;

  constructor(
    story: Story,
    source: RouteSource,
    uniforms: RouteUniforms | undefined,
    load = fetchData,
    labelRoot?: HTMLElement,
  ) {
    this.#story = story;
    this.#source = source;
    this.#uniforms = uniforms;
    this.#fetch = load;
    this.#labelRoot = labelRoot;
  }

  load(): Promise<void> {
    return (this.#loading ??= this.#load());
  }

  async #load(): Promise<void> {
    if (!this.#uniforms || this.#disposed) return;
    const names = [
      ...new Set(
        this.#story.beats.flatMap((beat) =>
          beat.effects.flatMap((e) => (e.kind === 'route' ? [e.dataset] : [])),
        ),
      ),
    ];
    if (names.length === 0) return;
    const loaded = await Promise.all(
      names.map(async (name): Promise<LoadedRoute | null> => {
        try {
          const entry = this.#source.fx?.[`${this.#story.id}/${name}`];
          if (!entry || entry.kind !== 'route')
            throw new Error('the release lacks it; run prebuild fx and publish-data');
          const data = parseRoute(await this.#fetch(`${this.#source.dataHost}/${entry.key}`));
          if (data.epochDay !== entry.epochDay)
            throw new Error('route epoch differs from its release');
          return { name, data, shown: 0, wDays: 0 };
        } catch (error) {
          if (!this.#disposed)
            console.warn(`The globe shows no route ${this.#story.id}/${name}: ${String(error)}`);
          return null;
        }
      }),
    );
    if (this.#disposed) return;
    this.#routes = loaded.filter((route): route is LoadedRoute => route !== null);
    if (this.#labelRoot) {
      for (const route of this.#routes) route.ship = new FleetShip(this.#labelRoot);
    }
    setRouteData(
      this.#uniforms,
      this.#routes.map((route) => route.data),
    );
  }

  /** The director reads only resident data; a missing route keeps the ordinary flight. */
  data(name: string): RouteData | undefined {
    return this.#routes.find((route) => route.name === name)?.data;
  }

  update(state: WalkState, dtS: number, strength: number, view?: ShipView): void {
    if (this.#disposed || !this.#uniforms || this.#routes.length === 0) return;
    const field = this.#uniforms.lookRouteState.value;
    const data = field.image.data as Float32Array;
    let visible = false;
    this.#routes.forEach((route, i) => {
      const effect = state.story.beats[state.beat]?.effects.find(
        (e) => e.kind === 'route' && e.dataset === route.name,
      );
      if (effect?.kind === 'route') route.wDays = Math.max(0, effect.wDays);
      const wanted = effect ? 1 : 0;
      const step = Math.max(0, dtS) / 0.5;
      route.shown += Math.max(-step, Math.min(step, wanted - route.shown));
      const frame = routeFrame(route.data, state.day, route.wDays);
      const alpha = frame.fleet ? smoothstep(0, 1, route.shown) * strength : 0;
      if (view) route.ship?.update(route.data, frame, state.day, alpha, view);
      visible ||= alpha > 0;
      data.set([frame.head.index, frame.head.fraction, route.wDays, alpha], i * 8);
      data.set(
        [
          frame.fleet?.x ?? 0,
          frame.fleet?.y ?? 0,
          frame.fleet?.z ?? 0,
          state.day - route.data.epochDay,
        ],
        i * 8 + 4,
      );
    });
    this.#uniforms.lookRouteCount.value = visible ? this.#routes.length : 0;
    field.needsUpdate = true;
  }

  hide(): void {
    for (const route of this.#routes) {
      route.shown = 0;
      route.ship?.hide();
    }
    if (this.#uniforms) this.#uniforms.lookRouteCount.value = 0;
  }

  dispose(): void {
    this.#disposed = true;
    for (const route of this.#routes) route.ship?.dispose();
    this.#routes = [];
    if (this.#uniforms) setRouteData(this.#uniforms, []);
  }
}
