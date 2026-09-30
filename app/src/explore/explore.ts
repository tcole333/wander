// Explore (issue #79): free time over the globe, as a mode the lobby dives into (walk/mode.ts). The
// dive opens the free clock on an event, the ruler showing exploreOpenYears around its day, and
// flies to the world view over its place while the ruler rises; from there the visitor turns the
// globe and scrubs through all of history. The arrow keys keep panning the view, as in the lobby.
// Where the release has its event index and the look cuts marks, the events of the now window
// mark the globe (exploreEvents.ts), the opening focal among them; the layer's data-explore-marks
// counts the events marked in view. Once the dive has landed, a mark pointed at brings its plate,
// a click pins it, and the keyboard reaches the marks through one listbox (labels.ts). The globe shows the climate at the clock's date wherever
// ModE-RA has it and the ruler is close enough (exploreClimate.ts). Its sound (audio/clockScore.ts)
// hears the clock's day, what the ruler engraves around it, and whether a free flight has the
// camera. Leaving stops input on the ruler, stops asking for events, eases their marks and the
// climate out and fades the sound to the room; ending releases the clock, ruler, event worker and
// climate years and takes the marks off, so the world clock has one owner at a time.
// window.__worldTime, window.__exploreEvents and window.__exploreLabels serve scripts while
// Explore runs.
import '../story/ui/tokens.css';
import '../story/ui/walkUi.css';
import type { WalkAudio } from '../audio/walkAudio';
import type { ClimateSource } from '../climate/years';
import { tunables } from '../config/tunables';
import type { SurfaceLook } from '../contract';
import type { EventsRelease } from '../data/release';
import { EventClient } from '../events/client';
import type { EventMark } from '../events/query';
import { GLOW_FADE_S } from '../lobby/lobby';
import type { MarkLayer, MarkSpec, PlacedMark } from '../marks/marks';
import type { LonLat } from '../story/story';
import { el } from '../story/ui/dom';
import type { Span } from '../story/ui/format';
import { CraftRuler } from '../story/ui/rulerCraft';
import { ExploreTime, HISTORY } from '../time/exploreTime';
import { worldClock, type WorldClock, type WorldTime } from '../time/worldClock';
import { FreeFlight } from '../view/freeFlight';
import type { ViewControl } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import type { Mode } from '../walk/mode';
import { ExploreClimate } from './exploreClimate';
import { ExploreEvents, focalOf, markIdOf, qidNumber } from './exploreEvents';
import { ExploreLabels } from './labels';
import { openings, type Opening } from './openings';

/**
 * The opening until Explore picks among its openings: Waterloo, which the fixture holds, as the
 * bundled lock gives it. A lock without it fails the dive, not the page.
 */
export function waterloo(): Opening {
  const found = openings.find((opening) => opening.qid === 'Q48314');
  if (!found) throw new Error('the openings lock lacks Waterloo (Q48314)');
  return found;
}

/** The dive's view keeps the event's latitude within this, degrees, so no pole faces the lamp. */
const WORLD_LAT = 35;

/** The free clock and ruler, for scripts. */
export interface WorldTimeHook {
  state(): WorldTime;
  span(): Span;
  seek(day: number): void;
  zoom(factor: number, share: number): void;
}

/** Explore's event marks, for scripts. */
export interface ExploreEventsHook {
  /** Makes the event with this Q number (`Q…`) focal, or none. */
  focus(qid: string | null): void;
  /** The focal event's Q number, or null once it has dropped. */
  focal(): string | null;
  /** The marks as last set. */
  marks(): MarkSpec[];
  /** The marks the look drew in view in the last draw. */
  placed(): PlacedMark[];
  /** The event a mark stands for: null for the lock's focal mark, undefined for no such mark. */
  event(id: string): EventMark | null | undefined;
  /** Nothing is on its way from the event worker, or it has failed, and no mark is fading. */
  settled(): boolean;
}

/** Explore's labels, for scripts. */
export interface ExploreLabelsHook {
  /** Pins the event of the mark with this id, as a click does, or unpins with null. */
  pin(id: string | null): void;
  /** The pinned event's Q number (`Q…`), or null. */
  pinned(): string | null;
  /** The mark hovered, by the pointer or the keyboard, or null. */
  hovered(): string | null;
}

declare global {
  interface Window {
    __worldTime?: WorldTimeHook;
    __exploreEvents?: ExploreEventsHook;
    __exploreLabels?: ExploreLabelsHook;
  }
}

/** The event index and the look's marks, which Explore's events need. */
export interface EventsSource {
  release: EventsRelease;
  /** The release's data host, which the index's files come from. */
  dataHost: string;
  marks: MarkLayer;
}

export interface ExploreParts {
  /** The page's host, which Explore's layer goes into. */
  root: HTMLElement;
  /** The globe's canvas, whose marks the labels pick; without it (the unit tests), none are. */
  canvas?: HTMLElement;
  control: ViewControl;
  sound: WalkAudio;
  /** Flown to from the lobby's view, or started where the view already stands (the dev page). */
  arrive: 'jump' | 'fly';
  clock?: WorldClock;
  /** The event the free clock opens on, the place the dive flies to and the focal event. */
  opening?: Pick<Opening, 'qid' | 'day' | 'at' | 'precision' | 'class'>;
  /** Where to find the events, or null for a globe without them. */
  events?: EventsSource | null;
  /**
   * The look Explore draws on and the release naming its data; without both (the unit tests),
   * Explore draws no climate.
   */
  look?: SurfaceLook;
  release?: ClimateSource;
}

/** The world view over `at`, its latitude kept within WORLD_LAT. */
export function worldViewOn([lon, lat]: LonLat, viewKm: number): ViewState {
  return {
    lon,
    lat: Math.max(-WORLD_LAT, Math.min(WORLD_LAT, lat)),
    viewKm,
    tilt: 0,
    heading: 0,
  };
}

export function startExplore({
  root,
  canvas,
  control,
  sound,
  arrive,
  clock = worldClock,
  opening = waterloo(),
  events: source = null,
  look,
  release,
}: ExploreParts): Mode {
  // The clock, flight, layer and climate hold no listeners and stand nowhere on the page, so they
  // come first, then the ruler, the one part holding listeners, and the event worker, and only then
  // are the page, the view's control, the marks and the script hooks touched: a dive that throws
  // on the way leaves nothing behind, since the boot never gets a mode to end.
  const focal = focalOf(opening);
  const time = new ExploreTime(clock, HISTORY, opening.day, {
    openYears: tunables.exploreOpenYears,
  });
  let flight =
    arrive === 'fly'
      ? new FreeFlight(control.current, worldViewOn(opening.at, control.maxKm))
      : null;
  const layer = el('div', 'wu wu-explore wu-mode');
  const climate = look && release ? new ExploreClimate(look, release, clock, layer) : null;
  const ruler = new CraftRuler(time);
  let client: EventClient | null;
  try {
    client = source ? EventClient.create(source.release, source.dataHost) : null;
  } catch (error) {
    ruler.dispose();
    climate?.end();
    throw error;
  }
  const events =
    source && client ? new ExploreEvents({ client, marks: source.marks, focal, arrive }) : null;
  const labels =
    events && canvas
      ? new ExploreLabels({
          events,
          canvas,
          openings,
          panels: () => [ruler.element, ...(climate ? [climate.legend] : [])],
        })
      : null;
  layer.append(ruler.element);
  if (labels) layer.prepend(labels.element);
  root.append(layer);
  let counted = -1;
  // The globe's layers fade in over the dive and out over the return, as a story's effects do.
  let fade = arrive === 'fly' ? 0 : 1;
  let left = false;
  let frameS = 0;

  const landings = new Set<() => void>();
  const land = () => {
    flight = null;
    labels?.land(null);
    for (const landed of [...landings]) landed();
  };
  // Started where the view stands (the dev page), Explore has landed already.
  if (!flight) labels?.land(null);
  control.arrowKeys = true;
  // Input during the dive takes the view from the flight, and the dive counts as landed.
  control.onInput = () => {
    if (flight) land();
  };

  const hook: WorldTimeHook = {
    state: () => clock.state(),
    span: () => time.span,
    seek: (day) => time.seek(day),
    zoom: (factor, share) => time.zoom(factor, share),
  };
  window.__worldTime = hook;
  const eventsHook: ExploreEventsHook | null = events && {
    focus(qid) {
      const number = qid === null ? null : qidNumber(qid);
      if (Number.isNaN(number)) throw new RangeError(`no Q number '${qid}'`);
      events.focus(number === null ? null : { qid: number });
    },
    focal: () => {
      const qid = events.focal?.qid;
      return qid === undefined ? null : markIdOf(qid);
    },
    marks: () => events.marks(),
    placed: () => events.placed(),
    event: (id) => events.event(id),
    settled: () => events.settled(),
  };
  if (eventsHook) window.__exploreEvents = eventsHook;
  const labelsHook: ExploreLabelsHook | null = labels && {
    pin: (id) => (id === null ? labels.unpin() : labels.pin(id)),
    pinned: () => (labels.pinned === null ? null : markIdOf(labels.pinned)),
    hovered: () => labels.hovered,
  };
  if (labelsHook) window.__exploreLabels = labelsHook;

  return {
    landed(cb) {
      landings.add(cb);
      return () => landings.delete(cb);
    },
    lensShift: () => 0,
    beforeCamera(_nowMs, dtS) {
      frameS = dtS;
      fade = Math.max(0, Math.min(1, fade + (left ? -dtS : dtS) / GLOW_FADE_S));
      if (!flight) return;
      control.go(flight.step(dtS), true);
      if (flight.done) land();
    },
    afterPlace(frame, nowMs) {
      climate?.update(frameS, fade);
      events?.update(frame, clock.state(), nowMs);
    },
    ui(_drawn, nowMs) {
      climate?.ui();
      labels?.update(nowMs);
      if (!events) return;
      const count = events.markedInView();
      if (count === counted) return;
      counted = count;
      layer.dataset.exploreMarks = String(count);
    },
    audio: () =>
      left
        ? null
        : {
            clock: { day: clock.state().day, unit: ruler.unit, yearStep: ruler.yearStep },
            flying: flight !== null,
          },
    leave() {
      left = true;
      flight = null;
      landings.clear();
      layer.inert = true;
      labels?.leave();
      events?.leave();
      sound.leave();
    },
    end() {
      flight = null;
      landings.clear();
      labels?.dispose();
      events?.dispose();
      ruler.dispose();
      climate?.end();
      layer.remove();
      if (window.__worldTime === hook) delete window.__worldTime;
      if (eventsHook && window.__exploreEvents === eventsHook) delete window.__exploreEvents;
      if (labelsHook && window.__exploreLabels === labelsHook) delete window.__exploreLabels;
    },
    inspectMemory(account) {
      events?.inspectMemory(account);
      climate?.inspectMemory(account);
    },
  };
}
