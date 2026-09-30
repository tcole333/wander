// Explore's climate (streaming.md 3.5): ModE-RA's months at the world clock's date on the look
// (climate/clock.ts), and the climate legend over the ruler's right end
// (story/ui/climateLegend.ts). Unlike a story's, the legend does not wait for a flight to land:
// Explore's flights leave the clock where it stands, so the month it names is the one the globe
// shows throughout. The mode's fade carries it in and out with the dive and the return; the end
// empties its years, and the legend leaves with Explore's layer.
import { ClockClimate } from '../climate/clock';
import { climateFieldOf } from '../climate/field';
import type { ClimateSource } from '../climate/years';
import type { SurfaceLook } from '../contract';
import { climateUniformsOf } from '../look/climateHook';
import type { MemoryAccount } from '../perf/memory';
import type { ClimateShown } from '../story/contract';
import { ClimateLegend } from '../story/ui/climateLegend';
import type { WorldClock } from '../time/worldClock';

export class ExploreClimate {
  readonly #look: SurfaceLook;
  readonly #clock: WorldClock;
  readonly #climate: ClockClimate;
  readonly #legend = new ClimateLegend();
  /** The mode's fade, 0 to 1. */
  #fade = 0;

  /** Draws on `look`'s field from `source`'s years, its legend first in Explore's `layer`. */
  constructor(look: SurfaceLook, source: ClimateSource, clock: WorldClock, layer: HTMLElement) {
    this.#look = look;
    this.#clock = clock;
    this.#climate = new ClockClimate(source, climateFieldOf(climateUniformsOf(look.material)));
    layer.prepend(this.#legend.element);
  }

  /** Every frame, before the look updates: the clock's date, drawn under the mode's fade. */
  update(dtS: number, fade: number): void {
    this.#fade = fade;
    this.#climate.update(this.#clock.state(), dtS, fade);
  }

  /** The climate drawn, for the legend; null while none is. */
  shown(): ClimateShown | null {
    const month = this.#climate.month;
    const strength = this.#climate.drawn * this.#fade;
    if (!month || strength <= 0) return null;
    return {
      ...month,
      rangeK: Number(this.#look.params.climateRangeK),
      base: String(this.#look.params.bronze),
      strength,
    };
  }

  /** Every frame, after the scene is drawn. */
  ui(): void {
    this.#legend.update(this.shown());
  }

  inspectMemory(account: MemoryAccount): void {
    this.#climate.inspectMemory(account);
  }

  /** Empties Explore's years and draws no more climate. */
  end(): void {
    this.#climate.end();
  }
}
