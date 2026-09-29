// Local CPU measurement, no server or browser. From app/:
// ./node_modules/.bin/rolldown scripts/benchmarkEvents.ts --platform node --format esm \
//   --tsconfig tsconfig.app.json --file ../build/benchmark-events.mjs
// node ../build/benchmark-events.mjs ../build/out ../build/stages/global/event-files.json
// Measures decoded array bytes and queries only, excluding worker messaging and rendering.
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release as osRelease } from 'node:os';
import { resolve } from 'node:path';
import { Matrix4, PerspectiveCamera } from 'three';
import type { EventsRelease } from '../src/data/release';
import { decodePage } from '../src/events/page';
import { EventQueryEngine } from '../src/events/query';
import { EventIndex } from '../src/events/residency';
import type { EventView } from '../src/events/view';
import { dayFromIso } from '../src/story/dates';
import { lonLatToDir, toThree } from '../src/surface/cube';

const [rootArg, recordArg] = process.argv.slice(2);
if (!rootArg || !recordArg) throw new Error('pass output root and event-files.json');
const root = resolve(rootArg);
const release = JSON.parse(readFileSync(resolve(recordArg), 'utf8')) as EventsRelease;
const index = new EventIndex(release);
index.plan();
const pages = [];
for (const file of release.files) {
  const stored = readFileSync(resolve(root, file.key));
  const before = performance.now();
  const page = await decodePage(new Uint8Array(stored).buffer, file);
  const decodeMs = performance.now() - before;
  const admitted = index.add(file.key, page);
  if (file.rows > 0 && !admitted) {
    throw new Error(
      'this benchmark needs a corpus that fits resident; paging has separate unit tests',
    );
  }
  pages.push({
    key: file.key,
    rows: page.rows,
    stored: stored.length,
    json: file.jsonBytes,
    arrays: page.bytes,
    decodeMs,
  });
}

function view(lon: number, lat: number, distance: number): EventView {
  const camera = new PerspectiveCamera(40, 1440 / 900, 0.001, 20);
  camera.position.fromArray(toThree(lonLatToDir(lon, lat))).multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    matrix: new Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .toArray(),
    camera: camera.position.toArray(),
    width: 1440,
    height: 900,
  };
}
const runs = [];
for (const tier of ['lite', 'full'] as const) {
  for (const [name, start, end, lon, lat, distance] of [
    ['world-all-history', '-9999-01-01', '2000-12-31', 15, 20, 3.5],
    ['europe-1815', '1815-01-01', '1815-12-31', 10, 45, 1.5],
    ['asia-1900-2000', '1900-01-01', '2000-12-31', 100, 30, 2],
  ] as const) {
    const engine = new EventQueryEngine(index);
    const t0 = dayFromIso(start),
      t1 = dayFromIso(end);
    const times: number[] = [];
    let markerCount = 0,
      labelCount = 0;
    for (let i = 0; i < 350; i++) {
      const query = { t0, t1, tier, view: view(lon + Math.sin(i / 20) * 10, lat, distance) };
      const before = performance.now();
      const result = engine.query(query, (i * 1000) / 30);
      const elapsed = performance.now() - before;
      if (i >= 50) times.push(elapsed);
      markerCount = result.markers.filter((m) => m.fade.to === 1).length;
      labelCount = result.labels.filter((m) => m.fade.to === 1).length;
    }
    times.sort((a, b) => a - b);
    runs.push({
      name,
      tier,
      queries: times.length,
      p50Ms: times[Math.floor(times.length * 0.5)],
      p95Ms: times[Math.floor(times.length * 0.95)],
      maxMs: times.at(-1),
      markerCount,
      labelCount,
    });
  }
}
console.log(
  JSON.stringify(
    {
      measured: new Date().toISOString(),
      machine: {
        cpu: cpus()[0]?.model,
        platform: platform(),
        os: osRelease(),
        arch: arch(),
        node: process.version,
      },
      method: {
        script: 'app/scripts/benchmarkEvents.ts',
        viewportCssPixels: [1440, 900],
        warmupQueries: 50,
        measuredQueries: 300,
        queryHz: 30,
        camera: '40-degree perspective; longitude offset sin(query / 20) * 10 degrees',
        queryTiming:
          'EventQueryEngine.query only; excludes fetch, messaging, camera construction and rendering',
        decodeTiming:
          'decodePage: gzip inflation, JSON parsing, validation and typed-array packing',
        bytes:
          'Stored gzip, inflated JSON and resident typed-array buffers including labels, offsets, extents and qid lookup; excludes object headers and transient allocations',
      },
      version: release.ver,
      rows: release.rows,
      residentArrayBytes: index.bytes,
      pages,
      runs,
    },
    null,
    2,
  ),
);
