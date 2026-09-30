// Explore's borders (#80, streaming.md 3.3): from the dive on, the border steps follow the world
// clock the ruler writes, the previews standing in while it moves and each step streaming in once
// it rests (borders/clockBorders.ts). They ease in over borderFade as the dive starts and out as
// the lobby takes the view back; the preview chunks are fetched once the dive has landed, so they
// never crowd the tiles the landing view needs. The year plate names the step drawn, and withdraws
// while a preview stands in, since the ruler then carries the year. Ending Explore empties the
// slots and the ring and drops the chunks. Its hook serves scripts as window.__borders while
// Explore runs.
import type { ClockBorders, StepShown } from '../borders/clockBorders';
import { plateLabel } from '../borders/steps';
import { tunables } from '../config/tunables';
import type { FrameContext } from '../scene/frameContext';
import type { BordersShown } from '../story/contract';
import { EARTH_KM } from '../story/effects/geo';
import { smoothstep } from '../story/effects/timeline';
import { BordersPlate } from '../story/ui/bordersPlate';

/** The border steps' runtime, as Explore drives it. */
export type StepsRuntime = Pick<ClockBorders, 'update' | 'loadPreviews' | 'end' | 'shown'>;

/** The year plate, as Explore drives it. */
export interface Plate {
  readonly element: HTMLElement;
  update(borders: BordersShown | null): void;
}

/** Explore's borders, for scripts. */
export interface BordersHook {
  /** Draws the clock's step, or draws none. */
  show(on: boolean): void;
  /** The step drawn, while one is. */
  shown(): StepShown | null;
}

declare global {
  interface Window {
    __borders?: BordersHook;
  }
}

export class ExploreBorders {
  readonly #steps: StepsRuntime;
  readonly #plate: Plate;
  /** For scripts: Explore sets it as window.__borders while it runs. */
  readonly hook: BordersHook;
  #on = true;
  #leaving = false;
  /** 0 to 1, before its easing curve. */
  #shown = 0;

  constructor(steps: StepsRuntime, plate: Plate = new BordersPlate(plateLabel)) {
    this.#steps = steps;
    this.#plate = plate;
    this.hook = { show: (on) => (this.#on = on), shown: () => this.#steps.shown };
  }

  /** The year plate, for Explore's layer. */
  get element(): HTMLElement {
    return this.#plate.element;
  }

  /** The dive has landed: the preview chunks come now, the clock's own first. */
  landed(): void {
    this.#steps.loadPreviews();
  }

  /** Every frame, once the camera is placed: the steps follow the clock at the view's width. */
  update(frame: FrameContext, dtS: number): void {
    const target = this.#on && !this.#leaving ? 1 : 0;
    const step = (1000 * dtS) / tunables.borderFade;
    this.#shown += Math.max(-step, Math.min(step, target - this.#shown));
    this.#steps.update({
      wanted: target > 0 || this.#shown > 0,
      previews: true,
      viewKm: viewWidthKm(frame),
      strength: smoothstep(0, 1, this.#shown),
    });
  }

  /** Every frame, after the scene is drawn: the plate names the step, never a preview. */
  ui(): void {
    const shown = this.#steps.shown;
    this.#plate.update(shown && !shown.preview ? shown : null);
  }

  /** The lobby takes the view back: the borders ease out. */
  leave(): void {
    this.#leaving = true;
  }

  /** Empties the slots and the ring, and drops the chunks. */
  end(): void {
    this.#steps.end();
  }
}

/** The view's width under the camera, km across, as the walk's effects measure it. */
export function viewWidthKm(frame: FrameContext): number {
  if (!frame.cam) return Infinity;
  const altitude = Math.max(0, frame.camera.length() - 1);
  return 2 * altitude * frame.tanHalf * frame.cam.aspect * EARTH_KM;
}
