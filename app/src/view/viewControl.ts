// The walk's camera controls over the view state: dragging slides the globe under the cursor with
// the heading kept, right-drag or shift-drag tilts, the wheel zooms, the arrow keys pan (with shift
// they tilt), + and - zoom, and presets fly there with an eased flight. Input moves a goal; the
// drawn view follows it, damped. A story (story/director.ts) hears of that input through onInput,
// and turns the arrow keys off to step its beats with them.
import {
  damp,
  dragView,
  easeInOut,
  flightAt,
  flightRise,
  viewGap,
  zoomView,
  type ViewState,
} from './viewState';

const DAMP_S = 0.12;
const TILT_PER_PX = 0.25;
const MAX_TILT = 80;
/** Zoom per wheel pixel, as e^(rate·deltaY): a 100 px notch is 1.35x, the world to 30 km in ~25. */
const WHEEL_RATE = 0.003;
const PINCH_RATE = 0.01;
/** Held keys: screen widths panned per second, e-folds of zoom per second, degrees of tilt per second. */
const KEY_PAN = 0.5;
const KEY_ZOOM = 1.2;
const KEY_TILT = 40;
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_']);

interface Flight {
  from: ViewState;
  to: ViewState;
  rise: number;
  startMs: number;
  durationMs: number;
}

export class ViewControl {
  current: ViewState;
  /** Where input has sent the view; `current` follows it. */
  goal: ViewState;
  #flight: Flight | null = null;
  /** The zoom's limits in km, set by the page: the closest a view may come, by where it is. */
  minKmAt: (view: ViewState) => number = () => 30;
  maxKm = Infinity;
  /** Called when the visitor moves the view: a drag, a tilt, the wheel or a key. */
  onInput: () => void = () => {};
  /** Whether the arrow keys pan and tilt. */
  arrowKeys = true;
  /** Input rests while the lobby takes the camera back. */
  #enabled = true;
  #held = new Set<string>();
  #shift = false;
  #widthPx = 1440;
  #drag: { x: number; y: number; tilt: boolean } | null = null;

  constructor(initial: ViewState) {
    this.current = { ...initial };
    this.goal = { ...initial };
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(on: boolean) {
    this.#enabled = on;
    if (!on) {
      this.#held.clear();
      this.#drag = null;
    }
  }

  /** Flies to `view`, or jumps there. */
  go(view: ViewState, instant = false): void {
    const to = this.#clamp(view);
    if (instant) {
      this.current = { ...to };
      this.goal = { ...to };
      this.#flight = null;
      return;
    }
    const rise = flightRise(this.current, to);
    const zoom = Math.abs(Math.log(to.viewKm / this.current.viewKm)) + 2 * rise;
    this.#flight = {
      from: { ...this.current },
      to,
      rise,
      startMs: performance.now(),
      durationMs: Math.min(4000, 1400 + 220 * zoom),
    };
  }

  /** Stops a flight where it is, so input takes over from there. */
  stop(): void {
    if (!this.#flight) return;
    this.#flight = null;
    this.goal = { ...this.current };
  }

  get flying(): boolean {
    return this.#flight !== null;
  }

  /** Whether the drawn view has caught up with the goal. */
  get settled(): boolean {
    return !this.#flight && viewGap(this.current, this.goal) < 0.01;
  }

  step(nowMs: number, dtS: number): void {
    if (this.#held.size > 0) {
      this.stop();
      this.goal = this.#keyed(this.goal, Math.min(dtS, 0.1));
    }
    const flight = this.#flight;
    if (flight) {
      const t = Math.min(1, (nowMs - flight.startMs) / flight.durationMs);
      const view = flightAt(flight.from, flight.to, easeInOut(t), flight.rise);
      this.current = { ...view, viewKm: Math.min(this.maxKm, view.viewKm) };
      this.goal = { ...this.current };
      if (t >= 1) this.#flight = null;
      return;
    }
    this.goal = this.#clamp(this.goal);
    this.current = this.settled ? { ...this.goal } : damp(this.current, this.goal, dtS, DAMP_S);
  }

  /**
   * Mouse and wheel input on `element`, and keys held anywhere on the page but in a form field.
   * Returns what takes the listeners off again.
   */
  attach(element: HTMLElement): () => void {
    const listeners = new AbortController();
    const { signal } = listeners;
    this.#widthPx = element.clientWidth || this.#widthPx;
    addEventListener('resize', () => (this.#widthPx = element.clientWidth || this.#widthPx), {
      signal,
    });
    addEventListener(
      'keydown',
      (event) => {
        if (!this.enabled) return;
        this.#shift = event.shiftKey;
        if (!KEYS.has(event.key) || isFormField(event.target)) return;
        if (!this.arrowKeys && event.key.startsWith('Arrow')) return;
        event.preventDefault();
        this.#held.add(event.key);
        this.onInput();
      },
      { signal },
    );
    addEventListener(
      'keyup',
      (event) => {
        this.#shift = event.shiftKey;
        this.#held.delete(event.key);
      },
      { signal },
    );
    addEventListener('blur', () => this.#held.clear(), { signal });
    element.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.enabled) return;
        if (event.button !== 0 && event.button !== 2) return;
        this.stop();
        this.#drag = {
          x: event.clientX,
          y: event.clientY,
          tilt: event.button === 2 || event.shiftKey,
        };
        element.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    element.addEventListener(
      'pointermove',
      (event) => {
        if (!this.enabled) return;
        const drag = this.#drag;
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (dx === 0 && dy === 0) return;
        this.onInput();
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.tilt) {
          const tilt = Math.min(MAX_TILT, Math.max(0, this.goal.tilt - dy * TILT_PER_PX));
          this.goal = { ...this.goal, tilt };
        } else {
          this.goal = dragView(this.goal, dx, dy, element.clientWidth);
        }
      },
      { signal },
    );
    const end = () => (this.#drag = null);
    element.addEventListener('pointerup', end, { signal });
    element.addEventListener('pointercancel', end, { signal });
    element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (!this.enabled) return;
        this.stop();
        this.onInput();
        const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        // A trackpad pinch arrives as ctrl+wheel with small deltas, so it zooms faster per pixel.
        const rate = event.ctrlKey ? PINCH_RATE : WHEEL_RATE;
        const minKm = this.minKmAt(this.goal);
        this.goal = zoomView(this.goal, event.deltaY * lines, minKm, this.maxKm, rate);
      },
      { passive: false, signal },
    );
    return () => {
      listeners.abort();
      this.#held.clear();
      this.#drag = null;
    };
  }

  /** The goal after `dtS` seconds of the held keys. */
  #keyed(view: ViewState, dtS: number): ViewState {
    const held = (key: string) => (this.#held.has(key) ? 1 : 0);
    const across = held('ArrowRight') - held('ArrowLeft');
    const upward = held('ArrowUp') - held('ArrowDown');
    const zoom = held('-') + held('_') - held('+') - held('=');
    let next = view;
    if (this.#shift) {
      next = { ...next, tilt: next.tilt + upward * KEY_TILT * dtS };
    } else {
      // A drag the other way: the view moves toward the arrow as the globe slides under it.
      const px = KEY_PAN * this.#widthPx * dtS;
      next = dragView(next, -across * px, upward * px, this.#widthPx);
    }
    if (zoom !== 0) {
      next = zoomView(next, zoom * KEY_ZOOM * dtS, this.minKmAt(next), this.maxKm, 1);
    }
    return this.#clamp(next);
  }

  #clamp(view: ViewState): ViewState {
    const viewKm = Math.min(this.maxKm, Math.max(this.minKmAt(view), view.viewKm));
    const tilt = Math.min(MAX_TILT, Math.max(0, view.tilt));
    return { ...view, viewKm, tilt };
  }
}

export function isFormField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
