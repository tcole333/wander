// Explore's events on the globe (spec sections 2 and 9, task 7): each frame the event worker is
// asked, through the event client, for the events in the now window (time/worldClock.ts,
// nowWindow) that the view shows, and what it answers becomes marks the look cuts into its bronze
// (marks/marks.ts). An event's class gives its pace layer and glyph (marks/eventSymbols.ts), so
// its mark takes that family's material. Each mark fades in and out as the worker's fades say,
// interpolated every frame between replies. A war whose extent grows past the split on screen gives
// way to its battles and stays as a hollow glyph, its extent a ring once hovered, its solid mark
// and its hollow one crossfading as marks of their own; an event whose place is inherited or
// derived, or whose date is known only to its year, draws softer and half as deep
// (globe-language.md, principle 1). The focal event, the opening at first, keeps its ember until
// the now window leaves its dates, when it becomes one mark among the others; until the index
// holds it, the openings lock draws it. Leaving eases every mark out with the lobby's glows;
// disposing ends the worker and takes the marks off the globe.
import type { Tier } from '../config/tunables';
import type { EventClient } from '../events/client';
import { fadeOpacity, type EventMark, type EventResult, type Fading } from '../events/query';
import type { EventReply } from '../events/runtime';
import { eventViewOf, type EventView, type ViewFrame } from '../events/view';
import { GLOW_FADE_S } from '../lobby/lobby';
import { eventSymbol, mirroredAt } from '../marks/eventSymbols';
import type { MarkLayer, MarkSpec, PlacedMark } from '../marks/marks';
import type { MemoryAccount } from '../perf/memory';
import { dayFromHistorical, historicalCivil, type Precision } from '../story/dates';
import type { LonLat } from '../story/story';
import { nowWindow, type DayWindow, type WorldTime } from '../time/worldClock';

/** What Explore's events need of the event client. */
export type EventSource = Pick<EventClient, 'query' | 'drain' | 'idle' | 'dispose'>;

/** What Explore's events need of the look's marks. */
export type EventMarks = Pick<MarkLayer, 'set' | 'placed' | 'strength'>;

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
  /** The marks set, by id, with the events they stand for. */
  #shown = new Map<string, EventMark | null>();
  #specs: MarkSpec[] = [];
  /** Something changed since the marks were last set; or a fade moves, so they change each frame. */
  #changed = true;
  #fading = false;
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

    const window = nowWindow(time);
    const focal = this.#focal;
    if (focal?.span && !inWindow(focal.span, window)) {
      this.#focal = null;
      this.#changed = true;
    }
    if (!this.#left) {
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

  /** Nothing is on its way from the worker and no mark is fading. */
  settled(): boolean {
    return this.#client.idle() && !this.#fading && !this.#changed;
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
        this.#result = reply.result;
        this.#resident = reply.plan.bytes;
        this.#changed = true;
        const focal = this.#focal;
        const found = focal && reply.result.markers.find((m) => m.qid === focal.qid);
        if (focal && found) this.#focal = { ...focal, span: { t0: found.t0, t1: found.t1 } };
        return;
      }
      case 'error':
        this.#report(reply.key ?? reply.request ?? 'worker', reply.message);
        return;
      default:
        return;
    }
  }

  /** The marks for the last result and the focal event, their fades at `nowMs`. */
  #draw(nowMs: number): void {
    const specs: MarkSpec[] = [];
    const shown = new Map<string, EventMark | null>();
    const focal = this.#focal;
    let fading = false;
    const add = (mark: Fading<EventMark>, hollow: boolean) => {
      const isFocal = !hollow && mark.qid === focal?.qid;
      const opacity = isFocal ? 1 : fadeOpacity(mark.fade, nowMs);
      if (opacity !== mark.fade.to && !isFocal) fading = true;
      if (opacity <= 0) return;
      const name = this.#classes[mark.cls];
      const symbol = name === undefined ? undefined : eventSymbol(name);
      if (!symbol) {
        this.#report(`class ${mark.cls}`, `no mark for the class '${name ?? mark.cls}'`);
        return;
      }
      const id = markIdOf(mark.qid, hollow);
      specs.push({
        id,
        at: mark.at,
        glyph: symbol.glyph,
        mirror: mirroredAt(symbol.glyph, mark.at[1]),
        pace: symbol.pace,
        opacity,
        focal: isFocal,
        hollow,
        soft: isSoft(mark),
        ringRad: hollow ? ringRadOf(mark) : undefined,
        score: mark.score,
      });
      shown.set(id, mark);
    };
    const result = this.#result;
    for (const mark of result?.markers ?? []) add(mark, false);
    // The focal event stays a mark of its own when it is also a parent its children split.
    for (const mark of result?.outlines ?? []) if (mark.qid !== focal?.qid) add(mark, true);
    // Until the index holds the focal event, or when it fails, the lock draws it.
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
