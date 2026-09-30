// Main-thread fetch and frame-loop boundary. One transferred page and one query are in flight at
// once; a Meanwhile query and a description request each have a slot of their own. onmessage only
// queues replies; drain() performs state changes on the caller's frame.
import { tunables, type Tier } from '../config/tunables';
import type { EventsRelease } from '../data/release';
import { fetchData } from '../data/surfaceLayer';
import { withinHistory } from '../time/exploreTime';
import type { EventDescription } from './describe';
// Bundled into the entry and started from a Blob URL, so a dive fetches nothing from Pages
// (streaming.md 2). The dev server serves it as a module worker instead.
import InlineEventWorker from './event.worker.ts?worker&inline';
import type { MeanwhileQuery } from './meanwhile';
import type { EventQuery } from './query';
import type { PagePlan } from './residency';
import type { EventReply, EventRequest } from './runtime';
import type { EventView } from './view';

/** Descriptions kept on the main thread, least recently used out first, until dispose(). */
export const DESCRIPTION_ROWS = 256;

export interface EventWorker {
  postMessage(message: EventRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<EventReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
type Arrival = EventReply | { type: 'fetched'; key: string; buf: ArrayBuffer };
type FetchBytes = (url: string, stillWanted: () => boolean) => Promise<ArrayBuffer>;

const sameList = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameView = (a: EventView, b: EventView) =>
  a.width === b.width &&
  a.height === b.height &&
  sameList(a.camera, b.camera) &&
  sameList(a.matrix, b.matrix);

/** Q numbers ascending and without repeats, so two sets compare element by element. */
const qidSet = (qids: readonly number[]) => [...new Set(qids)].sort((a, b) => a - b);

/**
 * A question's dates within history, so the worker marks and picks nothing after 2000 or before
 * 10,000 BCE.
 */
function inHistory<Q extends { t0: number; t1: number }>(query: Q): Q {
  const { start, end } = withinHistory({ start: query.t0, end: query.t1 });
  return { ...query, t0: start, t1: end };
}

/** Two Meanwhile questions, their Q number lists made by qidSet, ask the same thing. */
function sameMeanwhile(a: MeanwhileQuery, b: MeanwhileQuery | undefined): boolean {
  return (
    !!b &&
    a.t0 === b.t0 &&
    a.t1 === b.t1 &&
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.count === b.count &&
    sameView(a.view, b.view) &&
    sameList(a.exclude, b.exclude) &&
    sameList(a.focalQids, b.focalQids)
  );
}

/**
 * Owns the event worker and fetches its pages through the main-thread data fetcher.
 * Queue the latest camera/ruler state with query(), then call drain(rAFTime) in the frame loop.
 * onready wakes that loop; replies become visible only through drain(). Results carry increasing
 * sent-query generations, so continuous scrubbing still receives the latest completed work.
 *
 * Query t0/t1 are inclusive, possibly fractional, proleptic Gregorian day numbers since
 * 0001-01-01, with astronomical years (1 BCE is year 0), as in story/dates.ts. The clock chooses
 * the visitor's range, which the client keeps within history (time/exploreTime.ts, HISTORY) for
 * events and Meanwhile alike; the index retains all its dates. Tier is 'lite' or 'full';
 * focalQids are numeric Wikidata Q numbers. EventView defines the camera and CSS-pixel coordinate
 * conventions.
 *
 * Result replies contain markers, labels, parent outlines and missingFocal Q numbers. Draw
 * anchors only when anchorVisible; clip outline geometry independently. Interpolate each item's
 * fade with fadeOpacity(fade, rAFTime) between replies, and stop drawing completed exits. State
 * replies expose classes and page readiness/array bytes; errors name the failed file or request.
 * retry() admits failed files again. dispose() terminates the worker and discards late arrivals.
 *
 * meanwhile() stands Meanwhile's question for the now window, sent once it has stood unchanged
 * for meanwhileRest; 'meanwhile' replies carry the picks. description(row) answers from a cache
 * of DESCRIPTION_ROWS rows, or asks the worker on the next drain(), whose 'described' reply says
 * the answer has arrived. A partial description, made before the row's parent was resident, is
 * asked again once a page loads and answers until the new one arrives.
 */
export class EventClient {
  readonly #worker: EventWorker;
  readonly #release: EventsRelease;
  readonly #host: string;
  readonly #fetch: FetchBytes;
  #ready: Arrival[] = [];
  #plan: PagePlan | undefined;
  #latest: EventQuery | undefined;
  #generation = 0;
  #lastDelivered = 0;
  #dirty = false;
  #inFlight: number | undefined;
  #lastSent = -Infinity;
  #lastDrain: number | undefined;
  #loading: string | undefined;
  #failed = new Set<string>();
  #disposed = false;
  #fatal = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The standing Meanwhile question, and the drain time it was first seen. */
  #meanwhile: { query: MeanwhileQuery; since?: number } | undefined;
  #meanwhileSent: MeanwhileQuery | undefined;
  #meanwhileGeneration = 0;
  #meanwhileDelivered = 0;
  #meanwhileInFlight: number | undefined;
  /** Insertion order is recency: the first key is the least recently used. */
  #descriptions = new Map<number, EventDescription>();
  #describeWanted = new Set<number>();
  #describing = new Set<number>();
  /** Rows no resident page held when asked; asked again once another page loads. */
  #undescribed = new Set<number>();
  /** Cached rows described before their parent was resident; asked again once a page loads. */
  #partial = new Set<number>();
  /** Wakes the frame loop. Replies and fetched bytes stay queued until drain(). */
  onready: (() => void) | null = null;

  constructor(
    worker: EventWorker,
    release: EventsRelease,
    dataHost: string,
    { tier = 'full', fetchBytes = fetchData }: { tier?: Tier; fetchBytes?: FetchBytes } = {},
  ) {
    this.#worker = worker;
    this.#release = release;
    this.#host = dataHost.replace(/\/$/, '');
    this.#fetch = fetchBytes;
    worker.onmessage = (event) => this.#arrive(event.data);
    worker.onerror = (event) =>
      this.#arrive({ type: 'error', message: event.message || 'event worker failed' });
    worker.postMessage({ type: 'init', release, tier }, []);
  }
  /** Starts a worker of its own; dispose() ends it. Explore makes one per dive. */
  static create(release: EventsRelease, dataHost: string, tier: Tier = 'full'): EventClient {
    return new EventClient(new InlineEventWorker({ name: 'events' }), release, dataHost, { tier });
  }
  /** Coalesce to the newest desired view. A generation is assigned when drain() sends it. */
  query(query: EventQuery): void {
    this.#latest = inHistory(query);
    this.#dirty = true;
    this.onready?.();
  }
  /**
   * Stand a Meanwhile question, as often as every frame. drain() sends it once the same question
   * has stood for meanwhileRest (the clock and view at rest), one in flight at a time; a page
   * loading afterwards asks it again. Replies older than the last delivered are dropped.
   * `exclude` and `focalQids` are sets: their order and repeats do not change the question.
   */
  meanwhile(query: MeanwhileQuery): void {
    if (this.#disposed) return;
    const asked = {
      ...inHistory(query),
      exclude: qidSet(query.exclude),
      focalQids: qidSet(query.focalQids),
    };
    if (this.#meanwhile && sameMeanwhile(asked, this.#meanwhile.query)) return;
    const { view } = query;
    this.#meanwhile = {
      query: {
        ...asked,
        center: [...query.center],
        view: { ...view, matrix: [...view.matrix], camera: [...view.camera] },
      },
    };
    this.onready?.();
  }
  /** The row's label, parent label and dates when cached; otherwise the next drain() asks. */
  description(row: number): EventDescription | undefined {
    const cached = this.#descriptions.get(row);
    if (cached) {
      this.#remember(cached);
      return cached;
    }
    if (
      !this.#disposed &&
      !this.#describeWanted.has(row) &&
      !this.#describing.has(row) &&
      !this.#undescribed.has(row)
    ) {
      this.#describeWanted.add(row);
      this.onready?.();
    }
    return undefined;
  }
  /** Call from rAF with performance.now(). State replies expose readiness, classes and array bytes. */
  drain(now: number): EventReply[] {
    if (this.#disposed) return [];
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const ready = this.#ready;
    this.#ready = [];
    const replies: EventReply[] = [];
    for (const reply of ready) {
      if (reply.type === 'fetched') {
        if (this.#plan?.needs.includes(reply.key)) {
          this.#worker.postMessage({ type: 'load', key: reply.key, buf: reply.buf }, [reply.buf]);
        } else this.#loading = undefined;
        continue;
      }
      if (reply.type === 'error') {
        if (reply.key) {
          this.#failed.add(reply.key);
          this.#loading = undefined;
        } else if (reply.request === 'query') {
          if (reply.generation === this.#inFlight) this.#inFlight = undefined;
        } else if (reply.request === 'meanwhile') {
          if (reply.generation === this.#meanwhileInFlight) this.#meanwhileInFlight = undefined;
        } else if (reply.request === 'describe') {
          this.#describing.clear();
        } else {
          this.#fatal = true;
          this.#worker.terminate();
        }
        replies.push(reply);
        continue;
      }
      if (reply.type === 'described') {
        this.#describing.clear();
        for (const event of reply.events) this.#remember(event);
        for (const row of reply.missing) this.#undescribed.add(row);
        replies.push(reply);
        continue;
      }
      if (reply.type === 'meanwhile') {
        if (reply.generation === this.#meanwhileInFlight) this.#meanwhileInFlight = undefined;
        if (reply.generation <= this.#meanwhileDelivered) continue;
        this.#meanwhileDelivered = reply.generation;
        for (const event of reply.events) this.#remember(event);
        replies.push(reply);
        continue;
      }
      if (reply.type === 'result' && reply.generation <= this.#lastDelivered) continue;
      this.#plan = reply.plan;
      if (reply.type === 'state') {
        if (reply.loaded) {
          this.#loading = undefined;
          this.#dirty = !!this.#latest;
          this.#meanwhileSent = undefined;
          this.#undescribed.clear();
          // The cached answer stands until the new one arrives, so a plate does not blink.
          for (const row of this.#partial)
            if (!this.#describing.has(row)) this.#describeWanted.add(row);
        }
        replies.push(reply);
      } else {
        if (reply.generation === this.#inFlight) this.#inFlight = undefined;
        this.#lastDelivered = reply.generation;
        replies.push(reply);
      }
    }
    if (this.#fatal) return replies;
    const interval = 1000 / tunables.eventQueryHz;
    // Round dispatch to the nearest frame instead of slipping a frame on rAF's fractional ms.
    const slack = Math.min(interval, Math.max(0, now - (this.#lastDrain ?? now))) / 2;
    this.#lastDrain = now;
    if (
      this.#dirty &&
      this.#latest &&
      this.#inFlight === undefined &&
      now - this.#lastSent >= interval - slack
    ) {
      this.#inFlight = ++this.#generation;
      this.#lastSent = now;
      this.#dirty = false;
      this.#worker.postMessage(
        { type: 'query', query: this.#latest, generation: this.#inFlight, now },
        [],
      );
    }
    // Wait for the overview decode before the rest; wait for an outstanding query's new page plan.
    if (!this.#loading && this.#plan && this.#inFlight === undefined) {
      const overviewReady = this.#plan.resident.includes(this.#release.overview);
      const key = this.#plan.needs.find(
        (k) => !this.#failed.has(k) && (overviewReady || k === this.#release.overview),
      );
      if (key) {
        this.#loading = key;
        const wanted = () => !this.#disposed && !!this.#plan?.needs.includes(key);
        void this.#fetch(`${this.#host}/${key}`, wanted).then(
          (buf) => this.#arrive({ type: 'fetched', key, buf }),
          (error: unknown) => this.#arrive({ type: 'error', key, message: String(error) }),
        );
      }
    }
    // Every row asked for since the last request, in one message.
    if (this.#describeWanted.size > 0 && this.#describing.size === 0) {
      const rows = [...this.#describeWanted];
      this.#describeWanted.clear();
      for (const row of rows) this.#describing.add(row);
      this.#worker.postMessage({ type: 'describe', rows }, []);
    }
    let wake = Infinity;
    const standing = this.#meanwhile;
    if (standing && !sameMeanwhile(standing.query, this.#meanwhileSent)) {
      standing.since ??= now;
      const rest = standing.since + tunables.meanwhileRest - now;
      if (rest > 0) wake = rest;
      else if (this.#meanwhileInFlight === undefined) {
        this.#meanwhileInFlight = ++this.#meanwhileGeneration;
        this.#meanwhileSent = standing.query;
        this.#worker.postMessage(
          { type: 'meanwhile', generation: this.#meanwhileInFlight, ...standing.query },
          [],
        );
      }
    }
    if (this.#dirty && this.#inFlight === undefined)
      wake = Math.min(wake, Math.max(0, interval - (now - this.#lastSent)));
    if (wake < Infinity) this.#timer = setTimeout(() => this.onready?.(), wake);
    return replies;
  }
  /**
   * Nothing is on its way: no query waits to be sent or answered, no reply waits for drain(), and
   * no page the plan needs is loading or waiting to load, but those that failed. A script's
   * renders wait for it.
   */
  idle(): boolean {
    return (
      !this.#disposed &&
      !this.#dirty &&
      this.#inFlight === undefined &&
      this.#loading === undefined &&
      this.#ready.length === 0 &&
      !this.#plan?.needs.some((key) => !this.#failed.has(key))
    );
  }
  retry(): void {
    this.#failed.clear();
    this.onready?.();
  }
  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#worker.onmessage = null;
    this.#worker.onerror = null;
    this.#worker.terminate();
    this.#ready = [];
    this.#latest = undefined;
    this.#plan = undefined;
    this.#meanwhile = undefined;
    this.#meanwhileSent = undefined;
    this.#descriptions.clear();
    this.#describeWanted.clear();
    this.#describing.clear();
    this.#undescribed.clear();
    this.#partial.clear();
    this.onready = null;
  }
  #remember(event: EventDescription): void {
    this.#descriptions.delete(event.row);
    this.#descriptions.set(event.row, event);
    this.#undescribed.delete(event.row);
    if (event.partial) this.#partial.add(event.row);
    else this.#partial.delete(event.row);
    if (this.#descriptions.size > DESCRIPTION_ROWS) {
      const oldest = this.#descriptions.keys().next().value!;
      this.#descriptions.delete(oldest);
      this.#partial.delete(oldest);
    }
  }
  #arrive(reply: Arrival): void {
    if (this.#disposed) return;
    this.#ready.push(reply);
    this.onready?.();
  }
}
