// Main-thread fetch and frame-loop boundary. One transferred page and one query are in flight at
// once; a description request has a slot of its own. onmessage only queues replies; drain()
// performs state changes on the caller's frame.
import { tunables, type Tier } from '../config/tunables';
import type { EventsRelease } from '../data/release';
import { fetchData } from '../data/surfaceLayer';
import type { EventDescription } from './describe';
// Bundled into the entry and started from a Blob URL, so a dive fetches nothing from Pages
// (streaming.md 2). The dev server serves it as a module worker instead.
import InlineEventWorker from './event.worker.ts?worker&inline';
import type { EventQuery } from './query';
import type { PagePlan } from './residency';
import type { EventReply, EventRequest } from './runtime';

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

/**
 * Owns the event worker and fetches its pages through the main-thread data fetcher.
 * Queue the latest camera/ruler state with query(), then call drain(rAFTime) in the frame loop.
 * onready wakes that loop; replies become visible only through drain(). Results carry increasing
 * sent-query generations, so continuous scrubbing still receives the latest completed work.
 *
 * Query t0/t1 are inclusive, possibly fractional, proleptic Gregorian day numbers since
 * 0001-01-01, with astronomical years (1 BCE is year 0), as in story/dates.ts. The clock chooses
 * the visitor's range; the index retains all its dates. Tier is 'lite' or 'full'; focalQids are
 * numeric Wikidata Q numbers. EventView defines the camera and CSS-pixel coordinate conventions.
 *
 * Result replies contain markers, labels, parent outlines and missingFocal Q numbers. Draw
 * anchors only when anchorVisible; clip outline geometry independently. Interpolate each item's
 * fade with fadeOpacity(fade, rAFTime) between replies, and stop drawing completed exits. State
 * replies expose classes and page readiness/array bytes; errors name the failed file or request.
 * retry() admits failed files again. dispose() terminates the worker and discards late arrivals.
 *
 * description(row) answers from a cache of DESCRIPTION_ROWS rows, or asks the worker on the next
 * drain(), whose 'described' reply says the answer has arrived.
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
  /** Insertion order is recency: the first key is the least recently used. */
  #descriptions = new Map<number, EventDescription>();
  #describeWanted = new Set<number>();
  #describing = new Set<number>();
  /** Rows no resident page held when asked; asked again once another page loads. */
  #undescribed = new Set<number>();
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
    this.#latest = query;
    this.#dirty = true;
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
      if (reply.type === 'result' && reply.generation <= this.#lastDelivered) continue;
      this.#plan = reply.plan;
      if (reply.type === 'state') {
        if (reply.loaded) {
          this.#loading = undefined;
          this.#dirty = !!this.#latest;
          this.#undescribed.clear();
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
    if (this.#dirty && this.#inFlight === undefined) {
      this.#timer = setTimeout(
        () => this.onready?.(),
        Math.max(0, interval - (now - this.#lastSent)),
      );
    }
    return replies;
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
    this.#descriptions.clear();
    this.#describeWanted.clear();
    this.#describing.clear();
    this.#undescribed.clear();
    this.onready = null;
  }
  #remember(event: EventDescription): void {
    this.#descriptions.delete(event.row);
    this.#descriptions.set(event.row, event);
    this.#undescribed.delete(event.row);
    if (this.#descriptions.size > DESCRIPTION_ROWS)
      this.#descriptions.delete(this.#descriptions.keys().next().value!);
  }
  #arrive(reply: Arrival): void {
    if (this.#disposed) return;
    this.#ready.push(reply);
    this.onready?.();
  }
}
