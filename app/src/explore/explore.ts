// Explore (issue #79): free time over the globe, as a mode the lobby dives into (walk/mode.ts). The
// dive opens the free clock on an event the visitor has not seen lately (openings.ts) and flies to
// the world view over its place while the time ruler rises (timeRuler.ts), its tape zooming in from
// its widest to exploreOpenYears about the day as it does, so it shows it zooms. From the landing
// the visitor turns the globe and moves through all of history: with nothing focused the arrow keys
// move time, as in the stories, and the globe takes them from its own stop in the tab order,
// keeping + and - everywhere (timeKeys.ts). Where the release has its event index and the look cuts
// marks, the events of the now window, the ruler's glass, mark the globe (exploreEvents.ts), the
// opening focal among them; the layer's data-explore-marks counts the events marked in view. The
// dive lands with the opening's plate pinned, its written line on it; from then a mark pointed at
// brings its plate, a click pins it, and the keyboard reaches the marks through one listbox
// (labels.ts). A pin holds while its event's dates are on the tape, dimmed outside the glass, and
// the ruler's bookmark marks its date. Meanwhile names what happens then elsewhere, as the event
// worker picks it (exploreMeanwhile.ts); choosing an entry flies there, 1,500 km wide, and pins it
// on landing. The globe shows the climate at the clock's date wherever ModE-RA has it and the tape
// is close enough (exploreClimate.ts). Through a flight in time the events and climate hold, and
// ask for where it lands. Its sound (audio/clockScore.ts) hears the clock's day, what the tape
// labels around it, and whether a free flight has the camera. Leaving stops the keys and input on
// the ruler, stops asking for events, eases their marks and the climate out and fades the sound to
// the room; ending releases the clock, ruler, event worker and climate years and takes the marks
// off, so the world clock has one owner at a time. Where the look holds the border steps, the
// borders follow the clock from the dive on (exploreBorders.ts), with no plate of their own: the
// ruler and the Credits carry the dates. window.__worldTime, window.__exploreView,
// window.__exploreEvents, window.__exploreLabels and window.__borders serve scripts while Explore
// runs.
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
import { ExploreTime, HISTORY } from '../time/exploreTime';
import { YEAR_DAYS } from '../time/overviewScale';
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
import { bindTimeKeys, type TimeKeys } from './timeKeys';
import { TimeRuler } from './timeRuler';

/** The dive's view keeps the event's latitude within this, degrees, so no pole faces the lamp. */
const WORLD_LAT = 35;
/** The landing zoom runs as the ruler rises in the dive (lobby.css), seconds. */
const LANDING_ZOOM_S = 1.6;
const LANDING_ZOOM_DELAY_S = 0.35;

/** Whether the visitor asks for less motion. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The free clock and ruler, for scripts. */
export interface WorldTimeHook {
  state(): WorldTime;
  span(): Span;
  seek(day: number): void;
  /** Shows `factor` times as much about the needle; `share`, once where it pivoted, is ignored. */
  zoom(factor: number, share?: number): void;
  /** Moves the needle `days` along at once. */
  pan(days: number): void;
  /** Whether a flight, coast or glide moves the tape. */
  moving(): boolean;
}

/** The globe's view, for scripts. */
export interface ExploreViewHook {
  /** Where input has sent the view. */
  goal(): ViewState;
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
    __exploreView?: ExploreViewHook;
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
  // As the ruler rises in the dive, its tape zooms in from its widest to the opening's years, so
  // the ruler shows it zooms without a word.
  const landingZoom = arrive === 'fly' && !reducedMotion();
  const time = new ExploreTime(clock, HISTORY, opening.day, {
    openYears: landingZoom ? tunables.exploreMaxSpanYears : tunables.exploreOpenYears,
    reducedMotion,
  });
  if (landingZoom) {
    time.fly(opening.day, tunables.exploreOpenYears * YEAR_DAYS, {
      durationS: LANDING_ZOOM_S,
      delayS: LANDING_ZOOM_DELAY_S,
    });
  }
  let flight =
    arrive === 'fly'
      ? new FreeFlight(control.current, worldViewOn(opening.at, control.maxKm))
      : null;
  const layer = el('div', 'wu wu-explore wu-mode');
  const climate = look && release ? new ExploreClimate(look, release, clock, layer) : null;
  const borders = steps ? new ExploreBorders(steps) : null;
  const ruler = new TimeRuler(time);
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
            ...ruler.panels,
            ...(meanwhile ? [meanwhile.element] : []),
            ...(climate ? [climate.legend] : []),
            ...chrome,
          ],
        })
      : null;
  if (meanwhile) layer.append(meanwhile.element);
  if (labels) layer.prepend(labels.element);
  // First in the tab order: the Date and Years shown sliders, then the events.
  layer.prepend(ruler.element);
  root.append(layer);
  let counted = -1;
  // The globe's layers fade in over the dive and out over the return, as a story's effects do.
  let fade = arrive === 'fly' ? 0 : 1;
  let left = false;
  let frameS = 0;

  const landings = new Set<() => void>();
  // Started where the view stands (the dev page), Explore has landed already.
  let dived = flight === null;
  /** The time keys and the Globe stop, from the landing on. */
  let keys: TimeKeys | null = null;
  const bindKeys = () => {
    keys = bindTimeKeys(time, ruler, control);
    // After the Date and Years shown sliders, before the events, in the tab order.
    ruler.element.after(keys.globe);
    layer.append(keys.caption);
  };
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
    bindKeys();
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
  if (dived) {
    bindKeys();
    labels?.land(null);
  }
  // The arrow keys move time; the globe takes them only from its own stop (timeKeys.ts).
  control.arrowKeys = false;
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
    pan: (days) => time.pan(days),
    moving: () => time.moving,
  };
  window.__worldTime = hook;
  const viewHook: ExploreViewHook = { goal: () => ({ ...control.goal }) };
  window.__exploreView = viewHook;
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
  /** The pinned event's day, which the ruler's bookmark marks: within its first year. */
  const pinnedDay = (): number | null => {
    const qid = labels?.pinned ?? null;
    const span = events?.focal?.qid === qid ? events?.focal?.span : undefined;
    if (qid === null || !span) return null;
    return Math.floor(span.t0 + Math.min(span.t1 - span.t0, 366) / 2);
  };

  return {
    landed(cb) {
      landings.add(cb);
      return () => landings.delete(cb);
    },
    lensShift: () => 0,
    beforeCamera(nowMs, dtS) {
      if (!left) time.tick(nowMs);
      frameS = dtS;
      fade = Math.max(0, Math.min(1, fade + (left ? -dtS : dtS) / GLOW_FADE_S));
      if (!flight) return;
      control.go(flight.step(dtS), true);
      if (flight.done) land();
    },
    afterPlace(frame, nowMs) {
      // Through a flight the climate keeps its field and the events their question; each asks for
      // where the flight lands, once it has, so nothing is fetched for eras flown past.
      climate?.update(frameS, fade, time.flying);
      borders?.update(frame, frameS);
      events?.update(frame, clock.state(), nowMs, time.flying);
      if (dived && !left)
        meanwhile?.ask(frame, clock.state(), [control.current.lon, control.current.lat]);
    },
    ui(drawn, nowMs) {
      ruler.pin = pinnedDay();
      ruler.frame();
      climate?.ui();
      labels?.update(nowMs);
      // The state names stand clear of the plates, from the next draw.
      look?.names?.avoid(
        'plates',
        (labels?.plateBoxes() ?? []).map((box) => ({
          x0: box.left,
          y0: box.top,
          x1: box.right,
          y1: box.bottom,
        })),
      );
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
      keys?.dispose();
      keys = null;
      labels?.leave();
      events?.leave();
      borders?.leave();
      sound.leave();
    },
    end() {
      flight = null;
      arriving = null;
      landings.clear();
      keys?.dispose();
      keys = null;
      labels?.dispose();
      look?.names?.avoid('plates', []);
      events?.dispose();
      borders?.end();
      ruler.dispose();
      climate?.end();
      layer.remove();
      if (window.__worldTime === hook) delete window.__worldTime;
      if (window.__exploreView === viewHook) delete window.__exploreView;
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
