// The global bake's border steps (streaming.md 3.3, 7.3, Bake check): `npm run verify:bake --
// global` decodes every step and preview chunk the borders record names, and checks that no border
// runs beside a lake shore for more than SHORE_RUN_KM (a border crosses a lake, never rings it),
// that a lake ring planted in a real step is caught, that each preview agrees in sign with its
// field near the outer borders, that each step draws as many leaves as Cliopatria has rows valid
// in its year, apart from corrections, and it reports the overlap pairs no correction acknowledges.
// The region bake has no steps, so the checks run for the global profile only. A missing or stale
// bake fails, naming the command.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COMPARED_LEAVES,
  FACES,
  decodeChunk,
  decodeStep,
  drawnLeaves,
  previewAgreement,
  previewMap,
  readBorderBake,
  shoreBand,
  shoreRuns,
  stepHolding,
  texelLonLat,
  type BorderBake,
  type ShoreRun,
} from '../test/borderBake';
import { REPO_ROOT } from '../test/fixture';

/** The longest a border may run beside a lake shore (streaming.md 7.3). */
const SHORE_RUN_KM = 50;
/** The share of each step's compared preview texels whose sign must match the field's. */
const PREVIEW_AGREEMENT = 0.99;
const SHOWN = 20;

const profile = process.env.WANDER_BAKE_PROFILE ?? 'region';

interface Findings {
  undecoded: string[];
  shoreRuns: (ShoreRun & { year: number })[];
  longestRun: number;
  planted: ShoreRun | null;
  preview: { year: number; compared: number; agreed: number }[];
  leaves: string[];
}

describe.runIf(profile === 'global')('the border steps', () => {
  let bake: BorderBake;
  let findings: Findings;

  beforeAll(() => {
    const started = performance.now();
    bake = readBorderBake(REPO_ROOT);
    const { steps } = bake.record;
    findings = {
      undecoded: [],
      shoreRuns: [],
      longestRun: 0,
      planted: null,
      preview: [],
      leaves: [],
    };
    const map = previewMap(steps.size, steps.apron, bake.land);
    const band = shoreBand(bake.shores, steps.size);
    const read = (key: string) => new Uint8Array(readFileSync(join(bake.root, key)));
    let chunk: ReturnType<typeof decodeChunk> | null = null;
    steps.keys.forEach((key, k) => {
      const year = steps.years[k]!;
      let decoded;
      try {
        decoded = decodeStep(read(key));
      } catch (error) {
        findings.undecoded.push(`${key}: ${String(error)}`);
        return;
      }
      if (decoded.year !== year || decoded.size !== steps.size || decoded.apron !== steps.apron) {
        findings.undecoded.push(`${key}: ${decoded.year} at ${decoded.size}, not ${year}`);
      }
      for (let face = 0; face < FACES; face += 1) {
        for (const run of shoreRuns(decoded.planes, band, decoded.size, face)) {
          findings.longestRun = Math.max(findings.longestRun, run.km);
          if (run.km > SHORE_RUN_KM) findings.shoreRuns.push({ ...run, year });
        }
      }
      const per = steps.previews.per;
      if (k % per === 0) {
        const chunkKey = steps.previews.keys[k / per]!;
        try {
          chunk = decodeChunk(read(chunkKey));
          const expected = steps.years.slice(k, k + per);
          if (chunk.years.join() !== expected.join()) {
            findings.undecoded.push(
              `${chunkKey}: years ${chunk.years.join()}, not ${expected.join()}`,
            );
          }
        } catch (error) {
          findings.undecoded.push(`${chunkKey}: ${String(error)}`);
          chunk = null;
        }
      }
      const layer = chunk?.layers[k % per];
      if (layer) {
        findings.preview.push({
          year,
          ...previewAgreement(decoded.planes, layer, map, decoded.size),
        });
      }
      if (k === steps.keys.length - 1) {
        findings.planted = plantedRing(decoded.planes, band, decoded.size);
      }
    });
    const drawn = drawnLeaves(bake.polities, steps.years);
    steps.years.forEach((year, k) => {
      const review = bake.review.byStep[String(year)];
      if (!review) return findings.leaves.push(`${year}: no review entry`);
      if ((review.corrections ?? []).length > 0) return;
      if (drawn[k] !== review.leaves) {
        findings.leaves.push(`${year}: ${drawn[k]} leaves drawn, ${review.leaves} rows valid`);
      }
    });
    for (const [year, leaves] of Object.entries(COMPARED_LEAVES)) {
      const held = steps.years[stepHolding(steps.years, Number(year))];
      const review = held === undefined ? undefined : bake.review.byStep[String(held)];
      if (review && (review.corrections ?? []).length === 0 && review.leaves !== leaves) {
        findings.leaves.push(
          `${year}: ${review.leaves} rows valid, not the comparison's ${leaves}`,
        );
      }
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const compared = findings.preview.reduce((sum, p) => sum + p.compared, 0);
    const agreed = findings.preview.reduce((sum, p) => sum + p.agreed, 0);
    const pairs = bake.record.unacknowledged ?? [];
    console.log(
      [
        `border steps: ${steps.keys.length} steps and ${steps.previews.keys.length} chunks in ${seconds} s`,
        `  the longest border beside a lake shore runs ${findings.longestRun.toFixed(0)} km`,
        `  ${agreed} of ${compared} preview texels agree in sign with their fields`,
        `  ${pairs.length} overlap pairs no correction acknowledges, across ` +
          `${new Set(pairs.flatMap((pair) => pair.steps)).size} steps; publish-data refuses them`,
        ...pairs.slice(0, SHOWN).map(({ polities, steps: years }) => {
          return `    ${polities.join(' / ')}: ${years.join(', ')}`;
        }),
      ].join('\n'),
    );
  });

  /**
   * A ring of border planted along every lake shore of the face with the most shore, in a copy of
   * a real step: the check must find it.
   */
  function plantedRing(planes: Uint8Array, band: Uint8Array, size: number): ShoreRun | null {
    const cells = size * size;
    let best = 0;
    let face = 0;
    for (let f = 0; f < FACES; f += 1) {
      let count = 0;
      for (let k = 0; k < cells; k += 1) count += band[f * cells + k]!;
      if (count > best) [best, face] = [count, f];
    }
    const planted = planes.slice();
    for (let k = 0; k < cells; k += 1) {
      if (band[face * cells + k] === 1) planted[2 * (face * cells + k)] = 128;
    }
    return shoreRuns(planted, band, size, face)[0] ?? null;
  }

  it('decodes every step and preview chunk', () => {
    expect(findings.undecoded.slice(0, SHOWN)).toEqual([]);
    expect(findings.preview).toHaveLength(bake.record.steps.keys.length);
  });

  it(`draws no border beside a lake shore for more than ${SHORE_RUN_KM} km`, () => {
    const { size, apron } = bake.record.steps;
    const shown = findings.shoreRuns.slice(0, SHOWN).map(({ year, face, at, km }) => {
      const [lon, lat] = texelLonLat(face, at[0], at[1], size, apron);
      return `${year} at ${lon.toFixed(2)}, ${lat.toFixed(2)}: ${km.toFixed(0)} km`;
    });
    expect(shown).toEqual([]);
  });

  it('finds a lake ring planted in a real step', () => {
    expect(findings.planted?.km ?? 0).toBeGreaterThan(SHORE_RUN_KM);
  });

  it('draws each preview on the same side of the outer borders as its field', () => {
    const failing = findings.preview
      .filter(({ compared, agreed }) => agreed < PREVIEW_AGREEMENT * compared)
      .slice(0, SHOWN)
      .map(({ year, compared, agreed }) => `${year}: ${agreed} of ${compared}`);
    expect(failing).toEqual([]);
  });

  it('draws as many leaves in each step as Cliopatria has rows valid in its year', () => {
    expect(findings.leaves.slice(0, SHOWN)).toEqual([]);
  });

  it('names each overlap pair no correction acknowledges, with its steps', () => {
    const pairs = bake.record.unacknowledged ?? [];
    expect(pairs.every(({ polities, steps }) => polities.length === 2 && steps.length > 0)).toBe(
      true,
    );
  });
});
