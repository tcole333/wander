// The time ruler as part of the instrument: a curved band of engraved, aged brass along the foot
// of the view, between two knurled knobs with gearwork behind them, drawn in SVG over the canvas.
// Its geometry and scale are rulerScale.ts's.
// With ExploreTime instead of a walk it reads the world clock, wheels through calendar scales,
// and uses the knobs to zoom and the bottom tier to range across all of history. A walk's ruler
// reads its story's proleptic Gregorian dates; Explore's reads the historical calendar (dates.ts),
// Julian before 15 October 1582, as the sources of its events do.
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
import { LENS } from '../../scene/lens';
import {
  formatDay,
  formatHistorical,
  GREGORIAN,
  HISTORICAL,
  monthName,
  yearLabel,
  type Calendar,
  type Precision,
} from '../dates';
import type { Walk, WalkState } from '../contract';
import type { Story } from '../story';
import { ExploreTime, wheelZoom } from '../../time/exploreTime';
import {
  engraved,
  gearSvg,
  gilt,
  JEWEL_AT,
  JEWEL_SVG,
  KNOB_FACE_SVG,
  LEVER_H,
  LEVER_W,
  leverSvg,
  PLATE_H,
  PLATE_SVG,
  PLATE_TAB,
  PLATE_W,
  setEngraved,
  sharedDefs,
  teeth,
} from './brass';
import { button, el, onPress, svg } from './dom';
import {
  beatSpan,
  calendarYearLabel,
  mixSpans,
  platePrecision,
  spreadPips,
  type Span,
} from './format';
import {
  along,
  anchored,
  arcFor,
  at,
  BAND,
  BASE,
  deg,
  engravedUnit,
  engraveHistoryTier,
  engraveScale,
  engraveTier,
  f,
  HEIGHT,
  KNOB_FOOT,
  KNOB_R,
  KNOB_SIDE,
  labelledYearStep,
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

/** How far each lever tucks under the plaque's side, and the clear space kept past its tip. */
const LEVER_TUCK = 7;
const LEVER_CLEAR = 14;
/** How far the plaque reaches along the rule from its middle, levers and clear space included. */
const PLATE_REACH = PLATE_W / 2 + LEVER_W - LEVER_TUCK + LEVER_CLEAR;
/** Upper-row labels keep this far from the plaque's levers, px. */
const PLATE_GAP = 6;
/** The plaque's foot, as a radial offset. */
const PLATE_FOOT = 2;

/** The canvas's vignette (scene/lens.ts), at this share of its strength so the engraving reads. */
const VIGNETTE = LENS.vignette * 0.55;
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
  readonly #walk: Walk | null;
  readonly #story: Story | null;
  readonly #explore: ExploreTime | null;
  /** The calendar the band and plaque read: the story's Gregorian, or Explore's historical. */
  readonly #calendar: Calendar;
  #unsubscribe: (() => void) | undefined;
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
  /** The finest unit the band engraves now, and the years between the years it labels. */
  #unit: Precision = 'day';
  #yearStep = 1;
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

  constructor(walk: Walk, story: Story);
  constructor(explore: ExploreTime);
  constructor(source: Walk | ExploreTime, story?: Story) {
    this.#explore = source instanceof ExploreTime ? source : null;
    this.#walk = source instanceof ExploreTime ? null : source;
    this.#calendar = this.#explore ? HISTORICAL : GREGORIAN;
    this.#story = story ?? null;
    const beats = story?.beats ?? [];
    this.#years = this.#explore?.extent ?? storyYears(beats);
    const first = beats[this.#walk?.state().beat ?? 0] ?? beats[0];
    this.#span = this.#to = this.#explore?.span ?? (first ? beatSpan(first) : { start: 0, end: 1 });
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
    this.#numerals = beats.map((_, i) => {
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
      const beat = beats[i];
      const mark = el('button', className);
      mark.type = 'button';
      if (beat)
        mark.title = `${roman(i + 1)}. ${beat.title}, ${formatDay(beat.day, beat.precision)}`;
      mark.setAttribute('aria-label', mark.title);
      onPress(mark, () => this.#walk?.goTo(i));
      return mark;
    };
    this.#studs = beats.map((_, i) => markButton('rc-stud', i));
    this.#dots = beats.map((_, i) => markButton('rc-dot', i));

    this.#playhead.innerHTML = JEWEL_SVG;

    this.#back = button('rc-lever is-back', 'Back', () => this.#walk?.back());
    this.#next = button('rc-lever is-next', 'Next', () => this.#walk?.next());
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
    if (this.#walk) this.#plate.append(this.#back, this.#next);
    this.#plate.append(plateBody, plateText);

    this.#play = button('rc-knob rc-play', this.#explore ? 'Zoom in' : 'Play', () => {
      if (this.#explore) this.#explore.zoom(0.5, this.#shareOfDay());
      else this.#walk?.togglePlay();
    });
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

    this.#count = button('rc-knob rc-count', this.#explore ? 'Zoom out' : 'Resume story', () => {
      if (this.#explore) this.#explore.zoom(2, this.#shareOfDay());
      else this.#walk?.resume();
    });
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
      this.#updateExplore();
    });
    if (this.#explore) {
      this.element.classList.add('rc-explore');
      this.#glyph.setAttribute('d', 'M-12 -2 H-2 V-12 H2 V-2 H12 V2 H2 V12 H-2 V2 H-12 Z');
      setEngraved(this.#countLines[0], '−');
      setEngraved(this.#countLines[1], 'ZOOM');
      this.#play.title = 'Zoom in';
      this.#count.title = 'Zoom out';
      this.#plate.tabIndex = 0;
      this.#plate.setAttribute('role', 'slider');
      this.#plate.setAttribute('aria-label', 'World date');
      this.#plate.setAttribute('aria-valuemin', String(this.#explore.bounds.start));
      this.#plate.setAttribute('aria-valuemax', String(this.#explore.bounds.end));
      this.#plate.addEventListener('keydown', (event) => {
        const explore = this.#explore!;
        const day = explore.clock.state().day;
        const step = Math.max(1, Math.round((this.#span.end - this.#span.start) / 100));
        if (event.key === 'ArrowLeft') explore.scrub(day - step);
        else if (event.key === 'ArrowRight') explore.scrub(day + step);
        else if (event.key === 'Home') explore.seek(explore.bounds.start);
        else if (event.key === 'End') explore.seek(explore.bounds.end);
        else return;
        event.preventDefault();
        event.stopPropagation();
      });
      this.element.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const share = (this.#angleAt(event.clientX, event.clientY) / this.#arc.reach + 1) / 2;
          this.#explore?.zoom(wheelZoom(event.deltaY, event.deltaMode, innerHeight), share);
        },
        { passive: false },
      );
      this.#unsubscribe = this.#explore.subscribe(() => this.#updateExplore());
    }
    this.#build();
  }

  #shareOfDay(): number {
    return (
      ((this.#explore?.clock.state().day ?? 0) - this.#span.start) /
      (this.#span.end - this.#span.start)
    );
  }

  #updateExplore(): void {
    if (!this.#explore) return;
    const span = this.#explore.span;
    if (!this.#laidOut || span.start !== this.#span.start || span.end !== this.#span.end) {
      this.#span = span;
      this.#engrave();
    }
    const { day } = this.#explore.clock.state();
    this.#place(day, this.#unit);
    this.#turn(day);
    this.#plate.setAttribute('aria-valuenow', String(day));
    const date = this.#calendar.civil(day);
    this.#plate.setAttribute(
      'aria-valuetext',
      `${date.day} ${monthName(date.month)} ${calendarYearLabel(date.year, true)}`,
    );
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
      this.#place(state.day, platePrecision(state));
    }
    this.#showPlay(state);
    this.#showAway(state);
    this.#turn(state.day);
  }

  /** The finest unit the band engraves now: days, months or years. */
  get unit(): Precision {
    return this.#unit;
  }

  /**
   * The years between the years the band labels now: 1 while it engraves days, months or every
   * year, else its labels' step of years, decades, centuries or millennia, whose detents sound.
   */
  get yearStep(): number {
    return this.#yearStep;
  }

  /** The Play knob, where a keyboard visitor lands as the Resume plaque fades. */
  get play(): HTMLButtonElement {
    return this.#play;
  }

  dispose(): void {
    this.#unsubscribe?.();
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
  #place(dayNumber: number, precision: Precision): void {
    const arc = this.#arc;
    const angle = this.#angle(dayNumber);
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
    if (this.#explore) this.#clearExploreLabels();

    const text = this.#explore
      ? formatHistorical(dayNumber, precision)
      : formatDay(dayNumber, precision);
    if (text === this.#plateText) return;
    this.#plateText = text;
    const { day, month, year } = this.#calendar.civil(dayNumber);
    const upper =
      precision === 'year'
        ? ''
        : precision === 'month'
          ? monthName(month)
          : `${day} ${monthName(month)}`;
    const [top, bottom] = this.#plateLines;
    setEngraved(top, upper.toUpperCase());
    const yearText = this.#explore ? calendarYearLabel(year, true) : yearLabel(year);
    setEngraved(bottom, yearText);
    this.#plate.classList.toggle('is-long-year', yearText.length > 7);
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

  /** Free dates can meet any tick: keep both rows clear of the plaque, its tail and the needle. */
  #clearExploreLabels(): void {
    const obstacles = [
      this.#plate.querySelector('.rc-plate-body')!,
      this.#playhead.firstElementChild!,
    ].map((element) => element.getBoundingClientRect());
    for (const { element, label, shown } of this.#cuts.values()) {
      const rect = element.getBoundingClientRect();
      const covered =
        (label.from !== undefined && shown === null) ||
        obstacles.some(
          (obstacle) =>
            rect.left < obstacle.right + 3 &&
            rect.right + 3 > obstacle.left &&
            rect.top < obstacle.bottom + 3 &&
            rect.bottom + 3 > obstacle.top,
        );
      // Recompute even for a hidden label: moving the date away must reveal it again.
      element.classList.toggle('is-covered', covered);
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
    const margin = this.#explore ? 0 : this.#margin;
    const kept = Math.min(1 - margin, Math.max(margin, t));
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
    let drag: { angle: number; day: number; width: number } | null = null;
    const scrub = (day: number) => {
      if (this.#explore) {
        if (from === 'tier') this.#explore.seek(day);
        else this.#explore.scrub(day);
      } else this.#walk?.scrub(day);
    };
    target.addEventListener('pointerdown', (event) => {
      const e = event as PointerEvent;
      if (e.button !== 0 || (e.target as Element).closest('.rc-lever')) return;
      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      this.element.classList.add('is-scrubbing');
      const angle = this.#angleAt(e.clientX, e.clientY);
      const day = this.#explore?.clock.state().day ?? this.#walk!.state().day;
      offset = relative ? this.#angle(day) - angle : 0;
      drag =
        this.#explore && from !== 'tier'
          ? { angle, day: relative ? day : dayAt(angle), width: this.#span.end - this.#span.start }
          : null;
      startX = e.clientX;
      moved = !relative;
      if (!relative) scrub(dayAt(angle));
    });
    target.addEventListener('pointermove', (event) => {
      const e = event as PointerEvent;
      if (!target.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      const angle = this.#angleAt(e.clientX, e.clientY);
      scrub(
        drag
          ? drag.day + ((angle - drag.angle) / (2 * this.#arc.reach)) * drag.width
          : dayAt(angle + offset),
      );
    });
    const end = () => this.element.classList.remove('is-scrubbing');
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
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
    this.#body.innerHTML = bodySvg(arc, this.#years, this.#explore !== null);
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

    const beats = this.#story?.beats ?? [];
    const trueS = beats.map((beat) => tierAngle(arc, this.#years, beat.day) * arc.r);
    const reachS = arc.reach * TIER_REACH * arc.r;
    const dotS = spreadPips(trueS, DOT_GAP, -reachS, reachS);
    this.#dots.forEach((dot, i) => {
      const [x, y] = at(arc, (dotS[i] ?? 0) / arc.r, TIER_RULE);
      dot.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
    });
    this.#laidOut = false;
    this.#placed = '';
    this.#updateExplore();
  }

  /** Engraves the span's scale on the band, sets the studs on the rail, and the tier's window. */
  #engrave(): void {
    this.#laidOut = true;
    const arc = this.#arc;
    const span = this.#span;
    const unit = engravedUnit(arc, span, this.#calendar);
    this.#unit = unit === 'day' || unit === 'month' ? unit : 'year';
    this.#yearStep = labelledYearStep(arc, span, this.#calendar);
    const scale = engraveScale(
      arc,
      span,
      (day) => this.#angle(day),
      this.#calendar,
      this.#explore?.extent,
    );
    for (const kind of TICK_KINDS) {
      for (const path of this.#ticks.get(kind) ?? []) path.setAttribute('d', scale[kind]);
    }
    this.#setLabels(scale.labels);

    // Only the beats in the span have studs on the rail; the tier shows them all.
    const beats = this.#story?.beats ?? [];
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
    // Exploration has no beat studs on the rail: put its window above the rule, off the years.
    const [inner, outer, foot] = this.#explore ? [4, 14, 3] : [-8, 2.5, -9];
    this.#window.setAttribute('d', sector(arc, w0, w1, TIER_RULE + inner, TIER_RULE + outer));
    const [x0, y0] = at(arc, w0, TIER_RULE + foot);
    const [x1, y1] = at(arc, w1, TIER_RULE + foot);
    const rim = along(arc, w0, w1, TIER_RULE + outer).slice(1);
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
        // A key names one label; should its words or face change anyway, the cut is recut.
        if (cut.label.text !== label.text || cut.label.cls !== label.cls) {
          cut.element.textContent = label.text;
          cut.element.setAttribute('class', label.cls);
          cut.half = 0;
        }
        cut.label = label;
      } else {
        const element = svg('text', { class: label.cls, 'text-anchor': 'middle' });
        element.textContent = label.text;
        this.#labelGroup.append(element);
        cut = { element, label, half: 0, shown: NaN };
      }
      // The upper row's labels are placed with the plaque (#clearPlate).
      cut.element.setAttribute('text-anchor', label.anchor ?? 'middle');
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
 * The band, its lit upper lip and its rail, seated into the knobs' sockets, and the base plate
 * under them, with the engraving that never changes: the band's border rules, the rail's beaded
 * edges, and the story tier's years in gilt.
 */
function bodySvg(arc: Arc, years: Span, exploring: boolean): string {
  const [a0, a1] = [-arc.end, arc.end];
  const knobY = HEIGHT - KNOB_FOOT;
  const sockets = [KNOB_SIDE, arc.width - KNOB_SIDE]
    .map((x) => `<circle cx="${x + 3}" cy="${knobY + 6}" r="${KNOB_R + 4}"/>`)
    .join('');
  const rules = [BAND - 3, -BAND + 3]
    .map((dr) => along(arc, -arc.reach - 0.008, arc.reach + 0.008, dr))
    .join('');
  const beads = along(arc, a0, a1, RAIL_TOP - 3.5);
  const tier = exploring ? engraveHistoryTier(arc, years) : engraveTier(arc, years);
  const tierReach = arc.reach * TIER_REACH;
  const tierRule = along(arc, -tierReach, tierReach, TIER_RULE);
  const tierYears = tier.labels
    .map((label) => {
      const spot = labelTransform(arc, label.angle, label.row);
      return `<text class="${label.cls}" text-anchor="${label.anchor ?? 'middle'}" transform="${spot}">${label.text}</text>`;
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
