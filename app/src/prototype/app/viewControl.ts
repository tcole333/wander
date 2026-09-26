// The prototype's camera controls over the view state: dragging slides the globe under the cursor
// with the heading kept, right-drag or shift-drag tilts, the wheel zooms, and presets fly there with
// an eased flight. Input moves a goal; the drawn view follows it, damped.
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
  /** The zoom's limits in km, set by the page. */
  minKm = 30;
  maxKm = Infinity;

  constructor(initial: ViewState) {
    this.current = { ...initial };
    this.goal = { ...initial };
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

  /** Mouse and wheel input on `element`. */
  attach(element: HTMLElement): void {
    let drag: { x: number; y: number; tilt: boolean } | null = null;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      this.stop();
      drag = { x: event.clientX, y: event.clientY, tilt: event.button === 2 || event.shiftKey };
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.tilt) {
        const tilt = Math.min(MAX_TILT, Math.max(0, this.goal.tilt - dy * TILT_PER_PX));
        this.goal = { ...this.goal, tilt };
      } else {
        this.goal = dragView(this.goal, dx, dy, element.clientWidth);
      }
    });
    const end = () => (drag = null);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.stop();
        const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        this.goal = zoomView(this.goal, event.deltaY * lines, this.minKm, this.maxKm);
      },
      { passive: false },
    );
  }

  #clamp(view: ViewState): ViewState {
    const viewKm = Math.min(this.maxKm, Math.max(this.minKm, view.viewKm));
    const tilt = Math.min(MAX_TILT, Math.max(0, view.tilt));
    return { ...view, viewKm, tilt };
  }
}
