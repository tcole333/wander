// Test-only builders, imported only by the event tests.
import { parsePage, type EventPage } from './page';

export interface TestEvent {
  row: number;
  qid?: number;
  lon?: number;
  lat?: number;
  score?: number;
  t0?: number;
  t1?: number;
  parent?: number;
  label?: string;
  ext?: number[];
}
export function pageOf(events: TestEvent[]): EventPage {
  const rows = [...events].sort((a, b) => a.row - b.row);
  return parsePage({
    v: 1,
    rows: rows.length,
    classes: ['battle'],
    row: rows.map((r) => r.row),
    qid: rows.map((r) => r.qid ?? r.row + 1),
    lon: rows.map((r) => Math.round((r.lon ?? 0) * 1e5)),
    lat: rows.map((r) => Math.round((r.lat ?? 0) * 1e5)),
    t0: rows.map((r) => r.t0 ?? 1),
    t1: rows.map((r) => r.t1 ?? 10),
    score: rows.map((r) => r.score ?? 1000 - r.row),
    parent: rows.map((r) => r.parent ?? -1),
    prec: rows.map(() => 11),
    cls: rows.map(() => 0),
    flags: rows.map(() => 0),
    unc: rows.map(() => 0),
    label: rows.map((r) => r.label ?? `Event ${r.row}`),
    ext: rows.filter((r) => r.ext).map((r) => [r.row, ...r.ext!.map((x) => Math.round(x * 1e5))]),
  });
}
