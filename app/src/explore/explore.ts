// Explore (issue #79): free time over the globe, as a mode the lobby dives into (walk/mode.ts). The
// dive opens the free clock on an event, the ruler showing exploreOpenYears around its day, and
// flies to the world view over its place while the ruler rises; from there the visitor turns the
// globe and scrubs through all of history. The arrow keys keep panning the view, as in the lobby.
// Leaving stops input on the ruler and fades the sound to the room; ending releases the clock and
// ruler, so the world clock has one owner at a time. window.__worldTime serves scripts while
// Explore runs.
import '../story/ui/tokens.css';
import '../story/ui/walkUi.css';
import type { WalkAudio } from '../audio/walkAudio';
import { tunables } from '../config/tunables';
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

declare global {
  interface Window {
    __worldTime?: WorldTimeHook;
  }
}

export interface ExploreParts {
  /** The page's host, which Explore's layer goes into. */
  root: HTMLElement;
  control: ViewControl;
  sound: WalkAudio;
  /** Flown to from the lobby's view, or started where the view already stands (the dev page). */
  arrive: 'jump' | 'fly';
  clock?: WorldClock;
  /** The day the free clock opens on and the place the dive flies to. */
  opening?: Pick<Opening, 'day' | 'at'>;
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
  control,
  sound,
  arrive,
  clock = worldClock,
  opening = waterloo(),
}: ExploreParts): Mode {
  // The clock, flight and layer hold no listeners and stand nowhere on the page, so they come
  // first, then the ruler, the one part holding listeners, and only then are the page, the view's
  // control and the script hook touched: a dive that throws on the way leaves nothing behind,
  // since the boot never gets a mode to end.
  const time = new ExploreTime(clock, HISTORY, opening.day, {
    openYears: tunables.exploreOpenYears,
  });
  let flight =
    arrive === 'fly'
      ? new FreeFlight(control.current, worldViewOn(opening.at, control.maxKm))
      : null;
  const layer = el('div', 'wu wu-explore wu-mode');
  const ruler = new CraftRuler(time);
  layer.append(ruler.element);
  root.append(layer);

  const landings = new Set<() => void>();
  const land = () => {
    flight = null;
    for (const landed of [...landings]) landed();
  };
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

  return {
    landed(cb) {
      landings.add(cb);
      return () => landings.delete(cb);
    },
    lensShift: () => 0,
    beforeCamera(_nowMs, dtS) {
      if (!flight) return;
      control.go(flight.step(dtS), true);
      if (flight.done) land();
    },
    afterPlace() {},
    ui() {},
    audio: () => null,
    leave() {
      flight = null;
      landings.clear();
      layer.inert = true;
      sound.leave();
    },
    end() {
      flight = null;
      landings.clear();
      ruler.dispose();
      layer.remove();
      if (window.__worldTime === hook) delete window.__worldTime;
    },
    inspectMemory() {},
  };
}
