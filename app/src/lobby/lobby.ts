// The lobby's opening, turn, dive and return (streaming.md 5.7). The plaques, glows, mark and
// knob stay mounted for the whole visit. A fresh director starts each dive; the return uses the
// same flight path and easing as the walk, then releases that director and its UI at the landing.
import type { Object3D, PerspectiveCamera } from 'three';
import type { MuseumScene } from '../contract';
import type { Walk } from '../story/contract';
import { flightEase, flightPath, flightSeconds, type FlightPath } from '../story/flight';
import type { LonLat, Story } from '../story/story';
import type { WalkChrome } from '../story/ui/chrome';
import type { ViewControl } from '../view/viewControl';
import { wrap180 } from '../view/viewState';
import { Glows } from './glows';
import { OPENING_S, openingPose, SKIP_S, TURN_DEG_S } from './opening';
import { Plaques } from './plaques';

const TURN_EASE_S = 1.5;
const TURN_IDLE_S = 5;
/** Seconds the glows and story effects take to exchange places. */
export const GLOW_FADE_S = 0.8;
/** Seconds the card and Meanwhile take to arrive (lobby.css). */
const ARRIVE_S = 0.8;

type LobbyPhase = 'waiting' | 'opening' | 'idle' | 'diving' | 'gone' | 'returning';

export interface LobbyParts {
  host: HTMLElement;
  story: Story;
  places: LonLat[];
  museum: MuseumScene;
  control: ViewControl;
  chrome: WalkChrome;
  /** The dev shell starts on a beat; it still has a lobby to return to. */
  initial?: 'lobby' | 'story';
  /** Starts a fresh walk inside the press that chose its plaque. */
  enter: () => Walk;
  /** Stops the story clock and inputs and fades its sound to the room. */
  leave: () => void;
  /** Releases the departing walk and restores the lobby's layers. */
  finish: () => void;
  fail: (error: unknown) => void;
}

export interface Lobby {
  readonly glows: Object3D;
  readonly opened: Promise<void>;
  /** The room's poster glides onto this one persistent mark. */
  readonly mark: HTMLElement;
  readonly returning: boolean;
  /** WANDER and Escape return even from a break-out or an unfinished dive. */
  back(): void;
  update(dtS: number, camera: PerspectiveCamera): void;
  /** The plaques' lens shift; null while the story has the view. */
  lensShift(): number | null;
  dispose(): void;
}

export function createLobby(parts: LobbyParts): Lobby {
  const { host, museum, control, chrome } = parts;
  const startsOnBeat = parts.initial === 'story';
  const rest = { ...control.goal, viewKm: control.maxKm };
  let home = { ...rest };
  let phase: LobbyPhase = startsOnBeat ? 'gone' : 'waiting';
  let progress = startsOnBeat ? 1 : 0;
  let rate = 1 / OPENING_S;
  let lastInput = -Infinity;
  let turn = 0;
  let glow = 0;
  let elapsed = 0;
  let shown = startsOnBeat;
  let arriving = 0;
  let rulerFrames = 0;
  let stopDive: (() => void) | null = null;
  let flight: { path: FlightPath; seconds: number; elapsed: number } | null = null;

  const glows = new Glows(parts.places);
  museum.globeMount.add(glows.points);
  const plaques = new Plaques(parts.story, () => choose());
  host.append(plaques.element);
  let reach = plaques.reach();
  chrome.lobby(!startsOnBeat);
  if (startsOnBeat) {
    plaques.leave();
    chrome.show();
  }

  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  if (startsOnBeat) open();

  const become = (next: LobbyPhase) => {
    phase = next;
    host.dataset.lobby = next;
  };
  become(phase);

  const skip = () => {
    rate = Math.max(rate, (1 - progress) / SKIP_S);
  };
  const listeners = new AbortController();
  const touched = () => {
    lastInput = performance.now();
    if (phase === 'opening') skip();
  };
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
    addEventListener(type, touched, { capture: true, passive: true, signal: listeners.signal });
  }
  addEventListener('resize', () => (reach = plaques.reach()), { signal: listeners.signal });
  control.onInput = touched;

  const pose = () => {
    const at = openingPose(progress);
    museum.params.lamp = at.lamp;
    museum.params.meridianSwing = at.meridian;
    museum.params.outerSwing = at.outer;
    return at;
  };
  if (!startsOnBeat) control.go({ ...rest, lon: wrap180(rest.lon + pose().spin) }, true);

  const clearTransition = () => {
    stopDive?.();
    stopDive = null;
    arriving = 0;
    rulerFrames = 0;
    host.classList.remove('lobby-dive', 'lobby-veiled', 'lobby-ruler-down', 'lobby-return');
  };

  const choose = () => {
    if (phase !== 'opening' && phase !== 'idle') return;
    home = { ...control.current };
    skip();
    become('diving');
    chrome.lobby(false);
    // The plaque relinquishes focus before becoming inert; the persistent mark is its heir.
    chrome.mark.focus({ preventScroll: true });
    plaques.leave();
    host.classList.add('lobby-dive', 'lobby-veiled', 'lobby-ruler-down');
    let walk: Walk;
    try {
      walk = parts.enter();
    } catch (error) {
      parts.fail(error);
      return;
    }
    // Mount below the page for a frame before the ruler rises. No queued frame or timeout can
    // change a later trip's classes if the visitor returns before this dive has landed.
    rulerFrames = 2;
    stopDive = walk.subscribe((state) => {
      if (state.flight !== null) return;
      stopDive?.();
      stopDive = null;
      become('gone');
      host.classList.remove('lobby-veiled');
      arriving = ARRIVE_S;
    });
  };

  const back = () => {
    if (phase !== 'gone' && phase !== 'diving') return;
    clearTransition();
    become('returning');
    progress = 1;
    shown = true;
    host.classList.add('lobby-return');
    chrome.lobby(true);
    control.enabled = false;
    control.stop();
    parts.leave();
    const path = flightPath(control.current, {
      ...home,
      viewKm: Math.min(home.viewKm, control.maxKm),
    });
    flight = { path, seconds: flightSeconds(path.length), elapsed: 0 };
  };
  addEventListener(
    'keydown',
    (event) => {
      // Credits stops propagation in its dialog; any other closer can consume Escape first.
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.key !== 'Escape' || (phase !== 'gone' && phase !== 'diving')) return;
      back();
      event.preventDefault();
    },
    { signal: listeners.signal },
  );

  return {
    glows: glows.points,
    opened,
    mark: chrome.mark,
    get returning() {
      return phase === 'returning';
    },
    back,

    update(dtS, camera) {
      elapsed += dtS;
      if (rulerFrames > 0 && --rulerFrames === 0) host.classList.remove('lobby-ruler-down');
      if (arriving > 0) {
        arriving = Math.max(0, arriving - dtS);
        if (arriving === 0) host.classList.remove('lobby-dive');
      }
      if (phase === 'waiting') {
        become('opening');
        open();
      } else if (progress < 1) {
        progress = Math.min(1, progress + rate * dtS);
      }
      const at = pose();
      if (at.reveal > 0 && !shown) {
        shown = true;
        plaques.show();
        chrome.show();
      }

      if (phase === 'opening') {
        control.go({ ...rest, lon: wrap180(rest.lon + at.spin) }, true);
        if (progress >= 1) {
          become('idle');
          if (performance.now() - lastInput >= TURN_IDLE_S * 1000) turn = 1;
        }
      } else if (phase === 'returning' && flight) {
        flight.elapsed = Math.min(flight.seconds, flight.elapsed + dtS);
        control.go(flight.path.at(flightEase(flight.elapsed / flight.seconds)), true);
        if (flight.elapsed >= flight.seconds) {
          flight = null;
          parts.finish();
          clearTransition();
          become('idle');
          control.enabled = true;
          control.arrowKeys = true;
          control.onInput = touched;
          lastInput = performance.now();
          turn = 0;
          plaques.show();
          plaques.focus();
        }
      } else if (phase === 'idle') {
        const still = performance.now() - lastInput >= TURN_IDLE_S * 1000 && control.settled;
        turn = still ? Math.min(1, turn + dtS / TURN_EASE_S) : 0;
        if (turn > 0) {
          const goal = control.goal;
          const pace = TURN_DEG_S * turn * Math.min(1, goal.viewKm / control.maxKm);
          control.go({ ...goal, lon: wrap180(goal.lon - pace * dtS) }, true);
        }
      }

      const target = phase === 'gone' || phase === 'diving' ? 0 : at.reveal;
      const step = dtS / GLOW_FADE_S;
      glow += Math.max(-step, Math.min(step, target - glow));
      glows.update(camera, museum.globeMount, elapsed, glow);
    },

    lensShift: () => (phase === 'diving' || phase === 'gone' ? null : reach / 2),

    dispose() {
      listeners.abort();
      clearTransition();
      flight = null;
      plaques.dispose();
      glows.dispose();
      delete host.dataset.lobby;
      if (control.onInput === touched) control.onInput = () => {};
      control.enabled = true;
      Object.assign(museum.params, { lamp: 1, meridianSwing: 0, outerSwing: 0 });
    },
  };
}
