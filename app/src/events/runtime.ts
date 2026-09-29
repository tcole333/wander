// Plain worker handler, also exercised directly by Vitest.
import type { EventsRelease } from '../data/release';
import type { Tier } from '../config/tunables';
import { describe, type EventDescription } from './describe';
import { decodePage } from './page';
import { EventQueryEngine, type EventQuery, type EventResult } from './query';
import { EventIndex, type PagePlan } from './residency';

export type EventRequest =
  | { type: 'init'; release: EventsRelease; tier: Tier }
  | { type: 'load'; key: string; buf: ArrayBuffer }
  | { type: 'query'; generation: number; query: EventQuery; now: number }
  | { type: 'describe'; rows: number[] };
export type EventReply =
  | { type: 'state'; plan: PagePlan; classes: string[]; loaded?: string }
  | { type: 'result'; generation: number; result: EventResult; plan: PagePlan }
  /** Rows no resident page holds come back as missing, not as an error. */
  | { type: 'described'; events: EventDescription[]; missing: number[] }
  /**
   * A failed file names its key; a failed query or description names its request (and a query its
   * generation). Any other error ends the worker.
   */
  | {
      type: 'error';
      message: string;
      key?: string;
      request?: 'query' | 'describe';
      generation?: number;
    };

export class EventRuntime {
  #index: EventIndex | undefined;
  #engine: EventQueryEngine | undefined;
  #window: EventQuery | undefined;
  #tier: Tier = 'full';
  async handle(request: EventRequest): Promise<EventReply> {
    try {
      if (request.type === 'init') {
        this.#tier = request.tier;
        this.#index = new EventIndex(request.release);
        this.#engine = new EventQueryEngine(this.#index);
        return { type: 'state', plan: this.#index.plan(undefined, this.#tier), classes: [] };
      }
      const index = this.#index;
      if (!index || !this.#engine) throw new Error('event worker has not been initialized');
      if (request.type === 'load') {
        const file = index.release.files.find((f) => f.key === request.key);
        if (!file) throw new Error(`event file is not in the release: ${request.key}`);
        if (index.accepts(request.key)) index.add(request.key, await decodePage(request.buf, file));
        return {
          type: 'state',
          loaded: request.key,
          classes: index.classes,
          plan: index.plan(this.#window, this.#window?.tier ?? this.#tier),
        };
      }
      if (request.type === 'describe') {
        const events: EventDescription[] = [];
        const missing: number[] = [];
        for (const row of request.rows) {
          const event = describe(index, row);
          if (event) events.push(event);
          else missing.push(row);
        }
        return { type: 'described', events, missing };
      }
      const result = this.#engine.query(request.query, request.now);
      this.#window = request.query;
      const plan = index.plan(request.query);
      return { type: 'result', generation: request.generation, result, plan };
    } catch (error) {
      return {
        type: 'error',
        message: String(error),
        ...(request.type === 'load' ? { key: request.key } : {}),
        ...(request.type === 'query' || request.type === 'describe'
          ? { request: request.type }
          : {}),
        ...(request.type === 'query' ? { generation: request.generation } : {}),
      };
    }
  }
}
