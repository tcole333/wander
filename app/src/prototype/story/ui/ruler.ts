// The time ruler along the bottom: a brass rule spanning the story, engraved with months and years,
// a numbered pip per beat (fanned out where beats crowd together, with a leader to each one's
// date), and a garnet playhead with a date plate at story time. Dragging the rule or the playhead
// scrubs; a pip flies to its beat.
import { formatDay, yearLabel, type Precision } from '../dates';
import type { Walk, WalkState } from '../contract';
import type { Story } from '../story';
import { el, onPress, svg } from './dom';
import { monthAbbrev, monthsIn, spreadPips, storySpan, type Span } from './format';

/** Pips' least spacing, px. */
const PIP_GAP = 26;
/** The least width of a month, px, for its name to be engraved. */
const MONTH_LABEL_PX = 28;
/** The playhead's plate may reach this far past the rule's ends, px. */
const PLATE_OVERHANG = 14;

export class TimeRuler {
  readonly element = el('div', 'wu-ruler wu-brass');
  readonly #walk: Walk;
  readonly #story: Story;
  readonly #span: Span;
  readonly #scale = el('div', 'wu-scale');
  readonly #band = el('div', 'wu-band');
  readonly #engraving = el('div', 'wu-engraving');
  readonly #leaders = svg('svg', { class: 'wu-leaders', 'aria-hidden': 'true' });
  readonly #pips: HTMLButtonElement[];
  readonly #playhead = el('div', 'wu-playhead');
  readonly #plate = el('div', 'wu-plate-date');
  #width = 0;
  #beat = -1;
  #plateText = '';
  #plateHalf = 0;
  readonly #onResize = () => this.#layout();

  constructor(walk: Walk, story: Story) {
    this.#walk = walk;
    this.#story = story;
    this.#span = storySpan(story);
    this.#band.append(this.#engraving);
    this.#pips = story.beats.map((beat, i) => {
      const pip = el('button', 'wu-pip', String(i + 1));
      pip.type = 'button';
      pip.title = `${beat.title}, ${formatDay(beat.day, beat.precision)}`;
      pip.setAttribute('aria-label', pip.title);
      onPress(pip, () => this.#walk.goTo(i));
      return pip;
    });
    const needle = el('div', 'wu-needle');
    const jewel = el('div', 'wu-jewel');
    this.#playhead.append(needle, this.#plate, jewel);
    this.#scale.append(this.#band, this.#leaders, ...this.#pips, this.#playhead);
    this.element.append(this.#scale);
    this.#scrubOn(this.#band);
    this.#scrubOn(this.#plate);
    addEventListener('resize', this.#onResize);
    // The plate is measured again once its typeface has loaded.
    void document.fonts.ready.then(() => (this.#plateText = ''));
  }

  update(state: WalkState): void {
    if (this.#width === 0) this.#layout();
    if (state.beat !== this.#beat) {
      this.#pips[this.#beat]?.classList.remove('is-current');
      this.#pips[state.beat]?.classList.add('is-current');
      this.#beat = state.beat;
    }
    const x = this.#x(state.day);
    this.#playhead.style.transform = `translateX(${x.toFixed(1)}px)`;
    const text = formatDay(state.day, platePrecision(state));
    if (text !== this.#plateText) {
      this.#plateText = text;
      this.#plate.textContent = text;
      this.#plateHalf = this.#plate.offsetWidth / 2;
    }
    // The plate slides to stay on the rule at its ends; the needle keeps the true date.
    const lo = this.#plateHalf - PLATE_OVERHANG;
    const hi = this.#width - this.#plateHalf + PLATE_OVERHANG;
    const plateX = Math.min(hi, Math.max(lo, x)) - x;
    this.#plate.style.transform = `translateX(calc(-50% + ${plateX.toFixed(1)}px))`;
  }

  dispose(): void {
    removeEventListener('resize', this.#onResize);
    this.element.remove();
  }

  #x(day: number): number {
    const { start, end } = this.#span;
    const t = (day - start) / (end - start);
    return Math.min(1, Math.max(0, t)) * this.#width;
  }

  #dayAt(clientX: number): number {
    const rect = this.#scale.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return this.#span.start + t * (this.#span.end - this.#span.start);
  }

  #scrubOn(target: HTMLElement): void {
    target.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      this.element.classList.add('is-scrubbing');
      this.#walk.scrub(this.#dayAt(event.clientX));
    });
    target.addEventListener('pointermove', (event) => {
      if (!target.hasPointerCapture(event.pointerId)) return;
      this.#walk.scrub(this.#dayAt(event.clientX));
    });
    const end = () => this.element.classList.remove('is-scrubbing');
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /** Engraves the months and years and places the pips for the rule's width. */
  #layout(): void {
    this.#width = this.#scale.clientWidth;
    const marks: HTMLElement[] = [];
    const months = monthsIn(this.#span);
    let firstYearAt = Infinity;
    for (const month of months) {
      const x0 = this.#x(month.start);
      const x1 = this.#x(month.end);
      if (month.start >= this.#span.start) {
        const tick = el('div', month.month === 1 ? 'wu-tick is-year' : 'wu-tick');
        tick.style.left = `${x0.toFixed(1)}px`;
        marks.push(tick);
        if (month.month === 1) {
          firstYearAt = Math.min(firstYearAt, x0);
          marks.push(yearMark(month.year, x0));
        }
      }
      // January goes unnamed: its year stands at its tick.
      if (month.month !== 1 && x1 - x0 >= MONTH_LABEL_PX) {
        const label = el('div', 'wu-month', monthAbbrev(month.month));
        label.style.left = `${((x0 + x1) / 2).toFixed(1)}px`;
        marks.push(label);
      }
    }
    // The first year is named at the rule's start when its January lies before it.
    const first = months[0];
    if (first && firstYearAt > 60 && first.start < this.#span.start) {
      marks.push(yearMark(first.year, 0));
    }
    this.#engraving.replaceChildren(...marks);

    const trueX = this.#story.beats.map((beat) => this.#x(beat.day));
    const pipX = spreadPips(trueX, PIP_GAP, 10, this.#width - 10);
    this.#pips.forEach((pip, i) => (pip.style.left = `${(pipX[i] ?? 0).toFixed(1)}px`));
    this.#leaders.replaceChildren(
      ...trueX.map((x, i) =>
        svg('path', { d: `M${(pipX[i] ?? 0).toFixed(1)} 0 L${x.toFixed(1)} 12 V16` }),
      ),
    );
  }
}

function yearMark(year: number, x: number): HTMLElement {
  const label = el('div', 'wu-year', yearLabel(year));
  label.style.left = `${x.toFixed(1)}px`;
  return label;
}

/** The plate names the beat's date at the beat's precision while landed on it; else the day. */
function platePrecision(state: WalkState): Precision {
  const beat = state.story.beats[state.beat];
  const landed = state.flight === null && state.mode !== 'breakout';
  return beat && landed && Math.abs(state.day - beat.day) < 0.5 ? beat.precision : 'day';
}
