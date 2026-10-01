import { tunables, type Tier } from '../config/tunables';
import { extentAt, labelAt, type Extent } from './page';
import { EventIndex, type Ref } from './residency';
import { extentPixels, project, validateView, type EventView } from './view';

export interface EventQuery {
  /** Inclusive Gregorian day numbers since 0001-01-01, like story/dates.ts. */
  t0: number;
  t1: number;
  view: EventView;
  tier: Tier;
  /**
   * The declutter cell's side in CSS px, declutterPerCell events a cell: declutterCellMarks marks
   * across at the size the marks are drawn, so larger marks keep as far apart.
   */
  cellPx: number;
  /** Resident story events: exempt from time, nesting, cell and count budgets. Still horizon-culled. */
  focalQids?: number[];
}
export interface Fade {
  phase: 'in' | 'steady' | 'out';
  from: number;
  to: number;
  start: number;
  duration: number;
}
export interface EventMark {
  row: number;
  qid: number;
  at: [number, number];
  x: number;
  y: number;
  /** Visibility of the point/label anchor; outlines clip their extent independently. */
  anchorVisible: boolean;
  score: number;
  cls: number;
  t0: number;
  t1: number;
  prec: number;
  flags: number;
  unc: number;
  parent: number;
  focal: boolean;
  /** Context belongs to an expanded parent (outline and label, no point marker). */
  context: boolean;
  extent?: Extent;
}
export type Fading<T> = T & { fade: Fade };
export interface EventResult {
  markers: Fading<EventMark>[];
  labels: Fading<EventMark & { text: string }>[];
  outlines: Fading<EventMark>[];
  /** Focal ids absent from the resident files; the story may supply its own mark. */
  missingFocal: number[];
}
interface Candidate extends Ref {
  row: number;
  score: number;
  x: number;
  y: number;
  focal: boolean;
}

/** Presentation time, independent of historical time. The UI may interpolate between queries. */
export function fadeOpacity(fade: Fade, now: number): number {
  const t = fade.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - fade.start) / fade.duration));
  return fade.from + (fade.to - fade.from) * t;
}

class Fades<T extends { row: number }> {
  #shown = new Map<number, Fading<T>>();
  incumbents(): Set<number> {
    return new Set([...this.#shown].filter(([, v]) => v.fade.to === 1).map(([id]) => id));
  }
  update(targets: T[], now: number): Fading<T>[] {
    const wanted = new Map(targets.map((v) => [v.row, v]));
    for (const value of targets) {
      const old = this.#shown.get(value.row);
      const fade =
        old?.fade.to === 1
          ? old.fade
          : {
              phase: 'in' as const,
              from: old ? fadeOpacity(old.fade, now) : 0,
              to: 1,
              start: now,
              duration: tunables.eventFade,
            };
      this.#shown.set(value.row, { ...value, fade });
    }
    for (const [id, value] of this.#shown) {
      if (!wanted.has(id) && value.fade.to !== 0) {
        value.fade = {
          phase: 'out',
          from: fadeOpacity(value.fade, now),
          to: 0,
          start: now,
          duration: tunables.eventFade,
        };
      }
      const opacity = fadeOpacity(value.fade, now);
      if (value.fade.to === 0 && opacity === 0) this.#shown.delete(id);
      else if (opacity === 1 && value.fade.to === 1) {
        value.fade = { phase: 'steady', from: 1, to: 1, start: now, duration: 0 };
      }
    }
    return [...this.#shown.values()].map((v) => ({ ...v, fade: { ...v.fade } }));
  }
}

/** The declutter cell's side, CSS px, for marks `markPx` across. */
export function cellPxFor(markPx: number): number {
  return tunables.declutterCellMarks * markPx;
}

/**
 * Greedy score budget over cells `cellPx` square. A 20-point incumbent margin applies both
 * globally and inside cells.
 */
function budget(
  candidates: Candidate[],
  limit: number,
  incumbent: Set<number>,
  cellPx: number,
): Candidate[] {
  candidates.sort(
    (a, b) =>
      b.score +
        (incumbent.has(b.row) ? tunables.hysteresisScore : 0) -
        (a.score + (incumbent.has(a.row) ? tunables.hysteresisScore : 0)) ||
      Number(incumbent.has(a.row)) - Number(incumbent.has(b.row)) ||
      a.row - b.row,
  );
  const cells = new Map<string, number>();
  const chosen: Candidate[] = [];
  let ordinary = 0;
  let remainingFocal = candidates.reduce((n, c) => n + Number(c.focal), 0);
  for (const c of candidates) {
    if (ordinary >= limit && remainingFocal === 0) break;
    if (!c.focal && ordinary >= limit) continue;
    const cell = `${Math.floor(c.x / cellPx)},${Math.floor(c.y / cellPx)}`;
    const count = cells.get(cell) ?? 0;
    if (!c.focal && (ordinary >= limit || count >= tunables.declutterPerCell)) continue;
    chosen.push(c);
    if (c.focal) remainingFocal--;
    if (!c.focal) {
      ordinary++;
      cells.set(cell, count + 1);
    }
  }
  return chosen;
}

/** One query session holds only split ids and the few marks still fading. Index rows stay columnar. */
export class EventQueryEngine {
  readonly index: EventIndex;
  #split = new Set<number>();
  #markers = new Fades<EventMark>();
  #labels = new Fades<EventMark & { text: string }>();
  #outlines = new Fades<EventMark>();

  constructor(index: EventIndex) {
    this.index = index;
  }

  query(query: EventQuery, now: number): EventResult {
    validateView(query.view);
    if (
      ![query.t0, query.t1, now].every(Number.isFinite) ||
      query.t0 > query.t1 ||
      !(query.cellPx > 0 && Number.isFinite(query.cellPx)) ||
      (query.tier !== 'lite' && query.tier !== 'full')
    )
      throw new Error('invalid event window, cell or tier');
    const focal = new Set(query.focalQids ?? []);
    const missingFocal = [...focal].filter((qid) => !this.index.qid(qid));
    const inTime = ({ page: p, i }: Ref) => p.t0[i]! <= query.t1 && p.t1[i]! >= query.t0;
    const visible: Candidate[] = [];
    this.index.forEach((p, i) => {
      const isFocal = focal.has(p.qid[i]!);
      if (!isFocal && (p.t0[i]! > query.t1 || p.t1[i]! < query.t0)) return;
      const point = project(query.view, p.lon[i]! / 1e5, p.lat[i]! / 1e5);
      if (point?.visible)
        visible.push({
          page: p,
          i,
          row: p.row[i]!,
          score: p.score[i]!,
          x: point.x,
          y: point.y,
          focal: isFocal,
        });
    });
    // A parent only gives way when a descendant in this window is available in view. Sparse
    // overviews and absent pages therefore never turn an entire family invisible.
    const hasChild = new Set<number>();
    // Battles commonly share a war. Cache each parent chain for this query only, rather than
    // binary-searching the same ancestors again for every battle and each budget pass.
    const lineages = new Map<number, Ref[]>();
    const noParents: Ref[] = [];
    const ancestors = (ref: Ref): Ref[] => {
      const first = ref.page.parent[ref.i]!;
      if (first === -1) return noParents;
      const cached = lineages.get(first);
      if (cached) return cached;
      const parents: Ref[] = [];
      const seen = new Set([ref.page.row[ref.i]!]);
      let row = ref.page.parent[ref.i]!;
      while (row !== -1 && !seen.has(row)) {
        seen.add(row);
        const parent = this.index.row(row);
        if (!parent) break;
        if (inTime(parent)) parents.push(parent);
        row = parent.page.parent[parent.i]!;
      }
      lineages.set(first, parents);
      return parents;
    };
    for (const c of visible) for (const p of ancestors(c)) hasChild.add(p.page.row[p.i]!);
    for (const row of this.#split) if (!this.index.row(row)) this.#split.delete(row);
    const expanded = new Map<number, boolean>();
    const isExpanded = (ref: Ref): boolean => {
      const row = ref.page.row[ref.i]!;
      if (!hasChild.has(row)) return false;
      const cached = expanded.get(row);
      if (cached !== undefined) return cached;
      const ext = extentAt(ref.page, row);
      if (!ext) {
        expanded.set(row, false);
        return false;
      }
      const px = extentPixels(query.view, ext);
      if (px > tunables.parentSplitPx) this.#split.add(row);
      else if (px < tunables.parentMergePx) this.#split.delete(row);
      const split = this.#split.has(row);
      expanded.set(row, split);
      return split;
    };
    const blocking = new Map<number, boolean>();
    const blocksChild = (ref: Ref): boolean => {
      const { page: p, i } = ref;
      const row = p.row[i]!;
      const cached = blocking.get(row);
      if (cached !== undefined) return cached;
      const blocks =
        !isExpanded(ref) && !!project(query.view, p.lon[i]! / 1e5, p.lat[i]! / 1e5)?.visible;
      blocking.set(row, blocks);
      return blocks;
    };
    const eligible = visible.filter(
      (c) => c.focal || (!isExpanded(c) && ancestors(c).every((p) => !blocksChild(p))),
    );
    const chosen = budget(
      eligible,
      tunables.eventMarkers[query.tier],
      this.#markers.incumbents(),
      query.cellPx,
    );
    const context = new Map<number, Candidate>();
    for (const c of chosen)
      for (const parent of ancestors(c)) {
        const row = parent.page.row[parent.i]!;
        if (!isExpanded(parent) || context.has(row)) continue;
        const p = project(
          query.view,
          parent.page.lon[parent.i]! / 1e5,
          parent.page.lat[parent.i]! / 1e5,
        );
        // An extent can cross the viewport while its anchor is offscreen; keep the outline. The
        // label is culled separately below and the renderer clips the outline to the globe.
        context.set(row, {
          ...parent,
          row,
          score: parent.page.score[parent.i]!,
          x: p?.x ?? -Infinity,
          y: p?.y ?? -Infinity,
          focal: false,
        });
      }
    const mark = (c: Candidate, isContext = false): EventMark => {
      const { page: p, i } = c;
      return {
        row: c.row,
        qid: p.qid[i]!,
        at: [p.lon[i]! / 1e5, p.lat[i]! / 1e5],
        x: c.x,
        y: c.y,
        anchorVisible: true,
        score: c.score,
        cls: p.cls[i]!,
        t0: p.t0[i]!,
        t1: p.t1[i]!,
        prec: p.prec[i]!,
        flags: p.flags[i]!,
        unc: p.unc[i]!,
        parent: p.parent[i]!,
        focal: c.focal,
        context: isContext,
        extent: extentAt(p, c.row),
      };
    };
    const labelCandidates = [
      ...chosen,
      ...[...context.values()].filter(
        (c) =>
          c.x >= 0 &&
          c.x <= query.view.width &&
          c.y >= 0 &&
          c.y <= query.view.height &&
          !chosen.some((m) => m.row === c.row),
      ),
    ];
    const labels = budget(
      labelCandidates,
      tunables.eventLabels[query.tier],
      this.#labels.incumbents(),
      query.cellPx,
    ).map((c) => ({ ...mark(c, context.has(c.row)), text: labelAt(c.page, c.i) }));
    const result: EventResult = {
      markers: this.#markers.update(
        chosen.map((c) => mark(c)),
        now,
      ),
      labels: this.#labels.update(labels, now),
      outlines: this.#outlines.update(
        [...context.values()].map((c) => mark(c, true)),
        now,
      ),
      missingFocal,
    };
    // Exiting marks still follow the current camera; otherwise a fade can leave a label fixed
    // on the screen or let it shine through the back of the globe while the visitor rotates it.
    for (const marks of [result.markers, result.labels, result.outlines])
      for (const m of marks) {
        const point = project(query.view, ...m.at);
        m.anchorVisible = point?.visible ?? false;
        m.x = point?.x ?? 0;
        m.y = point?.y ?? 0;
      }
    return result;
  }
}
