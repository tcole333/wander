// Explore's labels (spec section 3; globe-language.md, principle 8): the globe explains nothing
// unasked, and a label confirms what the visitor noticed. Pointing at a mark for `hoverQueue`
// brings a vellum plate beside it with the event's name and date, and for a child the event it is
// part of (plateText.ts); a hollow parent also draws its extent's ring. A click (a press that moves
// under CLICK_PX) pins the event's plate, with its source, and makes the event focal, its ember
// the one that blooms; a click on bare metal, Escape while the pinned plate stands in view, or the
// now window leaving the event unpins it, and Escape with no pinned plate in view is the lobby's
// again. The dive lands with its opening pinned, its written line on its plate.
//
// The keyboard reaches the same marks, once the dive has landed, through one tab stop: a listbox,
// hidden from sight, whose options are the worker's labels for the events marked in view. Its
// active option shows its plate as a hover does, or rings the pinned plate when it is the pinned
// event's; the arrow keys move to the nearest mark that way on screen (and do not pan the view),
// and Enter pins it. While the listbox has the focus a small plate at the top names it, so the
// focus is seen even with no mark in view. A live region reads each pinned plate.
//
// At most two plates stand, the pinned one and the hovered one, each on the first side of its mark
// that stays in view and clear of the other plate, the panels (the ruler, Meanwhile, the legend
// and the page's mark and sound knob), the listbox's name while it shows and the focal ember
// (platePlacement.ts), taking each mark, as the arrow keys do, where the relief may lift it on
// screen (MarkLayer.span). Plates, options and the live region are set in the label family
// (story/ui/fonts.ts), loaded whole before the room opens.
import './labels.css';
import { tunables } from '../config/tunables';
import type { EventDescription } from '../events/describe';
import type { EventMark } from '../events/query';
import type { MarkSpan, PlacedMark } from '../marks/marks';
import { EMBER_RING } from '../marks/marks.glsl';
import type { Precision } from '../story/dates';
import { el } from '../story/ui/dom';
import { EVENTS_LIST, PART_OF } from './copy';
import { markIdOf, markQid, qidNumber, type EventLabel, type FocalEvent } from './exploreEvents';
import type { Opening } from './openings';
import { placePlate, type Box, type PlateAnchor, type Side } from './platePlacement';
import {
  describedText,
  eventDate,
  eventName,
  openingText,
  pinnedText,
  precisionOf,
  spoken,
  type PinnedText,
  type PlateText,
} from './plateText';

/** A press that moves less than this, CSS px, is a click rather than a drag. */
export const CLICK_PX = 4;
/** How far a plate stands from its mark's edge, CSS px. */
const GAP_PX = 8;
/** How often the panels the plates avoid are measured again, ms. */
const MEASURE_MS = 500;

/** What the labels need of Explore's events (exploreEvents.ts). */
export interface LabelEvents {
  placed(): PlacedMark[];
  event(id: string): EventMark | null | undefined;
  hit(x: number, y: number): string | null;
  /** Where the mark with this id may stand on screen, the relief lifting it, or null. */
  span(id: string): MarkSpan | null;
  hover(id: string | null): void;
  readonly focal: FocalEvent | null;
  focus(focal: FocalEvent | null): void;
  labels(): readonly EventLabel[];
  description(row: number): EventDescription | undefined;
}

export interface LabelsParts {
  events: LabelEvents;
  /** The globe's canvas, whose marks the pointer hovers and clicks. */
  canvas: HTMLElement;
  /** The openings, whose lines their pinned plates carry. */
  openings: readonly Opening[];
  /** The panels the plates keep clear of, and the page's chrome, measured as they stand. */
  panels: () => readonly Element[];
  /** The view's size, CSS px. */
  view?: () => { width: number; height: number };
}

type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const ARROWS: Record<ArrowKey, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The mark nearest `from` the way an arrow key points, on screen: of those within 45 degrees of
 * that way, else of all ahead of it, the one nearest along it, a step aside counting twice. Null
 * when none lies that way.
 */
export function nearestToward(
  from: { x: number; y: number },
  marks: readonly { id: string; x: number; y: number }[],
  key: ArrowKey,
): string | null {
  const [dx, dy] = ARROWS[key];
  let best: { id: string; inCone: boolean; cost: number } | null = null;
  for (const mark of marks) {
    const along = (mark.x - from.x) * dx + (mark.y - from.y) * dy;
    if (along <= 0) continue;
    const aside = Math.abs((mark.x - from.x) * dy - (mark.y - from.y) * dx);
    const inCone = aside <= along;
    const cost = along + 2 * aside;
    if (!best || (inCone && !best.inCone) || (inCone === best.inCone && cost < best.cost)) {
      best = { id: mark.id, inCone, cost };
    }
  }
  return best?.id ?? null;
}

/** A plate: its element, its words as last set, its size and its side. */
class Plate {
  readonly element: HTMLElement;
  side: Side | null = null;
  box: Box | null = null;
  #key = '';
  #size = { width: 0, height: 0 };
  #at = '';

  constructor(pinned: boolean) {
    this.element = el('div', pinned ? 'xl-plate is-pinned' : 'xl-plate');
    // A hovered plate repeats what its option or mark gives; a pinned one is read, its link reached.
    if (!pinned) this.element.setAttribute('aria-hidden', 'true');
  }

  get shown(): boolean {
    return this.element.classList.contains('is-shown');
  }

  /** Its words; its size is measured again when they change, and its side chosen afresh. */
  set(text: PlateText & { line?: string; source?: PinnedText['source'] }): void {
    const key = JSON.stringify(text);
    if (key === this.#key) return;
    this.#key = key;
    this.side = null;
    const parts: HTMLElement[] = [];
    if (text.line) parts.push(el('p', 'xl-line', text.line));
    parts.push(el('p', 'xl-name', text.name), el('p', 'xl-date', text.date));
    if (text.parent) {
      // A caption over the parent's name, which the index labels without an article.
      const parent = el('p', 'xl-parent');
      parent.append(el('span', 'xl-part-of', PART_OF), el('span', 'xl-parent-name', text.parent));
      parts.push(parent);
    }
    if (text.source) {
      const link = el('a', 'xl-source', text.source.title);
      link.href = text.source.url;
      link.target = '_blank';
      link.rel = 'noopener';
      parts.push(link);
    }
    this.element.replaceChildren(...parts);
    this.#size = { width: this.element.offsetWidth, height: this.element.offsetHeight };
  }

  get size(): { width: number; height: number } {
    return this.#size;
  }

  /** Stands the plate at `box`, on `side` of its mark. */
  show(side: Side, box: Box): void {
    this.side = side;
    this.box = box;
    const at = `${box.left.toFixed(1)}px ${box.top.toFixed(1)}px`;
    if (at !== this.#at) {
      this.#at = at;
      this.element.style.setProperty('translate', at);
    }
    this.element.setAttribute('data-side', side);
    this.element.classList.add('is-shown');
  }

  hide(): void {
    this.box = null;
    this.element.classList.remove('is-shown');
  }
}

/** An option: its mark and where the mark stands. */
interface Option {
  id: string;
  x: number;
  y: number;
  element: HTMLElement;
}

export class ExploreLabels {
  /** The listbox, the live region and the plates: first in Explore's layer. */
  readonly element = el('div', 'xl');
  readonly #events: LabelEvents;
  readonly #canvas: HTMLElement;
  readonly #openings: ReadonlyMap<number, Opening>;
  readonly #panels: () => readonly Element[];
  readonly #view: () => { width: number; height: number };
  readonly #listeners = new AbortController();
  readonly #list = el('div', 'xl-list');
  /** The listbox's name, shown while it has the focus. */
  readonly #caption = el('div', 'xl-focus', EVENTS_LIST);
  readonly #live = el('div', 'xl-live');
  readonly #pinPlate = new Plate(true);
  readonly #hoverPlate = new Plate(false);
  /** The pointer over the canvas, CSS px, or null. */
  #pointer: { x: number; y: number } | null = null;
  /** Where a press on the canvas began, and with which button, while it lasts. */
  #press: { x: number; y: number; button: number } | null = null;
  /** The mark under the pointer, and since when, for hoverQueue. */
  #candidate: string | null = null;
  #since = 0;
  #hovered: string | null = null;
  /** The event pinned, by its Q number. */
  #pinned: number | null = null;
  /** A pin not yet read out: its plate's words go to the live region once known. */
  #unread = false;
  #options: Option[] = [];
  /** The options' marks and words as last listed, in the worker's order. */
  #listed: { ids: readonly string[]; texts: readonly string[] } = { ids: [], texts: [] };
  /** Each worker label's option words, kept with the label, which each answer makes anew. */
  readonly #optionTexts = new WeakMap<EventLabel, string>();
  /** The active option's mark, while the listbox has the focus. */
  #active: string | null = null;
  #listFocused = false;
  #panelBoxes: Box[] = [];
  #captionBox: Box | null = null;
  #measuredMs = -Infinity;
  #landed = false;
  #left = false;

  constructor({ events, canvas, openings, panels, view = windowSize }: LabelsParts) {
    this.#events = events;
    this.#canvas = canvas;
    this.#openings = new Map(openings.map((opening) => [qidNumber(opening.qid), opening]));
    this.#panels = panels;
    this.#view = view;
    this.#list.setAttribute('role', 'listbox');
    this.#list.setAttribute('aria-label', EVENTS_LIST);
    // Out of the tab order until the dive lands, so no key pins an event while the dive flies.
    this.#list.tabIndex = -1;
    this.#live.setAttribute('aria-live', 'polite');
    // The listbox's own name gives it to screen readers.
    this.#caption.setAttribute('aria-hidden', 'true');
    this.element.append(
      this.#list,
      this.#live,
      this.#caption,
      this.#hoverPlate.element,
      this.#pinPlate.element,
    );
    this.#listen();
  }

  /** The events' listbox, the keyboard's way to the marks. */
  get listbox(): HTMLElement {
    return this.#list;
  }

  /** The event pinned, by its Q number, or null. */
  get pinned(): number | null {
    return this.#pinned;
  }

  /** The mark hovered, by the pointer or the keyboard, or null. */
  get hovered(): string | null {
    return this.#hovered;
  }

  /**
   * The dive has landed: the marks can be pointed at from now on, and the opening, if given, is
   * pinned, its line on its plate.
   */
  land(opening: Pick<Opening, 'qid'> | null): void {
    this.#landed = true;
    this.#list.tabIndex = 0;
    if (opening) this.#pinQid(qidNumber(opening.qid));
  }

  /** Pins the event of the mark with this id, making it focal. */
  pin(id: string): void {
    const mark = this.#events.event(id);
    if (mark === undefined) return;
    // A mark the lock draws is the focal opening's already.
    if (mark === null) this.#pinQid(markQid(id));
    else this.pinEvent(mark.qid, { t0: mark.t0, t1: mark.t1 });
  }

  /** Pins the event with Q number `qid`, over `span`, making it focal: a Meanwhile entry's. */
  pinEvent(qid: number, span: { t0: number; t1: number }): void {
    if (this.#left) return;
    if (this.#events.focal?.qid !== qid) this.#events.focus({ qid, span });
    this.#pinQid(qid);
  }

  /** Unpins the pinned event, which is focal no more. */
  unpin(): void {
    const qid = this.#pinned;
    if (qid === null) return;
    this.#pinned = null;
    this.#unread = false;
    if (this.#events.focal?.qid === qid) this.#events.focus(null);
  }

  /** Every frame, once the marks are placed: hover, options and plates, at `nowMs`. */
  update(nowMs: number): void {
    if (this.#left) return;
    // The focal event dropped (the now window left it), or another took its place.
    if (this.#pinned !== null && this.#events.focal?.qid !== this.#pinned) {
      this.#pinned = null;
      this.#unread = false;
    }
    const placed = new Map(this.#events.placed().map((mark) => [mark.id, mark]));
    this.#syncOptions(placed);
    this.#hover(nowMs);
    if (nowMs - this.#measuredMs >= MEASURE_MS) this.#measure(nowMs);
    this.#placePlates(placed);
  }

  /** Stops picking: the plates go, and nothing is hovered. */
  leave(): void {
    this.#left = true;
    this.#listeners.abort();
    this.#events.hover(null);
    this.#hovered = null;
    this.#canvas.classList.remove('is-over-mark');
    this.#caption.classList.remove('is-shown');
    this.#pinPlate.hide();
    this.#hoverPlate.hide();
  }

  dispose(): void {
    this.leave();
    this.element.remove();
  }

  #pinQid(qid: number): void {
    if (this.#left) return;
    this.#pinned = qid;
    this.#unread = true;
  }

  #listen(): void {
    const { signal } = this.#listeners;
    const canvas = this.#canvas;
    canvas.addEventListener(
      'pointermove',
      (event) => {
        this.#pointer = { x: event.clientX, y: event.clientY };
        // No button is down, whatever became of the press.
        if (event.buttons === 0) this.#press = null;
      },
      { signal },
    );
    canvas.addEventListener('pointerleave', () => (this.#pointer = null), { signal });
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        this.#pointer = { x: event.clientX, y: event.clientY };
        this.#press = { x: event.clientX, y: event.clientY, button: event.button };
      },
      { signal },
    );
    canvas.addEventListener(
      'pointerup',
      (event) => {
        const press = this.#press;
        this.#press = null;
        if (!press || press.button !== 0 || !this.#landed || event.button !== 0) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_PX) return;
        const id = this.#events.hit(event.clientX, event.clientY);
        if (id) this.pin(id);
        else this.unpin();
      },
      { signal },
    );
    canvas.addEventListener('pointercancel', () => (this.#press = null), { signal });
    // A press the canvas does not see end (a button the view does not capture, let go off the
    // canvas, or the window losing the focus mid-press) ends all the same; the canvas's own
    // pointerup hears it first.
    const release = () => (this.#press = null);
    addEventListener('pointerup', release, { signal });
    addEventListener('pointercancel', release, { signal });
    addEventListener('blur', release, { signal });
    // Before the lobby's own, on the window: a pinned plate in view takes the first Escape. One
    // panned out of view, or not yet described, leaves it to the lobby, so Escape never seems to
    // do nothing.
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (this.#pinned === null || !this.#pinPlate.shown) return;
        this.unpin();
        event.preventDefault();
      },
      { signal },
    );
    const list = this.#list;
    list.addEventListener(
      'focus',
      () => {
        this.#listFocused = true;
        this.#caption.classList.add('is-shown');
        this.#sortOptions();
        this.#activate(this.#firstActive());
      },
      { signal },
    );
    list.addEventListener(
      'blur',
      () => {
        this.#listFocused = false;
        this.#caption.classList.remove('is-shown');
        this.#activate(null);
      },
      { signal },
    );
    list.addEventListener('keydown', (event) => this.#key(event), { signal });
  }

  /** The listbox's keys: arrows move to the nearest mark that way, Home and End, Enter pins. */
  #key(event: KeyboardEvent): void {
    if (!this.#landed || event.metaKey || event.ctrlKey || event.altKey) return;
    const options = this.#options;
    const active = options.find((option) => option.id === this.#active);
    let next: string | null | undefined;
    if (event.key in ARROWS) {
      const marks = options.map((option) => ({ id: option.id, ...this.#drawnAt(option) }));
      const from = marks.find((mark) => mark.id === active?.id) ?? this.#center();
      next = nearestToward(from, marks, event.key as ArrowKey) ?? active?.id ?? null;
    } else if (event.key === 'Home') next = options[0]?.id ?? null;
    else if (event.key === 'End') next = options.at(-1)?.id ?? null;
    else if (event.key === 'Enter') {
      if (this.#active) this.pin(this.#active);
      next = undefined;
    } else return;
    // The arrow keys stay here: they do not reach the view's control and pan the globe.
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) this.#activate(next);
  }

  #center(): { x: number; y: number } {
    const { width, height } = this.#view();
    return { x: width / 2, y: height / 2 };
  }

  /**
   * Where an option's mark is drawn, as near as it is known: halfway along the way the relief may
   * lift it, which over land in a tilted view can stand well above its sea-level place.
   */
  #drawnAt(option: Option): { x: number; y: number } {
    const span = this.#events.span(option.id);
    if (!span) return { x: option.x, y: option.y };
    return { x: (span.x0 + span.x1) / 2, y: (span.y0 + span.y1) / 2 };
  }

  /** The option the listbox starts on: the pinned event's, else the one nearest the center. */
  #firstActive(): string | null {
    const pinned = this.#options.find((option) => markQid(option.id) === this.#pinned);
    if (pinned) return pinned.id;
    const center = this.#center();
    let best: { id: string; d: number } | undefined;
    for (const option of this.#options) {
      const { x, y } = this.#drawnAt(option);
      const d = Math.hypot(x - center.x, y - center.y);
      if (!best || d < best.d) best = { id: option.id, d };
    }
    return best?.id ?? null;
  }

  #activate(id: string | null): void {
    this.#active = id;
    for (const option of this.#options) {
      option.element.setAttribute('aria-selected', String(option.id === id));
    }
    const option = this.#options.find((o) => o.id === id);
    if (option) this.#list.setAttribute('aria-activedescendant', option.element.id);
    else this.#list.removeAttribute('aria-activedescendant');
  }

  /**
   * The listbox's options: the worker's labels for the events marked in view, and the focal
   * event's while the lock draws it or it stands solid where the labels name its hollow mark. Only
   * a change in the events or their words lists them anew, left to right; while the same events
   * stand, their marks' places follow the globe, and their order is set again only as the listbox
   * takes the focus.
   */
  #syncOptions(placed: ReadonlyMap<string, PlacedMark>): void {
    const ids: string[] = [];
    const texts: string[] = [];
    for (const label of this.#events.labels()) {
      if (!label.anchorVisible || label.fade.to !== 1) continue;
      const id = markIdOf(label.qid, label.context);
      if (!placed.has(id) || ids.includes(id)) continue;
      ids.push(id);
      texts.push(this.#optionText(label));
    }
    const focal = this.#events.focal;
    const focalId = focal ? markIdOf(focal.qid) : null;
    if (focal && focalId !== null && placed.has(focalId) && !ids.includes(focalId)) {
      // Named as the worker labels it, a war pinned while split by its hollow mark's label, which
      // the keyboard may pin before the worker has described it; else as its plate names it.
      const label = this.#events.labels().find((label) => label.qid === focal.qid);
      const words = label ? null : this.#textOf(focalId);
      const text = label ? this.#optionText(label) : words && `${words.name}, ${words.date}`;
      if (text) {
        ids.push(focalId);
        texts.push(text);
      }
    }
    if (sameList(ids, this.#listed.ids) && sameList(texts, this.#listed.texts)) {
      // The same options, their marks moved with the globe.
      for (const option of this.#options) {
        const mark = placed.get(option.id);
        if (mark) [option.x, option.y] = [mark.x, mark.y];
      }
      return;
    }
    this.#listed = { ids, texts };
    const was = this.#options.find((option) => option.id === this.#active);
    this.#options = ids.map((id, i) => {
      const element = el('div', 'xl-option', texts[i]);
      element.id = `xl-${id.replace('/', '-')}`;
      element.setAttribute('role', 'option');
      const mark = placed.get(id);
      return { id, x: mark?.x ?? 0, y: mark?.y ?? 0, element };
    });
    this.#sortOptions();
    if (!this.#listFocused) return;
    // The active mark went: its event's other mark takes its place, as a war pinned while split
    // turns solid, else the option nearest where it stood.
    const stays = this.#options.some((option) => option.id === this.#active);
    let next = stays ? this.#active : null;
    if (next === null && was) {
      const qid = markQid(was.id);
      next = this.#options.find((option) => markQid(option.id) === qid)?.id ?? null;
    }
    if (next === null && was) {
      let best = Infinity;
      for (const option of this.#options) {
        const d = Math.hypot(option.x - was.x, option.y - was.y);
        if (d < best) [next, best] = [option.id, d];
      }
    }
    this.#activate(next);
  }

  /** An option's words for a worker's label: as its plate names and dates it. */
  #optionText(label: EventLabel): string {
    const known = this.#optionTexts.get(label);
    if (known !== undefined) return known;
    const opening = this.#openings.get(label.qid);
    const { name, date } =
      opening && finer(opening.precision, precisionOf(label.prec))
        ? openingText(opening)
        : { name: eventName(label.text), date: eventDate(label.t0, label.t1, label.prec) };
    const text = `${name}, ${date}`;
    this.#optionTexts.set(label, text);
    return text;
  }

  /** The options left to right as their marks stand now, in the listbox's order. */
  #sortOptions(): void {
    this.#options.sort((a, b) => a.x - b.x || a.y - b.y);
    this.#list.replaceChildren(...this.#options.map((option) => option.element));
  }

  /**
   * The mark hovered: the active option's at once, else the pointer's after hoverQueue; none while
   * a press drags the globe. The pointer's mark alone takes the pointing cursor.
   */
  #hover(nowMs: number): void {
    const pointed =
      this.#landed && this.#pointer && !this.#press
        ? this.#events.hit(this.#pointer.x, this.#pointer.y)
        : null;
    this.#canvas.classList.toggle('is-over-mark', pointed !== null);
    const keyed = this.#landed && this.#listFocused ? this.#active : null;
    const target = keyed ?? pointed;
    if (target !== this.#candidate) {
      this.#candidate = target;
      this.#since = nowMs;
    }
    const rested = keyed !== null || nowMs - this.#since >= tunables.hoverQueue;
    const hovered = target !== null && rested ? target : null;
    if (hovered === this.#hovered) return;
    this.#hovered = hovered;
    this.#events.hover(hovered);
  }

  /**
   * A plate's words for the mark with this id, as far as they are known: as the worker describes
   * the event, but for an opening its lock dates more finely than the index (Krakatoa's day, where
   * the index knows its year), whose name and date the lock gives, with the event it is part of
   * once the worker has said.
   */
  #textOf(id: string): PlateText | null {
    const mark = this.#events.event(id);
    if (mark === undefined) return null;
    const described = mark === null ? undefined : this.#events.description(mark.row);
    const opening = this.#openings.get(markQid(id));
    if (described && (!opening || !finer(opening.precision, precisionOf(described.prec)))) {
      return describedText(described);
    }
    if (!opening) return null;
    const parent = described?.parent;
    return { ...openingText(opening), ...(parent ? { parent: eventName(parent) } : {}) };
  }

  /** The pinned event's mark as drawn: its solid one, else its hollow one. */
  #pinnedMark(placed: ReadonlyMap<string, PlacedMark>): PlacedMark | undefined {
    const qid = this.#pinned;
    if (qid === null) return undefined;
    return placed.get(markIdOf(qid)) ?? placed.get(markIdOf(qid, true));
  }

  #placePlates(placed: ReadonlyMap<string, PlacedMark>): void {
    const view = this.#view();
    const focal = this.#events.focal;
    const focalMark = focal ? placed.get(markIdOf(focal.qid)) : undefined;
    // Each mark as far as the relief may lift it: a plate stands clear of all the way.
    const spans = new Map<PlacedMark, MarkSpan>();
    const spanOf = (mark: PlacedMark): MarkSpan => {
      let span = spans.get(mark);
      if (!span) {
        span = this.#events.span(mark.id) ?? { x0: mark.x, y0: mark.y, x1: mark.x, y1: mark.y };
        spans.set(mark, span);
      }
      return span;
    };
    const ember = (mark: PlacedMark): Box => {
      const { x0, y0, x1, y1 } = spanOf(mark);
      const reach = (EMBER_RING.radius + EMBER_RING.half) * mark.rPx + 2;
      return {
        left: Math.min(x0, x1) - reach,
        right: Math.max(x0, x1) + reach,
        top: Math.min(y0, y1) - reach,
        bottom: Math.max(y0, y1) + reach,
      };
    };
    const anchor = (mark: PlacedMark): PlateAnchor => {
      const { x0, y0, x1, y1 } = spanOf(mark);
      return {
        x: x0,
        y: y0,
        lift: { x: x1, y: y1 },
        gap: (mark === focalMark ? EMBER_RING.radius + EMBER_RING.half : 1) * mark.rPx + GAP_PX,
      };
    };
    const avoid = (own: PlacedMark, other: Box | null): Box[] => [
      ...this.#panelBoxes,
      ...(this.#listFocused && this.#captionBox ? [this.#captionBox] : []),
      ...(focalMark && focalMark !== own ? [ember(focalMark)] : []),
      ...(other ? [other] : []),
    ];

    const qid = this.#pinned;
    const pinnedMark = this.#pinnedMark(placed);
    const words = qid !== null && pinnedMark ? this.#textOf(pinnedMark.id) : null;
    if (qid !== null && pinnedMark && words) {
      const text = pinnedText(words, qid, this.#openings.get(qid));
      this.#pinPlate.set(text);
      const { side, box } = placePlate(
        anchor(pinnedMark),
        this.#pinPlate.size,
        this.#pinPlate.side,
        avoid(pinnedMark, null),
        view,
      );
      this.#pinPlate.show(side, box);
      if (this.#unread) {
        this.#unread = false;
        this.#live.textContent = spoken(text);
      }
    } else this.#pinPlate.hide();
    // The keyboard's option is the pinned event's: its plate takes the focus's ring.
    const active = this.#listFocused ? this.#active : null;
    this.#pinPlate.element.classList.toggle(
      'is-active',
      this.#pinPlate.shown && active !== null && markQid(active) === qid,
    );

    const hovered = this.#hovered;
    const hoveredMark = hovered === null ? undefined : placed.get(hovered);
    const hoverText =
      hovered !== null && hoveredMark && markQid(hovered) !== this.#pinned
        ? this.#textOf(hovered)
        : null;
    if (hoveredMark && hoverText) {
      this.#hoverPlate.set(hoverText);
      const { side, box } = placePlate(
        anchor(hoveredMark),
        this.#hoverPlate.size,
        this.#hoverPlate.side,
        avoid(hoveredMark, this.#pinPlate.box),
        view,
      );
      this.#hoverPlate.show(side, box);
      this.#hoverPlate.element.classList.toggle('is-active', hovered === this.#active);
    } else this.#hoverPlate.hide();
  }

  /** The panels' boxes, and the listbox's name's, as they stand now. */
  #measure(nowMs: number): void {
    this.#measuredMs = nowMs;
    this.#panelBoxes = this.#panels().map(boxOf);
    this.#captionBox = boxOf(this.#caption);
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Whether a date known at precision `a` is known more finely than at `b`. */
function finer(a: Precision, b: Precision): boolean {
  const rank = { year: 0, month: 1, day: 2 } as const;
  return rank[a] > rank[b];
}

function boxOf(element: Element): Box {
  const { left = 0, top = 0, right = 0, bottom = 0 } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

function windowSize(): { width: number; height: number } {
  return { width: innerWidth, height: innerHeight };
}
