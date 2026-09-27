// Meanwhile, at the top right: what else is happening during the current beat, or once the visitor
// has scrubbed story time away from the beat's date, the entries nearest the time scrubbed to. Each
// entry has a compass needle pointing from the view's center toward it (turned with the view's
// heading, so it points the way to look on screen) and the compass point it lies at. Choosing one
// flies there.
import { arcKm, type ViewState } from '../../app/viewState';
import type { MeanwhileByBeat, MeanwhileEntry, Walk, WalkState } from '../contract';
import { nearestEntries } from '../meanwhile';
import { el, onPress, svg } from './dom';
import { bearingDeg, compassPoint, curlyQuotes } from './format';

/** The width a Meanwhile flight lands at, km. */
const ARRIVE_KM = 1500;
/** An entry nearer the view's center than this share of the view's width is here. */
const HERE_SHARE = 0.05;
/** How many entries a scrub away from the beat's date shows. */
const NEAREST = 3;

interface Row {
  entry: MeanwhileEntry;
  needle: SVGGElement;
  compass: HTMLElement;
  point: HTMLElement;
  /** What the compass last showed, 'here' or the needle's angle, to skip redrawing it. */
  drawn: string;
}

export class MeanwhilePanel {
  readonly element = el('aside', 'wu-meanwhile wu-brass');
  readonly #walk: Walk;
  readonly #byBeat: MeanwhileByBeat;
  readonly #list = el('ul', 'wu-mw-list');
  /** The entries shown, by label, to tell when they change. */
  #shown: string | null = null;
  #rows: Row[] = [];

  constructor(walk: Walk, byBeat: MeanwhileByBeat) {
    this.#walk = walk;
    this.#byBeat = byBeat;
    this.element.append(el('h2', 'wu-mw-head', 'Meanwhile, elsewhere —'), this.#list);
  }

  update(state: WalkState, view: ViewState): void {
    const entries = this.#entries(state);
    const shown = entries.map((entry) => entry.label).join('\n');
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#show(entries);
    }
    for (const row of this.#rows) {
      const [lon, lat] = row.entry.at;
      const here = arcKm(view, { ...view, lon, lat }) < view.viewKm * HERE_SHARE;
      const bearing = bearingDeg([view.lon, view.lat], row.entry.at);
      const drawn = here ? 'here' : (bearing - view.heading).toFixed(1);
      if (drawn === row.drawn) continue;
      row.drawn = drawn;
      row.compass.classList.toggle('is-here', here);
      row.point.textContent = here ? 'Here' : compassPoint(bearing);
      if (!here) row.needle.setAttribute('transform', `rotate(${drawn} 16 16)`);
    }
  }

  /** The beat's own entries, or in a break-out scrubbed off the beat's date, the nearest. */
  #entries(state: WalkState): MeanwhileEntry[] {
    const beat = state.story.beats[state.beat];
    if (!beat) return [];
    const scrubbed = state.mode === 'breakout' && Math.abs(state.day - beat.day) >= 1;
    if (scrubbed) return nearestEntries(this.#byBeat, state.day, NEAREST);
    return this.#byBeat[beat.id] ?? [];
  }

  #show(entries: MeanwhileEntry[]): void {
    this.element.hidden = entries.length === 0;
    this.#rows = entries.map((entry) => {
      const needle = svg('g', { class: 'wu-needle-g' });
      needle.append(
        svg('path', { class: 'wu-needle-n', d: 'M16 4.5 L18.4 16 L13.6 16 Z' }),
        svg('path', { class: 'wu-needle-s', d: 'M13.6 16 L18.4 16 L16 27.5 Z' }),
      );
      const compass = el('span', 'wu-compass');
      return { entry, needle, compass, point: el('span', 'wu-compass-point'), drawn: '' };
    });
    this.#list.replaceChildren(...this.#rows.map((row) => this.#item(row)));
    this.element.classList.remove('is-fresh');
    void this.element.offsetWidth;
    this.element.classList.add('is-fresh');
  }

  #item({ entry, needle, compass, point }: Row): HTMLLIElement {
    const item = el('li');
    const choose = el('button', 'wu-mw-entry');
    choose.type = 'button';
    choose.title = `Source: ${entry.source.title}`;
    onPress(choose, () => this.#walk.flyTo(entry.at, ARRIVE_KM));
    const words = el('span', 'wu-mw-words');
    words.append(
      el('span', 'wu-mw-label', curlyQuotes(entry.label)),
      el('span', 'wu-mw-date', entry.dateLabel),
    );
    compass.append(point, rose(needle));
    choose.append(words, compass);
    item.append(choose);
    return item;
  }
}

/** A small engraved compass rose, 32 units across, around `needle`. */
function rose(needle: SVGGElement): SVGSVGElement {
  const face = svg('svg', { viewBox: '0 0 32 32', class: 'wu-rose', 'aria-hidden': 'true' });
  face.append(
    svg('circle', { cx: 16, cy: 16, r: 14.5, class: 'wu-rose-ring' }),
    svg('circle', { cx: 16, cy: 16, r: 11.5, class: 'wu-rose-ring is-inner' }),
    svg('path', {
      class: 'wu-rose-ticks',
      d: 'M16 1.5v3M16 27.5v3M1.5 16h3M27.5 16h3M5.7 5.7l1.8 1.8M24.5 24.5l1.8 1.8M26.3 5.7l-1.8 1.8M7.5 24.5l-1.8 1.8',
    }),
    needle,
    svg('circle', { cx: 16, cy: 16, r: 1.6, class: 'wu-rose-pin' }),
  );
  return face;
}
