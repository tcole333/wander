import type { Tier } from '../config/tunables';
import type { EventFile, EventsRelease } from '../data/release';
import { findQid, findRow, type EventPage } from './page';

export const INDEX_BYTES: Record<Tier, number> = { lite: 16 * 1024 ** 2, full: 24 * 1024 ** 2 };
export interface Ref {
  page: EventPage;
  i: number;
}
export interface Window {
  t0: number;
  t1: number;
  tier: Tier;
}
export interface PagePlan {
  needs: string[];
  resident: string[];
  bytes: number;
  complete: boolean;
  /** A working set that cannot fit is explicit; no rows are thinned to meet the cap. */
  error?: string;
}

export class EventIndex {
  readonly pages = new Map<string, EventPage>();
  readonly release: EventsRelease;
  #wanted = new Set<string>();
  #required = new Set<string>();
  #clock = 0;
  #used = new Map<string, number>();
  #middle: number | undefined;
  #direction = 0;
  #cap = INDEX_BYTES.full;
  #error: string | undefined;

  constructor(release: EventsRelease) {
    this.release = release;
  }
  get bytes(): number {
    return [...this.pages.values()].reduce((n, p) => n + p.bytes, 0);
  }
  get classes(): string[] {
    return this.pages.get(this.release.overview)?.classes ?? [];
  }

  /** Plan once per query. Small corpora stay resident; large ones keep the window ±1 bin. */
  plan(window?: Window, tier: Tier = window?.tier ?? 'full'): PagePlan {
    this.#cap = INDEX_BYTES[tier];
    this.#error = undefined;
    const files = this.release.files.filter((f) => f.rows > 0 || f.key === this.release.overview);
    const required: EventFile[] = [];
    let prefetch: EventFile | undefined;
    const overview = files.find((f) => f.key === this.release.overview);
    if (!overview) throw new Error('events release has no overview metadata');
    required.push(overview);
    if (files.reduce((sum, f) => sum + f.decoded, 0) <= this.#cap) {
      required.push(...files.filter((f) => f !== overview));
    } else if (window) {
      const first = this.bin(window.t0),
        last = this.bin(window.t1);
      const middle = window.t0 + (window.t1 - window.t0) / 2;
      if (this.#middle !== undefined && middle !== this.#middle)
        this.#direction = Math.sign(middle - this.#middle);
      this.#middle = middle;
      const lo = Math.max(0, first - 1),
        hi = Math.min(23, last + 1);
      const rest = files.filter((f) => f !== overview);
      required.push(
        ...rest
          .filter((f) => f.bin === undefined || (f.bin >= lo && f.bin <= hi))
          .sort((a, b) => this.distance(a, first, last) - this.distance(b, first, last)),
      );
      const next = this.#direction > 0 ? hi + 1 : this.#direction < 0 ? lo - 1 : -1;
      prefetch = rest.find((f) => f.bin === next);
    }
    const neededBytes = required.reduce((n, f) => n + f.decoded, 0);
    this.#required = new Set(required.map((f) => f.key));
    if (neededBytes > this.#cap) {
      this.#error = `event window needs ${neededBytes} B; ${window?.tier ?? 'full'} index cap is ${this.#cap} B`;
      this.#wanted = new Set([overview.key]);
    } else {
      if (prefetch && neededBytes + prefetch.decoded <= this.#cap) required.push(prefetch);
      this.#wanted = new Set(required.map((f) => f.key));
    }
    // Reserve bytes for the entire desired set before admitting any page. Evict stale pages LRU.
    const reserve = files
      .filter((f) => this.#wanted.has(f.key) && !this.pages.has(f.key))
      .reduce((n, f) => n + f.decoded, 0);
    const stale = [...this.pages.keys()]
      .filter((key) => !this.#wanted.has(key))
      .sort((a, b) => this.#used.get(a)! - this.#used.get(b)!);
    for (const key of stale) {
      if (this.bytes + reserve <= this.#cap) break;
      this.pages.delete(key);
      this.#used.delete(key);
    }
    for (const key of this.#wanted) if (this.pages.has(key)) this.#used.set(key, ++this.#clock);
    return this.status();
  }

  status(): PagePlan {
    return {
      needs: [...this.#wanted].filter((key) => !this.pages.has(key)),
      resident: [...this.pages.keys()],
      bytes: this.bytes,
      complete: !this.#error && [...this.#required].every((key) => this.pages.has(key)),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  /** Superseded page loads are discarded whole, before taking residency. */
  accepts(key: string): boolean {
    return this.#wanted.has(key);
  }
  add(key: string, page: EventPage): boolean {
    if (!this.accepts(key)) return false;
    if (this.bytes - (this.pages.get(key)?.bytes ?? 0) + page.bytes > this.#cap) {
      throw new Error('event page exceeds the resident index cap');
    }
    this.pages.set(key, page);
    this.#used.set(key, ++this.#clock);
    return true;
  }

  row(row: number): Ref | undefined {
    for (const page of this.pages.values()) {
      const i = findRow(page, row);
      if (i >= 0) return { page, i };
    }
  }
  qid(qid: number): Ref | undefined {
    for (const page of this.pages.values()) {
      const i = findQid(page, qid);
      if (i >= 0) return { page, i };
    }
  }

  /**
   * Merge score-ordered pages; no per-row objects or corpus-sized scratch Set while scanning.
   * A visit that returns true stops the walk, as in Array.prototype.some.
   */
  forEach(visit: (page: EventPage, i: number) => boolean | void): void {
    const pages = [...this.pages.values()];
    const cursors = new Uint32Array(pages.length);
    let previous = -1;
    for (;;) {
      let best = -1,
        row = Infinity;
      for (let p = 0; p < pages.length; p++) {
        const next = pages[p]!.row[cursors[p]!];
        if (next !== undefined && next < row) {
          best = p;
          row = next;
        }
      }
      if (best < 0) return;
      const i = cursors[best]!;
      cursors[best] = i + 1;
      if (row !== previous && visit(pages[best]!, i) === true) return;
      previous = row;
    }
  }

  private bin(day: number): number {
    let bin = 0;
    while (bin < this.release.eraEdges.length && day >= this.release.eraEdges[bin]!) bin++;
    return bin;
  }
  private distance(file: EventFile, first: number, last: number): number {
    return file.bin === undefined ? 0 : Math.max(0, first - file.bin, file.bin - last);
  }
}
