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

export class EventClient {
  readonly #worker: EventWorker;
  readonly #release: EventsRelease;
  readonly #host: string;
  readonly #fetch: FetchBytes;
  #ready: Arrival[] = [];
  #plan: PagePlan | undefined;
  #latest: { query: EventQuery; generation: number } | undefined;
  #generation = 0;
  #dirty = false;
  #inFlight: number | undefined;
  #lastSent = -Infinity;
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
  /** Queue the newest desired view; match its generation against result replies. */
  query(query: EventQuery): number {
    this.#latest = { query, generation: ++this.#generation };
    this.#dirty = true;
    this.onready?.();
    return this.#generation;
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
        if (reply.generation !== undefined) this.#inFlight = undefined;
        replies.push(reply);
        continue;
      }
      this.#plan = reply.plan;
      if (reply.type === 'state') {
        if (reply.loaded) {
          this.#loading = undefined;
          this.#dirty = !!this.#latest;
        }
        replies.push(reply);
      } else {
        this.#inFlight = undefined;
        if (reply.generation === this.#generation) replies.push(reply);
      }
    }
    if (this.#fatal) return replies;
    const interval = 1000 / tunables.eventQueryHz;
    if (
      this.#dirty &&
      this.#latest &&
      this.#inFlight === undefined &&
      now - this.#lastSent >= interval
    ) {
      this.#inFlight = this.#latest.generation;
      this.#lastSent = now;
      this.#dirty = false;
      this.#worker.postMessage({ type: 'query', ...this.#latest, now }, []);
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
