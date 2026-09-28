// E5's light answer (streaming.md 8.2): how long the events table (`ev/events.tsv.gz`, 3.4) takes
// to inflate and parse into the columns a worker would hold: t0 and t1 as Float64 day numbers,
// lon, lat and score as Float32, precision as Uint8, labels as strings. Plain Node, from the repo
// root:
//
//   node docs/design/measurements/e5/parse.mjs [build/out/ev/events.tsv.gz]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const path = process.argv[2] ?? 'build/out/ev/events.tsv.gz';
const RUNS = 7;

/** Day number since 0001-01-01, proleptic Gregorian, astronomical years (app/src/story/dates.ts). */
function dayFromIso(iso) {
  const [, y0, m, d] = /^(-?\d+)-(\d\d)-(\d\d)$/.exec(iso).map(Number);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 306;
}

function parse(stored) {
  const lines = gunzipSync(stored).toString('utf8').split('\n');
  const header = lines[0].split('\t');
  const at = (name) => header.indexOf(name);
  const rows = lines.length - 2;
  const columns = {
    t0: new Float64Array(rows),
    t1: new Float64Array(rows),
    lon: new Float32Array(rows),
    lat: new Float32Array(rows),
    score: new Float32Array(rows),
    prec: new Uint8Array(rows),
    label: new Array(rows),
  };
  for (let i = 0; i < rows; i++) {
    const f = lines[i + 1].split('\t');
    columns.t0[i] = dayFromIso(f[at('t0')]);
    columns.t1[i] = dayFromIso(f[at('t1')]);
    columns.lon[i] = Number(f[at('lon')]);
    columns.lat[i] = Number(f[at('lat')]);
    columns.score[i] = Number(f[at('score')]);
    columns.prec[i] = Number(f[at('precision')]);
    columns.label[i] = f[at('label')];
  }
  return columns;
}

const stored = readFileSync(path);
const times = [];
let rows = 0;
for (let run = 0; run < RUNS; run++) {
  const start = performance.now();
  rows = parse(stored).t0.length;
  times.push(performance.now() - start);
}
const ms = (value) => Math.round(value * 10) / 10;
const first = ms(times[0]);
times.sort((a, b) => a - b);
const result = {
  file: path,
  rows,
  bytes: stored.length,
  decoded: gunzipSync(stored).length,
  parseMs: { first, median: ms(times[RUNS >> 1]), min: ms(times[0]) },
  runs: RUNS,
  node: process.version,
  measured: new Date().toISOString().slice(0, 10),
};
console.log(JSON.stringify(result, null, 2));
