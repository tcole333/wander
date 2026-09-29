// Test-only builders, imported only by the event tests.
import { OrthographicCamera, Matrix4 } from 'three';
import type { EventsRelease } from '../data/release';
import { lonLatToDir, toThree } from '../surface/cube';
import { parsePage, type EventPage } from '../events/page';
import { EventIndex } from '../events/residency';
import type { EventView } from '../events/view';

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
export function releaseOf(pages: EventPage[]): EventsRelease {
  return {
    ver: 'test',
    overview: 'ev/test/overview.wev',
    rows: pages.reduce((n, p) => n + p.rows, 0),
    eraEdges: Array.from({ length: 23 }, (_, i) => (i + 1) * 10),
    files: pages.map((p, i) => ({
      key: i ? `ev/test/p${i - 1}.wev` : 'ev/test/overview.wev',
      rows: p.rows,
      t0: 0,
      t1: 240,
      decoded: p.bytes,
      bytes: 1,
      jsonBytes: 1,
    })),
  };
}
export function indexOf(pages: EventPage[]): EventIndex {
  const index = new EventIndex(releaseOf(pages));
  index.plan();
  pages.forEach((p, i) => index.add(index.release.files[i]!.key, p));
  return index;
}
export function viewOf(span = 2.2, lon = 0, lat = 0, width = 1440, height = 900): EventView {
  const halfY = (span * height) / width / 2;
  const camera = new OrthographicCamera(-span / 2, span / 2, halfY, -halfY, 0.01, 30);
  camera.position.fromArray(toThree(lonLatToDir(lon, lat))).multiplyScalar(10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { matrix: matrix.toArray(), camera: camera.position.toArray(), width, height };
}
