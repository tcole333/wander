// The time ruler as part of the instrument: a curved band of engraved, aged brass along the foot
// of the view, between two knurled knobs with gearwork behind them, drawn in SVG over the canvas.
//
// It keeps TimeRuler's behavior (ruler.ts): the band zooms to each beat's own time (beatSpan),
// easing from span to span during flights, engraved with years, months and, once wide enough,
// days; a garnet playhead marks story time on the band, under a raised brass plaque that names the
// date (sliding to stay on the rule at its ends); a brass stud on the rail beneath marks each beat,
// those in the span at their dates (fanned out where they crowd, with a leader to each one's
// date), the rest dimmed at the ends, and flies there when clicked. Pressing or dragging the band,
// or dragging the plaque, scrubs. The story's controls are on it too: the left knob plays and
// pauses (its glyph shows which, a garnet arc counts down to the next beat), levers either side
// of the plaque step back and on, and the right knob counts the beats.
//
// The lamp is warm and at the upper left, as in the museum scene: the brass is lit from there
// (a specular bevel whose brightest edges bloom a little), engravings are cut dark with their
// lower lips catching the light, and the canvas's vignette and grain lie over the brass so it
// sits in the same photograph. What never changes (the band's body, the knobs, the plaque) is
// drawn once per resize into layers of its own; a frame moves the playhead, plaque and gears, and
// engraves the band again only while its span changes.
import './rulerCraft.css';
import {
  civilFromDay,
  dayFromCivil,
  formatDay,
  monthName,
  yearLabel,
  type Precision,
} from '../dates';
import type { Walk, WalkState } from '../contract';
import type { Story } from '../story';
import { button, el, onPress, svg } from './dom';
import { beatSpan, mixSpans, monthAbbrev, monthsIn, spreadPips, type Span } from './format';

/** The ruler's box: the view's width, this tall, on the view's foot. */
const HEIGHT = 170;
/** The knobs: radius to the knurl's tips, and their centers from the side and the foot. */
const KNOB_R = 50;
const KNOB_SIDE = 86;
const KNOB_FOOT = 64;
/** Each knob is drawn in a square this wide, centered on the knob. */
const KNOB_BOX = 2 * (KNOB_R + 8);
/** How far the band's middle rises above its ends. */
const SAG = 22;
/**
 * Radial offsets from the band's center line, up positive: the band's half width, the rows of
 * its engraving (baselines), and the rail's edges.
 */
const BAND = 22;
/** The band's top face, above it, catching the lamp. */
const LIP = 4.5;
const UPPER_ROW = 5;
const LOWER_ROW = -15;
const RAIL_TOP = -25;
const RAIL_FOOT = -57;
/** On the rail: the studs' centers, and the baseline of each one's numeral beneath it. */
const STUD_AT = -35;
const NUMERAL_ROW = -52;
/** The base plate under the rail runs this far below it, past the view's foot. */
const BASE = 60;
/** The rule stops this far short of each knob's rim. */
const RULE_MARGIN = 22;

/** Studs' least spacing along the rail, px. */
const STUD_GAP = 24;
/** The least widths, px, for a day's tick, a day's number, a month's name, and a year's. */
const DAY_TICK_PX = 6;
const DAY_LABEL_PX = 19;
const MONTH_LABEL_PX = 46;
const YEAR_LABEL_PX = 44;
/** A month named with its year needs this much of it on the rule. */
const MONTH_YEAR_LABEL_PX = 110;
/** Where every day's number would crowd, every fifth, tenth or fifteenth is numbered, this far apart. */
const DAY_STEPS = [5, 10, 15];
const DAY_STEP_PX = 42;

/** The plaque: its size, the tab under it, and how far it may overhang the rule's ends. */
const PLATE_W = 150;
const PLATE_H = 46;
const PLATE_TAB = 6;
const LEVER_W = 38;
const LEVER_H = 32;
const PLATE_OVERHANG = 18;
/** The plaque's foot and the jewel's center, as radial offsets. */
const PLATE_FOOT = 0;
const JEWEL_AT = -12;

/** The canvas's vignette (museumScene.ts: 0.72, from 0.28 to 1.05 of the view's height), eased. */
const VIGNETTE = 0.72 * 0.55;
const VIGNETTE_FROM = 0.28;
const VIGNETTE_TO = 1.05;
/** Gears turn this many degrees per story day; the knobs' knurl turns a third as much. */
const GEAR_DEG_PER_DAY = 0.45;

const PLAY = 'M-7 -12 L13 0 L-7 12 Z';
const PAUSE = 'M-10 -12 H-3 V12 H-10 Z M3 -12 H10 V12 H3 Z';
const RING_R = 41.5;
const RING_C = 2 * Math.PI * RING_R;

/** The band's circle: center, center-line radius, and the half-angles of the rule and of the band. */
interface Arc {
  width: number;
  cx: number;
  cy: number;
  r: number;
  reach: number;
  end: number;
}

export class CraftRuler {
  readonly element = el('div', 'rc');
  readonly #walk: Walk;
  readonly #story: Story;
  readonly #body = svg('svg', { class: 'rc-body', 'aria-hidden': 'true' });
  readonly #engraving = svg('svg', { class: 'rc-engraving', 'aria-hidden': 'true' });
  /** The band's ticks, each kind drawn twice: its lit lip, then the cut. */
  readonly #ticks = new Map<TickKind, SVGPathElement[]>();
  readonly #labelGroup = svg('g', { class: 'rc-labels' });
  /** The labels engraved, by what they name, so a zoom moves them rather than cutting anew. */
  #labels = new Map<string, SVGTextElement>();
  readonly #leaders: SVGPathElement[];
  readonly #numerals: SVGTextElement[];
  readonly #hit = svg('path', { class: 'rc-hit' });
  readonly #finish = svg('svg', { class: 'rc-finish', 'aria-hidden': 'true' });
  readonly #gears: { element: SVGSVGElement; turn: number; side: -1 | 1; big: boolean }[] = [];
  readonly #studs: HTMLButtonElement[];
  readonly #playhead = el('div', 'rc-playhead');
  readonly #plate = el('div', 'rc-plate');
  readonly #plateLines: SVGTextElement[][];
  readonly #back: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #play: HTMLButtonElement;
  readonly #glyph = svg('path', { id: 'rc-glyph', d: PLAY });
  readonly #ring = svg('circle', { class: 'rc-ring', r: RING_R });
  readonly #count = el('div', 'rc-knob rc-count');
  readonly #countLines: SVGTextElement[][];
  readonly #knurls: SVGSVGElement[] = [];
  #arc: Arc = arcFor(1440);
  /**
   * The span drawn; the one a flight eases from, with the playhead's share of it then; and the
   * beat's own.
   */
  #span: Span;
  #from: { span: Span; at: number };
  #to: Span;
  #flying = false;
  #beat = -1;
  #laidOut = false;
  #plateText = '';
  #playing: boolean | null = null;
  #advanceFrom: number | null = null;
  #turnDay = NaN;
  #placed = '';
  readonly #onResize = () => this.#build();

  constructor(walk: Walk, story: Story) {
    this.#walk = walk;
    this.#story = story;
    const first = story.beats[walk.state().beat] ?? story.beats[0];
    this.#span = this.#to = first ? beatSpan(first) : { start: 0, end: 1 };
    this.#from = { span: this.#span, at: 0.5 };

    for (const side of [-1, 1] as const) {
      for (const big of [true, false]) {
        const element = svg('svg', { class: 'rc-gear', 'aria-hidden': 'true' });
        this.#gears.push({ element, turn: big ? side : -2.6 * side, side, big });
      }
    }

    // The band's ticks are cut twice, a light copy a hair down and right (the lip of the cut
    // catching the lamp) under the dark cut; its labels' lips are text shadows. On the dark rail,
    // the leaders and the beats' numerals are gilt inlay over their shadow.
    const lip = svg('g', { class: 'rc-cut-lip', transform: 'translate(0.6 0.9)' });
    const cut = svg('g', { class: 'rc-cut' });
    for (const kind of TICK_KINDS) {
      const pair = [lip, cut].map((group) =>
        group.appendChild(svg('path', { class: `rc-tick is-${kind}` })),
      );
      this.#ticks.set(kind, pair);
    }
    cut.append(this.#labelGroup);
    this.#leaders = [
      svg('path', { class: 'rc-leaders rc-gilt-shadow', transform: 'translate(0.6 0.9)' }),
      svg('path', { class: 'rc-leaders rc-gilt' }),
    ];
    this.#numerals = story.beats.map((_, i) => {
      const numeral = svg('text', { class: 'rc-numeral rc-gilt', 'text-anchor': 'middle' });
      numeral.textContent = roman(i + 1);
      return numeral;
    });
    this.#engraving.append(lip, cut, ...this.#leaders, ...this.#numerals, this.#hit);

    this.#studs = story.beats.map((beat, i) => {
      const stud = el('button', 'rc-stud');
      stud.type = 'button';
      stud.title = `${roman(i + 1)}. ${beat.title}, ${formatDay(beat.day, beat.precision)}`;
      stud.setAttribute('aria-label', stud.title);
      onPress(stud, () => this.#walk.goTo(i));
      return stud;
    });

    this.#playhead.innerHTML = JEWEL_SVG;

    this.#back = button('rc-lever is-back', 'Back', () => this.#walk.back());
    this.#next = button('rc-lever is-next', 'Next', () => this.#walk.next());
    for (const [lever, side] of [
      [this.#back, -1],
      [this.#next, 1],
    ] as const) {
      lever.title = side < 0 ? 'Back' : 'Next';
      lever.innerHTML = leverSvg(side);
      // Each lever tucks a few px under the plaque's side.
      place(lever, side < 0 ? -PLATE_W / 2 - LEVER_W + 6 : PLATE_W / 2 - 6, -PLATE_H / 2 - 17);
    }
    const plateBody = svg('svg', {
      class: 'rc-plate-body',
      width: PLATE_W + 8,
      height: PLATE_H + PLATE_TAB + 10,
      viewBox: `-4 -4 ${PLATE_W + 8} ${PLATE_H + PLATE_TAB + 10}`,
      'aria-hidden': 'true',
    });
    plateBody.innerHTML = PLATE_SVG;
    place(plateBody, -PLATE_W / 2 - 4, -PLATE_H - 4);
    const plateText = svg('svg', {
      class: 'rc-plate-text',
      width: PLATE_W,
      height: PLATE_H,
      viewBox: `0 0 ${PLATE_W} ${PLATE_H}`,
      'aria-hidden': 'true',
    });
    place(plateText, -PLATE_W / 2, -PLATE_H);
    this.#plateLines = [
      engraved(plateText, 'rc-plate-top', PLATE_W / 2, 18),
      engraved(plateText, 'rc-plate-year', PLATE_W / 2, 38.5),
    ];
    this.#plate.append(this.#back, this.#next, plateBody, plateText);

    this.#play = button('rc-knob rc-play', 'Play', () => this.#walk.togglePlay());
    const mark = knobLayer('rc-knob-mark');
    const glyphDefs = svg('defs');
    glyphDefs.append(this.#glyph);
    mark.append(
      glyphDefs,
      svg('use', { href: '#rc-glyph', class: 'rc-cut-lip', transform: 'translate(0.8 1.1)' }),
      svg('use', { href: '#rc-glyph', class: 'rc-niello' }),
    );
    const ring = knobLayer('rc-knob-ring');
    this.#ring.setAttribute('stroke-dasharray', String(RING_C));
    this.#ring.style.opacity = '0';
    ring.append(this.#ring);
    this.#play.append(...this.#knob(), mark, ring);

    const countMark = knobLayer('rc-knob-mark');
    this.#countLines = [
      engraved(countMark, 'rc-count-num', 0, 6),
      engraved(countMark, 'rc-count-of', 0, 22),
    ];
    this.#count.append(...this.#knob(), countMark);
    this.#count.setAttribute('role', 'status');
    for (const knob of [this.#play, this.#count]) {
      place(knob, -KNOB_BOX / 2, -KNOB_BOX / 2);
      knob.style.width = knob.style.height = `${KNOB_BOX}px`;
    }

    this.element.append(
      ...this.#gears.map((gear) => gear.element),
      this.#body,
      this.#engraving,
      ...this.#studs,
      this.#finish,
      this.#playhead,
      this.#plate,
      this.#play,
      this.#count,
    );
    this.#scrubOn(this.#hit, false);
    this.#scrubOn(this.#plate, true);
    addEventListener('resize', this.#onResize);
    this.#build();
  }

  update(state: WalkState): void {
    // A flight to a beat, or back to it after a break-out, zooms from the span drawn.
    const flying = state.flight !== null;
    if (state.beat !== this.#beat || (flying && !this.#flying)) {
      if (state.beat !== this.#beat) this.#showBeat(state);
      const { start, end } = this.#span;
      this.#from = { span: this.#span, at: (state.day - start) / (end - start) };
      const beat = state.story.beats[state.beat];
      if (beat) this.#to = beatSpan(beat);
    }
    this.#flying = flying;
    const t = state.flight ?? 1;
    const { span: from, at } = this.#from;
    const span = mixSpans(from, this.#to, at, state.day, t * t * (3 - 2 * t));
    if (!this.#laidOut || span.start !== this.#span.start || span.end !== this.#span.end) {
      this.#span = span;
      this.#engrave();
    }
    const placed = `${state.day} ${span.start} ${span.end} ${platePrecision(state)}`;
    if (placed !== this.#placed) {
      this.#placed = placed;
      this.#place(state);
    }
    this.#showPlay(state);
    this.#turn(state.day);
  }

  dispose(): void {
    removeEventListener('resize', this.#onResize);
    this.element.remove();
  }

  /** A knob's body: the knurled rim, which turns with story time, and the face over it. */
  #knob(): SVGSVGElement[] {
    const knurl = knobLayer('rc-knurl');
    knurl.innerHTML = `<path d="${teeth(80, KNOB_R - 4.5, KNOB_R, 0.2, 0.55)}" fill="url(#rc-knurl-fill)" filter="url(#rc-lit-teeth)"/>`;
    this.#knurls.push(knurl);
    const face = knobLayer('rc-face');
    face.innerHTML = KNOB_FACE_SVG;
    return [knurl, face];
  }

  #showBeat(state: WalkState): void {
    this.#studs[this.#beat]?.classList.remove('is-current');
    this.#studs[state.beat]?.classList.add('is-current');
    this.#beat = state.beat;
    const beats = state.story.beats;
    this.#back.disabled = state.beat <= 0;
    this.#next.disabled = state.beat >= beats.length - 1;
    setEngraved(this.#countLines[0], roman(state.beat + 1));
    setEngraved(this.#countLines[1], `of ${roman(beats.length)}`);
    this.#count.setAttribute('aria-label', `Beat ${state.beat + 1} of ${beats.length}`);
    this.#count.title = beats[state.beat]?.title ?? '';
  }

  #showPlay(state: WalkState): void {
    const playing = state.mode === 'playing';
    if (playing !== this.#playing) {
      this.#playing = playing;
      this.#glyph.setAttribute('d', playing ? PAUSE : PLAY);
      this.#play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.#play.title = playing ? 'Pause' : 'Play';
      this.#play.classList.toggle('is-playing', playing);
    }
    const advanceIn = state.advanceIn;
    if (advanceIn === null) {
      if (this.#advanceFrom !== null) this.#ring.style.opacity = '0';
      this.#advanceFrom = null;
      return;
    }
    if (this.#advanceFrom === null || advanceIn > this.#advanceFrom) this.#advanceFrom = advanceIn;
    const run = this.#advanceFrom > 0 ? 1 - advanceIn / this.#advanceFrom : 1;
    this.#ring.style.opacity = '1';
    this.#ring.setAttribute('stroke-dashoffset', (RING_C * (1 - run)).toFixed(1));
  }

  /** The gears and the knobs' knurl turn with story time, so time visibly winds through them. */
  #turn(day: number): void {
    if (day === this.#turnDay) return;
    this.#turnDay = day;
    const turn = (share: number) => `${((day * GEAR_DEG_PER_DAY * share) % 360).toFixed(2)}deg`;
    for (const gear of this.#gears) gear.element.style.rotate = turn(gear.turn);
    for (const knurl of this.#knurls) knurl.style.rotate = turn(1 / 3);
  }

  /** The playhead at the day on the band; the plaque above it, kept on the rule. */
  #place(state: WalkState): void {
    const arc = this.#arc;
    const angle = this.#angle(state.day);
    const [x, y] = at(arc, angle, JEWEL_AT);
    this.#playhead.style.transform = `translate(${f(x)}px, ${f(y)}px) rotate(${f(deg(angle), 2)}deg)`;
    setShade(this.#playhead, shadeAt(x, y));
    const half = (PLATE_W / 2 + LEVER_W - PLATE_OVERHANG) / arc.r;
    const plateAngle = Math.min(arc.reach - half, Math.max(-arc.reach + half, angle));
    const [px, py] = at(arc, plateAngle, PLATE_FOOT);
    this.#plate.style.transform = `translate(${f(px)}px, ${f(py)}px) rotate(${f(deg(plateAngle), 2)}deg)`;
    setShade(this.#plate, shadeAt(px, py - PLATE_H / 2));

    const precision = platePrecision(state);
    const text = formatDay(state.day, precision);
    if (text === this.#plateText) return;
    this.#plateText = text;
    const { day, month, year } = civilFromDay(state.day);
    const upper =
      precision === 'year'
        ? ''
        : precision === 'month'
          ? monthName(month)
          : `${day} ${monthName(month)}`;
    const [top, bottom] = this.#plateLines;
    setEngraved(top, upper.toUpperCase());
    setEngraved(bottom, yearLabel(year));
    for (const line of bottom ?? []) line.setAttribute('y', upper ? '38.5' : '31');
  }

  /** The band's angle for a day: the span maps onto the rule, clamped to its ends. */
  #angle(day: number): number {
    const { start, end } = this.#span;
    const t = Math.min(1, Math.max(0, (day - start) / (end - start)));
    return (2 * t - 1) * this.#arc.reach;
  }

  #dayAtAngle(angle: number): number {
    const t = Math.min(1, Math.max(0, (angle / this.#arc.reach + 1) / 2));
    return this.#span.start + t * (this.#span.end - this.#span.start);
  }

  #angleAt(clientX: number, clientY: number): number {
    const rect = this.element.getBoundingClientRect();
    const arc = this.#arc;
    return Math.atan2(clientX - rect.left - arc.cx, arc.cy - (clientY - rect.top));
  }

  /**
   * Scrubs from `target`: pressing the band scrubs to the day under the pointer; the plaque, which
   * shows the day already, scrubs only once dragged, and by as far as it is dragged.
   */
  #scrubOn(target: Element, relative: boolean): void {
    let offset = 0;
    let startX = 0;
    let moved = false;
    target.addEventListener('pointerdown', (event) => {
      const e = event as PointerEvent;
      if (e.button !== 0 || (e.target as Element).closest('.rc-lever')) return;
      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      this.element.classList.add('is-scrubbing');
      const angle = this.#angleAt(e.clientX, e.clientY);
      offset = relative ? this.#angle(this.#walk.state().day) - angle : 0;
      startX = e.clientX;
      moved = !relative;
      if (!relative) this.#walk.scrub(this.#dayAtAngle(angle));
    });
    target.addEventListener('pointermove', (event) => {
      const e = event as PointerEvent;
      if (!target.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      this.#walk.scrub(this.#dayAtAngle(this.#angleAt(e.clientX, e.clientY) + offset));
    });
    const end = () => this.element.classList.remove('is-scrubbing');
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /** Draws what depends only on the view's size: the band's body, gears, knobs and finish. */
  #build(): void {
    const width = innerWidth;
    const arc = (this.#arc = arcFor(width));
    for (const layer of [this.#body, this.#engraving, this.#finish]) {
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(HEIGHT));
      layer.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    }
    this.#body.innerHTML = bodySvg(arc);
    this.#finish.innerHTML = finishSvg(arc);
    this.#hit.setAttribute(
      'd',
      sector(arc, -arc.reach - 0.004, arc.reach + 0.004, RAIL_FOOT, BAND),
    );

    const knobY = HEIGHT - KNOB_FOOT;
    for (const [knob, x] of [
      [this.#play, KNOB_SIDE],
      [this.#count, width - KNOB_SIDE],
    ] as const) {
      knob.style.transform = `translate(${x}px, ${knobY}px)`;
      setShade(knob, shadeAt(x, knobY));
    }
    for (const gear of this.#gears) {
      // A big wheel behind each knob, low and outward; a small one above it.
      const [dx, dy, r, n] = gear.big ? [-40, 24, 66, 28] : [-60, -40, 20, 11];
      const x = gear.side < 0 ? KNOB_SIDE + dx : width - KNOB_SIDE - dx;
      const y = knobY + dy;
      const size = 2 * r + 8;
      gear.element.setAttribute('width', String(size));
      gear.element.setAttribute('height', String(size));
      gear.element.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
      gear.element.style.left = `${x - size / 2}px`;
      gear.element.style.top = `${y - size / 2}px`;
      setShade(gear.element, shadeAt(x, y));
      gear.element.innerHTML = gearSvg(r, n);
    }
    this.#laidOut = false;
    this.#placed = '';
  }

  /** Engraves the span's scale on the band, and sets the studs on the rail. */
  #engrave(): void {
    this.#laidOut = true;
    const arc = this.#arc;
    const span = this.#span;
    const scale = engraveScale(arc, span, (day) => this.#angle(day));
    for (const kind of TICK_KINDS) {
      for (const path of this.#ticks.get(kind) ?? []) path.setAttribute('d', scale[kind]);
    }
    this.#setLabels(scale.labels);

    const inRule = (day: number) => day >= span.start && day <= span.end;
    const beats = this.#story.beats;
    const trueS = beats.map((beat) => this.#angle(beat.day) * arc.r);
    const inside = beats.map((beat) => inRule(beat.day));
    const reachS = arc.reach * arc.r;
    const studS = spreadPips(trueS, STUD_GAP, -reachS + 8, reachS - 8);
    let leaders = '';
    this.#studs.forEach((stud, i) => {
      const a = (studS[i] ?? 0) / arc.r;
      const [x, y] = at(arc, a, STUD_AT);
      stud.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
      stud.classList.toggle('is-off', !inside[i]);
      const [nx, ny] = at(arc, a, NUMERAL_ROW);
      const numeral = this.#numerals[i];
      numeral?.setAttribute('transform', `translate(${f(nx)} ${f(ny)}) rotate(${f(deg(a), 2)})`);
      numeral?.classList.toggle('is-off', !inside[i]);
      if (!inside[i]) return;
      const b = (trueS[i] ?? 0) / arc.r;
      const [x0, y0] = at(arc, b, -BAND);
      const [x1, y1] = at(arc, b, RAIL_TOP - 1);
      const [x2, y2] = at(arc, a, STUD_AT + 7);
      leaders += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
    });
    for (const path of this.#leaders) path.setAttribute('d', leaders);
  }

  /** Moves the labels still on the rule, cuts the new ones, and removes those gone. */
  #setLabels(labels: Label[]): void {
    const kept = new Map<string, SVGTextElement>();
    for (const { key, angle, row, text, cls } of labels) {
      let t = this.#labels.get(key);
      if (t) {
        this.#labels.delete(key);
      } else {
        t = svg('text', { class: cls, 'text-anchor': 'middle' });
        t.textContent = text;
        this.#labelGroup.append(t);
      }
      const [x, y] = at(this.#arc, angle, row);
      t.setAttribute('transform', `translate(${f(x)} ${f(y)}) rotate(${f(deg(angle), 2)})`);
      kept.set(key, t);
    }
    for (const gone of this.#labels.values()) gone.remove();
    this.#labels = kept;
  }
}

type TickKind = 'full' | 'major' | 'minor';
const TICK_KINDS: TickKind[] = ['full', 'major', 'minor'];

/** A label on the band: what it names (its key), where, and in which face. */
interface Label {
  key: string;
  angle: number;
  row: number;
  text: string;
  cls: string;
}

interface Scale extends Record<TickKind, string> {
  labels: Label[];
}

/**
 * The span's scale in calendar terms, for the unit that fits: days, months or years, each ticked
 * and numbered or named in the lower row, and the unit above (a month with its year, a year)
 * named in the upper row over the part of it the rule shows.
 */
function engraveScale(arc: Arc, span: Span, angle: (day: number) => number): Scale {
  const scale: Scale = { full: '', major: '', minor: '', labels: [] };
  const pxPerDay = (2 * arc.reach * arc.r) / (span.end - span.start);
  const inRule = (day: number) => day >= span.start && day <= span.end;
  const edges = (a: number, length: number) =>
    radial(arc, a, BAND - 1, BAND - 1 - length) + radial(arc, a, -BAND + 1, -BAND + 1 + length);
  /** Names the stretch [from, to) at the middle of the part of it on the rule, if that is wide enough. */
  const name = (
    key: string,
    from: number,
    to: number,
    row: number,
    text: string,
    cls: string,
    least: number,
  ) => {
    const a0 = angle(Math.max(from, span.start));
    const a1 = angle(Math.min(to, span.end));
    if ((a1 - a0) * arc.r >= least)
      scale.labels.push({ key, angle: (a0 + a1) / 2, row, text, cls });
  };

  const months = monthsIn(span);
  for (const month of months) {
    if (!inRule(month.start)) continue;
    if (month.month === 1) scale.full += radial(arc, angle(month.start), -BAND + 1, BAND - 1);
    else if (pxPerDay * 28 >= 4) scale.major += edges(angle(month.start), 7);
  }
  if (pxPerDay >= DAY_TICK_PX) {
    // Days, numbered as often as they fit, under each month named with its year.
    const step =
      pxPerDay >= DAY_LABEL_PX ? 1 : (DAY_STEPS.find((s) => s * pxPerDay >= DAY_STEP_PX) ?? 30);
    for (let day = Math.ceil(span.start); day < span.end; day += 1) {
      const date = civilFromDay(day).day;
      const numbered =
        step === 1 || (date === 1 && step >= 5) || (date % step === 0 && date <= 30 - step / 2);
      if (date !== 1) scale.minor += edges(angle(day), numbered && step > 1 ? 6 : 4);
      if (numbered && inRule(day + 0.5)) {
        const text = String(date);
        scale.labels.push({
          key: `d${day}`,
          angle: angle(day + 0.5),
          row: LOWER_ROW,
          text,
          cls: 'rc-day',
        });
      }
    }
    for (const month of months) {
      const text = `${monthName(month.month)} ${yearLabel(month.year)}`.toUpperCase();
      name(
        `u${month.start}`,
        month.start,
        month.end,
        UPPER_ROW,
        text,
        'rc-upper',
        MONTH_YEAR_LABEL_PX,
      );
    }
  } else if (pxPerDay * 28 * 3 >= MONTH_LABEL_PX) {
    // Months, each with a fine tick at its middle and named, or where that crowds, every third
    // (January, April, July, October), under each year.
    const every = pxPerDay * 30 >= MONTH_LABEL_PX ? 1 : 3;
    for (const month of months) {
      const mid = (month.start + month.end) / 2;
      if (inRule(mid)) scale.minor += edges(angle(mid), 4);
      if ((month.month - 1) % every !== 0) continue;
      const text = monthAbbrev(month.month).toUpperCase();
      const least = Math.min(MONTH_LABEL_PX, 28);
      name(`m${month.start}`, month.start, month.end, LOWER_ROW, text, 'rc-month', least);
    }
    for (const year of yearsIn(span)) {
      const text = yearLabel(year.year);
      name(
        `u${year.start}`,
        year.start,
        year.end,
        UPPER_ROW - 3,
        text,
        'rc-upper is-year',
        YEAR_LABEL_PX,
      );
    }
  } else {
    for (const year of yearsIn(span)) {
      const text = yearLabel(year.year);
      name(`y${year.start}`, year.start, year.end, LOWER_ROW, text, 'rc-year', YEAR_LABEL_PX);
    }
  }
  return scale;
}

/** Every year the span touches, with its first day and the next year's. */
function yearsIn(span: Span): { year: number; start: number; end: number }[] {
  const years = [];
  const last = civilFromDay(span.end).year;
  for (let year = civilFromDay(span.start).year; year <= last; year += 1) {
    const start = dayFromCivil({ year, month: 1, day: 1 });
    years.push({ year, start, end: dayFromCivil({ year: year + 1, month: 1, day: 1 }) });
  }
  return years;
}

function arcFor(width: number): Arc {
  const half = width / 2 - KNOB_SIDE;
  const r = (half * half + SAG * SAG) / (2 * SAG);
  const apexY = HEIGHT - KNOB_FOOT - SAG;
  return {
    width,
    cx: width / 2,
    cy: apexY + r,
    r,
    reach: Math.asin((half - KNOB_R - RULE_MARGIN) / r),
    end: Math.asin(half / r),
  };
}

/** The point at `angle` on the circle `dr` above the band's center line. */
function at(arc: Arc, angle: number, dr = 0): [number, number] {
  const r = arc.r + dr;
  return [arc.cx + r * Math.sin(angle), arc.cy - r * Math.cos(angle)];
}

/** The ring's stretch from a0 to a1 between the radial offsets `inner` and `outer`. */
function sector(arc: Arc, a0: number, a1: number, inner: number, outer: number): string {
  const [x0, y0] = at(arc, a0, outer);
  const [x1, y1] = at(arc, a1, outer);
  const [x2, y2] = at(arc, a1, inner);
  const [x3, y3] = at(arc, a0, inner);
  const [ro, ri] = [arc.r + outer, arc.r + inner];
  return (
    `M${f(x0)} ${f(y0)}A${f(ro)} ${f(ro)} 0 0 1 ${f(x1)} ${f(y1)}` +
    `L${f(x2)} ${f(y2)}A${f(ri)} ${f(ri)} 0 0 0 ${f(x3)} ${f(y3)}Z`
  );
}

/** An arc along the band from a0 to a1, `dr` above its center line. */
function along(arc: Arc, a0: number, a1: number, dr: number): string {
  const [x0, y0] = at(arc, a0, dr);
  const [x1, y1] = at(arc, a1, dr);
  const r = arc.r + dr;
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y1)}`;
}

/** A tick across the band at `angle`, from one radial offset to another. */
function radial(arc: Arc, angle: number, from: number, to: number): string {
  const [x0, y0] = at(arc, angle, from);
  const [x1, y1] = at(arc, angle, to);
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
}

/** A line of text engraved in `parent` at (x, y): the lit lip of the cut, then the cut. */
function engraved(
  parent: SVGSVGElement,
  className: string,
  x: number,
  y: number,
): SVGTextElement[] {
  const at = { x, y, 'text-anchor': 'middle' };
  const lip = svg('text', {
    ...at,
    class: `${className} rc-cut-lip`,
    transform: 'translate(0.6 0.9)',
  });
  const cut = svg('text', { ...at, class: `${className} rc-cut` });
  parent.append(lip, cut);
  return [lip, cut];
}

function setEngraved(lines: SVGTextElement[] | undefined, text: string): void {
  for (const line of lines ?? []) line.textContent = text;
}

/** One of a knob's stacked layers, a square centered on the knob. */
function knobLayer(className: string): SVGSVGElement {
  const h = KNOB_BOX / 2;
  return svg('svg', {
    class: className,
    width: KNOB_BOX,
    height: KNOB_BOX,
    viewBox: `${-h} ${-h} ${KNOB_BOX} ${KNOB_BOX}`,
    'aria-hidden': 'true',
  });
}

/** Sets a part's --shade (the vignette where it sits) when it changes. */
function setShade(element: HTMLElement | SVGElement, shade: string): void {
  if (element.style.getPropertyValue('--shade') !== shade)
    element.style.setProperty('--shade', shade);
}

/** Positions an element absolutely within its parent. */
function place(element: HTMLElement | SVGElement, left: number, top: number): void {
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

/**
 * A toothed wheel's outline: `n` teeth between radii r0 and r1, each rising over `rise` of its
 * pitch and flat on top for `top` of what is left.
 */
function teeth(n: number, r0: number, r1: number, rise: number, top: number): string {
  const points: string[] = [];
  const step = (2 * Math.PI) / n;
  const flat = top * (1 - 2 * rise);
  for (let k = 0; k < n; k += 1) {
    for (const [share, r] of [
      [0, r0],
      [rise, r1],
      [rise + flat, r1],
      [2 * rise + flat, r0],
    ] as const) {
      const a = (k + share) * step;
      points.push(`${f(r * Math.sin(a))} ${f(-r * Math.cos(a))}`);
    }
  }
  return `M${points.join('L')}Z`;
}

function circlePath(r: number): string {
  return `M${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0Z`;
}

/** A spoked wheel of radius r with n teeth, shaded alike all round so it can turn under the lamp. */
function gearSvg(r: number, n: number): string {
  const root = r - Math.max(4, r * 0.1);
  const rim = root * 0.78;
  const hub = Math.max(4, r * 0.2);
  const spokes = r > 30 ? 5 : 4;
  const w = r > 30 ? 4.5 : 2.5;
  let spokePath = '';
  for (let k = 0; k < spokes; k += 1) {
    const a = (k * 2 * Math.PI) / spokes;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    const p = (out: number, side: number) => `${f(out * s + side * c)} ${f(-out * c + side * s)}`;
    spokePath += `M${p(hub - 1, -w)}L${p(rim + 1, -w)}L${p(rim + 1, w)}L${p(hub - 1, w)}Z`;
  }
  return (
    `<g fill="url(#rc-gear-fill)" stroke="#170e05" stroke-width="0.8">` +
    `<path fill-rule="evenodd" d="${teeth(n, root, r, 0.16, 0.5)}${circlePath(rim)}"/>` +
    `<path d="${spokePath}${circlePath(hub)}"/></g>` +
    `<circle r="${f(hub * 0.45)}" fill="#170e05"/>` +
    `<circle r="${f(root - 1.5)}" fill="none" stroke="rgb(240 205 140 / 0.2)" stroke-width="0.8"/>` +
    `<circle r="${f(rim + 1.5)}" fill="none" stroke="rgb(240 205 140 / 0.14)" stroke-width="0.8"/>`
  );
}

interface FilterSpec {
  /** How far the shape's edge rounds off, px. */
  bevel: number;
  /** The height of that rounding, for the lighting. */
  relief: number;
  /** The surface's texture, as feTurbulence's baseFrequency, and how deep it is. */
  texture: string;
  amount: number;
  shine?: number;
  /** How much the brightest edges glow past the shape. */
  bloom?: number;
  /** How much low, cloudy tarnish darkens the brass. */
  patina?: number;
}

/**
 * A filter that lights a flat brass shape as raised metal under the lamp: the shape's alpha,
 * blurred by `bevel`, is its height, roughened by `texture`, lit diffusely and specularly from
 * the upper left in the key light's warm color; a cloudy tarnish ages it, a fine grain lies over
 * it as over the canvas, and its brightest edges bloom past it a little.
 */
function brassFilter(id: string, spec: FilterSpec): string {
  const { bevel, relief, texture, amount, shine = 1, bloom = 0.5, patina = 0 } = spec;
  const [k, b] = [2 * patina, 1 - 1.5 * patina];
  return `<filter id="${id}" x="-15%" y="-40%" width="130%" height="180%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="${bevel}" result="hump"/>
<feTurbulence type="fractalNoise" baseFrequency="${texture}" numOctaves="2" seed="7" result="tex"/>
<feComposite in="tex" in2="hump" operator="arithmetic" k2="${amount}" k3="1" result="height"/>
<feDiffuseLighting in="height" surfaceScale="${relief}" diffuseConstant="1.05" lighting-color="#fff2e0" result="diffuse"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting>
<feSpecularLighting in="height" surfaceScale="${relief}" specularConstant="${shine}" specularExponent="16" lighting-color="#ffd6a8" result="spec"><feDistantLight azimuth="225" elevation="35"/></feSpecularLighting>
<feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="1.25" result="lit"/>
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.03" numOctaves="3" seed="21" result="cloud"/>
<feColorMatrix in="cloud" type="matrix" values="${k} 0 0 0 ${b} ${k} 0 0 0 ${b} ${k} 0 0 0 ${b} 0 0 0 0 1" result="tarnish"/>
<feBlend in="lit" in2="tarnish" mode="multiply" result="aged"/>
<feComposite in="spec" in2="SourceAlpha" operator="in" result="shine"/>
<feComposite in="aged" in2="shine" operator="arithmetic" k2="1" k3="0.85" result="metal"/>
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="3" result="n"/>
<feColorMatrix in="n" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1" result="grain"/>
<feComposite in="grain" in2="metal" operator="arithmetic" k2="0.16" k3="1" k4="-0.08" result="grained"/>
<feComposite in="grained" in2="SourceAlpha" operator="in" result="body"/>
<feGaussianBlur in="shine" stdDeviation="2.4" result="glowBlur"/>
<feComponentTransfer in="glowBlur" result="glow"><feFuncA type="linear" slope="${bloom}"/></feComponentTransfer>
<feMerge><feMergeNode in="glow"/><feMergeNode in="body"/></feMerge>
</filter>`;
}

/** Gradients and filters every part of the ruler shares, defined once in the body. */
function sharedDefs(): string {
  return `<defs>
<linearGradient id="rc-band-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#8a6632"/><stop offset="0.2" stop-color="#be9451"/>
  <stop offset="0.34" stop-color="#d0a862"/><stop offset="0.6" stop-color="#b38848"/>
  <stop offset="1" stop-color="#76572b"/>
</linearGradient>
<linearGradient id="rc-rail-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#4f3a1c"/><stop offset="0.3" stop-color="#7a5a2d"/>
  <stop offset="0.6" stop-color="#694c24"/><stop offset="1" stop-color="#46331a"/>
</linearGradient>
<linearGradient id="rc-base-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#1c140b"/><stop offset="0.3" stop-color="#3a2a16"/>
  <stop offset="0.55" stop-color="#30230f"/><stop offset="1" stop-color="#18110a"/>
</linearGradient>
<linearGradient id="rc-lip-fill" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#b58d4c"/><stop offset="0.3" stop-color="#f3d9a0"/>
  <stop offset="0.65" stop-color="#d2ab66"/><stop offset="1" stop-color="#8e6c37"/>
</linearGradient>
<linearGradient id="rc-plate-fill" x1="0" x2="0.35" y1="0" y2="1">
  <stop offset="0" stop-color="#ecd092"/><stop offset="0.5" stop-color="#cfa65f"/>
  <stop offset="1" stop-color="#9c763b"/>
</linearGradient>
<linearGradient id="rc-frame-fill" x1="0" x2="0.3" y1="0" y2="1">
  <stop offset="0" stop-color="#a47d40"/><stop offset="0.5" stop-color="#6e5027"/>
  <stop offset="1" stop-color="#3f2c13"/>
</linearGradient>
<linearGradient id="rc-knurl-fill" x1="0" x2="1" y1="0" y2="1">
  <stop offset="0" stop-color="#c49a55"/><stop offset="1" stop-color="#6e5027"/>
</linearGradient>
<radialGradient id="rc-face-fill" cx="0.4" cy="0.36" r="0.75">
  <stop offset="0" stop-color="#d8b471"/><stop offset="0.55" stop-color="#b28845"/>
  <stop offset="1" stop-color="#6b4d26"/>
</radialGradient>
<radialGradient id="rc-gear-fill" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0.5" stop-color="#5a4121"/><stop offset="0.86" stop-color="#76582c"/>
  <stop offset="1" stop-color="#3b2a14"/>
</radialGradient>
<radialGradient id="rc-garnet" cx="0.38" cy="0.34" r="0.7">
  <stop offset="0" stop-color="#ffc2ca"/><stop offset="0.18" stop-color="#e0485e"/>
  <stop offset="0.5" stop-color="#9c1c31"/><stop offset="1" stop-color="#380611"/>
</radialGradient>
<radialGradient id="rc-garnet-glow" r="0.5">
  <stop offset="0" stop-color="rgb(255 90 100 / 0.5)"/><stop offset="1" stop-color="rgb(200 40 60 / 0)"/>
</radialGradient>
<linearGradient id="rc-bezel" x1="0" x2="1" y1="0" y2="1">
  <stop offset="0" stop-color="#f6dea4"/><stop offset="0.5" stop-color="#b88e4b"/>
  <stop offset="1" stop-color="#5a411f"/>
</linearGradient>
<radialGradient id="rc-sheen" r="0.5">
  <stop offset="0" stop-color="rgb(255 240 205 / 0.5)"/><stop offset="1" stop-color="rgb(255 240 205 / 0)"/>
</radialGradient>
${brassFilter('rc-lit-band', { bevel: 6, relief: 4, texture: '0.005 0.8', amount: 0.06, bloom: 0.5, patina: 0.2 })}
${brassFilter('rc-lit-rail', { bevel: 3, relief: 3, texture: '0.11', amount: 0.3, shine: 0.6, bloom: 0.2, patina: 0.3 })}
${brassFilter('rc-lit-base', { bevel: 3, relief: 2.5, texture: '0.05', amount: 0.1, shine: 0.35, bloom: 0.1, patina: 0.3 })}
${brassFilter('rc-lit-lip', { bevel: 0.8, relief: 2, texture: '0.01 0.5', amount: 0.03, shine: 1.2, bloom: 0.9 })}
${brassFilter('rc-lit-teeth', { bevel: 1, relief: 2.5, texture: '0.5', amount: 0.05, bloom: 0.4 })}
${brassFilter('rc-lit-dome', { bevel: 8, relief: 5, texture: '0.08', amount: 0.08, bloom: 0.45, patina: 0.15 })}
${brassFilter('rc-lit-plate', { bevel: 2, relief: 3, texture: '0.01 0.6', amount: 0.05, bloom: 0.6, patina: 0.1 })}
<filter id="rc-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>`;
}

/**
 * The band, its lit upper lip and its rail, seated into the knobs' sockets, with the engraving
 * that never changes: the band's border rules and the rail's beaded edges.
 */
function bodySvg(arc: Arc): string {
  const [a0, a1] = [-arc.end, arc.end];
  const knobY = HEIGHT - KNOB_FOOT;
  const sockets = [KNOB_SIDE, arc.width - KNOB_SIDE]
    .map((x) => `<circle cx="${x + 3}" cy="${knobY + 6}" r="${KNOB_R + 4}"/>`)
    .join('');
  const rules = [BAND - 3, -BAND + 3]
    .map((dr) => along(arc, -arc.reach - 0.008, arc.reach + 0.008, dr))
    .join('');
  const beads = along(arc, a0, a1, RAIL_TOP - 3.5);
  const baseRule = along(arc, a0, a1, RAIL_FOOT - 4);
  return `${sharedDefs()}
<g fill="#000" filter="url(#rc-soft)">
  <path d="${sector(arc, a0, a1, RAIL_FOOT - BASE, BAND + LIP + 5)}" opacity="0.6"/>
  <path d="${sector(arc, a0, a1, RAIL_FOOT - 2, BAND + 2)}" opacity="0.8" transform="translate(2 6)"/>
  <g opacity="0.75">${sockets}</g>
</g>
<path d="${sector(arc, -arc.end - 0.02, arc.end + 0.02, RAIL_FOOT - BASE, RAIL_FOOT)}" fill="url(#rc-base-fill)" filter="url(#rc-lit-base)"/>
<path d="${sector(arc, a0, a1, RAIL_FOOT, RAIL_TOP)}" fill="url(#rc-rail-fill)" filter="url(#rc-lit-rail)"/>
<path d="${sector(arc, a0, a1, RAIL_TOP, -BAND)}" fill="#120a03"/>
<path d="${sector(arc, a0, a1, -BAND, BAND)}" fill="url(#rc-band-fill)" filter="url(#rc-lit-band)"/>
<path d="${sector(arc, a0, a1, BAND - 0.5, BAND + LIP)}" fill="url(#rc-lip-fill)" filter="url(#rc-lit-lip)"/>
<path d="${along(arc, a0, a1, BAND)}" fill="none" stroke="rgb(40 25 8 / 0.55)" stroke-width="0.8"/>
<g fill="none" stroke-linecap="round">
  <path d="${rules}" stroke="rgb(255 238 196 / 0.45)" stroke-width="0.8" transform="translate(0.5 0.8)"/>
  <path d="${rules}" stroke="rgb(43 28 12 / 0.8)" stroke-width="0.8"/>
  <path d="${beads}" stroke="rgb(0 0 0 / 0.6)" stroke-width="2.6" stroke-dasharray="0 6" transform="translate(0.5 0.9)"/>
  <path d="${beads}" stroke="rgb(236 200 132 / 0.75)" stroke-width="2" stroke-dasharray="0 6"/>
  <path d="${baseRule}" stroke="rgb(0 0 0 / 0.5)" stroke-width="0.8" transform="translate(0.5 0.9)"/>
  <path d="${baseRule}" stroke="rgb(214 176 108 / 0.3)" stroke-width="0.8"/>
</g>`;
}

/** The canvas's vignette laid over the band and rail, so their ends darken as the view's do. */
function finishSvg(arc: Arc): string {
  const vh = innerHeight;
  const stops: string[] = [];
  for (let k = 0; k <= 10; k += 1) {
    const r = VIGNETTE_FROM + ((VIGNETTE_TO - VIGNETTE_FROM) * k) / 10;
    const dark = 1 - vignetteAt(r);
    stops.push(
      `<stop offset="${(r / VIGNETTE_TO).toFixed(3)}" stop-color="#000" stop-opacity="${dark.toFixed(3)}"/>`,
    );
  }
  return `<defs><radialGradient id="rc-vignette" gradientUnits="userSpaceOnUse" cx="${f(arc.cx)}" cy="${f(HEIGHT - vh / 2)}" r="${f(VIGNETTE_TO * vh)}">${stops.join('')}</radialGradient></defs>
<path d="${sector(arc, -arc.end - 0.02, arc.end + 0.02, RAIL_FOOT - BASE, BAND + LIP)}" fill="url(#rc-vignette)"/>`;
}

/** The canvas's vignette as a brightness, `r` view heights from the view's center. */
function vignetteAt(r: number): number {
  const t = Math.min(1, Math.max(0, (r - VIGNETTE_FROM) / (VIGNETTE_TO - VIGNETTE_FROM)));
  const v = 1 - t * t * (3 - 2 * t);
  return 1 - VIGNETTE + VIGNETTE * v;
}

/** The vignette's brightness at a point of the ruler's box, for a part's --shade. */
function shadeAt(x: number, y: number): string {
  const vy = innerHeight - HEIGHT + y;
  const r = Math.hypot((x - innerWidth / 2) / innerHeight, vy / innerHeight - 0.5);
  return vignetteAt(r).toFixed(2);
}

const KNOB_FACE_SVG = `
<circle r="${KNOB_R - 4}" fill="#1a1007"/>
<circle r="${KNOB_R - 5.5}" fill="url(#rc-bezel)" filter="url(#rc-lit-teeth)"/>
<circle r="${KNOB_R - 12}" fill="#24170a"/>
<circle r="${KNOB_R - 13}" fill="url(#rc-face-fill)" filter="url(#rc-lit-dome)"/>
<g fill="none" stroke="rgb(60 40 15 / 0.22)" stroke-width="0.5">
  <circle r="32"/><circle r="28"/><circle r="24"/><circle r="20"/><circle r="16"/>
</g>
<ellipse cx="-13" cy="-15" rx="16" ry="9" fill="url(#rc-sheen)" transform="rotate(-40 -13 -15)"/>
<path d="M-45 -10 A46 46 0 0 1 -10 -45" stroke="rgb(255 236 190 / 0.3)" stroke-width="5" fill="none" stroke-linecap="round" filter="url(#rc-soft)"/>`;

const JEWEL_SVG = `<svg viewBox="-24 -24 48 72" width="48" height="72" aria-hidden="true">
<circle r="20" fill="url(#rc-garnet-glow)"/>
<path d="M-3.4 8 L3.4 8 L0.9 ${JEWEL_AT - STUD_AT - 8} L-0.9 ${JEWEL_AT - STUD_AT - 8} Z" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.7"/>
<circle r="11" fill="#1c1208" transform="translate(1 1.6)" opacity="0.6"/>
<circle r="10.5" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.8"/>
<circle r="8.6" fill="none" stroke="rgb(40 25 8 / 0.6)" stroke-width="1.6" stroke-dasharray="1.1 1.6"/>
<circle r="7.2" fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.6"/>
<path d="M-7 0 L0 -7 L7 0 L0 7 Z M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6" fill="none" stroke="rgb(255 200 210 / 0.16)" stroke-width="0.6"/>
<ellipse cx="-2.6" cy="-3" rx="2.4" ry="1.4" fill="#fff6f0" opacity="0.92" transform="rotate(-38 -2.6 -3)"/>
<circle cx="3" cy="3.4" r="0.9" fill="#ffd9de" opacity="0.6"/>
</svg>`;

/** The plaque: a dark bronze frame round a raised face of bright brass, with an engraved border. */
const PLATE_SVG = `
<path d="${cartouche(2, 4, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="#000" opacity="0.8" filter="url(#rc-soft)"/>
<path d="${cartouche(0, 0, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="url(#rc-frame-fill)" stroke="#160d05" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(3.5, 3.5, PLATE_W - 7, PLATE_H - 7, 5, 0)}" fill="#1c1208"/>
<path d="${cartouche(4, 4, PLATE_W - 8, PLATE_H - 8, 4.5, 0)}" fill="url(#rc-plate-fill)" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(255 244 210 / 0.55)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(58 38 14 / 0.65)" stroke-width="0.7"/>`;

/** A lever beside the plaque, pointing back (-1) or on (1), with an engraved arrow and grip. */
function leverSvg(side: -1 | 1): string {
  // Drawn pointing back, then mirrored point by point for Next, so the lamp lights both alike.
  const x = (v: number) => (side < 0 ? v : LEVER_W - v);
  const shape = `M${x(LEVER_W)} 5 H${x(15)} Q${x(12)} 5 ${x(10)} 7 L${x(3)} 15 L${x(10)} 23 Q${x(12)} 25 ${x(15)} 25 H${x(LEVER_W)} Z`;
  const arrow = `M${x(10)} 15 L${x(19)} 9.5 V20.5 Z`;
  const grip = `M${x(24)} 9 V21 M${x(28)} 9 V21`;
  return `<svg viewBox="-1 -1 ${LEVER_W + 2} ${LEVER_H}" width="${LEVER_W + 2}" height="${LEVER_H}" aria-hidden="true">
<path d="${shape}" fill="#000" opacity="0.6" transform="translate(1 2)" filter="url(#rc-soft)"/>
<path d="${shape}" fill="url(#rc-plate-fill)" stroke="#3a2710" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${arrow}" class="rc-cut-lip" transform="translate(0.6 0.9)"/>
<path d="${arrow}" class="rc-niello"/>
<path d="${grip}" class="rc-cut-line"/>
</svg>`;
}

/**
 * A plaque's outline at (x, y), w by h, with corners cut in by quarter circles of radius n and a
 * tab of depth `tab` under its middle.
 */
function cartouche(x: number, y: number, w: number, h: number, n: number, tab: number): string {
  const [r, b, m] = [x + w, y + h, x + w / 2];
  const foot = tab > 0 ? `H${m + tab * 1.4}L${m} ${b + tab}L${m - tab * 1.4} ${b}` : '';
  return (
    `M${x + n} ${y}H${r - n}A${n} ${n} 0 0 0 ${r} ${y + n}V${b - n}A${n} ${n} 0 0 0 ${r - n} ${b}` +
    `${foot}H${x + n}A${n} ${n} 0 0 0 ${x} ${b - n}V${y + n}A${n} ${n} 0 0 0 ${x + n} ${y}Z`
  );
}

/** The plaque names the beat's date at the beat's precision while landed on it; else the day. */
function platePrecision(state: WalkState): Precision {
  const beat = state.story.beats[state.beat];
  const landed = state.flight === null && state.mode !== 'breakout';
  return beat && landed && Math.abs(state.day - beat.day) < 0.5 ? beat.precision : 'day';
}

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function roman(n: number): string {
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

function deg(angle: number): number {
  return (angle * 180) / Math.PI;
}

function f(x: number, digits = 1): string {
  return x.toFixed(digits);
}
