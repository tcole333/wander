// Explore's time ruler: one brass stock along the foot of the view with two scales, as a slide
// rule has. The tape on top is the linear scale of the stretch shown, graduated in the historical
// calendar (time/tapeScale.ts); it moves, and the needle stays still. Under it, past a beaded rule,
// the overview holds all of history on a logarithmic strip (time/overviewScale.ts), a lens on it
// over the tape's days. A glass fixed at the crown covers exactly the now window, a tenth of the
// tape, with a blued hairline and a garnet jewel; the date plaque stands on the jewel, and a date
// typed into it flies there (time/dateEntry.ts). The counter at the left says how much history the
// tape shows, its two knobs showing less or more. The tape winds into a knurled reel at each end,
// which turns with its travel, and runs on past history's ends as unengraved leader behind a stop.
//
// The painted brass is one hit surface, clipped to the stock's outline, that dispatches by radius
// from the arc's centre: the lip, tape and glass pull, flick, click and double-click the tape; the
// beaded rule and overview sweep and press through all of history, a rider naming the year under
// the pointer; the reels and bare brass swallow presses. The wheel changes the span about the
// needle, a sideways swipe travels, and a pinch zooms. Time moves as time/exploreTime.ts says; the
// ruler draws what it holds, once a frame. The tape's engraving is cut into a buffer three spans
// wide that slides by rotating about the arc's centre, a compositor transform, and is cut again
// only on a zoom or near the buffer's edge.
//
// The lamp is warm and at the upper left, as in the museum scene: the brass is lit from there
// (story/ui/brass.ts), engravings are cut dark with their lower lips catching the light, and the
// canvas's vignette lies over the brass so it sits in the same photograph.
import './timeRuler.css';
import { tunables } from '../config/tunables';
import { LENS } from '../scene/lens';
import { HISTORICAL, monthName, type Precision } from '../story/dates';
import { brassFilter, cartouche, sharedDefs, smallKnob, teeth } from '../story/ui/brass';
import { el, svg } from '../story/ui/dom';
import { along, at, deg, f, radial, sector, type Arc } from '../story/ui/rulerScale';
import { parseEntry } from '../time/dateEntry';
import { ExploreTime, wheelPixels } from '../time/exploreTime';
import {
  groupDigits,
  lensExtent,
  NAME_CHAR_PX,
  overviewNames,
  overviewTicks,
  riderYear,
  YEAR_DAYS,
  type RiderYear,
} from '../time/overviewScale';
import { engraveTape, graduation, TAPE_FADE_PX, type Graduation } from '../time/tapeScale';
import { nearestTick, nextDetent } from '../time/timeMotion';
import { nowWindow } from '../time/worldClock';

/** The ruler's box: the view's width, this tall, on the view's foot. */
export const RULER_H = 114;
/** Radial offsets from the beaded rule between the scales, up positive. */
const FOOT = 8;
const OVD = 23;
const TAPE = 34;
const TAPE_TOP = TAPE + 1;
const LIP_TOP = TAPE_TOP + 4;
/** The overview's hit area reaches this far below the beaded rule. */
const OV_HIT = 30;
/** The tape's reference radius, its band's middle, where its scale is measured. */
const TAPE_MID = 18;
/** Tick lengths, px: labelled, half-step and fine. */
const TICK = { label: 11, mid: 7, fine: 4 } as const;
/** Numerals' baseline, and the caps', from the beaded rule. */
const NUMERAL_ROW = 9.5;
const CAPS_ROW = 11;
/** The jewel's centre on the lip, and its bezel's radius. */
const JEWEL_AT = TAPE_TOP + 2;
const JEWEL_R = 6.3;
/** The plaque's tab. */
const TAB = 5;
/** A press that moves less than this, px, is a click. */
const CLICK_PX = 4;
/** Two clicks this close in time and place are a double click, which a touch also makes. */
const DOUBLE_MS = 320;
const DOUBLE_PX = 20;
/** A click on the tape snaps to a labelled tick within this, px. */
const SNAP_PX = 8;
/** Wheel events further apart than this start a new gesture, whose axis is set anew. */
const WHEEL_GESTURE_MS = 160;
/** A knob held down repeats its step, after a wait, this often. */
const REPEAT_WAIT_MS = 420;
const REPEAT_MS = 240;
/** The canvas's vignette over the brass, at this share of its strength so the engraving reads. */
const VIGNETTE = LENS.vignette * 0.55;

/** The ruler's geometry at one width. */
interface Layout {
  width: number;
  narrow: boolean;
  arc: Arc;
  side: number;
  reelR: number;
  /** The tape's length, px, and the overview's. */
  rulePx: number;
  ovLen: number;
  /** The glass's half angle: a tenth of the tape. */
  glass: number;
  plateW: number;
  counterW: number;
  short: boolean;
}

function layoutFor(width: number): Layout {
  const narrow = width < 700;
  const side = Math.max(24, Math.round(width * 0.044));
  const half = width / 2 - side;
  const sag = Math.min(12, Math.max(4, width * 0.0085));
  const r = (half * half + sag * sag) / (2 * sag);
  const sepY = RULER_H - FOOT - OVD - sag;
  const reelR = narrow ? 15 : 22;
  const end = Math.asin(Math.min(1, half / r));
  const reach = Math.asin(Math.min(1, (half - reelR - 3) / r));
  const arc: Arc = { width, cx: width / 2, cy: sepY + r, r, reach, end };
  return {
    width,
    narrow,
    arc,
    side,
    reelR,
    rulePx: 2 * reach * (r + TAPE_MID),
    ovLen: 2 * reach * (r - OVD / 2),
    glass: 0.1 * reach,
    plateW: narrow ? 104 : 124,
    counterW: width < 420 ? 104 : narrow ? 122 : 142,
    short: width < 420,
  };
}

/** The tape as last engraved: its middle day and span, and the view it was cut for. */
interface Engraved {
  center: number;
  span: number;
  width: number;
  pin: number | null;
  grade: Graduation;
}

type Zone =
  | { kind: 'tape'; angle: number }
  | { kind: 'overview'; angle: number }
  | { kind: 'return' | 'bookmark'; angle: number }
  | { kind: 'bare' };

interface Press {
  pointerId: number;
  zone: Zone;
  x: number;
  y: number;
  moved: boolean;
  /** The tape's middle when the press began, for a pull. */
  center: number;
  /** The last few moments of a pull: when, and where the tape's middle stood. */
  samples: { t: number; center: number }[];
  from: 'surface' | 'plaque';
}

export class TimeRuler {
  readonly element = el('div', 'xr');
  readonly #time: ExploreTime;
  readonly #body = svg('svg', { class: 'xr-body', 'aria-hidden': 'true' });
  readonly #tapeMask = el('div', 'xr-tape-mask');
  readonly #tape = svg('svg', { class: 'xr-tape', 'aria-hidden': 'true' });
  readonly #over = svg('svg', { class: 'xr-over', 'aria-hidden': 'true' });
  readonly #live = svg('svg', { class: 'xr-live', 'aria-hidden': 'true' });
  readonly #glass = svg('svg', { class: 'xr-glass', 'aria-hidden': 'true' });
  readonly #reels = [el('div', 'xr-reel'), el('div', 'xr-reel')];
  readonly #knurls: SVGSVGElement[] = [];
  readonly #finish = svg('svg', { class: 'xr-finish', 'aria-hidden': 'true' });
  readonly #hit = el('div', 'xr-hit');
  readonly #plaque = el('div', 'xr-plaque');
  readonly #plateBody = svg('svg', { class: 'xr-plate-body', 'aria-hidden': 'true' });
  readonly #plateText = svg('svg', { class: 'xr-plate-text', 'aria-hidden': 'true' });
  readonly #limits = el('span', 'xr-limits', '10,000 BCE – 2000');
  readonly #entry = el('input', 'xr-entry');
  readonly #counter = el('div', 'xr-counter');
  readonly #counterBody = svg('svg', { class: 'xr-counter-body', 'aria-hidden': 'true' });
  readonly #fewer: HTMLButtonElement;
  readonly #more: HTMLButtonElement;
  readonly #reading = el('span', 'xr-reading');
  readonly #count = el('span', 'xr-count');
  readonly #unitWord = el('span', 'xr-unit');
  readonly #riderTag = el('div', 'xr-rider');
  readonly #status = el('span', 'xr-status');
  readonly #listeners = new AbortController();
  readonly #unsubscribe: () => void;
  #layout: Layout = layoutFor(1440);
  #engraved: Engraved | null = null;
  #grade: Graduation;
  #dirty = true;
  #frame = 0;
  #resizeFrame = 0;
  /** The tape's travel, px, which turns the reels, and the middle it was last measured from. */
  #travel = 0;
  #lastCenter = NaN;
  #lastSpan = NaN;
  #plateKey = '';
  #plateH = 0;
  #press: Press | null = null;
  #pinch: { dist: number; mid: number; span: number } | null = null;
  readonly #pointers = new Map<number, { x: number; y: number }>();
  #lastClick: { t: number; x: number; y: number; day: number } | null = null;
  #rider: RiderYear | null = null;
  #riderU = 0;
  #hot: 'lens' | 'return' | 'bookmark' | null = null;
  #wheel: { t: number; axis: 'x' | 'y' } | null = null;
  #repeat = 0;
  #entryOpen = false;
  #spoken = '';
  /** The pinned event's day, which the bookmark marks, or null. */
  #pin: number | null = null;

  constructor(time: ExploreTime) {
    this.#time = time;
    this.#grade = graduation(time.spanDays, time.rulePx, time.day);
    this.#tapeMask.append(this.#tape);

    this.#plaque.tabIndex = 0;
    this.#plaque.setAttribute('role', 'slider');
    this.#plaque.setAttribute('aria-label', 'World date');
    this.#plaque.setAttribute('aria-valuemin', String(time.bounds.start));
    this.#plaque.setAttribute('aria-valuemax', String(time.bounds.end));
    this.#plaque.setAttribute(
      'aria-keyshortcuts',
      'ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End Backspace',
    );
    this.#entry.type = 'text';
    this.#entry.inputMode = 'text';
    this.#entry.autocomplete = 'off';
    this.#entry.spellcheck = false;
    this.#entry.tabIndex = -1;
    this.#entry.setAttribute('aria-label', 'Go to a date');
    this.#limits.setAttribute('aria-hidden', 'true');
    this.#plaque.append(this.#plateBody, this.#plateText, this.#limits, this.#entry);

    this.#counter.tabIndex = 0;
    this.#counter.setAttribute('role', 'slider');
    this.#counter.setAttribute('aria-label', 'Years shown');
    this.#counter.setAttribute('aria-valuemin', '10');
    this.#counter.setAttribute('aria-valuemax', String(Math.round(5000 * YEAR_DAYS)));
    this.#fewer = this.#knob('fewer', -1);
    this.#more = this.#knob('more', 1);
    this.#reading.append(this.#count, this.#unitWord);
    this.#counter.append(this.#counterBody, this.#fewer, this.#reading, this.#more);

    this.#status.setAttribute('role', 'status');
    this.#riderTag.setAttribute('aria-hidden', 'true');
    this.#hit.setAttribute('aria-hidden', 'true');

    this.element.append(
      this.#body,
      this.#tapeMask,
      this.#over,
      this.#live,
      this.#glass,
      ...this.#reels,
      this.#finish,
      this.#hit,
      this.#counter,
      this.#plaque,
      this.#riderTag,
      this.#status,
    );
    this.#listen();
    this.#unsubscribe = time.subscribe(() => this.#invalidate());
    addEventListener('resize', this.#onResize, { signal: this.#listeners.signal });
    this.#build();
  }

  /** The finest unit the tape labels now: days, months or years. */
  get unit(): Precision {
    return this.#grade.unit;
  }

  /** The years between the years the tape labels: 1 unless it labels years. */
  get yearStep(): number {
    return this.#grade.yearStep;
  }

  /** The date plaque, the Date slider. */
  get plaque(): HTMLElement {
    return this.#plaque;
  }

  /** The counter, the Years shown slider. */
  get counter(): HTMLElement {
    return this.#counter;
  }

  /** What the plates keep clear of: the box, and the plaque standing over it. */
  get panels(): readonly Element[] {
    return [this.element, this.#plaque];
  }

  /** Whether the date entry is open. */
  get entryOpen(): boolean {
    return this.#entryOpen;
  }

  /** Marks the pinned event's day on both scales, or none. */
  set pin(day: number | null) {
    if (day === this.#pin) return;
    this.#pin = day;
    this.#invalidate();
  }

  /** Draws what changed since the last frame. */
  frame(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    if (this.#dirty) this.#draw();
  }

  /** Opens the date entry on the plaque, with `typed` in it. */
  openEntry(typed = ''): void {
    this.#entryOpen = true;
    this.#plaque.classList.add('is-entering');
    this.#plaque.classList.remove('is-refused');
    this.#entry.value = typed;
    this.#plateKey = '';
    this.#draw();
    this.#entry.focus({ preventScroll: true });
    this.#entry.setSelectionRange(typed.length, typed.length);
  }

  /** Closes the date entry; focus returns to the plaque if it was in the entry. */
  closeEntry(): void {
    if (!this.#entryOpen) return;
    this.#entryOpen = false;
    this.#plaque.classList.remove('is-entering', 'is-refused');
    const had = document.activeElement === this.#entry;
    this.#entry.value = '';
    this.#plateKey = '';
    this.#draw();
    if (had) this.#plaque.focus({ preventScroll: true });
  }

  /** Says a jump's date or a detent's span to a screen reader. */
  say(text: string): void {
    if (text === this.#spoken) text += ' ';
    this.#spoken = text;
    this.#status.textContent = text;
  }

  /** Says where a jump landed, once it has. */
  sayDate(day: number): void {
    this.say(spokenDay(day));
  }

  sayYears(span: number): void {
    this.say(spanWords(span, false).join(' ').toLowerCase());
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.abort();
    cancelAnimationFrame(this.#frame);
    cancelAnimationFrame(this.#resizeFrame);
    clearTimeout(this.#repeat);
    this.element.remove();
  }

  readonly #onResize = () => {
    cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = requestAnimationFrame(() => this.#build());
  };

  #invalidate(): void {
    this.#dirty = true;
    if (this.#frame === 0) {
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        if (this.#dirty) this.#draw();
      });
    }
  }

  /** A counter knob: fewer years (-1) or more (1), stepping one detent, repeating while held. */
  #knob(name: string, dir: 1 | -1): HTMLButtonElement {
    const knob = el('button', `xr-knob is-${name}`);
    knob.type = 'button';
    knob.tabIndex = -1;
    const face = smallKnob(`xr-knob-${name}`, 14);
    face.setAttribute('width', '28');
    face.setAttribute('height', '28');
    const glyph = svg('svg', { viewBox: '-14 -14 28 28', width: 28, height: 28 });
    // ›|‹ gathers the years in, ‹|› spreads them out.
    const d =
      dir < 0
        ? 'M-7.5 -4.5 L-2.4 0 L-7.5 4.5 Z M7.5 -4.5 L2.4 0 L7.5 4.5 Z M-0.7 -5 H0.7 V5 H-0.7 Z'
        : 'M-2.6 -4.5 L-7.8 0 L-2.6 4.5 Z M2.6 -4.5 L7.8 0 L2.6 4.5 Z M-0.7 -5 H0.7 V5 H-0.7 Z';
    glyph.innerHTML = `<path d="${d}" class="rc-cut-lip" transform="translate(0.5 0.7)"/><path d="${d}" class="rc-niello"/>`;
    knob.append(face, glyph);
    const { signal } = this.#listeners;
    const stop = () => {
      clearTimeout(this.#repeat);
      this.#repeat = 0;
    };
    knob.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.#counter.focus({ preventScroll: true });
        const step = () => {
          this.#detent(dir);
          this.#repeat = window.setTimeout(step, REPEAT_MS);
        };
        this.#detent(dir);
        this.#repeat = window.setTimeout(step, REPEAT_WAIT_MS);
      },
      { signal },
    );
    for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'blur'] as const)
      knob.addEventListener(type, stop, { signal });
    // A click the keyboard makes (none reaches it: the knobs are out of the tab order), or a
    // screen reader's, steps once.
    knob.addEventListener(
      'click',
      (event) => {
        if (event.detail === 0) this.#detent(dir);
      },
      { signal },
    );
    return knob;
  }

  /** One detent wider or narrower, said once it lands. */
  #detent(dir: 1 | -1): void {
    this.#time.detent(dir);
    this.sayYears(this.#time.target.span);
  }

  /** A jump to a date: it flies there, leaving a return point if far, and is said. */
  #jump(day: number, span?: number): void {
    this.#time.fly(day, span ?? this.#time.target.span, { jump: true });
    this.sayDate(this.#time.target.day);
  }

  // ---------------------------------------------------------------- building

  /** Draws what depends only on the view's size: the stock, overview, glass, reels and finish. */
  #build(): void {
    const width = innerWidth;
    const layout = (this.#layout = layoutFor(width));
    this.#time.rulePx = layout.rulePx;
    this.element.classList.toggle('is-narrow', layout.narrow);
    for (const layer of [
      this.#body,
      this.#tape,
      this.#over,
      this.#live,
      this.#glass,
      this.#finish,
    ]) {
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(RULER_H));
      layer.setAttribute('viewBox', `0 0 ${width} ${RULER_H}`);
    }
    const { arc } = layout;
    this.#tape.style.transformOrigin = `${f(arc.cx, 2)}px ${f(arc.cy, 2)}px`;
    this.#body.innerHTML = bodySvg(layout);
    this.#over.innerHTML = overviewSvg(layout, this.#time);
    this.#glass.innerHTML = glassSvg(layout);
    this.#finish.innerHTML = finishSvg(layout);
    this.#buildReels();
    this.#buildMask();
    this.#buildHit();
    this.#buildCounter();
    this.#engraved = null;
    this.#plateKey = '';
    this.#draw();
  }

  #buildReels(): void {
    const { arc, reelR } = this.#layout;
    this.#knurls.length = 0;
    const size = 2 * reelR + 8;
    this.#reels.forEach((reel, i) => {
      const side = i === 0 ? -1 : 1;
      const [x, y] = at(arc, side * arc.end, TAPE_MID);
      reel.style.transform = `translate(${f(x - size / 2)}px, ${f(y - size / 2)}px)`;
      reel.style.width = reel.style.height = `${size}px`;
      setShade(reel, shadeAt(x, y));
      const h = size / 2;
      const box = `${-h} ${-h} ${size} ${size}`;
      const knurl = svg('svg', { class: 'xr-knurl', viewBox: box, width: size, height: size });
      knurl.innerHTML = `<path d="${teeth(Math.round(reelR * 2.4), reelR - 2.6, reelR, 0.2, 0.55)}" fill="url(#xr-knurl-fill)" stroke="#1c1207" stroke-width="0.45"/>`;
      const face = svg('svg', { class: 'xr-reel-face', viewBox: box, width: size, height: size });
      face.innerHTML = reelFaceSvg(reelR);
      reel.replaceChildren(knurl, face);
      this.#knurls.push(knurl);
    });
  }

  /** The tape fades over TAPE_FADE_PX at each reel, and shows nothing past them. */
  #buildMask(): void {
    const { arc, width } = this.#layout;
    const [x0] = at(arc, -arc.reach, TAPE_MID);
    const [x1] = at(arc, arc.reach, TAPE_MID);
    const stops = [
      `transparent ${f(x0)}px`,
      `#000 ${f(x0 + TAPE_FADE_PX)}px`,
      `#000 ${f(x1 - TAPE_FADE_PX)}px`,
      `transparent ${f(x1)}px`,
    ].join(', ');
    const mask = `linear-gradient(to right, ${stops})`;
    this.#tapeMask.style.setProperty('mask-image', mask);
    this.#tapeMask.style.setProperty('-webkit-mask-image', mask);
    this.#tapeMask.style.width = `${width}px`;
  }

  /** The hit surface: the stock's outline and the reels. */
  #buildHit(): void {
    const { arc, width, reelR } = this.#layout;
    let d = sector(arc, -arc.end - 0.004, arc.end + 0.004, -OV_HIT, LIP_TOP + 3);
    for (const side of [-1, 1]) {
      const [x, y] = at(arc, side * arc.end, TAPE_MID);
      const r = reelR + 3;
      d += `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    this.#hit.style.width = `${width}px`;
    this.#hit.style.height = `${RULER_H}px`;
    this.#hit.style.clipPath = `path('${d}')`;
  }

  #buildCounter(): void {
    const { arc, side, reelR, counterW, narrow } = this.#layout;
    const h = 28;
    const left = side + reelR + (narrow ? 4 : 8);
    const mid = left + counterW / 2;
    const lip = arc.cy - Math.sqrt((arc.r + LIP_TOP) ** 2 - (mid - arc.cx) ** 2);
    const top = lip - 4 - h;
    this.#counter.style.transform = `translate(${f(left)}px, ${f(top)}px)`;
    this.#counter.style.width = `${counterW}px`;
    setShade(this.#counter, shadeAt(mid, top + h / 2));
    this.#counterBody.setAttribute('width', String(counterW));
    this.#counterBody.setAttribute('height', String(h));
    this.#counterBody.setAttribute('viewBox', `0 0 ${counterW} ${h}`);
    this.#counterBody.innerHTML =
      `<path d="${cartouche(0.5, 0.5, counterW - 1, h - 1, 5, 0)}" fill="url(#xr-dark-fill)" stroke="#0e0904" stroke-width="1" filter="url(#rc-lit-plate)"/>` +
      `<path d="${cartouche(30, 4, counterW - 60, h - 8, 3, 0)}" fill="#140d06" stroke="rgb(230 190 120 / 0.35)" stroke-width="0.6"/>`;
  }

  // ---------------------------------------------------------------- drawing

  #draw(): void {
    this.#dirty = false;
    const time = this.#time;
    const layout = this.#layout;
    const { arc } = layout;
    const center = time.center;
    const span = time.spanDays;
    const k = (2 * arc.reach) / span;

    // The tape: cut again on a zoom, a resize, a new pin, or near the buffer's edge.
    const engraved = this.#engraved;
    if (
      !engraved ||
      engraved.span !== span ||
      engraved.width !== layout.width ||
      engraved.pin !== this.#pin ||
      Math.abs(center - engraved.center) > 0.9 * span
    ) {
      this.#engrave(center, span);
    }
    const cut = this.#engraved!;
    this.#tape.style.transform = `rotate(${f(deg(-(center - cut.center) * k), 5)}deg)`;
    this.#grade = graduation(span, layout.rulePx, time.day);

    // The reels turn with the tape's travel, in px, so they never strobe.
    if (span === this.#lastSpan && Number.isFinite(this.#lastCenter)) {
      this.#travel += (center - this.#lastCenter) * k * (arc.r + TAPE_MID);
    }
    [this.#lastCenter, this.#lastSpan] = [center, span];
    const turn = f((-this.#travel / layout.reelR) * (180 / Math.PI), 2);
    for (const knurl of this.#knurls) knurl.style.rotate = `${turn}deg`;

    this.#live.innerHTML = liveSvg(layout, time, this.#pin, this.#rider ? this.#riderU : null);
    this.#live.classList.toggle('is-lens-hot', this.#hot === 'lens');
    this.#live.classList.toggle('is-return-hot', this.#hot === 'return');
    this.#live.classList.toggle('is-bookmark-hot', this.#hot === 'bookmark');
    this.#drawPlaque();
    this.#drawCounter();
    this.#drawRider();
  }

  #engrave(center: number, span: number): void {
    const layout = this.#layout;
    const { arc } = layout;
    const time = this.#time;
    const range = { start: center - 1.5 * span, end: center + 1.5 * span };
    const tape = engraveTape(range, span, layout.rulePx, time.extent);
    const k = (2 * arc.reach) / span;
    const angle = (day: number) => (day - center) * k;
    const paths = { label: '', mid: '', fine: '' };
    for (const tier of ['label', 'mid', 'fine'] as const) {
      for (const day of tape.ticks[tier])
        paths[tier] += radial(arc, angle(day), TAPE_TOP - 0.5, TAPE_TOP - 0.5 - TICK[tier]);
    }
    let leaders = '';
    for (const leader of tape.leaders) {
      const [a0, a1] = [angle(leader.start), angle(leader.end)];
      leaders += `<path d="${sector(arc, a0, a1, 1, TAPE_TOP)}" fill="url(#xr-hatch)"/>`;
    }
    let stops = '';
    for (const stop of tape.stops) {
      const a = angle(stop.day);
      const beyond = (stop.side === 'start' ? -3 : 3) / (arc.r + TAPE_MID);
      stops += radial(arc, a, 1.5, TAPE_TOP - 0.5) + radial(arc, a + beyond, 1.5, TAPE_TOP - 0.5);
    }
    let labels = '';
    for (const label of tape.labels) {
      const shift = label.anchor === 'start' ? 7 : label.anchor === 'end' ? -7 : 0;
      const a = angle(label.day) + shift / (arc.r + NUMERAL_ROW);
      const row = label.face === 'caps' ? CAPS_ROW : NUMERAL_ROW;
      const [x, y] = at(arc, a, row);
      const cls = label.face === 'caps' ? 'xr-caps' : 'xr-num';
      labels += `<text class="${cls}" text-anchor="${label.anchor}" transform="translate(${f(x)} ${f(y)}) rotate(${f(deg(a), 2)})">${escapeText(label.text)}</text>`;
    }
    let bookmark = '';
    if (this.#pin !== null) {
      const a = angle(this.#pin);
      if (Math.abs(a) < 1.6 * arc.reach) bookmark = lozenge(arc, a, TAPE_TOP + 2, 3.4);
    }
    const cuts = (cls: string, shift: string) =>
      `<g class="${cls}"${shift}><path class="is-label" d="${paths.label}${stops}"/><path class="is-mid" d="${paths.mid}"/><path class="is-fine" d="${paths.fine}"/></g>`;
    this.#tape.innerHTML =
      `${leaders}${cuts('xr-tick-lip', ' transform="translate(0.6 0.9)"')}${cuts('xr-tick', '')}` +
      `<g class="xr-labels">${labels}</g>${bookmark}`;
    this.#engraved = {
      center,
      span,
      width: layout.width,
      pin: this.#pin,
      grade: tape.graduation,
    };
  }

  #drawPlaque(): void {
    const layout = this.#layout;
    const { arc, plateW } = layout;
    const time = this.#time;
    const day = time.day;
    const unit = this.#grade.unit;
    const civil = HISTORICAL.civil(day);
    const year = plateYear(civil.year);
    const top = this.#entryOpen
      ? ''
      : unit === 'day'
        ? `${civil.day} ${monthName(civil.month)}`.toUpperCase()
        : unit === 'month'
          ? monthName(civil.month).toUpperCase()
          : '';
    const tall = this.#entryOpen || top !== '';
    const h = tall ? 44 : 34;
    const key = `${plateW} ${h} ${top} ${year} ${this.#entryOpen}`;
    if (key !== this.#plateKey) {
      this.#plateKey = key;
      if (h !== this.#plateH || this.#plateBody.getAttribute('width') !== String(plateW + 8)) {
        this.#plateH = h;
        this.#plateBody.setAttribute('width', String(plateW + 8));
        this.#plateBody.setAttribute('height', String(h + TAB + 10));
        this.#plateBody.setAttribute('viewBox', `-4 -4 ${plateW + 8} ${h + TAB + 10}`);
        this.#plateBody.innerHTML = plateSvg(plateW, h);
        this.#plateText.setAttribute('width', String(plateW));
        this.#plateText.setAttribute('height', String(h));
        this.#plateText.setAttribute('viewBox', `0 0 ${plateW} ${h}`);
      }
      const long = year.length > 8;
      this.#plateText.innerHTML = this.#entryOpen
        ? ''
        : (top ? engravedText(plateW / 2, 15, 'xr-pl-top', top) : '') +
          engravedText(
            plateW / 2,
            top ? 34 : 24.5,
            `xr-pl-year${long ? ' is-long' : ''}${top ? ' is-under' : ''}`,
            year,
          );
      const [cx, jewelY] = at(arc, 0, JEWEL_AT);
      const tip = jewelY - JEWEL_R + 0.5;
      this.#plaque.style.width = `${plateW}px`;
      this.#plaque.style.height = `${h}px`;
      this.#plaque.style.transform = `translate(${f(cx - plateW / 2)}px, ${f(tip - TAB - h)}px)`;
      setShade(this.#plaque, shadeAt(cx, tip - h / 2));
    }
    this.#plaque.setAttribute('aria-valuenow', String(Math.floor(day)));
    this.#plaque.setAttribute('aria-valuetext', `${spokenDay(day)}; ${glassWords(time)}`);
  }

  #drawCounter(): void {
    const span = this.#time.spanDays;
    const [n, unit] = spanWords(span, this.#layout.short);
    if (this.#count.textContent !== n) this.#count.textContent = n;
    if (this.#unitWord.textContent !== unit) this.#unitWord.textContent = unit;
    const words = spanWords(span, false).join(' ').toLowerCase();
    this.#counter.setAttribute('aria-valuenow', String(Math.round(span)));
    this.#counter.setAttribute('aria-valuetext', words);
    for (const [knob, dir] of [
      [this.#fewer, -1],
      [this.#more, 1],
    ] as const) {
      const next = nextDetent(this.#time.target.span, dir);
      const title = `Show ${spanWords(next, false).join(' ').toLowerCase()}`;
      if (knob.title !== title) {
        knob.title = title;
        knob.setAttribute('aria-label', title);
      }
      knob.disabled = Math.abs(next - this.#time.target.span) < 1e-6;
    }
  }

  #drawRider(): void {
    const rider = this.#rider;
    const tag = this.#riderTag;
    tag.classList.toggle('is-shown', rider !== null);
    if (!rider) return;
    const { arc } = this.#layout;
    const [x, y] = at(arc, (2 * this.#riderU - 1) * arc.reach, 3);
    if (tag.textContent !== rider.text) tag.textContent = rider.text;
    tag.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
  }

  // ---------------------------------------------------------------- input

  #listen(): void {
    const { signal } = this.#listeners;
    const hit = this.#hit;
    hit.addEventListener('pointerdown', (event) => this.#down(event, 'surface'), { signal });
    this.#plaque.addEventListener('pointerdown', (event) => this.#down(event, 'plaque'), {
      signal,
    });
    for (const target of [hit, this.#plaque]) {
      target.addEventListener('pointermove', (event) => this.#move(event), { signal });
      target.addEventListener('pointerup', (event) => this.#up(event, false), { signal });
      target.addEventListener('pointercancel', (event) => this.#up(event, true), { signal });
    }
    hit.addEventListener(
      'pointerleave',
      () => {
        if (this.#press) return;
        this.#setRider(null);
        this.#setHot(null);
      },
      { signal },
    );
    for (const target of [hit, this.#plaque, this.#counter]) {
      target.addEventListener('wheel', (event) => this.#onWheel(event), {
        signal,
        passive: false,
      });
    }
    // Presses on the counter's body focus it and select nothing.
    this.#counter.addEventListener(
      'pointerdown',
      (event) => {
        if ((event.target as Element).closest('.xr-knob')) return;
        event.preventDefault();
        this.#counter.focus({ preventScroll: true });
      },
      { signal },
    );
    this.#plaque.addEventListener(
      'keydown',
      (event) => {
        if (event.target !== this.#plaque || event.key !== 'Enter') return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        this.openEntry();
      },
      { signal },
    );
    const entry = this.#entry;
    entry.addEventListener(
      'keydown',
      (event) => {
        // Nothing the entry reads goes further: not the globe's keys, not the lobby's Escape.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeEntry();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          this.#commit();
        }
      },
      { signal },
    );
    entry.addEventListener('input', () => this.#plaque.classList.remove('is-refused'), {
      signal,
    });
    entry.addEventListener('blur', () => this.closeEntry(), { signal });
  }

  /** Reads what was typed: a date flies there and closes; one out of reach shakes the plaque. */
  #commit(): void {
    const typed = parseEntry(this.#entry.value, this.#time.bounds);
    if (!typed.ok) {
      if (typed.why === 'empty') {
        this.closeEntry();
        return;
      }
      this.#plaque.classList.remove('is-refused');
      // Once more, so the shake runs again.
      void this.#plaque.offsetWidth;
      this.#plaque.classList.add('is-refused');
      return;
    }
    const span = this.#time.target.span;
    this.closeEntry();
    this.#jump(typed.day, typed.maxSpan === undefined ? span : Math.min(span, typed.maxSpan));
  }

  /** The zone under a point of the box: by radius from the arc's centre. */
  #zoneAt(x: number, y: number): Zone {
    const { arc } = this.#layout;
    const dx = x - arc.cx;
    const up = arc.cy - y;
    const angle = Math.atan2(dx, up);
    const dr = Math.hypot(dx, up) - arc.r;
    if (Math.abs(angle) > arc.reach + 2 / arc.r) return { kind: 'bare' };
    if (dr > LIP_TOP + 3 || dr < -OV_HIT) return { kind: 'bare' };
    const time = this.#time;
    const px = (a: number, b: number) => Math.abs(a - b) * arc.r;
    if (dr < 1) {
      const u = (angle / arc.reach + 1) / 2;
      const aOf = (day: number) => (2 * time.warp.u(day) - 1) * arc.reach;
      const back = time.returnDay;
      if (back !== null && px(aOf(back), angle) <= 7 && dr > -OVD) return { kind: 'return', angle };
      if (this.#pin !== null && px(aOf(this.#pin), angle) <= 6 && dr > -9)
        return { kind: 'bookmark', angle };
      if (u < -0.01 || u > 1.01) return { kind: 'bare' };
      return { kind: 'overview', angle };
    }
    if (this.#pin !== null && dr > TAPE_TOP - 4) {
      const a = (this.#pin - time.center) * ((2 * arc.reach) / time.spanDays);
      if (Math.abs(a) < arc.reach && px(a, angle) <= 6) return { kind: 'bookmark', angle };
    }
    return { kind: 'tape', angle };
  }

  #local(event: PointerEvent | WheelEvent): [number, number] {
    const rect = this.element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  #angleAt(x: number, y: number): number {
    const { arc } = this.#layout;
    return Math.atan2(x - arc.cx, arc.cy - y);
  }

  #down(event: PointerEvent, from: 'surface' | 'plaque'): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A press in the open entry places its caret.
    if (from === 'plaque' && this.#entryOpen) return;
    // Painted brass takes every press: no text is selected and the globe never turns.
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const [x, y] = this.#local(event);
    this.#pointers.set(event.pointerId, { x, y });
    if (from === 'plaque') this.#plaque.focus({ preventScroll: true });
    if (this.#pointers.size === 2) {
      // Two fingers: a pinch, whose midpoint's slide travels.
      const [p, q] = [...this.#pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      this.#press = null;
      this.#time.interrupt();
      this.#pinch = {
        dist: Math.max(8, Math.hypot(p.x - q.x, p.y - q.y)),
        mid: this.#angleAt((p.x + q.x) / 2, (p.y + q.y) / 2),
        span: this.#time.spanDays,
      };
      return;
    }
    const zone = from === 'plaque' ? { kind: 'tape' as const, angle: 0 } : this.#zoneAt(x, y);
    if (zone.kind === 'bare') return;
    this.#time.interrupt();
    this.#press = {
      pointerId: event.pointerId,
      zone,
      x,
      y,
      moved: false,
      center: this.#time.center,
      samples: [{ t: event.timeStamp, center: this.#time.center }],
      from,
    };
    if (zone.kind === 'tape') this.element.classList.add('is-pulling');
    if (zone.kind === 'overview') this.#setRider(zone.angle);
  }

  #move(event: PointerEvent): void {
    const [x, y] = this.#local(event);
    if (this.#pointers.has(event.pointerId)) this.#pointers.set(event.pointerId, { x, y });
    const pinch = this.#pinch;
    if (pinch && this.#pointers.size >= 2) {
      const [p, q] = [...this.#pointers.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const dist = Math.max(8, Math.hypot(p.x - q.x, p.y - q.y));
      const mid = this.#angleAt((p.x + q.x) / 2, (p.y + q.y) / 2);
      const { arc } = this.#layout;
      const before = this.#time.spanDays;
      this.#time.zoomTo((pinch.span * pinch.dist) / dist);
      pinch.span = this.#time.spanDays;
      pinch.dist = dist;
      // The midpoint's slide carries the tape with it, at the span it slid at.
      this.#time.pan(-((mid - pinch.mid) / (2 * arc.reach)) * before);
      pinch.mid = mid;
      return;
    }
    const press = this.#press;
    if (!press || press.pointerId !== event.pointerId) {
      if (event.buttons === 0 && event.currentTarget === this.#hit) this.#hover(x, y);
      return;
    }
    if (!press.moved && Math.hypot(x - press.x, y - press.y) < CLICK_PX) return;
    press.moved = true;
    const { arc } = this.#layout;
    const angle = this.#angleAt(x, y);
    if (press.zone.kind === 'overview') {
      // A sweep: the date follows the pointer through all of history.
      const u = Math.min(1, Math.max(0, (angle / arc.reach + 1) / 2));
      this.#time.seek(this.#time.warp.day(u));
      this.#setRider(angle);
      return;
    }
    if (press.zone.kind !== 'tape') return;
    // A pull: the date grabbed stays under the pointer.
    const grabbed = this.#angleAt(press.x, press.y);
    const k = (2 * arc.reach) / this.#time.spanDays;
    this.#time.drag(press.center - (angle - grabbed) / k);
    press.samples.push({ t: event.timeStamp, center: this.#time.center });
    if (press.samples.length > 8) press.samples.shift();
  }

  #up(event: PointerEvent, cancelled: boolean): void {
    this.#pointers.delete(event.pointerId);
    if (this.#pinch) {
      if (this.#pointers.size < 2) this.#pinch = null;
      this.#press = null;
      return;
    }
    const press = this.#press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.#press = null;
    this.element.classList.remove('is-pulling');
    if (event.pointerType !== 'mouse') this.#setRider(null);
    if (cancelled) {
      this.#time.release(0);
      return;
    }
    const zone = press.zone;
    if (press.moved) {
      if (zone.kind === 'tape') this.#time.release(this.#velocity(press, event.timeStamp));
      return;
    }
    const [x, y] = [press.x, press.y];
    if (press.from === 'plaque') {
      this.openEntry();
      return;
    }
    if (zone.kind === 'return') {
      this.#time.back();
      this.sayDate(this.#time.target.day);
    } else if (zone.kind === 'bookmark' && this.#pin !== null) {
      this.#jump(this.#pin);
    } else if (zone.kind === 'overview') {
      const { arc, ovLen } = this.#layout;
      const u = Math.min(1, Math.max(0, (zone.angle / arc.reach + 1) / 2));
      this.#jump(riderYear(this.#time.warp, this.#time.extent, u, ovLen).day);
    } else if (zone.kind === 'tape') {
      const last = this.#lastClick;
      const double =
        last !== null &&
        event.timeStamp - last.t < DOUBLE_MS &&
        Math.hypot(x - last.x, y - last.y) < DOUBLE_PX;
      if (double) {
        // A double click flies there and looks one detent closer.
        this.#lastClick = null;
        this.#time.fly(last.day, nextDetent(this.#time.target.span, -1), { jump: true });
        this.sayYears(this.#time.target.span);
        return;
      }
      const day = this.#clickedDay(zone.angle);
      this.#lastClick = { t: event.timeStamp, x, y, day };
      this.#jump(day);
    }
  }

  /** The date under a click on the tape, snapped to a labelled tick within SNAP_PX. */
  #clickedDay(angle: number): number {
    const { arc } = this.#layout;
    const time = this.#time;
    const k = (2 * arc.reach) / time.spanDays;
    const day = time.center + angle / k;
    const tick = nearestTick(day, this.#grade.label);
    return Math.abs(tick - day) * k * (arc.r + TAPE_MID) <= SNAP_PX ? tick : day;
  }

  /** A pull's speed as it was let go, days a second; none if the hand held still first. */
  #velocity(press: Press, now: number): number {
    const samples = press.samples.filter((s) => now - s.t <= 100);
    const last = press.samples.at(-1);
    if (!last || now - last.t > 60 || samples.length < 2) return 0;
    const first = samples[0]!;
    const dt = (last.t - first.t) / 1000;
    return dt > 0.008 ? (last.center - first.center) / dt : 0;
  }

  #hover(x: number, y: number): void {
    const zone = this.#zoneAt(x, y);
    const hit = this.#hit;
    hit.dataset.zone = zone.kind;
    const { arc } = this.#layout;
    if (zone.kind === 'overview' || zone.kind === 'return') {
      this.#setRider(zone.angle);
      const { u0, u1 } = lensExtent(
        this.#time.warp,
        this.#time.day,
        this.#time.spanDays,
        this.#layout.ovLen,
      );
      const u = (zone.angle / arc.reach + 1) / 2;
      this.#setHot(zone.kind === 'return' ? 'return' : u >= u0 && u <= u1 ? 'lens' : null);
      return;
    }
    if (zone.kind === 'bookmark') {
      this.#setRider(null);
      this.#setHot('bookmark');
      return;
    }
    this.#setRider(null);
    // The tape's ends carry the lens's brackets: hovering either brightens both.
    const nearEnd = zone.kind === 'tape' && (arc.reach - Math.abs(zone.angle)) * arc.r < 14;
    this.#setHot(nearEnd ? 'lens' : null);
  }

  #setRider(angle: number | null): void {
    if (angle === null) {
      if (this.#rider === null) return;
      this.#rider = null;
    } else {
      const { arc, ovLen } = this.#layout;
      this.#riderU = Math.min(1, Math.max(0, (angle / arc.reach + 1) / 2));
      this.#rider = riderYear(this.#time.warp, this.#time.extent, this.#riderU, ovLen);
    }
    this.#invalidate();
  }

  #setHot(hot: 'lens' | 'return' | 'bookmark' | null): void {
    if (hot === this.#hot) return;
    this.#hot = hot;
    this.#invalidate();
  }

  /**
   * The wheel over the brass: vertically it changes the span about the needle, sideways (or with
   * Shift) it travels px for px, and a pinch (ctrl) zooms at the globe's rate. Each gesture keeps
   * to the axis its first event leans to.
   */
  #onWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const time = this.#time;
    const dx = wheelPixels(event.deltaX, event.deltaMode, innerHeight);
    const dy = wheelPixels(event.deltaY, event.deltaMode, innerHeight);
    if (event.ctrlKey) {
      time.zoomBy(Math.exp(clamp(dy, -600, 600) * tunables.timePinchRate));
      return;
    }
    const last = this.#wheel;
    const axis =
      last && event.timeStamp - last.t < WHEEL_GESTURE_MS
        ? last.axis
        : event.shiftKey || Math.abs(dx) > Math.abs(dy)
          ? 'x'
          : 'y';
    this.#wheel = { t: event.timeStamp, axis };
    if (axis === 'y' && !event.shiftKey) {
      time.zoomBy(Math.exp(clamp(dy, -600, 600) * tunables.timeWheelRate));
      return;
    }
    const along = axis === 'x' && dx !== 0 ? dx : dy;
    time.pan(along / (this.#layout.rulePx / time.spanDays));
  }
}

// ---------------------------------------------------------------- words

/** The plaque's year: BCE before 1 CE, CE after. */
function plateYear(year: number): string {
  return year <= 0 ? `${groupDigits(1 - year)} BCE` : `${year} CE`;
}

/** A day as the Date slider says it: '18 June 1815 CE'. */
function spokenDay(day: number): string {
  const { year, month, day: date } = HISTORICAL.civil(day);
  return `${date} ${monthName(month)} ${plateYear(year)}`;
}

/** The glass's days, as the Date slider adds them: '1805 to 1825'. */
function glassWords(time: ExploreTime): string {
  const { start, end } = nowWindow({ day: time.day, spanDays: time.spanDays });
  const [a, b] = [
    HISTORICAL.civil(Math.max(time.bounds.start, start)),
    HISTORICAL.civil(Math.min(time.bounds.end, end)),
  ];
  const yearText = (y: number) => (y <= 0 ? `${groupDigits(1 - y)} BCE` : String(y));
  if (time.spanDays / 10 >= 2 * YEAR_DAYS) return `${yearText(a.year)} to ${yearText(b.year)}`;
  if (time.spanDays / 10 >= 60)
    return `${monthName(a.month)} ${yearText(a.year)} to ${monthName(b.month)} ${yearText(b.year)}`;
  return `${a.day} ${monthName(a.month)} to ${b.day} ${monthName(b.month)} ${yearText(b.year)}`;
}

/** Two significant figures, grouped: 200, 5,000, 1,200, 2.5. */
function twoFigures(n: number): string {
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1);
  const rounded = Math.round(n / magnitude) * magnitude;
  return rounded >= 1000
    ? Math.round(rounded).toLocaleString('en-US')
    : String(Number(rounded.toPrecision(2)));
}

/** How much the tape shows, as the counter reads it: ['200', 'YEARS'], or ['200', 'YRS'] short. */
export function spanWords(span: number, short: boolean): [string, string] {
  const years = span / YEAR_DAYS;
  const months = span / (YEAR_DAYS / 12);
  const [n, unit] =
    years >= 0.97
      ? [twoFigures(years), short ? 'YRS' : 'YEARS']
      : months >= 0.97
        ? [twoFigures(months), short ? 'MOS' : 'MONTHS']
        : [twoFigures(span), 'DAYS'];
  if (n !== '1') return [n, unit];
  const one: Record<string, string> = {
    YEARS: 'YEAR',
    YRS: 'YR',
    MONTHS: 'MONTH',
    MOS: 'MO',
    DAYS: 'DAY',
  };
  return [n, one[unit] ?? unit];
}

// ---------------------------------------------------------------- brass

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Text engraved at (x, y): the lit lip of the cut, then the cut. */
function engravedText(x: number, y: number, className: string, text: string): string {
  const t = escapeText(text);
  return (
    `<text x="${x + 0.6}" y="${y + 0.9}" text-anchor="middle" class="${className} rc-cut-lip">${t}</text>` +
    `<text x="${x}" y="${y}" text-anchor="middle" class="${className} rc-cut">${t}</text>`
  );
}

/** A garnet lozenge at `angle`, `dr` above the beaded rule. */
function lozenge(arc: Arc, angle: number, dr: number, s: number): string {
  const [x, y] = at(arc, angle, dr);
  return (
    `<path class="xr-lozenge" d="M${f(x)} ${f(y - s)}L${f(x + s * 0.8)} ${f(y)}L${f(x)} ${f(y + s)}L${f(x - s * 0.8)} ${f(y)}Z" ` +
    `fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.5"/>`
  );
}

/** The ruler's own gradients and patterns, beside the brass's shared ones. */
function ownDefs(): string {
  return `<defs>
<linearGradient id="xr-dark-fill" x1="0" x2="0.3" y1="0" y2="1">
  <stop offset="0" stop-color="#4a3519"/><stop offset="0.5" stop-color="#2e2010"/><stop offset="1" stop-color="#1b1208"/>
</linearGradient>
<radialGradient id="xr-knurl-fill" r="0.5">
  <stop offset="0.8" stop-color="#8a6630"/><stop offset="0.93" stop-color="#c9a15c"/><stop offset="1" stop-color="#5a3f1a"/>
</radialGradient>
<linearGradient id="xr-glass-fill" x1="0" x2="0.25" y1="0" y2="1">
  <stop offset="0" stop-color="rgb(255 246 222 / 0.26)"/><stop offset="0.45" stop-color="rgb(255 246 222 / 0.1)"/>
  <stop offset="1" stop-color="rgb(255 246 222 / 0.05)"/>
</linearGradient>
<pattern id="xr-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(40)">
  <rect width="6" height="6" fill="rgb(24 13 3 / 0.42)"/>
  <path d="M0 0V6" stroke="rgb(20 10 2 / 0.5)" stroke-width="1.4"/>
  <path d="M1.6 0V6" stroke="rgb(255 226 170 / 0.12)" stroke-width="0.6"/>
</pattern>
${brassFilter('xr-lit-reel', { bevel: 2, relief: 3.5, texture: '0.08', amount: 0.08, bloom: 0.4, patina: 0.15 })}
</defs>`;
}

/**
 * The stock: its shadow, the overview's dark bronze, the beaded rule between the scales, the tape's
 * band and its lit lip, their edge rules, the reels' sockets and the tape's end brackets' seats.
 */
function bodySvg(layout: Layout): string {
  const { arc, reelR } = layout;
  const [a0, a1] = [-arc.end, arc.end];
  const rules =
    along(arc, -arc.reach - 0.004, arc.reach + 0.004, TAPE_TOP - 2.5) +
    along(arc, -arc.reach - 0.004, arc.reach + 0.004, 2.5);
  const beads = along(arc, a0, a1, 0.2);
  const sockets = [-1, 1]
    .map((side) => {
      const [x, y] = at(arc, side * arc.end, TAPE_MID);
      return `<circle cx="${f(x + 2)}" cy="${f(y + 4)}" r="${f(reelR + 3)}"/>`;
    })
    .join('');
  return `${sharedDefs()}${ownDefs()}
<g fill="#000" filter="url(#rc-soft)">
  <path d="${sector(arc, a0, a1, -OVD - 2, LIP_TOP + 3)}" opacity="0.55" transform="translate(2 5)"/>
  <g opacity="0.7">${sockets}</g>
</g>
<path d="${sector(arc, a0 - 0.004, a1 + 0.004, -OVD, 0)}" fill="url(#rc-base-fill)" filter="url(#rc-lit-base)"/>
<path d="${sector(arc, a0, a1, 0, 1)}" fill="#120a03"/>
<path d="${sector(arc, a0, a1, 1, TAPE_TOP)}" fill="url(#rc-band-fill)" filter="url(#rc-lit-band)"/>
<path d="${sector(arc, a0, a1, TAPE_TOP - 0.5, LIP_TOP)}" fill="url(#rc-lip-fill)" filter="url(#rc-lit-lip)"/>
<path d="${along(arc, a0, a1, TAPE_TOP)}" fill="none" stroke="rgb(40 25 8 / 0.55)" stroke-width="0.8"/>
<g fill="none" stroke-linecap="round">
  <path d="${rules}" stroke="rgb(255 238 196 / 0.38)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
  <path d="${rules}" stroke="rgb(43 28 12 / 0.7)" stroke-width="0.7"/>
  <path d="${beads}" stroke="rgb(0 0 0 / 0.6)" stroke-width="2.2" stroke-dasharray="0 5" transform="translate(0.4 0.8)"/>
  <path d="${beads}" stroke="rgb(236 200 132 / 0.75)" stroke-width="1.6" stroke-dasharray="0 5"/>
</g>`;
}

/**
 * The overview's gilt engraving, which changes only with the view's size: history's ends and each
 * millennium, 1 CE's double rule, the centuries and decades where they have room, and its names.
 */
function overviewSvg(layout: Layout, time: ExploreTime): string {
  const { arc, ovLen, narrow } = layout;
  const angleOf = (day: number) => (2 * time.warp.u(day) - 1) * arc.reach;
  let ticks = '';
  const widths = new Map<number, string>();
  for (const tick of overviewTicks(time.warp, time.extent, ovLen)) {
    const a = angleOf(tick.day);
    if (tick.kind === 'era') {
      const e = 1.1 / arc.r;
      const d = radial(arc, a - e, -1, -1 - tick.length) + radial(arc, a + e, -1, -1 - tick.length);
      widths.set(0.7, (widths.get(0.7) ?? '') + d);
      continue;
    }
    const d = radial(arc, a, -1, -1 - tick.length);
    widths.set(tick.width, (widths.get(tick.width) ?? '') + d);
  }
  for (const [width, d] of widths) ticks += `<path d="${d}" stroke-width="${width}"/>`;
  const charPx = narrow ? 6.2 : NAME_CHAR_PX;
  let names = '';
  for (const name of overviewNames(time.warp, time.extent, ovLen, HISTORICAL, charPx)) {
    const shift = name.anchor === 'start' ? 3 : name.anchor === 'end' ? -3 : 0;
    const a = angleOf(name.day) + shift / (arc.r - OVD);
    const [x, y] = at(arc, a, -OVD + 6.5);
    names += `<text text-anchor="${name.anchor}" transform="translate(${f(x)} ${f(y)}) rotate(${f(deg(a), 2)})">${escapeText(name.text)}</text>`;
  }
  return (
    `<g class="xr-ov-shadow" transform="translate(0.5 0.8)">${ticks}${names}</g>` +
    `<g class="xr-ov-gilt">${ticks}${names}</g>`
  );
}

/**
 * What moves over the stock with the date: the lens on the overview over the tape's days, its
 * hairline at the date, the return point, the bookmark on the overview's top edge, the rider's
 * hairline, and the tape's end brackets, the lens's twins.
 */
function liveSvg(
  layout: Layout,
  time: ExploreTime,
  pin: number | null,
  riderU: number | null,
): string {
  const { arc, ovLen } = layout;
  const { u0, u1, u } = lensExtent(time.warp, time.day, time.spanDays, ovLen);
  const aOf = (v: number) => (2 * v - 1) * arc.reach;
  const [aL, aR, aC] = [aOf(u0), aOf(u1), aOf(u)];
  const bracket = (a: number, dir: 1 | -1, inner: number, outer: number, foot: number) => {
    const e = (dir * foot) / arc.r;
    const [x0, y0] = at(arc, a + e, outer);
    const [x1, y1] = at(arc, a, outer);
    const [x2, y2] = at(arc, a, inner);
    const [x3, y3] = at(arc, a + e, inner);
    return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}`;
  };
  const lensBrackets = bracket(aL, 1, -OVD + 1.5, -1.2, 4) + bracket(aR, -1, -OVD + 1.5, -1.2, 4);
  const tapeBrackets =
    bracket(-arc.reach, 1, 2, TAPE_TOP - 1, 5) + bracket(arc.reach, -1, 2, TAPE_TOP - 1, 5);
  let out =
    `<path class="xr-lens" d="${sector(arc, aL, aR, -OVD + 0.6, -0.6)}"/>` +
    `<path class="xr-lens-rule" d="${along(arc, aL, aR, -1.4)}"/>` +
    `<g class="xr-brackets"><path class="xr-bracket-shadow" d="${lensBrackets}${tapeBrackets}" transform="translate(0.5 0.8)"/>` +
    `<path class="xr-bracket" d="${lensBrackets}${tapeBrackets}"/></g>` +
    `<path class="xr-lens-hair" d="${radial(arc, aC, -1.6, -OVD + 2.5)}"/>`;
  const [dx, dy] = at(arc, aC, -OVD + 2.6);
  out += `<circle class="xr-lens-dot" cx="${f(dx)}" cy="${f(dy)}" r="1.5"/>`;
  const back = time.returnDay;
  if (back !== null) {
    const [x, y] = at(arc, aOf(time.warp.u(back)), -OVD / 2);
    out += `<g class="xr-return"><circle cx="${f(x)}" cy="${f(y)}" r="3.6"/><circle class="xr-return-core" cx="${f(x)}" cy="${f(y)}" r="1"/></g>`;
  }
  if (pin !== null)
    out += `<g class="xr-bookmark">${lozenge(arc, aOf(time.warp.u(pin)), -1.8, 3)}</g>`;
  if (riderU !== null)
    out += `<path class="xr-rider-hair" d="${radial(arc, aOf(riderU), -1, -OVD + 1)}"/>`;
  return out;
}

/**
 * The glass fixed at the crown over the now window, a tenth of the tape: a pale pane whose fine
 * gilt edges are held by small brass clips on the lip and a riveted clip at the tape's foot, a
 * blued hairline down through the tape, and the garnet jewel in its beaded bezel on the lip.
 */
function glassSvg(layout: Layout): string {
  const { arc, glass: g } = layout;
  let out = `<path d="${sector(arc, -g, g, 1, TAPE_TOP)}" fill="url(#xr-glass-fill)"/>`;
  out += `<path d="${along(arc, -g, g, TAPE_TOP - 2.2)}" stroke="rgb(255 250 235 / 0.5)" stroke-width="1" fill="none"/>`;
  for (const side of [-1, 1]) {
    const a = side * g;
    out += `<path d="${radial(arc, a, 1, TAPE_TOP)}" stroke="rgb(20 12 4 / 0.55)" stroke-width="1.6"/>`;
    out += `<path d="${radial(arc, a, 1, TAPE_TOP)}" stroke="rgb(255 226 170 / 0.85)" stroke-width="0.7"/>`;
    const w = 2.8 / arc.r;
    out += `<path d="${sector(arc, a - w, a + w, TAPE_TOP - 2, LIP_TOP + 1.5)}" fill="url(#rc-frame-fill)" stroke="#1a1006" stroke-width="0.7" filter="url(#rc-lit-plate)"/>`;
    out += `<path d="${sector(arc, a - w * 1.2, a + w * 1.2, -2.5, 3.5)}" fill="url(#rc-frame-fill)" stroke="#1a1006" stroke-width="0.7" filter="url(#rc-lit-plate)"/>`;
    const [rx, ry] = at(arc, a, 0.5);
    out += `<circle cx="${f(rx)}" cy="${f(ry)}" r="1.25" fill="url(#rc-bezel)" stroke="#1a1006" stroke-width="0.4"/>`;
  }
  const [x0, y0] = at(arc, 0, JEWEL_AT - 5);
  const [x1, y1] = at(arc, 0, 1.2);
  out +=
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="#000" stroke-opacity="0.45" stroke-width="1.8" transform="translate(0.7 1)"/>` +
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="url(#rc-steel)" stroke-width="1.2"/>` +
    `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="#7f9ccc" stroke-width="0.4" opacity="0.8"/>`;
  const [jx, jy] = at(arc, 0, JEWEL_AT);
  out += `<g transform="translate(${f(jx)} ${f(jy)})">
<circle r="10" fill="url(#rc-garnet-glow)"/>
<circle r="6.6" fill="#1c1208" opacity="0.6" transform="translate(0.8 1.2)"/>
<circle r="${JEWEL_R}" fill="url(#rc-bezel)" stroke="#2a1a0a" stroke-width="0.7"/>
<circle r="5.1" fill="none" stroke="rgb(40 25 8 / 0.6)" stroke-width="1" stroke-dasharray="0.8 1.1"/>
<circle r="4.2" fill="url(#rc-garnet)" stroke="#2a0710" stroke-width="0.5"/>
<ellipse cx="-1.5" cy="-1.8" rx="1.5" ry="0.85" fill="#fff6f0" opacity="0.9" transform="rotate(-38 -1.5 -1.8)"/>
</g>`;
  return out;
}

/** A reel's face over its turning knurl: bezel, domed face, hub, and the lamp's sheen. */
function reelFaceSvg(r: number): string {
  const face = r * 0.64;
  return `<circle r="${f(r - 2.3)}" fill="#1a1007"/>
<circle r="${f(r - 2.8)}" fill="url(#rc-bezel)" filter="url(#rc-lit-teeth)"/>
<circle r="${f(face + 0.6)}" fill="#24170a"/>
<circle r="${f(face)}" fill="url(#rc-face-fill)" filter="url(#xr-lit-reel)"/>
<circle r="${f(face * 0.62)}" fill="none" stroke="rgb(60 40 15 / 0.28)" stroke-width="0.5"/>
<circle r="${f(r * 0.2)}" fill="#1a1007"/><circle r="${f(r * 0.13)}" fill="url(#rc-bezel)"/>
<ellipse cx="${f(-face * 0.3)}" cy="${f(-face * 0.36)}" rx="${f(face * 0.44)}" ry="${f(face * 0.24)}" fill="rgb(255 238 200 / 0.26)" transform="rotate(-40 ${f(-face * 0.3)} ${f(-face * 0.36)})"/>
<path d="M${f(-r * 0.9)} ${f(-r * 0.2)}A${f(r * 0.92)} ${f(r * 0.92)} 0 0 1 ${f(-r * 0.2)} ${f(-r * 0.9)}" stroke="rgb(255 236 190 / 0.32)" stroke-width="${f(r * 0.1)}" fill="none" stroke-linecap="round"/>`;
}

/** The plaque: a dark bronze frame round a raised face of bright brass, over its tab. */
function plateSvg(w: number, h: number): string {
  return `<path d="${cartouche(2, 4, w, h, 6, TAB)}" fill="#000" opacity="0.7" filter="url(#rc-soft)"/>
<path d="${cartouche(0, 0, w, h, 6, TAB)}" fill="url(#rc-frame-fill)" stroke="#160d05" stroke-width="1" filter="url(#rc-lit-plate)"/>
<path d="${cartouche(3, 3, w - 6, h - 6, 4.5, 0)}" fill="#1c1208"/>
<path class="xr-plate-face" d="${cartouche(3.5, 3.5, w - 7, h - 7, 4, 0)}" fill="url(#rc-plate-fill)" filter="url(#rc-lit-plate)"/>
<path class="xr-plate-inset" d="${cartouche(4.5, 4.5, w - 9, h - 9, 3.5, 0)}" fill="#150d06"/>
<path class="xr-plate-rule" d="${cartouche(6.5, 6.5, w - 13, h - 13, 2.5, 0)}" fill="none" stroke="rgb(255 244 210 / 0.5)" stroke-width="0.7" transform="translate(0.5 0.8)"/>
<path class="xr-plate-rule" d="${cartouche(6.5, 6.5, w - 13, h - 13, 2.5, 0)}" fill="none" stroke="rgb(58 38 14 / 0.6)" stroke-width="0.7"/>`;
}

/** The canvas's vignette laid over the stock, so its ends darken as the view's do. */
function finishSvg(layout: Layout): string {
  const { arc } = layout;
  const vh = innerHeight;
  const stops: string[] = [];
  for (let k = 0; k <= 10; k += 1) {
    const r = LENS.from + ((LENS.to - LENS.from) * k) / 10;
    const dark = 1 - vignetteAt(r);
    stops.push(
      `<stop offset="${(r / LENS.to).toFixed(3)}" stop-color="#000" stop-opacity="${dark.toFixed(3)}"/>`,
    );
  }
  return `<defs><radialGradient id="xr-vignette" gradientUnits="userSpaceOnUse" cx="${f(arc.cx)}" cy="${f(RULER_H - vh / 2)}" r="${f(LENS.to * vh)}">${stops.join('')}</radialGradient></defs>
<path d="${sector(arc, -arc.end - 1 / arc.r, arc.end + 1 / arc.r, -OVD, LIP_TOP)}" fill="url(#xr-vignette)"/>`;
}

/** The canvas's vignette as a brightness, `r` view heights from the view's center. */
function vignetteAt(r: number): number {
  const t = Math.min(1, Math.max(0, (r - LENS.from) / (LENS.to - LENS.from)));
  const v = 1 - t * t * (3 - 2 * t);
  return 1 - VIGNETTE + VIGNETTE * v;
}

/** The vignette's brightness at a point of the ruler's box, for a part's --shade. */
function shadeAt(x: number, y: number): string {
  const vy = innerHeight - RULER_H + y;
  const r = Math.hypot((x - innerWidth / 2) / innerHeight, vy / innerHeight - 0.5);
  return vignetteAt(r).toFixed(2);
}

function setShade(element: HTMLElement, shade: string): void {
  if (element.style.getPropertyValue('--shade') !== shade)
    element.style.setProperty('--shade', shade);
}
