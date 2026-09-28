// Meanwhile, at the top right: what else is happening during the current beat, or once the visitor
// has scrubbed story time away from the beat's date, during the month scrubbed to, on vellum slips
// in a dark cast-brass panel. Each entry has an engraved compass rose whose needle points from the
// view's center toward it (turned with the view's heading, so it points the way to look on
// screen), and the compass point it lies at. Choosing one flies there.
import { arcKm, type ViewState } from '../../view/viewState';
import type { Meanwhile, MeanwhileEntry, Walk, WalkState } from '../contract';
import { scrubbedEntries } from '../meanwhile';
import { el, onPress, svg } from './dom';
import { bearingDeg, compassPoint, curlyQuotes } from './format';

/** The width a Meanwhile flight lands at, km. */
const ARRIVE_KM = 1500;
/** An entry nearer the view's center than this share of the view's width is here. */
const HERE_SHARE = 0.05;
/** The rose's center, in its SVG's units (40 across). */
const C = 20;

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
  readonly #meanwhile: Meanwhile;
  readonly #list = el('ul', 'wu-mw-list');
  /** The entries shown, by label, to tell when they change. */
  #shown: string | null = null;
  #rows: Row[] = [];

  constructor(walk: Walk, meanwhile: Meanwhile) {
    this.#walk = walk;
    this.#meanwhile = meanwhile;
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
      if (!here) row.needle.setAttribute('transform', `rotate(${drawn} ${C} ${C})`);
    }
  }

  /** The beat's own entries, or in a break-out scrubbed off the beat's date, the month's. */
  #entries(state: WalkState): MeanwhileEntry[] {
    const beat = state.story.beats[state.beat];
    if (!beat) return [];
    const scrubbed = state.mode === 'breakout' && Math.abs(state.day - beat.day) >= 1;
    if (scrubbed) return scrubbedEntries(this.#meanwhile, state.day);
    return this.#meanwhile.beats[beat.id] ?? [];
  }

  #show(entries: MeanwhileEntry[]): void {
    this.element.hidden = entries.length === 0;
    this.#rows = entries.map((entry) => {
      const needle = svg('g', { class: 'wu-needle-g' });
      needle.append(...halves(C - 16, 2.2, 'wu-needle-n'), ...halves(C + 16, 2.2, 'wu-needle-s'));
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

/**
 * An engraved compass rose, 40 units across, around `needle`: a ring of 32 ticks, four long
 * cardinal points over four short ones, each point cut into a lit half and a shaded half.
 */
function rose(needle: SVGGElement): SVGSVGElement {
  const face = svg('svg', { viewBox: '0 0 40 40', class: 'wu-rose', 'aria-hidden': 'true' });
  const points = (length: number, waist: number, angles: number[]) =>
    angles.map((angle) => {
      const point = svg('g', { transform: `rotate(${angle} ${C} ${C})` });
      point.append(...halves(C - length, waist, 'wu-rose-point'));
      return point;
    });
  face.append(
    svg('circle', { cx: C, cy: C, r: 19, class: 'wu-rose-ring' }),
    svg('circle', { cx: C, cy: C, r: 16.4, class: 'wu-rose-ring' }),
    svg('path', { class: 'wu-rose-ticks', d: ticks() }),
    ...points(10.5, 2.2, [45, 135, 225, 315]),
    ...points(15.6, 3, [0, 90, 180, 270]),
    svg('circle', { cx: C, cy: C, r: 3, class: 'wu-rose-hub' }),
    needle,
    svg('circle', { cx: C, cy: C, r: 1.5, class: 'wu-rose-pin' }),
  );
  return face;
}

/**
 * A point from the center to the tip at height `tip`, `waist` wide either side, as a lit half (the
 * lamp's side, left) and a shaded half.
 */
function halves(tip: number, waist: number, className: string): SVGPathElement[] {
  const toward = Math.sign(tip - C);
  const side = (dx: number) => `M${C} ${C}L${C} ${tip}L${C + dx} ${C + toward * waist}Z`;
  return [
    svg('path', { class: `${className} is-lit`, d: side(-waist) }),
    svg('path', { class: `${className} is-shaded`, d: side(waist) }),
  ];
}

/** The ring's ticks: every 11.25 degrees, longer at the eight points. */
function ticks(): string {
  const at = (r: number, a: number) =>
    `${(C + r * Math.sin(a)).toFixed(2)} ${(C - r * Math.cos(a)).toFixed(2)}`;
  let path = '';
  for (let k = 0; k < 32; k += 1) {
    const a = (k * Math.PI) / 16;
    path += `M${at(k % 4 === 0 ? 16.4 : 17.7, a)}L${at(19, a)}`;
  }
  return path;
}
