// The borders' year plate, at the top of the page between the mark and the sound knob, clear of
// the card, Meanwhile, the climate legend and the ruler: a small riveted plate of Meanwhile's dark
// cast brass naming the snapshot's year in engraved gilt capitals ("Borders · 1815"), as the
// globe's borders always carry their year. It fades with the borders.
import type { BordersShown } from '../contract';
import { yearLabel } from '../dates';
import { el } from './dom';

/** The plate's words for a snapshot's astronomical year: the year as history writes it. */
export function bordersLabel(year: number): string {
  return `Borders · ${yearLabel(year)}`;
}

export class BordersPlate {
  readonly element = el('aside', 'wu-borders wu-brass wu-lit');
  readonly #label = el('span', 'wu-borders-label');
  #opacity = -1;
  #year: number | null = null;

  constructor() {
    this.element.setAttribute('aria-hidden', 'true');
    this.element.append(this.#label);
  }

  /** Every frame: the borders drawn, or null while none are. */
  update(borders: BordersShown | null | undefined): void {
    const opacity = Math.round(100 * (borders?.strength ?? 0)) / 100;
    if (opacity !== this.#opacity) {
      this.#opacity = opacity;
      this.element.style.opacity = String(opacity);
      this.element.setAttribute('aria-hidden', String(opacity < 0.5));
    }
    if (!borders || borders.year === this.#year) return;
    this.#year = borders.year;
    this.#label.textContent = bordersLabel(borders.year);
  }
}
