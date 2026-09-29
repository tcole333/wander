// Main-thread fetch and frame-loop boundary. One transferred page and query are in flight at
// once. onmessage only queues replies; drain() performs state changes on the caller's frame.
import { tunables, type Tier } from '../config/tunables';
import type { EventsRelease } from '../data/release';
import { fetchData } from '../data/surfaceLayer';
import type { EventQuery } from './query';
import type { PagePlan } from './residency';
import type { EventReply, EventRequest } from './runtime';

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
 * replies expose classes and page readiness/array bytes; errors name the failed file. retry()
 * admits failed files again. dispose() terminates the worker and discards late arrivals.
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
  static create(release: EventsRelease, dataHost: string, tier: Tier = 'full'): EventClient {
    return new EventClient(
      new Worker(new URL('./event.worker.ts', import.meta.url), { type: 'module' }),
      release,
      dataHost,
      { tier },
    );
  }
  /** Coalesce to the newest desired view. A generation is assigned when drain() sends it. */
  query(query: EventQuery): void {
    this.#latest = query;
    this.#dirty = true;
    this.onready?.();
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
        } else if (reply.generation === undefined) {
          this.#fatal = true;
          this.#worker.terminate();
        }
        if (reply.generation === this.#inFlight) this.#inFlight = undefined;
        replies.push(reply);
        continue;
      }
      if (reply.type === 'result' && reply.generation <= this.#lastDelivered) continue;
      this.#plan = reply.plan;
      if (reply.type === 'state') {
        if (reply.loaded) {
          this.#loading = undefined;
          this.#dirty = !!this.#latest;
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
    this.onready = null;
  }
  #arrive(reply: Arrival): void {
    if (this.#disposed) return;
    this.#ready.push(reply);
    this.onready?.();
  }
}
