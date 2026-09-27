// The lobby (PRD, "First visit: the lobby"; streaming.md 5.7): the instrument at world view in the
// lamp-lit room, the story's plaque at its left (plaques.ts) and faint glows on the globe
// (glows.ts). Once the shaders are compiled and the streamer has settled at world view, or after
// OPEN_WAIT_S, the opening plays (opening.ts) and the room's poster gives way to it; any press,
// key or wheel runs the rest of it in SKIP_S. Then the instrument turns slowly eastward, as the
// Earth does, stopping at any input and turning on after TURN_IDLE_S without one; dragging and the
// wheel move it as in the walk. Choosing a plaque dives: the plaques slide away, the walk starts in
// that press (so all it starts, sound too, starts inside the visitor's gesture), and the camera
// flies into the story's first beat by the walk's own flight and readiness gate while the time
// ruler rises; the card and Meanwhile come in at the landing. The turn and the glows stop.
//
// While it stands, the lobby holds the scene's lamp and ring swings and the view's longitude. The
// walk's boot (walk/boot.ts) calls update() every frame before the view steps, and shifts its lens
// by lensShift(). The page's `data-lobby` attribute names the phase, for scripts and tests.
import type { Object3D, PerspectiveCamera } from 'three';
import type { MuseumScene } from '../contract';
import type { Walk } from '../story/contract';
import type { LonLat, Story } from '../story/story';
import type { ViewControl } from '../view/viewControl';
import { wrap180 } from '../view/viewState';
import { Glows } from './glows';
import { OPENING_S, openingPose, SKIP_S, TURN_DEG_S } from './opening';
import { Plaques } from './plaques';

/** The longest the opening waits for the streamer to settle at world view, in seconds. */
const OPEN_WAIT_S = 4;
/** The turn (TURN_DEG_S) eases up to its pace over this long after input, in seconds. */
const TURN_EASE_S = 1.5;
/** How long the lobby waits after the visitor's last input before it turns again, in seconds. */
const TURN_IDLE_S = 5;
/**
 * How long the glows take to go once the plaque is chosen, in seconds, as the story's own effects
 * come up (walk/boot.ts).
 */
export const GLOW_FADE_S = 0.8;
/** How long the card and Meanwhile take to come in at the landing (lobby.css), in ms. */
const ARRIVE_MS = 800;

/**
 * Waiting for the streamer, the opening, the turning lobby, the dive into a story, and gone once
 * the walk has landed.
 */
type LobbyPhase = 'waiting' | 'opening' | 'idle' | 'diving' | 'gone';

export interface LobbyParts {
  /** Where the lobby's layer goes, and where the walk's UI arrives. */
  host: HTMLElement;
  /** The story its plaque stands for: milestone 1 has the one. */
  story: Story;
  /** Where the ambient glows are. */
  places: LonLat[];
  museum: MuseumScene;
  control: ViewControl;
  /** True once the view has settled and the streamer has been idle for a while. */
  ready: () => boolean;
  /** Starts the story's walk, flying in from the view, inside the press that chose its plaque. */
  enter: () => Walk;
  /** Called when enter() throws: the lobby has gone, and the page brings its plate. */
  fail: (error: unknown) => void;
}

export interface Lobby {
  /** The glows, hung in the globe frame, for the precompile. */
  readonly glows: Object3D;
  /** Resolves as the opening starts, when the room's poster should give way to the canvas. */
  readonly opened: Promise<void>;
  /**
   * The lobby's Wander mark, which comes in with the plaques; the room's poster mark glides onto
   * it (main.ts, page/room.ts).
   */
  readonly mark: HTMLElement;
  /** One frame, before the view steps; `camera` stands where the last frame drew from. */
  update(nowMs: number, dtS: number, camera: PerspectiveCamera): void;
  /**
   * CSS px the lens shifts right while the plaques stand, which centers the instrument in the
   * room beside them; null once a story is chosen.
   */
  lensShift(): number | null;
  dispose(): void;
}

export function createLobby(parts: LobbyParts): Lobby {
  const { host, museum, control } = parts;
  /** The view the opening settles on and the turn starts from: the widest the zoom allows. */
  const rest = { ...control.goal, viewKm: Infinity };
  let phase: LobbyPhase = 'waiting';
  let waitingSince: number | null = null;
  let progress = 0;
  let rate = 1 / OPENING_S;
  let lastInput = -Infinity;
  let turn = 0;
  let glow = 0;
  let elapsed = 0;
  let shown = false;

  const glows = new Glows(parts.places);
  museum.globeMount.add(glows.points);
  const plaques = new Plaques(parts.story, () => choose());
  host.append(plaques.element);
  let reach = plaques.reach();

  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));

  const become = (next: LobbyPhase) => {
    phase = next;
    host.dataset.lobby = next;
  };
  become('waiting');

  const skip = () => {
    rate = Math.max(rate, (1 - progress) / SKIP_S);
  };

  // Any press, key or wheel runs the rest of the opening and holds the turn.
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

  /** The scene's part of the opening's pose, and the rest for the view and the plaques. */
  const pose = () => {
    const at = openingPose(progress);
    museum.params.lamp = at.lamp;
    museum.params.meridianSwing = at.meridian;
    museum.params.outerSwing = at.outer;
    return at;
  };
  control.go({ ...rest, lon: wrap180(rest.lon + pose().spin) }, true);

  const choose = () => {
    if (phase !== 'opening' && phase !== 'idle') return;
    skip();
    become('diving');
    host.classList.add('lobby-dive', 'lobby-veiled', 'lobby-ruler-down');
    void plaques.leave().then(() => plaques.dispose());
    let walk: Walk;
    try {
      walk = parts.enter();
    } catch (error) {
      parts.fail(error);
      return;
    }
    // The ruler mounts below the page, then rises.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => host.classList.remove('lobby-ruler-down')),
    );
    const stop = walk.subscribe((state) => {
      if (state.flight !== null) return;
      stop();
      arrive();
    });
  };

  /** The walk has landed, or the visitor broke out of the dive: the card and Meanwhile come in. */
  const arrive = () => {
    become('gone');
    listeners.abort();
    host.classList.remove('lobby-veiled');
    setTimeout(() => host.classList.remove('lobby-dive'), ARRIVE_MS);
  };

  return {
    glows: glows.points,
    opened,
    mark: plaques.mark,

    update(nowMs, dtS, camera) {
      elapsed += dtS;
      if (phase === 'waiting') {
        waitingSince ??= nowMs;
        if (parts.ready() || nowMs - waitingSince >= OPEN_WAIT_S * 1000) {
          become('opening');
          open();
        }
      } else if (progress < 1) {
        progress = Math.min(1, progress + rate * dtS);
      }
      const at = pose();
      if (at.reveal > 0 && !shown) {
        shown = true;
        plaques.show();
      }

      if (phase === 'opening') {
        control.go({ ...rest, lon: wrap180(rest.lon + at.spin) }, true);
        if (progress >= 1) {
          become('idle');
          // Untouched, the turn carries on at the pace the spin ended at.
          if (performance.now() - lastInput >= TURN_IDLE_S * 1000) turn = 1;
        }
      } else if (phase === 'idle') {
        // Held at once by input; eased back up to speed once the view has been still a while.
        const still = performance.now() - lastInput >= TURN_IDLE_S * 1000 && control.settled;
        turn = still ? Math.min(1, turn + dtS / TURN_EASE_S) : 0;
        if (turn > 0) {
          // Closer in, the turn slows, so the ground crosses the view at the same pace.
          const goal = control.goal;
          const pace = TURN_DEG_S * turn * Math.min(1, goal.viewKm / control.maxKm);
          control.go({ ...goal, lon: wrap180(goal.lon - pace * dtS) }, true);
        }
      }

      const standing = phase !== 'diving' && phase !== 'gone';
      glow = standing ? at.reveal : Math.max(0, glow - dtS / GLOW_FADE_S);
      glows.update(camera, museum.globeMount, elapsed, glow);
    },

    lensShift: () => (phase === 'diving' || phase === 'gone' ? null : reach / 2),

    dispose() {
      listeners.abort();
      plaques.dispose();
      glows.dispose();
      host.classList.remove('lobby-dive', 'lobby-veiled', 'lobby-ruler-down');
      delete host.dataset.lobby;
      if (control.onInput === touched) control.onInput = () => {};
      Object.assign(museum.params, { lamp: 1, meridianSwing: 0, outerSwing: 0 });
    },
  };
}
