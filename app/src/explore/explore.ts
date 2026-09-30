// Explore (issue #79): free time over the globe, as a mode the lobby dives into (walk/mode.ts). The
// dive opens the free clock on an event the visitor has not seen lately (openings.ts), the ruler
// showing exploreOpenYears around its day, and flies to the world view over its place while the
// ruler rises; from there the visitor turns the globe and scrubs through all of history. The arrow
// keys keep panning the view, as in the lobby. Where the release has its event index and the look
// cuts marks, the events of the now window mark the globe (exploreEvents.ts), the opening focal
// among them; the layer's data-explore-marks counts the events marked in view. The dive lands with
// the opening's plate pinned, its written line on it; from then a mark pointed at brings its
// plate, a click pins it, and the keyboard reaches the marks through one listbox (labels.ts).
// Meanwhile names what happens then elsewhere, as the event worker picks it (exploreMeanwhile.ts);
// choosing an entry flies there, 1,500 km wide, and pins it on landing. The globe shows the
// climate at the clock's date wherever ModE-RA has it and the ruler is close enough
// (exploreClimate.ts). Its sound (audio/clockScore.ts) hears the clock's day, what the ruler
// engraves around it, and whether a free flight has the camera. Leaving stops input on the ruler,
// stops asking for events, eases their marks and the climate out and fades the sound to the room;
// ending releases the clock, ruler, event worker and climate years and takes the marks off, so the
// world clock has one owner at a time. Where the look holds the border steps, the borders follow
// the clock from the dive on (exploreBorders.ts), with no plate of their own: the ruler and the
// Credits carry the dates. window.__worldTime, window.__exploreEvents, window.__exploreLabels and
// window.__borders serve scripts while Explore runs.
import '../story/ui/tokens.css';
import '../story/ui/walkUi.css';
import type { WalkAudio } from '../audio/walkAudio';
import type { ClockBorders } from '../borders/clockBorders';
import type { ClimateSource } from '../climate/years';
import { tunables } from '../config/tunables';
import type { SurfaceLook } from '../contract';
import type { EventsRelease } from '../data/release';
import { EventClient } from '../events/client';
import type { MeanwhileEvent } from '../events/meanwhile';
import type { EventMark } from '../events/query';
import { GLOW_FADE_S } from '../lobby/lobby';
import type { MarkLayer, MarkSpec, PlacedMark } from '../marks/marks';
import type { LonLat } from '../story/story';
import { el } from '../story/ui/dom';
import type { Span } from '../story/ui/format';
import { ARRIVE_KM } from '../story/ui/meanwhile';
import { CraftRuler } from '../story/ui/rulerCraft';
import { ExploreTime, HISTORY } from '../time/exploreTime';
import { worldClock, type WorldClock, type WorldTime } from '../time/worldClock';
import { FreeFlight } from '../view/freeFlight';
import type { ViewControl } from '../view/viewControl';
import type { ViewState } from '../view/viewState';
import type { Mode } from '../walk/mode';
import { ExploreBorders } from './exploreBorders';
import { ExploreClimate } from './exploreClimate';
import { ExploreEvents, focalOf, markIdOf, qidNumber } from './exploreEvents';
import { ExploreLabels } from './labels';
import { ExploreMeanwhile } from './exploreMeanwhile';
import { openingForDive, openings, type Opening } from './openings';

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
  /**
   * Nothing is on its way from the event worker, Meanwhile's answer included, or it has failed,
   * and no mark is fading: the marks and Meanwhile's list stand as they will until something
   * changes.
   */
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
  /** The page's mark and sound knob, which stand over Explore's layer and its plates avoid. */
  chrome?: readonly HTMLElement[];
  control: ViewControl;
  sound: WalkAudio;
  /** Flown to from the lobby's view, or started where the view already stands (the dev page). */
  arrive: 'jump' | 'fly';
  clock?: WorldClock;
  /**
   * The event the free clock opens on, the place the dive flies to, and the focal event, pinned
   * when the dive lands; by default the one openingForDive picks.
   */
  opening?: Pick<Opening, 'qid' | 'day' | 'at' | 'precision' | 'class'>;
  /** Where to find the events, or null for a globe without them. */
  events?: EventsSource | null;
  /**
   * The look Explore draws on and the release naming its data; without both (the unit tests),
   * Explore draws no climate.
   */
  look?: SurfaceLook;
  release?: ClimateSource;
  /** The look's border steps, where it holds them. */
  borders?: ClockBorders | null;
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
  chrome = [],
  control,
  sound,
  arrive,
  clock = worldClock,
  opening = openingForDive(),
  events: source = null,
  look,
  release,
  borders: steps = null,
}: ExploreParts): Mode {
  // The clock, flight, layer, climate and borders hold no listeners and stand nowhere on the page,
  // so they come first, then the ruler, the one part holding listeners, and the event worker, and
  // only then are the page, the view's control, the marks and the script hooks touched: a dive
  // that throws on the way leaves nothing behind, since the boot never gets a mode to end.
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
  const borders = steps ? new ExploreBorders(steps) : null;
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
  // An emptied Meanwhile hands a keyboard visitor's focus to the events' listbox.
  const meanwhile: ExploreMeanwhile | null = events
    ? new ExploreMeanwhile(
        events,
        (event) => flyTo(event),
        () => labels?.listbox ?? null,
      )
    : null;
  const labels: ExploreLabels | null =
    events && canvas
      ? new ExploreLabels({
          events,
          canvas,
          openings,
          panels: () => [
            ruler.element,
            ...(meanwhile ? [meanwhile.element] : []),
            ...(climate ? [climate.legend] : []),
            ...chrome,
          ],
        })
      : null;
  layer.append(ruler.element);
  if (meanwhile) layer.append(meanwhile.element);
  if (labels) layer.prepend(labels.element);
  root.append(layer);
  let counted = -1;
  // The globe's layers fade in over the dive and out over the return, as a story's effects do.
  let fade = arrive === 'fly' ? 0 : 1;
  let left = false;
  let frameS = 0;

  const landings = new Set<() => void>();
  // Started where the view stands (the dev page), Explore has landed already.
  let dived = flight === null;
  /** What a Meanwhile flight's landing does: pins its entry. */
  let arriving: (() => void) | null = null;
  /** The flight has landed: the dive, its opening pinned, or a flight to a Meanwhile entry. */
  const land = () => {
    flight = null;
    const arrived = arriving;
    arriving = null;
    if (dived) {
      arrived?.();
      return;
    }
    dived = true;
    borders?.landed();
    labels?.land(opening);
    for (const landed of [...landings]) landed();
  };
  /** Flies to a Meanwhile entry's event, 1,500 km wide, pinning it on landing. */
  const flyTo = (event: MeanwhileEvent) => {
    if (left || !dived) return;
    const [lon, lat] = event.at;
    const { tilt, heading } = control.current;
    flight = new FreeFlight(control.current, { lon, lat, viewKm: ARRIVE_KM, tilt, heading });
    arriving = () => labels?.pinEvent(event.qid, { t0: event.t0, t1: event.t1 });
  };
  if (dived) labels?.land(null);
  control.arrowKeys = true;
  // Input during the dive takes the view from the flight, and the dive counts as landed; input
  // during a flight to a Meanwhile entry takes the view, and nothing is pinned.
  control.onInput = () => {
    if (!flight) return;
    if (dived) [flight, arriving] = [null, null];
    else land();
  };

  const hook: WorldTimeHook = {
    state: () => clock.state(),
    span: () => time.span,
    seek: (day) => time.seek(day),
    zoom: (factor) => time.zoomBy(factor),
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
  if (borders) window.__borders = borders.hook;
  // A jump has no dive to wait for.
  if (!flight) borders?.landed();

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
      borders?.update(frame, frameS);
      events?.update(frame, clock.state(), nowMs);
      if (dived && !left)
        meanwhile?.ask(frame, clock.state(), [control.current.lon, control.current.lat]);
    },
    ui(drawn, nowMs) {
      climate?.ui();
      labels?.update(nowMs);
      meanwhile?.update(drawn, clock.state());
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
      arriving = null;
      landings.clear();
      layer.inert = true;
      labels?.leave();
      events?.leave();
      borders?.leave();
      sound.leave();
    },
    end() {
      flight = null;
      arriving = null;
      landings.clear();
      labels?.dispose();
      events?.dispose();
      borders?.end();
      ruler.dispose();
      climate?.end();
      layer.remove();
      if (window.__worldTime === hook) delete window.__worldTime;
      if (eventsHook && window.__exploreEvents === eventsHook) delete window.__exploreEvents;
      if (labelsHook && window.__exploreLabels === labelsHook) delete window.__exploreLabels;
      if (borders && window.__borders === borders.hook) delete window.__borders;
    },
    inspectMemory(account) {
      events?.inspectMemory(account);
      climate?.inspectMemory(account);
    },
  };
}
