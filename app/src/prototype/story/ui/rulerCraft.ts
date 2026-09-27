// The time ruler as part of the instrument: a curved band of engraved, aged brass along the foot
// of the view, between two knurled knobs with gearwork behind them, drawn in SVG over the canvas.
// Its geometry and scale are rulerScale.ts's.
//
// The band zooms to each beat's own time (beatSpan), easing from span to span during flights,
// engraved with years, months and, once wide enough, days. A garnet playhead marks story time:
// the jewel hangs under a raised brass plaque that names the date, and a blued needle runs from
// it down through the day numbers to the band's foot. The span is kept clear of the ends by the
// plaque's width, so the plaque always rides over the playhead; labels of the upper row move
// aside for it. A brass stud on the rail beneath marks each beat in the span at its date (fanned
// out where they crowd, with a leader to each one's date), and flies there when clicked. On the
// base plate below, the story tier shows the whole story in whole years, a burnished window over
// the stretch the band shows, and a dot for every beat. Pressing or dragging the band, dragging
// the plaque, or pressing the tier scrubs. The story's controls are on it too: the left knob
// plays and pauses (its glyph shows which, a garnet arc counts down to the next beat), levers
// either side of the plaque step back and on, and the right knob counts the beats and, while the
// visitor has broken out, glows and resumes the story.
//
// The lamp is warm and at the upper left, as in the museum scene: the brass is lit from there
// (a specular bevel whose brightest edges bloom a little), engravings are cut dark with their
// lower lips catching the light, and the canvas's vignette and grain lie over the brass so it
// sits in the same photograph. What never changes (the band's body, the knobs, the plaque) is
// drawn once per resize into layers of its own; a frame moves the playhead, plaque and gears, and
// engraves the band again only while its span changes.
import './rulerCraft.css';
import { KEY_LAMP, KEY_LAMP_CSS, LENS } from '../../scene/lens';
import { civilFromDay, formatDay, monthName, yearLabel, type Precision } from '../dates';
import type { Walk, WalkState } from '../contract';
import type { Story } from '../story';
import { button, el, onPress, svg } from './dom';
import { beatSpan, mixSpans, spreadPips, type Span } from './format';
import {
  along,
  anchored,
  arcFor,
  at,
  BAND,
  BASE,
  deg,
  engraveScale,
  engraveTier,
  f,
  HEIGHT,
  KNOB_FOOT,
  KNOB_R,
  KNOB_SIDE,
  LIP,
  NUMERAL_ROW,
  RAIL_FOOT,
  RAIL_TOP,
  roman,
  sector,
  storyYears,
  STUD_AT,
  TICK_KINDS,
  TIER_REACH,
  TIER_RULE,
  tierAngle,
  type Arc,
  type Label,
  type TickKind,
} from './rulerScale';

/** Each knob is drawn in a square this wide, centered on the knob. */
const KNOB_BOX = 2 * (KNOB_R + 8);
/** Studs' least spacing along the rail, and the story tier's dots' along its rule, px. */
const STUD_GAP = 24;
const DOT_GAP = 12;

/** The plaque: its size, the tab under its middle, and its levers. */
const PLATE_W = 150;
const PLATE_H = 46;
const PLATE_TAB = 6;
const LEVER_W = 44;
const LEVER_H = 36;
/** How far each lever tucks under the plaque's side, and the clear space kept past its tip. */
const LEVER_TUCK = 7;
const LEVER_CLEAR = 14;
/** How far the plaque reaches along the rule from its middle, levers and clear space included. */
const PLATE_REACH = PLATE_W / 2 + LEVER_W - LEVER_TUCK + LEVER_CLEAR;
/** Upper-row labels keep this far from the plaque's levers, px. */
const PLATE_GAP = 6;
/**
 * The plaque's foot and the jewel's center, as radial offsets: the jewel hangs from the plaque
 * over the upper row, clear of the lower, and its needle runs down to the band's foot.
 */
const PLATE_FOOT = 2;
const JEWEL_AT = -1;
const NEEDLE_TIP = JEWEL_AT + BAND + 1;

/** The canvas's vignette (scene/lens.ts), at this share of its strength so the engraving reads. */
const VIGNETTE = LENS.vignette * 0.55;
/**
 * The key lamp as polished brass reflects it: metal tints its own highlights, so they roll off
 * warm, as the globe's do under the canvas's tone mapping, instead of clipping to lemon white.
 */
const BRASS_REFLECTANCE = [0.95, 0.86, 0.68];
const SHINE = BRASS_REFLECTANCE.map((reflects, i) =>
  Math.round(((KEY_LAMP >> (16 - 8 * i)) & 255) * reflects),
);
const SHINE_CSS = `rgb(${SHINE.join(' ')})`;
/** Gears turn this many degrees per story day; the knobs' knurl turns a third as much. */
const GEAR_DEG_PER_DAY = 0.45;

const PLAY = 'M-7 -12 L13 0 L-7 12 Z';
const PAUSE = 'M-10 -12 H-3 V12 H-10 Z M3 -12 H10 V12 H3 Z';
const RING_R = 41.5;
const RING_C = 2 * Math.PI * RING_R;

/** A label cut on the band: its element, what it names, and where an upper-row one is shown. */
interface Cut {
  element: SVGTextElement;
  label: Label;
  /** Half its length, px, measured when first needed (and again once its face has loaded). */
  half: number;
  /** The angle it is shown at, null while it has no room beside the plaque, NaN until placed. */
  shown: number | null;
}

type ScrubFrom = 'band' | 'plate' | 'tier';

export class CraftRuler {
  readonly element = el('div', 'rc');
  readonly #walk: Walk;
  readonly #story: Story;
  /** The story's whole years, which the tier on the base plate shows. */
  readonly #years: Span;
  readonly #body = svg('svg', { class: 'rc-body', 'aria-hidden': 'true' });
  readonly #engraving = svg('svg', { class: 'rc-engraving', 'aria-hidden': 'true' });
  /** The band's ticks, each kind drawn twice: its lit lip, then the cut. */
  readonly #ticks = new Map<TickKind, SVGPathElement[]>();
  readonly #labelGroup = svg('g', { class: 'rc-labels' });
  /** The labels engraved, by what they name, so a zoom moves them rather than cutting anew. */
  #cuts = new Map<string, Cut>();
  readonly #leaders: SVGPathElement[];
  readonly #numerals: SVGTextElement[];
  /** The tier's burnished window over the stretch of the story the band shows, and its bracket. */
  readonly #window = svg('path', { class: 'rc-window' });
  readonly #bracket: SVGPathElement[];
  readonly #hit = svg('path', { class: 'rc-hit' });
  readonly #tierHit = svg('path', { class: 'rc-hit' });
  readonly #finish = svg('svg', { class: 'rc-finish', 'aria-hidden': 'true' });
  readonly #gears: { element: SVGSVGElement; turn: number; side: -1 | 1; big: boolean }[] = [];
  readonly #studs: HTMLButtonElement[];
  readonly #dots: HTMLButtonElement[];
  readonly #playhead = el('div', 'rc-playhead');
  readonly #plate = el('div', 'rc-plate');
  readonly #plateLines: SVGTextElement[][];
  readonly #back: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #play: HTMLButtonElement;
  readonly #glyph = svg('path', { id: 'rc-glyph', d: PLAY });
  readonly #ring = svg('circle', { class: 'rc-ring', r: RING_R });
  readonly #count: HTMLButtonElement;
  readonly #countLines: SVGTextElement[][];
  readonly #status = el('span', 'rc-status');
  /** Each knob's knurl, which turns, and its light, which turns back so the lamp stays put. */
  readonly #knurls: { teeth: SVGPathElement; light: SVGLinearGradientElement }[] = [];
  #arc: Arc = arcFor(1440);
  /** The share of the rule kept clear at each end, so the plaque over the playhead fits on it. */
  #margin = 0.1;
  /**
   * The span drawn; the one a flight eases from, with the playhead's share of it then; and the
   * beat's own.
   */
  #span: Span;
  #from: { span: Span; share: number };
  #to: Span;
  #flying = false;
  #beat = -1;
  #laidOut = false;
  #plateText = '';
  #playing: boolean | null = null;
  #away: boolean | null = null;
  #advanceFrom: number | null = null;
  #turnDay = NaN;
  #placed = '';
  #resizeFrame = 0;
  readonly #onResize = () => {
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = requestAnimationFrame(() => this.#build());
  };

  constructor(walk: Walk, story: Story) {
    this.#walk = walk;
    this.#story = story;
    this.#years = storyYears(story.beats);
    const first = story.beats[walk.state().beat] ?? story.beats[0];
    this.#span = this.#to = first ? beatSpan(first) : { start: 0, end: 1 };
    this.#from = { span: this.#span, share: 0.5 };

    for (const side of [-1, 1] as const) {
      for (const big of [true, false]) {
        const element = svg('svg', { class: 'rc-gear', 'aria-hidden': 'true' });
        this.#gears.push({ element, turn: big ? side : -2.6 * side, side, big });
      }
    }

    // The band's ticks are cut twice, a light copy a hair down and right (the lip of the cut
    // catching the lamp) under the dark cut; its labels' lips are text shadows. On the dark rail
    // and base plate, the leaders, the beats' numerals and the window's bracket are gilt inlay
    // over their shadow.
    const lip = svg('g', { class: 'rc-cut-lip', transform: 'translate(0.6 0.9)' });
    const cut = svg('g', { class: 'rc-cut' });
    for (const kind of TICK_KINDS) {
      const pair = [lip, cut].map((group) =>
        group.appendChild(svg('path', { class: `rc-tick is-${kind}` })),
      );
      this.#ticks.set(kind, pair);
    }
    cut.append(this.#labelGroup);
    this.#leaders = gilt('rc-leaders');
    this.#bracket = gilt('rc-bracket');
    this.#numerals = story.beats.map((_, i) => {
      const numeral = svg('text', { class: 'rc-numeral rc-gilt', 'text-anchor': 'middle' });
      numeral.textContent = roman(i + 1);
      return numeral;
    });
    this.#engraving.append(
      lip,
      cut,
      ...this.#leaders,
      ...this.#numerals,
      this.#window,
      ...this.#bracket,
      this.#hit,
      this.#tierHit,
    );

    const markButton = (className: string, i: number) => {
      const beat = story.beats[i];
      const mark = el('button', className);
      mark.type = 'button';
      if (beat)
        mark.title = `${roman(i + 1)}. ${beat.title}, ${formatDay(beat.day, beat.precision)}`;
      mark.setAttribute('aria-label', mark.title);
      onPress(mark, () => this.#walk.goTo(i));
      return mark;
    };
    this.#studs = story.beats.map((_, i) => markButton('rc-stud', i));
    this.#dots = story.beats.map((_, i) => markButton('rc-dot', i));

    this.#playhead.innerHTML = JEWEL_SVG;

    this.#back = button('rc-lever is-back', 'Back', () => this.#walk.back());
    this.#next = button('rc-lever is-next', 'Next', () => this.#walk.next());
    for (const [lever, side] of [
      [this.#back, -1],
      [this.#next, 1],
    ] as const) {
      lever.title = side < 0 ? 'Back' : 'Next';
      lever.innerHTML = leverSvg(side);
      // Each lever tucks under the plaque's side, level with its middle.
      const left = side < 0 ? -PLATE_W / 2 - LEVER_W + LEVER_TUCK : PLATE_W / 2 - LEVER_TUCK;
      place(lever, left, -PLATE_H / 2 - LEVER_H / 2);
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
    this.#play.append(...this.#knob(0), mark, ring);

    this.#count = button('rc-knob rc-count', 'Resume story', () => this.#walk.resume());
    const countMark = knobLayer('rc-knob-mark');
    this.#countLines = [
      engraved(countMark, 'rc-count-num', 0, 6),
      engraved(countMark, 'rc-count-of', 0, 22),
    ];
    const glow = knobLayer('rc-knob-glow');
    glow.innerHTML = `<circle r="${KNOB_R - 1}" fill="none" stroke="rgb(255 188 104)" stroke-width="6" filter="url(#rc-soft)"/>`;
    this.#count.append(glow, ...this.#knob(1), countMark);
    for (const knob of [this.#play, this.#count]) {
      place(knob, -KNOB_BOX / 2, -KNOB_BOX / 2);
      knob.style.width = knob.style.height = `${KNOB_BOX}px`;
    }
    this.#status.setAttribute('role', 'status');

    this.element.append(
      ...this.#gears.map((gear) => gear.element),
      this.#body,
      this.#engraving,
      ...this.#studs,
      ...this.#dots,
      this.#finish,
      this.#plate,
      this.#playhead,
      this.#play,
      this.#count,
      this.#status,
    );
    this.#scrubOn(this.#hit, 'band');
    this.#scrubOn(this.#plate, 'plate');
    this.#scrubOn(this.#tierHit, 'tier');
    addEventListener('resize', this.#onResize);
    // Labels are measured again once their faces have loaded.
    void document.fonts.ready.then(() => {
      for (const cut of this.#cuts.values()) [cut.half, cut.shown] = [0, NaN];
      this.#placed = '';
    });
    this.#build();
  }

  update(state: WalkState): void {
    // A flight to a beat, or back to it after a break-out, zooms from the span drawn.
    const flying = state.flight !== null;
    if (state.beat !== this.#beat || (flying && !this.#flying)) {
      if (state.beat !== this.#beat) this.#showBeat(state);
      const { start, end } = this.#span;
      this.#from = { span: this.#span, share: (state.day - start) / (end - start) };
      const beat = state.story.beats[state.beat];
      if (beat) this.#to = beatSpan(beat);
    }
    this.#flying = flying;
    const t = state.flight ?? 1;
    const { span: from, share } = this.#from;
    const mixed = mixSpans(from, this.#to, share, state.day, t * t * (3 - 2 * t));
    const span = anchored(mixed, state.day, this.#margin);
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
    this.#showAway(state);
    this.#turn(state.day);
  }

  dispose(): void {
    removeEventListener('resize', this.#onResize);
    cancelAnimationFrame(this.#resizeFrame);
    this.element.remove();
  }

  /**
   * A knob's body: the knurled rim, which turns with story time under a light that turns back so
   * the lamp stays at the upper left, and the face over it.
   */
  #knob(index: number): SVGSVGElement[] {
    const knurl = knobLayer('rc-knurl');
    const id = `rc-knurl-light-${index}`;
    knurl.innerHTML =
      `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-38" y1="-38" x2="38" y2="38">` +
      `<stop offset="0" stop-color="#f2d596"/><stop offset="0.45" stop-color="#b08642"/>` +
      `<stop offset="1" stop-color="#4a3416"/></linearGradient></defs>` +
      `<path d="${teeth(80, KNOB_R - 4.5, KNOB_R, 0.2, 0.55)}" fill="url(#${id})" stroke="#1c1207" stroke-width="0.5"/>`;
    const light = knurl.querySelector('linearGradient');
    const path = knurl.querySelector('path');
    if (light && path) this.#knurls.push({ teeth: path, light });
    const face = knobLayer('rc-face');
    face.innerHTML = KNOB_FACE_SVG;
    return [knurl, face];
  }

  #showBeat(state: WalkState): void {
    for (const marks of [this.#studs, this.#dots]) {
      marks[this.#beat]?.classList.remove('is-current');
      marks[state.beat]?.classList.add('is-current');
    }
    this.#beat = state.beat;
    const beats = state.story.beats;
    this.#back.disabled = state.beat <= 0;
    this.#next.disabled = state.beat >= beats.length - 1;
    setEngraved(this.#countLines[0], roman(state.beat + 1));
    setEngraved(this.#countLines[1], `of ${roman(beats.length)}`);
    const title = beats[state.beat]?.title ?? '';
    this.#status.textContent = `Beat ${state.beat + 1} of ${beats.length}: ${title}`;
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

  /** While the visitor explores on their own, the count knob glows and resumes the story. */
  #showAway(state: WalkState): void {
    const away = state.mode === 'breakout';
    if (away === this.#away) return;
    this.#away = away;
    this.#count.disabled = !away;
    this.#count.classList.toggle('is-away', away);
    this.#count.title = away ? 'Resume story' : '';
  }

  /** The gears and the knobs' knurl turn with story time, so time visibly winds through them. */
  #turn(day: number): void {
    if (day === this.#turnDay) return;
    this.#turnDay = day;
    const turn = (share: number) => (day * GEAR_DEG_PER_DAY * share) % 360;
    for (const gear of this.#gears) gear.element.style.rotate = `${f(turn(gear.turn), 2)}deg`;
    const knurl = turn(1 / 3);
    for (const { teeth, light } of this.#knurls) {
      teeth.setAttribute('transform', `rotate(${f(knurl, 2)})`);
      light.setAttribute('gradientTransform', `rotate(${f(-knurl, 2)})`);
    }
  }

  /** The playhead at the day on the band, and the plaque over it. */
  #place(state: WalkState): void {
    const arc = this.#arc;
    const angle = this.#angle(state.day);
    const [x, y] = at(arc, angle, JEWEL_AT);
    this.#playhead.style.transform = `translate(${f(x)}px, ${f(y)}px) rotate(${f(deg(angle), 2)}deg)`;
    setShade(this.#playhead, shadeAt(x, y));
    // The span keeps the playhead clear of the ends, so the plaque rides over it; the plaque is
    // held on the rule besides, for a view too narrow for that.
    const half = PLATE_REACH / arc.r;
    const plateAngle = Math.min(arc.reach - half, Math.max(-arc.reach + half, angle));
    const [px, py] = at(arc, plateAngle, PLATE_FOOT);
    this.#plate.style.transform = `translate(${f(px)}px, ${f(py)}px) rotate(${f(deg(plateAngle), 2)}deg)`;
    setShade(this.#plate, shadeAt(px, py - PLATE_H / 2));
    this.#clearPlate(plateAngle);

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

  /**
   * Moves the upper row's labels out from under the plaque and its levers: each goes to whichever
   * side is nearer while it still stands over its month or year on the rule; else it waits unseen.
   */
  #clearPlate(plateAngle: number): void {
    const r = this.#arc.r;
    const half = (PLATE_W / 2 + LEVER_W - LEVER_TUCK + PLATE_GAP) / r;
    const [b0, b1] = [plateAngle - half, plateAngle + half];
    for (const cut of this.#cuts.values()) {
      const { label } = cut;
      if (label.from === undefined || label.to === undefined) continue;
      if (cut.half === 0) cut.half = cut.element.getComputedTextLength() / 2;
      const w = cut.half / (r + label.row);
      let shown: number | null = label.angle;
      if (shown + w > b0 && shown - w < b1) {
        const slack = 6 / r;
        const [lo, hi] = [label.from - slack + w, label.to + slack - w];
        const sides = [Math.min(shown, b0 - w), Math.max(shown, b1 + w)];
        const nearest = sides
          .filter((a) => a >= lo && a <= hi)
          .sort((p, q) => Math.abs(p - label.angle) - Math.abs(q - label.angle));
        shown = nearest[0] ?? null;
      }
      if (shown === cut.shown) continue;
      cut.shown = shown;
      cut.element.classList.toggle('is-covered', shown === null);
      if (shown !== null) {
        cut.element.setAttribute('transform', labelTransform(this.#arc, shown, label.row));
      }
    }
  }

  /** The band's angle for a day: the span maps onto the rule, clamped to its ends. */
  #angle(day: number): number {
    const { start, end } = this.#span;
    const t = Math.min(1, Math.max(0, (day - start) / (end - start)));
    return (2 * t - 1) * this.#arc.reach;
  }

  /** The day at an angle on the band, kept as clear of the ends as the span keeps the playhead. */
  #dayAtAngle(angle: number): number {
    const t = (angle / this.#arc.reach + 1) / 2;
    const kept = Math.min(1 - this.#margin, Math.max(this.#margin, t));
    return this.#span.start + kept * (this.#span.end - this.#span.start);
  }

  /** The day at an angle on the story tier. */
  #dayOnTier(angle: number): number {
    const { start, end } = this.#years;
    const t = Math.min(1, Math.max(0, (angle / (this.#arc.reach * TIER_REACH) + 1) / 2));
    return Math.min(end - 1, start + t * (end - start));
  }

  #angleAt(clientX: number, clientY: number): number {
    const rect = this.element.getBoundingClientRect();
    const arc = this.#arc;
    return Math.atan2(clientX - rect.left - arc.cx, arc.cy - (clientY - rect.top));
  }

  /**
   * Scrubs from `target`: pressing the band scrubs to the day under the pointer, and pressing the
   * base plate to the day under it on the story tier; the plaque, which shows the day already,
   * scrubs only once dragged, and by as far as it is dragged.
   */
  #scrubOn(target: Element, from: ScrubFrom): void {
    const relative = from === 'plate';
    const dayAt = (angle: number) =>
      from === 'tier' ? this.#dayOnTier(angle) : this.#dayAtAngle(angle);
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
      if (!relative) this.#walk.scrub(dayAt(angle));
    });
    target.addEventListener('pointermove', (event) => {
      const e = event as PointerEvent;
      if (!target.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      this.#walk.scrub(dayAt(this.#angleAt(e.clientX, e.clientY) + offset));
    });
    const end = () => this.element.classList.remove('is-scrubbing');
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /**
   * Draws what depends only on the view's size: the band's body with the story tier, the gears,
   * the knobs and the finish; and sets the tier's dots.
   */
  #build(): void {
    const width = innerWidth;
    const arc = (this.#arc = arcFor(width));
    this.#margin = Math.min(0.4, PLATE_REACH / (2 * arc.reach * arc.r));
    for (const layer of [this.#body, this.#engraving, this.#finish]) {
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(HEIGHT));
      layer.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    }
    this.#body.innerHTML = bodySvg(arc, this.#years);
    this.#finish.innerHTML = finishSvg(arc);
    this.#hit.setAttribute(
      'd',
      sector(arc, -arc.reach - 0.004, arc.reach + 0.004, RAIL_FOOT, BAND),
    );
    // The base plate takes every press, so none reaches the globe, and scrubs on the tier.
    this.#tierHit.setAttribute('d', sector(arc, -arc.end, arc.end, RAIL_FOOT - BASE, RAIL_FOOT));

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

    const beats = this.#story.beats;
    const trueS = beats.map((beat) => tierAngle(arc, this.#years, beat.day) * arc.r);
    const reachS = arc.reach * TIER_REACH * arc.r;
    const dotS = spreadPips(trueS, DOT_GAP, -reachS, reachS);
    this.#dots.forEach((dot, i) => {
      const [x, y] = at(arc, (dotS[i] ?? 0) / arc.r, TIER_RULE);
      dot.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
    });
    this.#laidOut = false;
    this.#placed = '';
  }

  /** Engraves the span's scale on the band, sets the studs on the rail, and the tier's window. */
  #engrave(): void {
    this.#laidOut = true;
    const arc = this.#arc;
    const span = this.#span;
    const scale = engraveScale(arc, span, (day) => this.#angle(day));
    for (const kind of TICK_KINDS) {
      for (const path of this.#ticks.get(kind) ?? []) path.setAttribute('d', scale[kind]);
    }
    this.#setLabels(scale.labels);

    // Only the beats in the span have studs on the rail; the tier shows them all.
    const beats = this.#story.beats;
    const inside = beats.map((beat) => beat.day >= span.start && beat.day <= span.end);
    const trueS = beats.map((beat) => this.#angle(beat.day) * arc.r);
    const reachS = arc.reach * arc.r;
    const shown = beats.flatMap((_, i) => (inside[i] ? [i] : []));
    const spread = spreadPips(
      shown.map((i) => trueS[i] ?? 0),
      STUD_GAP,
      -reachS + 8,
      reachS - 8,
    );
    const studS = trueS.slice();
    shown.forEach((i, k) => (studS[i] = spread[k] ?? 0));
    let leaders = '';
    this.#studs.forEach((stud, i) => {
      const a = (studS[i] ?? 0) / arc.r;
      const [x, y] = at(arc, a, STUD_AT);
      stud.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
      stud.classList.toggle('is-off', !inside[i]);
      // The keys reach each beat once: by its stud while it has one, else by its dot.
      stud.tabIndex = inside[i] ? 0 : -1;
      const dot = this.#dots[i];
      if (dot) dot.tabIndex = inside[i] ? -1 : 0;
      const numeral = this.#numerals[i];
      numeral?.setAttribute('transform', labelTransform(arc, a, NUMERAL_ROW));
      numeral?.classList.toggle('is-off', !inside[i]);
      if (!inside[i]) return;
      const b = (trueS[i] ?? 0) / arc.r;
      const [x0, y0] = at(arc, b, -BAND);
      const [x1, y1] = at(arc, b, RAIL_TOP - 1);
      const [x2, y2] = at(arc, a, STUD_AT + 7);
      leaders += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
    });
    for (const path of this.#leaders) path.setAttribute('d', leaders);

    // The tier's window: the span's stretch of the story, at least a few px wide.
    const years = this.#years;
    const [s0, s1] = [tierAngle(arc, years, span.start), tierAngle(arc, years, span.end)];
    const least = 2 / arc.r;
    const [w0, w1] = [Math.min(s0, (s0 + s1) / 2 - least), Math.max(s1, (s0 + s1) / 2 + least)];
    this.#window.setAttribute('d', sector(arc, w0, w1, TIER_RULE - 8, TIER_RULE + 2.5));
    const [x0, y0] = at(arc, w0, TIER_RULE - 9);
    const [x1, y1] = at(arc, w1, TIER_RULE - 9);
    const rim = along(arc, w0, w1, TIER_RULE + 2.5).slice(1);
    for (const path of this.#bracket) {
      path.setAttribute('d', `M${f(x0)} ${f(y0)}L${rim}L${f(x1)} ${f(y1)}`);
    }
  }

  /** Moves the labels still on the rule, cuts the new ones, and removes those gone. */
  #setLabels(labels: Label[]): void {
    const kept = new Map<string, Cut>();
    for (const label of labels) {
      let cut = this.#cuts.get(label.key);
      if (cut) {
        this.#cuts.delete(label.key);
        cut.label = label;
      } else {
        const element = svg('text', { class: label.cls, 'text-anchor': 'middle' });
        element.textContent = label.text;
        this.#labelGroup.append(element);
        cut = { element, label, half: 0, shown: NaN };
      }
      // The upper row's labels are placed with the plaque (#clearPlate).
      if (label.from === undefined) {
        cut.element.setAttribute('transform', labelTransform(this.#arc, label.angle, label.row));
      } else {
        cut.shown = NaN;
      }
      kept.set(label.key, cut);
    }
    for (const gone of this.#cuts.values()) gone.element.remove();
    this.#cuts = kept;
  }
}

/** Where a label along the band stands: at its angle on its row, turned with the band. */
function labelTransform(arc: Arc, angle: number, row: number): string {
  const [x, y] = at(arc, angle, row);
  return `translate(${f(x)} ${f(y)}) rotate(${f(deg(angle), 2)})`;
}

/** A gilt inlay path over its shadow, a hair down and right. */
function gilt(className: string): SVGPathElement[] {
  return [
    svg('path', { class: `${className} rc-gilt-shadow`, transform: 'translate(0.6 0.9)' }),
    svg('path', { class: `${className} rc-gilt` }),
  ];
}

/** A line of text engraved in `parent` at (x, y): the lit lip of the cut, then the cut. */
function engraved(
  parent: SVGSVGElement,
  className: string,
  x: number,
  y: number,
): SVGTextElement[] {
  const spot = { x, y, 'text-anchor': 'middle' };
  const lip = svg('text', {
    ...spot,
    class: `${className} rc-cut-lip`,
    transform: 'translate(0.6 0.9)',
  });
  const cut = svg('text', { ...spot, class: `${className} rc-cut` });
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
 * blurred by `bevel`, is its height, roughened by `texture`, lit from the upper left, diffusely
 * and with a highlight in the lamp's light as brass reflects it; a cloudy tarnish ages it, a
 * fine grain lies over it as over the canvas, and its brightest edges bloom past it a little.
 */
function brassFilter(id: string, spec: FilterSpec): string {
  const { bevel, relief, texture, amount, shine = 1, bloom = 0.5, patina = 0 } = spec;
  const [k, b] = [2 * patina, 1 - 1.5 * patina];
  return `<filter id="${id}" x="-15%" y="-40%" width="130%" height="180%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="${bevel}" result="hump"/>
<feTurbulence type="fractalNoise" baseFrequency="${texture}" numOctaves="2" seed="7" result="tex"/>
<feComposite in="tex" in2="hump" operator="arithmetic" k2="${amount}" k3="1" result="height"/>
<feDiffuseLighting in="height" surfaceScale="${relief}" diffuseConstant="1.05" lighting-color="#fff2e0" result="diffuse"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting>
<feSpecularLighting in="height" surfaceScale="${relief}" specularConstant="${shine}" specularExponent="16" lighting-color="${SHINE_CSS}" result="spec"><feDistantLight azimuth="225" elevation="35"/></feSpecularLighting>
<feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="1.25" result="lit"/>
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.03" numOctaves="3" seed="21" result="cloud"/>
<feColorMatrix in="cloud" type="matrix" values="${k} 0 0 0 ${b} ${k} 0 0 0 ${b} ${k} 0 0 0 ${b} 0 0 0 0 1" result="tarnish"/>
<feBlend in="lit" in2="tarnish" mode="multiply" result="aged"/>
<feComposite in="spec" in2="SourceAlpha" operator="in" result="shine"/>
<feComposite in="aged" in2="shine" operator="arithmetic" k2="1" k3="0.45" result="metal"/>
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
  <stop offset="0" stop-color="#6a4a20"/><stop offset="0.2" stop-color="#94703a"/>
  <stop offset="0.34" stop-color="#a8804a"/><stop offset="0.6" stop-color="#8a6534"/>
  <stop offset="1" stop-color="#5a3f1c"/>
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
  <stop offset="0" stop-color="#b58843"/><stop offset="0.3" stop-color="#f3d18d"/>
  <stop offset="0.65" stop-color="#d2a55a"/><stop offset="1" stop-color="#8e6830"/>
</linearGradient>
<linearGradient id="rc-plate-fill" x1="0" x2="0.35" y1="0" y2="1">
  <stop offset="0" stop-color="#ecc980"/><stop offset="0.5" stop-color="#cfa054"/>
  <stop offset="1" stop-color="#9c7234"/>
</linearGradient>
<linearGradient id="rc-frame-fill" x1="0" x2="0.3" y1="0" y2="1">
  <stop offset="0" stop-color="#a47938"/><stop offset="0.5" stop-color="#6e4d22"/>
  <stop offset="1" stop-color="#3f2a11"/>
</linearGradient>
<radialGradient id="rc-face-fill" cx="0.4" cy="0.36" r="0.75">
  <stop offset="0" stop-color="#d8ae63"/><stop offset="0.55" stop-color="#b2833d"/>
  <stop offset="1" stop-color="#6b4a21"/>
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
<linearGradient id="rc-steel" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#141c30"/><stop offset="0.45" stop-color="#6f8cc0"/>
  <stop offset="1" stop-color="#1c2640"/>
</linearGradient>
<radialGradient id="rc-sheen" r="0.5">
  <stop offset="0" stop-color="${KEY_LAMP_CSS}" stop-opacity="0.3"/><stop offset="1" stop-color="${KEY_LAMP_CSS}" stop-opacity="0"/>
</radialGradient>
${brassFilter('rc-lit-band', { bevel: 6, relief: 4, texture: '0.005 0.8', amount: 0.06, bloom: 0.5, patina: 0.4 })}
${brassFilter('rc-lit-rail', { bevel: 3, relief: 3, texture: '0.11', amount: 0.3, shine: 0.6, bloom: 0.2, patina: 0.3 })}
${brassFilter('rc-lit-base', { bevel: 3, relief: 2.5, texture: '0.05', amount: 0.1, shine: 0.35, bloom: 0.1, patina: 0.3 })}
${brassFilter('rc-lit-lip', { bevel: 0.8, relief: 2, texture: '0.01 0.5', amount: 0.03, shine: 0.6, bloom: 0.9 })}
${brassFilter('rc-lit-teeth', { bevel: 1, relief: 2.5, texture: '0.5', amount: 0.05, bloom: 0.4 })}
${brassFilter('rc-lit-dome', { bevel: 8, relief: 5, texture: '0.08', amount: 0.08, bloom: 0.45, patina: 0.15 })}
${brassFilter('rc-lit-plate', { bevel: 2, relief: 3, texture: '0.01 0.6', amount: 0.05, bloom: 0.6, patina: 0.1 })}
<filter id="rc-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>`;
}

/**
 * The band, its lit upper lip and its rail, seated into the knobs' sockets, and the base plate
 * under them, with the engraving that never changes: the band's border rules, the rail's beaded
 * edges, and the story tier's years in gilt.
 */
function bodySvg(arc: Arc, years: Span): string {
  const [a0, a1] = [-arc.end, arc.end];
  const knobY = HEIGHT - KNOB_FOOT;
  const sockets = [KNOB_SIDE, arc.width - KNOB_SIDE]
    .map((x) => `<circle cx="${x + 3}" cy="${knobY + 6}" r="${KNOB_R + 4}"/>`)
    .join('');
  const rules = [BAND - 3, -BAND + 3]
    .map((dr) => along(arc, -arc.reach - 0.008, arc.reach + 0.008, dr))
    .join('');
  const beads = along(arc, a0, a1, RAIL_TOP - 3.5);
  const tier = engraveTier(arc, years);
  const tierReach = arc.reach * TIER_REACH;
  const tierRule = along(arc, -tierReach, tierReach, TIER_RULE);
  const tierYears = tier.labels
    .map((label) => {
      const spot = labelTransform(arc, label.angle, label.row);
      return `<text class="${label.cls}" text-anchor="middle" transform="${spot}">${label.text}</text>`;
    })
    .join('');
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
</g>
<g class="rc-tier">
  <g transform="translate(0.6 0.9)" class="rc-gilt-shadow">
    <path d="${tierRule}${tier.years}${tier.months}"/>${tierYears}
  </g>
  <g class="rc-gilt">
    <path d="${tierRule}" stroke-width="0.8"/>
    <path d="${tier.years}" stroke-width="1"/>
    <path d="${tier.months}" stroke-width="0.6" opacity="0.7"/>${tierYears}
  </g>
</g>`;
}

/** The canvas's vignette laid over the band and rail, so their ends darken as the view's do. */
function finishSvg(arc: Arc): string {
  const vh = innerHeight;
  const stops: string[] = [];
  for (let k = 0; k <= 10; k += 1) {
    const r = LENS.from + ((LENS.to - LENS.from) * k) / 10;
    const dark = 1 - vignetteAt(r);
    stops.push(
      `<stop offset="${(r / LENS.to).toFixed(3)}" stop-color="#000" stop-opacity="${dark.toFixed(3)}"/>`,
    );
  }
  return `<defs><radialGradient id="rc-vignette" gradientUnits="userSpaceOnUse" cx="${f(arc.cx)}" cy="${f(HEIGHT - vh / 2)}" r="${f(LENS.to * vh)}">${stops.join('')}</radialGradient></defs>
<path d="${sector(arc, -arc.end - 0.02, arc.end + 0.02, RAIL_FOOT - BASE, BAND + LIP)}" fill="url(#rc-vignette)"/>`;
}

/** The canvas's vignette as a brightness, `r` view heights from the view's center. */
function vignetteAt(r: number): number {
  const t = Math.min(1, Math.max(0, (r - LENS.from) / (LENS.to - LENS.from)));
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

/**
 * The playhead: a garnet in a beaded bezel, hanging from the plaque, and a blued steel needle
 * from it down to the band's foot. Its y runs down the band, toward the circle's center.
 */
const JEWEL_SVG = `<svg viewBox="-16 -16 32 ${f(NEEDLE_TIP + 20)}" width="32" height="${f(NEEDLE_TIP + 20)}" aria-hidden="true">
<circle r="13" fill="url(#rc-garnet-glow)"/>
<path d="M-1.5 5.5 L1.5 5.5 L0.45 ${f(NEEDLE_TIP)} L-0.45 ${f(NEEDLE_TIP)} Z" fill="#000" opacity="0.45" transform="translate(0.8 1.2)"/>
<path d="M-1.5 5.5 L1.5 5.5 L0.45 ${f(NEEDLE_TIP)} L-0.45 ${f(NEEDLE_TIP)} Z" fill="url(#rc-steel)" stroke="#0b1020" stroke-width="0.4"/>
<circle r="8.9" fill="#1c1208" transform="translate(1 1.6)" opacity="0.6"/>
<circle r="8.5" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.8"/>
<circle r="7" fill="none" stroke="rgb(40 25 8 / 0.6)" stroke-width="1.3" stroke-dasharray="1 1.4"/>
<circle r="5.8" fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.6"/>
<path d="M-5.7 0 L0 -5.7 L5.7 0 L0 5.7 Z M-2.9 -2.9 L2.9 2.9 M2.9 -2.9 L-2.9 2.9" fill="none" stroke="rgb(255 200 210 / 0.16)" stroke-width="0.6"/>
<ellipse cx="-2.1" cy="-2.5" rx="2" ry="1.15" fill="#fff6f0" opacity="0.92" transform="rotate(-38 -2.1 -2.5)"/>
<circle cx="2.5" cy="2.8" r="0.8" fill="#ffd9de" opacity="0.6"/>
</svg>`;

/** The plaque: a dark bronze frame round a raised face of bright brass, with an engraved border. */
const PLATE_SVG = `
<path d="${cartouche(2, 4, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="#000" opacity="0.8" filter="url(#rc-soft)"/>
<path d="${cartouche(0, 0, PLATE_W, PLATE_H, 7, PLATE_TAB)}" fill="url(#rc-frame-fill)" stroke="#160d05" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(3.5, 3.5, PLATE_W - 7, PLATE_H - 7, 5, 0)}" fill="#1c1208"/>
<path d="${cartouche(4, 4, PLATE_W - 8, PLATE_H - 8, 4.5, 0)}" fill="url(#rc-plate-fill)" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(255 244 210 / 0.55)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
<path d="${cartouche(7.5, 7.5, PLATE_W - 15, PLATE_H - 15, 3, 0)}" fill="none" stroke="rgb(58 38 14 / 0.65)" stroke-width="0.7"/>`;

/** A lever beside the plaque, pointing back (-1) or on (1): a brass ear with a cut arrow and grip. */
function leverSvg(side: -1 | 1): string {
  // Drawn pointing back, then mirrored point by point for Next, so the lamp lights both alike.
  const x = (v: number) => (side < 0 ? v : LEVER_W - v);
  const mid = LEVER_H / 2 - 1;
  const [top, foot] = [3, LEVER_H - 5];
  const shape =
    `M${x(LEVER_W)} ${top} H${x(17)} Q${x(13)} ${top} ${x(10)} ${top + 3} L${x(2)} ${mid}` +
    ` L${x(10)} ${foot - 3} Q${x(13)} ${foot} ${x(17)} ${foot} H${x(LEVER_W)} Z`;
  const arrow = `M${x(9)} ${mid} L${x(22)} ${mid - 8} V${mid + 8} Z`;
  const grip = `M${x(28)} ${mid - 8} V${mid + 8} M${x(32)} ${mid - 8} V${mid + 8}`;
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
