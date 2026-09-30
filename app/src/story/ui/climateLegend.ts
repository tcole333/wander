// The climate legend, at the bottom right over the ruler's end: a small plate of dark cast brass
// like Meanwhile's, shown while the globe draws ModE-RA's temperatures. Its month is engraved in
// gilt over an enamel strip in the look's own colors (look/climateHook.ts climateSwatch), with the
// strip's ends named and its degrees engraved under it, the warm end's with the unit. It rises into
// view like the Resume plaque and fades as the layer eases out. A story's waits for a flight to
// land (walkUi.ts gives it no climate during one), since a flight sweeps story time through months
// the ruler's date plate already names; Explore's shows at once (explore/exploreClimate.ts), since
// its flights leave the clock where it stands.
import { climateSwatch } from '../../look/climateHook';
import { monthName } from '../dates';
import type { ClimateShown } from '../contract';
import { el } from './dom';

/** The stops the strip's gradient is drawn through, from the cold end to the warm. */
const STOPS = 17;
/** The ticks, as shares of the palette's range. */
const TICKS = [-1, -0.5, 0, 0.5, 1];

/** A signed whole or half degree, with a true minus sign. */
function degrees(k: number): string {
  const text = Number.isInteger(k) ? String(Math.abs(k)) : Math.abs(k).toFixed(1);
  return k < 0 ? `−${text}` : k > 0 ? `+${text}` : '0';
}

export class ClimateLegend {
  readonly element = el('aside', 'wu-legend wu-brass');
  readonly #month = el('div', 'wu-legend-month');
  readonly #strip = el('div', 'wu-legend-strip');
  readonly #scale = el('div', 'wu-legend-scale');
  /** Whether the plate is shown, and what its month and strip last showed, to skip redrawing. */
  #shown = false;
  #monthShown = '';
  #stripShown = '';

  constructor() {
    this.element.setAttribute('aria-hidden', 'true');
    const frame = el('div', 'wu-legend-frame');
    frame.append(this.#strip);
    const ramp = el('div', 'wu-legend-ramp');
    ramp.append(
      el('span', 'wu-legend-end', 'Colder'),
      frame,
      el('span', 'wu-legend-end', 'Warmer'),
      this.#scale,
    );
    this.element.append(
      this.#month,
      ramp,
      el('div', 'wu-legend-note', 'than the 1901–2000 average'),
    );
  }

  /** Every frame: the climate drawn, or null during a flight or while none is. */
  update(climate: ClimateShown | null | undefined): void {
    const shown = (climate?.strength ?? 0) >= 0.5;
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.element.classList.toggle('is-shown', shown);
      this.element.setAttribute('aria-hidden', String(!shown));
    }
    if (!climate || !shown) return;

    const month = `${monthName(climate.month)} ${climate.year}`;
    if (month !== this.#monthShown) {
      this.#monthShown = month;
      this.#month.textContent = month;
    }
    const { rangeK, base } = climate;
    const strip = `${rangeK} ${base}`;
    if (strip === this.#stripShown) return;
    this.#stripShown = strip;
    const stops = Array.from({ length: STOPS }, (_, i) => {
      const k = rangeK * ((2 * i) / (STOPS - 1) - 1);
      return `${climateSwatch(base, k, rangeK)} ${((100 * i) / (STOPS - 1)).toFixed(2)}%`;
    });
    this.#strip.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    this.#scale.replaceChildren(
      ...TICKS.map((share) => {
        const tick = el('span', 'wu-legend-tick', degrees(share * rangeK));
        tick.style.left = `${50 + 50 * share}%`;
        // The warm end's numeral carries the unit, trailing it so the numeral stays on its tick.
        if (share === 1) tick.append(el('span', 'wu-legend-unit', '°C'));
        return tick;
      }),
    );
  }
}
