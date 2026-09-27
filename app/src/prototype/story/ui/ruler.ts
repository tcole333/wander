// The time ruler along the bottom: a brass rule zoomed to the beat's own time (beatSpan), easing
// from one beat's span to the next during flights, and engraved with years, months and, once they
// are wide enough, days. A garnet playhead with a date plate above the rule marks story time, and
// a numbered pip below it marks each beat: those in the span at their dates (fanned out where they
// crowd, with a leader to each one's date), the rest dimmed at the ends. Dragging the rule or the
// plate scrubs; a pip flies to its beat.
import { civilFromDay, formatDay, monthName, yearLabel, type Precision } from '../dates';
import type { Walk, WalkState } from '../contract';
import type { Story } from '../story';
import { el, onPress, svg } from './dom';
import { beatSpan, mixSpans, monthAbbrev, monthsIn, spreadPips, type Span } from './format';

/** Pips' least spacing, px. */
const PIP_GAP = 24;
/** The least width of a month, px, for its name to be engraved, and for its name and year. */
const MONTH_LABEL_PX = 28;
const MONTH_YEAR_LABEL_PX = 90;
/** The least width of a day, px, for its tick to be engraved, and for its number. */
const DAY_TICK_PX = 6;
const DAY_LABEL_PX = 18;
/** The playhead's plate may reach this far past the rule's ends, px. */
const PLATE_OVERHANG = 14;

export class TimeRuler {
  readonly element = el('div', 'wu-ruler wu-brass');
  readonly #walk: Walk;
  readonly #story: Story;
  readonly #scale = el('div', 'wu-scale');
  readonly #band = el('div', 'wu-band');
  readonly #engraving = el('div', 'wu-engraving');
  readonly #leaders = svg('svg', { class: 'wu-leaders', 'aria-hidden': 'true' });
  readonly #pips: HTMLButtonElement[];
  readonly #playhead = el('div', 'wu-playhead');
  readonly #plate = el('div', 'wu-plate-date');
  /**
   * The span drawn; the one a flight eases from, with the playhead's share of it then; and the
   * beat's own.
   */
  #span: Span;
  #from: { span: Span; at: number };
  #to: Span;
  #flying = false;
  #width = 0;
  #beat = -1;
  #plateText = '';
  #plateHalf = 0;
  readonly #onResize = () => this.#layout();

  constructor(walk: Walk, story: Story) {
    this.#walk = walk;
    this.#story = story;
    const first = story.beats[walk.state().beat] ?? story.beats[0];
    this.#span = this.#to = first ? beatSpan(first) : { start: 0, end: 1 };
    this.#from = { span: this.#span, at: 0.5 };
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
    // A flight to a beat, or back to it after a break-out, zooms from the span drawn.
    const flying = state.flight !== null;
    if (state.beat !== this.#beat || (flying && !this.#flying)) {
      this.#pips[this.#beat]?.classList.remove('is-current');
      this.#pips[state.beat]?.classList.add('is-current');
      this.#beat = state.beat;
      const { start, end } = this.#span;
      this.#from = { span: this.#span, at: (state.day - start) / (end - start) };
      const beat = state.story.beats[state.beat];
      if (beat) this.#to = beatSpan(beat);
    }
    this.#flying = flying;
    const t = state.flight ?? 1;
    const { span: from, at } = this.#from;
    const span = mixSpans(from, this.#to, at, state.day, t * t * (3 - 2 * t));
    if (this.#width === 0 || span.start !== this.#span.start || span.end !== this.#span.end) {
      this.#span = span;
      this.#layout();
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

  /** Engraves the span's years, months and days, and places the pips, for the rule's width. */
  #layout(): void {
    this.#width = this.#scale.clientWidth;
    const span = this.#span;
    const dayPx = this.#width / (span.end - span.start);
    const days = dayPx >= DAY_TICK_PX;
    const marks: HTMLElement[] = [];
    const months = monthsIn(span);
    let firstYearAt = Infinity;
    for (const month of months) {
      const x0 = this.#x(month.start);
      const x1 = this.#x(month.end);
      if (month.start >= span.start) {
        const tick = el('div', month.month === 1 ? 'wu-tick is-year' : 'wu-tick');
        tick.style.left = px(x0);
        marks.push(tick);
        if (month.month === 1 && !days) {
          firstYearAt = Math.min(firstYearAt, x0);
          marks.push(yearMark(month.year, x0));
        }
      }
      // Zoomed to days, each month is named with its year; otherwise January goes unnamed, its
      // year standing at its tick.
      if (days && x1 - x0 >= MONTH_YEAR_LABEL_PX) {
        marks.push(monthMark(`${monthName(month.month)} ${yearLabel(month.year)}`, x0, x1));
      } else if (month.month !== 1 && x1 - x0 >= MONTH_LABEL_PX) {
        marks.push(monthMark(monthAbbrev(month.month), x0, x1));
      }
    }
    if (days) {
      for (let day = Math.ceil(span.start); day < span.end; day += 1) {
        const date = civilFromDay(day).day;
        if (date !== 1) {
          const tick = el('div', 'wu-tick is-day');
          tick.style.left = px(this.#x(day));
          marks.push(tick);
        }
        if (dayPx >= DAY_LABEL_PX) {
          const number = el('div', 'wu-day', String(date));
          number.style.left = px(this.#x(day + 0.5));
          marks.push(number);
        }
      }
    }
    // The first year is named at the rule's start when its January lies before it.
    const first = months[0];
    if (!days && first && firstYearAt > 60 && first.start < span.start) {
      marks.push(yearMark(first.year, 0));
    }
    this.#engraving.replaceChildren(...marks);

    const beats = this.#story.beats;
    const trueX = beats.map((beat) => this.#x(beat.day));
    const inside = beats.map((beat) => beat.day >= span.start && beat.day <= span.end);
    const pipX = spreadPips(trueX, PIP_GAP, 10, this.#width - 10);
    this.#pips.forEach((pip, i) => {
      pip.style.left = px(pipX[i] ?? 0);
      pip.classList.toggle('is-off', !inside[i]);
    });
    this.#leaders.replaceChildren(
      ...trueX.flatMap((x, i) =>
        inside[i]
          ? [svg('path', { d: `M${x.toFixed(1)} 0 V3 L${(pipX[i] ?? 0).toFixed(1)} 9` })]
          : [],
      ),
    );
  }
}

function px(x: number): string {
  return `${x.toFixed(1)}px`;
}

function yearMark(year: number, x: number): HTMLElement {
  const label = el('div', 'wu-year', yearLabel(year));
  label.style.left = px(x);
  return label;
}

/** A month's name, centered on the part of it the rule shows. */
function monthMark(name: string, x0: number, x1: number): HTMLElement {
  const label = el('div', 'wu-month', name);
  label.style.left = px((x0 + x1) / 2);
  return label;
}

/** The plate names the beat's date at the beat's precision while landed on it; else the day. */
function platePrecision(state: WalkState): Precision {
  const beat = state.story.beats[state.beat];
  const landed = state.flight === null && state.mode !== 'breakout';
  return beat && landed && Math.abs(state.day - beat.day) < 0.5 ? beat.precision : 'day';
}
