// Meanwhile, live (spec section 5; streaming.md 5.3): what else happens in the now window,
// elsewhere. A story's lists come from its lock (story/meanwhile.ts); Explore's come from here, in
// the worker, over the resident index.
import { tunables } from '../config/tunables';
import { describeRef, type EventDescription } from './describe';
import type { EventIndex, Ref } from './residency';

export interface MeanwhileQuery {
  /** The now window: inclusive, possibly fractional day numbers, as in EventQuery. */
  t0: number;
  t1: number;
  /** The view's center, [lon, lat] in degrees. */
  center: [number, number];
  /** The view's visible width across the viewport at its center, in km (ViewState.viewKm). */
  viewKm: number;
  /** How many to pick: tunables.meanwhileCount. */
  count: number;
  /** Q numbers the globe already draws (its marks, focal and pinned events), never picked. */
  exclude: number[];
}
export interface MeanwhileEvent extends EventDescription {
  /** [lon, lat] in degrees, where the entry flies to. */
  at: [number, number];
  cls: number;
  flags: number;
  score: number;
}

/**
 * The longest span a short window admits, as in the meanwhile stage (meanwhile.py SHORTEST_DAYS,
 * streaming.md 3.9): a decade's war does not stand for a month of it.
 */
const SHORTEST_DAYS = 92;
/** globe/viewCamera.ts's radius; the worker imports no three.js. */
const EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;

type Dir = [number, number, number];
function dirOf(lon: number, lat: number): Dir {
  const cosLat = Math.cos(lat * DEG);
  return [cosLat * Math.sin(lon * DEG), Math.sin(lat * DEG), cosLat * Math.cos(lon * DEG)];
}
const dot = (a: Dir, b: Dir) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The cosine of the arc `km` long: two places at least that far apart have a smaller dot. */
const cosArc = (km: number) => Math.cos(Math.min(Math.PI, km / EARTH_KM));

function validate(q: MeanwhileQuery): void {
  if (
    q.center.length !== 2 ||
    ![q.t0, q.t1, q.viewKm, ...q.center].every(Number.isFinite) ||
    q.t0 > q.t1 ||
    q.viewKm <= 0 ||
    Math.abs(q.center[1]) > 90 ||
    !Number.isInteger(q.count) ||
    q.count < 0 ||
    !q.exclude.every(Number.isInteger)
  )
    throw new Error('invalid meanwhile query');
}

/** The display parents above a row, nearest first, stopping at a cycle or a row not resident. */
function ancestors(index: EventIndex, { page, i }: Ref): number[] {
  const rows: number[] = [];
  const seen = new Set([page.row[i]!]);
  let row = page.parent[i]!;
  while (row !== -1 && !seen.has(row)) {
    rows.push(row);
    seen.add(row);
    const parent = index.row(row);
    if (!parent) break;
    row = parent.page.parent[parent.i]!;
  }
  return rows;
}

/**
 * The `count` best-scored events in the now window that the globe does not draw: outside the view
 * (beyond half its width from its center), at least meanwhileMinKm from the center and from each
 * other, spanning no longer than the window or SHORTEST_DAYS, and never a parent with its child.
 * In score order; fewer when fewer qualify among the resident pages.
 */
export function meanwhileEvents(index: EventIndex, query: MeanwhileQuery): MeanwhileEvent[] {
  validate(query);
  if (query.count === 0) return [];
  const exclude = new Set(query.exclude);
  const longest = Math.max(query.t1 - query.t0 + 1, SHORTEST_DAYS);
  const center = dirOf(...query.center);
  const away = cosArc(Math.max(tunables.meanwhileMinKm, query.viewKm / 2));
  const apart = cosArc(tunables.meanwhileMinKm);
  const chosen: { ref: Ref; dir: Dir }[] = [];
  const chosenRows = new Set<number>();
  const chosenAncestors = new Set<number>();
  index.forEach((page, i) => {
    const t0 = page.t0[i]!,
      t1 = page.t1[i]!;
    if (t0 > query.t1 || t1 < query.t0 || t1 - t0 + 1 > longest) return;
    if (exclude.has(page.qid[i]!)) return;
    const dir = dirOf(page.lon[i]! / 1e5, page.lat[i]! / 1e5);
    if (dot(dir, center) > away || chosen.some((c) => dot(c.dir, dir) > apart)) return;
    const ref = { page, i };
    const row = page.row[i]!;
    const lineage = ancestors(index, ref);
    if (chosenAncestors.has(row) || lineage.some((r) => chosenRows.has(r))) return;
    chosen.push({ ref, dir });
    chosenRows.add(row);
    for (const r of lineage) chosenAncestors.add(r);
    return chosen.length >= query.count;
  });
  return chosen.map(({ ref: { page, i }, ref }) => ({
    ...describeRef(index, ref),
    at: [page.lon[i]! / 1e5, page.lat[i]! / 1e5],
    cls: page.cls[i]!,
    flags: page.flags[i]!,
    score: page.score[i]!,
  }));
}
