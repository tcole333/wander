// The borders' year plate, at the top of the page between the mark and the sound knob, clear of
// the card, Meanwhile, the climate legend and the ruler: a small riveted plate of Meanwhile's dark
// cast brass naming the snapshot's year in engraved gilt capitals ("Borders · 1815"), as the
// globe's borders always carry their year. Like the climate legend, it settles into view once the
// borders are drawn at half strength or more and fades as they ease out, never lingering
// half-seen while the view holds inside the borders' zoom fade. Explore's border steps name theirs
// as the historical calendar writes a year ("Borders · 44 BCE", borders/steps.ts).
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
  readonly #words: (year: number) => string;
  #shown = false;
  #year: number | null = null;

  /** `words` gives the plate's words for an astronomical year. */
  constructor(words: (year: number) => string = bordersLabel) {
    this.#words = words;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.append(this.#label);
  }

  /** Every frame: the borders drawn, or null while none are. */
  update(borders: BordersShown | null | undefined): void {
    const shown = (borders?.strength ?? 0) >= 0.5;
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.element.classList.toggle('is-shown', shown);
      this.element.setAttribute('aria-hidden', String(!shown));
    }
    if (!borders || borders.year === this.#year) return;
    this.#year = borders.year;
    this.#label.textContent = this.#words(borders.year);
  }
}
