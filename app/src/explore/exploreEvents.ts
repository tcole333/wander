// Explore's events on the globe (spec sections 2 and 9, task 7): each frame the event worker is
// asked, through the event client, for the events in the now window, kept within history
// (time/exploreTime.ts, exploreWindow), that the view shows, and what it answers becomes marks the
// look cuts into its bronze (marks/marks.ts). An event's class gives its pace layer and glyph
// (marks/eventSymbols.ts), so its mark takes that family's material. Each mark fades in and out as
// the worker's fades say, interpolated every frame between replies. A war whose extent grows past
// the split on screen gives way to its battles and stays as a hollow glyph, its extent a ring once
// hovered, its solid mark and its hollow one crossfading as marks of their own; a hollow glyph
// gives way to a mark already standing on its spot, so parents sharing a borrowed place do not pile
// into one blot. An event whose place is inherited or derived, or whose date is known only to its
// year, draws softer and half as deep (globe-language.md, principle 1). The focal event, the
// opening at first, keeps its ember until the now window leaves its dates, when it becomes one mark
// among the others; until the index holds it, or once the worker has failed, the openings lock
// draws it. A failed worker logs once and its marks go. Leaving eases every mark out with the
// lobby's glows; disposing ends the worker and takes the marks off the globe.
//
// Explore's labels (labels.ts) pick the marks under the pointer, hover one (a hollow parent then
// draws its extent's ring), read the worker's labels and describe their events through here, and
// its Meanwhile (exploreMeanwhile.ts) asks the worker its question and reads the answer.
import { tunables, type Tier } from '../config/tunables';
import type { EventClient } from '../events/client';
import type { EventDescription } from '../events/describe';
import type { MeanwhileEvent, MeanwhileQuery } from '../events/meanwhile';
import { fadeOpacity, type EventMark, type EventResult, type Fading } from '../events/query';
import type { EventReply } from '../events/runtime';
import { eventViewOf, type EventView, type ViewFrame } from '../events/view';
import { GLOW_FADE_S } from '../lobby/lobby';
import { eventSymbol, mirroredAt } from '../marks/eventSymbols';
import type { MarkLayer, MarkSpan, MarkSpec, PlacedMark } from '../marks/marks';
import type { MemoryAccount } from '../perf/memory';
import { dayFromHistorical, historicalCivil, type Precision } from '../story/dates';
import type { LonLat } from '../story/story';
import { exploreWindow } from '../time/exploreTime';
import type { DayWindow, WorldTime } from '../time/worldClock';

/** What Explore's events need of the event client. */
export type EventSource = Pick<
  EventClient,
  'query' | 'drain' | 'idle' | 'dispose' | 'description' | 'meanwhile'
>;

/** What Explore's events need of the look's marks. */
export type EventMarks = Pick<MarkLayer, 'set' | 'placed' | 'strength' | 'hit' | 'span'>;

/** A label the worker gives, for an event marked in view. */
export type EventLabel = Fading<EventMark & { text: string }>;

/** The event the view attends to: its ember, and a time filter it bypasses until it drops. */
export interface FocalEvent {
  /** Its Wikidata Q number. */
  qid: number;
  /** Its inclusive day span, once known: the index's, else the lock's. */
  span?: { t0: number; t1: number };
  /** The lock's mark, drawn until the index holds the event. */
  lock?: { at: LonLat; cls: string; soft: boolean };
}

/** An opening as the lock gives it, for its focal event. */
export interface LockedFocal {
  qid: string;
  day: number;
  at: LonLat;
  precision: Precision;
  class: string;
}

export interface ExploreEventsParts {
  client: EventSource;
  marks: EventMarks;
  /** The event the dive opens on, or none. */
  focal?: FocalEvent | null;
  /** Arrived by flight, the marks fading in with the dive; otherwise at once. */
  arrive?: 'jump' | 'fly';
  tier?: Tier;
}

/** The .wev flags (3.4) of a place not the event's own: inherited from its location, or derived. */
const BORROWED_PLACE = 1 | 2;
/** Wikidata's precision of a date known to its year; a coarser one is smaller. */
const YEAR_PRECISION = 9;
/** The longest frame a fade steps over, seconds. */
const STEP_MAX_S = 0.1;
const DEG = Math.PI / 180;

/** What a hollow parent's mark id adds to its event's, so its solid mark can crossfade with it. */
const HOLLOW_ID = '/outline';
/** One mark's radius on screen, CSS px, until the look has placed one: the smallest scale's. */
const MARK_RADIUS_PX = Math.min(...tunables.markPx.map((row) => row.px)) / 2;

/**
 * A mark's id: its event's Q number, the same whether the index or the lock draws it, and a
 * suffix for a hollow parent's.
 */
export function markIdOf(qid: number, hollow = false): string {
  return `Q${qid}${hollow ? HOLLOW_ID : ''}`;
}

/** The Q number of the event a mark stands for, or NaN. */
export function markQid(id: string): number {
  return qidNumber(id.endsWith(HOLLOW_ID) ? id.slice(0, -HOLLOW_ID.length) : id);
}

/** The Q number in `Q…`, or NaN. */
export function qidNumber(qid: string): number {
  return /^Q[1-9][0-9]*$/.test(qid) ? Number(qid.slice(1)) : NaN;
}

/**
 * The opening as the focal event: its lock's mark and the days its date covers at its precision,
 * in the historical calendar the lock dates it in, until the index gives its own.
 */
export function focalOf(opening: LockedFocal): FocalEvent {
  const qid = qidNumber(opening.qid);
  if (!Number.isFinite(qid)) throw new RangeError(`no Q number '${opening.qid}'`);
  return {
    qid,
    span: spanOf(opening.day, opening.precision),
    lock: { at: opening.at, cls: opening.class, soft: opening.precision === 'year' },
  };
}

/** The inclusive days a date at `precision` covers, in the historical calendar. */
export function spanOf(day: number, precision: Precision): { t0: number; t1: number } {
  if (precision === 'day') return { t0: day, t1: day };
  const { year, month } = historicalCivil(day);
  if (precision === 'month') {
    const t0 = dayFromHistorical({ year, month, day: 1 });
    const next =
      month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
    return { t0, t1: dayFromHistorical(next) - 1 };
  }
  const t0 = dayFromHistorical({ year, month: 1, day: 1 });
  return { t0, t1: dayFromHistorical({ year: year + 1, month: 1, day: 1 }) - 1 };
}

/** Whether an event over `span` counts as now, by the query's own test. */
export function inWindow(span: { t0: number; t1: number }, window: DayWindow): boolean {
  return span.t0 <= window.end && span.t1 >= window.start;
}

/** An estimated place or a date known only to its year: drawn softer and half as deep. */
export function isSoft({ flags, prec }: Pick<EventMark, 'flags' | 'prec'>): boolean {
  return (flags & BORROWED_PLACE) !== 0 || prec <= YEAR_PRECISION;
}

/**
 * An extent's reach from its mark, radians of arc: the farthest of its corners and edges' middles,
 * for the dashed ring a hovered parent shows. Undefined without an extent.
 */
export function ringRadOf(mark: Pick<EventMark, 'at' | 'extent'>): number | undefined {
  if (!mark.extent) return undefined;
  const [w, s, e, n] = mark.extent;
  const [lon, lat] = mark.at;
  let most = 0;
  for (const x of [w, (w + e) / 2, e])
    for (const y of [s, (s + n) / 2, n]) most = Math.max(most, arc(lon, lat, x, y));
  return most > 0 ? most : undefined;
}

/** The great-circle arc between two places, radians. */
function arc(lon0: number, lat0: number, lon1: number, lat1: number): number {
  const a =
    Math.sin(((lat1 - lat0) * DEG) / 2) ** 2 +
    Math.cos(lat0 * DEG) * Math.cos(lat1 * DEG) * Math.sin(((lon1 - lon0) * DEG) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The query last asked: the now window, the view and the focal event. */
interface Asked {
  window: DayWindow;
  view: EventView;
  focal: number | null;
}

const sameAsked = (a: Asked | null, b: Asked) =>
  !!a &&
  a.window.start === b.window.start &&
  a.window.end === b.window.end &&
  a.focal === b.focal &&
  a.view.width === b.view.width &&
  a.view.height === b.view.height &&
  a.view.camera.every((v, i) => v === b.view.camera[i]) &&
  a.view.matrix.every((v, i) => v === b.view.matrix[i]);

export class ExploreEvents {
  readonly #client: EventSource;
  readonly #marks: EventMarks;
  readonly #tier: Tier;
  #focal: FocalEvent | null;
  #classes: readonly string[] = [];
  #result: EventResult | null = null;
  #asked: Asked | null = null;
  /** Worker bytes the index holds, as its last plan said. */
  #resident = 0;
  #strength: number;
  #lastMs: number | null = null;
  #left = false;
  #disposed = false;
  /** The worker has failed: nothing more is asked, and only the lock's focal mark is drawn. */
  #dead = false;
  /** The marks set, by id, with the events they stand for. */
  #shown = new Map<string, EventMark | null>();
  #specs: MarkSpec[] = [];
  /** Something changed since the marks were last set; or a fade moves, so they change each frame. */
  #changed = true;
  #fading = false;
  /** The mark the visitor points at or has chosen from the keyboard, drawn hovered. */
  #hovered: string | null = null;
  /** The worker's last Meanwhile answer. */
  #meanwhile: readonly MeanwhileEvent[] | null = null;
  readonly #reported = new Set<string>();

  constructor({ client, marks, focal = null, arrive = 'fly', tier = 'full' }: ExploreEventsParts) {
    this.#client = client;
    this.#marks = marks;
    this.#focal = focal;
    this.#tier = tier;
    this.#strength = arrive === 'fly' ? 0 : 1;
    marks.strength = this.#strength;
  }

  /** The focal event, or null once it has dropped. */
  get focal(): FocalEvent | null {
    return this.#focal;
  }

  /** Makes an event focal, or none. */
  focus(focal: FocalEvent | null): void {
    if (this.#disposed) return;
    this.#focal = focal;
    this.#changed = true;
  }

  /** The mark drawn hovered, or none. */
  get hovered(): string | null {
    return this.#hovered;
  }

  /** Draws the mark with this id hovered (a hollow parent's with its extent's ring), or none. */
  hover(id: string | null): void {
    if (this.#disposed || id === this.#hovered) return;
    this.#hovered = id;
    this.#changed = true;
  }

  /** The event's mark under CSS px (x, y), as the look last drew it, or null. */
  hit(x: number, y: number): string | null {
    const id = this.#marks.hit(x, y);
    return id !== null && this.#shown.has(id) ? id : null;
  }

  /** Where the event's mark with this id may stand on screen, the relief lifting it, or null. */
  span(id: string): MarkSpan | null {
    return this.#shown.has(id) ? this.#marks.span(id) : null;
  }

  /** The labels the worker last gave: the events it names in view, within the label budget. */
  labels(): readonly EventLabel[] {
    return this.#result?.labels ?? [];
  }

  /**
   * The event in `row` as the worker describes it, once it has answered; until then, undefined,
   * and the worker is asked.
   */
  description(row: number): EventDescription | undefined {
    return this.#disposed ? undefined : this.#client.description(row);
  }

  /** The Q numbers of the events marked, each once, though a crossfade marks a parent twice. */
  drawnQids(): number[] {
    return [...new Set([...this.#shown.keys()].map(markQid))];
  }

  /**
   * Stands Meanwhile's question for this frame; the client asks it once the clock and view have
   * rested (EventClient.meanwhile). Nothing is asked once Explore leaves or the worker has failed.
   */
  askMeanwhile(query: MeanwhileQuery): void {
    if (this.#left || this.#dead || this.#disposed) return;
    this.#client.meanwhile(query);
  }

  /** The worker's last Meanwhile answer, a new list with each answer; null before the first. */
  get meanwhile(): readonly MeanwhileEvent[] | null {
    return this.#meanwhile;
  }

  /**
   * Every frame, once the frame is placed: asks for the events the view shows in the now window,
   * takes the worker's replies, drops the focal event once the window has left it, and sets the
   * marks, their fades at `nowMs`.
   */
  update(frame: ViewFrame, time: WorldTime, nowMs: number): void {
    if (this.#disposed) return;
    const dtS = this.#lastMs === null ? 0 : Math.min(STEP_MAX_S, (nowMs - this.#lastMs) / 1000);
    this.#lastMs = nowMs;
    this.#strength = Math.max(
      0,
      Math.min(1, this.#strength + (this.#left ? -dtS : dtS) / GLOW_FADE_S),
    );
    this.#marks.strength = this.#strength;

    const window = exploreWindow(time);
    const focal = this.#focal;
    if (focal?.span && !inWindow(focal.span, window)) {
      this.#focal = null;
      this.#changed = true;
    }
    if (!this.#left && !this.#dead) {
      const asked: Asked = {
        window,
        view: eventViewOf(frame),
        focal: this.#focal?.qid ?? null,
      };
      if (!sameAsked(this.#asked, asked)) {
        this.#asked = asked;
        this.#client.query({
          t0: window.start,
          t1: window.end,
          view: asked.view,
          tier: this.#tier,
          focalQids: asked.focal === null ? [] : [asked.focal],
        });
      }
    }
    for (const reply of this.#client.drain(nowMs)) this.#take(reply);
    if (this.#changed || this.#fading) this.#draw(nowMs);
  }

  /** The events' marks the look drew in view in the last draw. */
  placed(): PlacedMark[] {
    return this.#marks.placed().filter((mark) => this.#shown.has(mark.id));
  }

  /** The events marked in view in the last draw, each once, though a crossfade draws it twice. */
  markedInView(): number {
    return new Set(this.placed().map((mark) => markQid(mark.id))).size;
  }

  /** The event a mark stands for, or null for one the lock draws; undefined for no mark set. */
  event(id: string): EventMark | null | undefined {
    return this.#shown.get(id);
  }

  /** The marks as last set, for scripts. */
  marks(): MarkSpec[] {
    return this.#specs;
  }

  /**
   * Nothing is on its way from the worker, Meanwhile's answer included, or it has failed, and no
   * mark is fading.
   */
  settled(): boolean {
    return (this.#dead || this.#client.idle()) && !this.#fading && !this.#changed;
  }

  /** Stops asking; the marks ease out with the lobby's glows. */
  leave(): void {
    this.#left = true;
  }

  /** Ends the worker and takes the marks off the globe. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#client.dispose();
    this.#marks.set('events', []);
    this.#marks.strength = 1;
    this.#shown.clear();
    this.#specs = [];
    this.#result = null;
    this.#resident = 0;
    this.#hovered = null;
    this.#meanwhile = null;
  }

  /** The index the worker holds for Explore, in its own heap. */
  inspectMemory(account: MemoryAccount): void {
    account.bytes('explore.events', 'arrayBuffers', this.#resident);
  }

  #take(reply: EventReply): void {
    switch (reply.type) {
      case 'state':
        if (reply.classes.length > 0 && reply.classes !== this.#classes) {
          this.#classes = reply.classes;
          this.#changed = true;
        }
        this.#resident = reply.plan.bytes;
        if (reply.plan.error) this.#report('plan', reply.plan.error);
        return;
      case 'result': {
        if (this.#dead) return;
        this.#result = reply.result;
        this.#resident = reply.plan.bytes;
        this.#changed = true;
        // Once the overview is resident, a window the index cap cannot hold asks for nothing to
        // load, so no state reply follows to say so.
        if (reply.plan.error) this.#report('plan', reply.plan.error);
        const focal = this.#focal;
        const found = focal && reply.result.markers.find((m) => m.qid === focal.qid);
        if (focal && found) this.#focal = { ...focal, span: { t0: found.t0, t1: found.t1 } };
        return;
      }
      case 'meanwhile':
        if (!this.#dead) this.#meanwhile = reply.events;
        return;
      case 'error':
        this.#report(reply.key ?? reply.request ?? 'worker', reply.message);
        // The worker itself failed, and the client asks it nothing more: its marks go, rather
        // than stand for another time as the clock moves on.
        if (reply.key === undefined && reply.request === undefined) {
          this.#dead = true;
          this.#result = null;
          this.#changed = true;
        }
        return;
      default:
        return;
    }
  }

  /**
   * The marks for the last result and the focal event, their fades at `nowMs`. A hollow parent
   * fades out as a mark of another event stands within one mark's radius of it on screen, the
   * highest-scored parent standing first.
   */
  #draw(nowMs: number): void {
    const specs: MarkSpec[] = [];
    const shown = new Map<string, EventMark | null>();
    const focal = this.#focal;
    let fading = false;
    /** Marks drawn with their anchors in view, and their opacities. */
    const standing: { mark: EventMark; opacity: number }[] = [];
    const radius = this.#marks.placed()[0]?.rPx ?? MARK_RADIUS_PX;
    /** Draws `mark` at its fade's opacity less `veil`'s share, and says what that came to. */
    const add = (mark: Fading<EventMark>, hollow: boolean, veil = 0): number => {
      const isFocal = !hollow && mark.qid === focal?.qid;
      const own = isFocal ? 1 : fadeOpacity(mark.fade, nowMs);
      if (own !== mark.fade.to && !isFocal) fading = true;
      const opacity = own * (1 - veil);
      if (opacity <= 0) return 0;
      const id = markIdOf(mark.qid, hollow);
      const name = this.#classes[mark.cls];
      const symbol = name === undefined ? undefined : eventSymbol(name);
      if (!symbol) {
        this.#report(`class ${mark.cls}`, `no mark for the class '${name ?? mark.cls}'`);
        return 0;
      }
      specs.push({
        id,
        at: mark.at,
        glyph: symbol.glyph,
        mirror: mirroredAt(symbol.glyph, mark.at[1]),
        pace: symbol.pace,
        opacity,
        focal: isFocal,
        hover: id === this.#hovered,
        hollow,
        soft: isSoft(mark),
        ringRad: hollow ? ringRadOf(mark) : undefined,
        score: mark.score,
      });
      shown.set(id, mark);
      if (mark.anchorVisible) standing.push({ mark, opacity });
      return opacity;
    };
    /** The most opaque mark of another event standing within one mark's radius of `mark`. */
    const veilOf = (mark: EventMark): number => {
      if (!mark.anchorVisible) return 0;
      let veil = 0;
      for (const other of standing)
        if (
          other.mark.qid !== mark.qid &&
          Math.hypot(other.mark.x - mark.x, other.mark.y - mark.y) <= radius
        )
          veil = Math.max(veil, other.opacity);
      return veil;
    };
    const result = this.#result;
    for (const mark of result?.markers ?? []) add(mark, false);
    // The focal event stays a mark of its own when it is also a parent its children split.
    const outlines = (result?.outlines ?? [])
      .filter((mark) => mark.qid !== focal?.qid)
      .sort((a, b) => b.score - a.score || a.row - b.row);
    for (const mark of outlines) add(mark, true, veilOf(mark));
    // Until the index holds the focal event, or when it or the worker fails, the lock draws it.
    const lock = focal?.lock;
    if (focal && lock && (!result || result.missingFocal.includes(focal.qid))) {
      const symbol = eventSymbol(lock.cls);
      if (symbol) {
        const id = markIdOf(focal.qid);
        specs.push({
          id,
          at: lock.at,
          glyph: symbol.glyph,
          mirror: mirroredAt(symbol.glyph, lock.at[1]),
          pace: symbol.pace,
          opacity: 1,
          focal: true,
          hover: id === this.#hovered,
          soft: lock.soft,
        });
        shown.set(id, null);
      } else this.#report(`class ${lock.cls}`, `no mark for the class '${lock.cls}'`);
    }
    this.#marks.set('events', specs);
    this.#specs = specs;
    this.#shown = shown;
    this.#changed = false;
    this.#fading = fading;
  }

  /** Logs a failure once: the marks it touches are not drawn. */
  #report(what: string, message: string): void {
    if (this.#reported.has(what)) return;
    this.#reported.add(what);
    console.warn(`Explore's events: ${what}: ${message}`);
  }
}
