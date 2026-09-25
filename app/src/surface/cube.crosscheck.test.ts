// cube.ts against the Python samples the fixture build writes (streaming.md 3.0 item 9).
import { describe, expect, it } from 'vitest';
import { readExpectation } from '../test/fixture';
import {
  TILE,
  faceOf,
  faceSt,
  lonLatToDir,
  nodeIndex,
  stToDir,
  texelCenter,
  texelOf,
  tileOf,
  type Vec3,
} from './cube';

interface CubeSample {
  lon: number;
  lat: number;
  L: number;
  f: number;
  x: number;
  y: number;
  node: number;
  s: number;
  t: number;
  i: number;
  j: number;
  center: Vec3;
}

const samples = readExpectation<CubeSample[]>('cube-samples.json');

/** Distance in s (or t) from v to the nearest of `cells + 1` evenly spaced edges over [−1, 1]. */
function edgeDistance(v: number, cells: number): number {
  const u = ((v + 1) * cells) / 2;
  return (Math.abs(u - Math.round(u)) * 2) / cells;
}

function awayFromEdges(sample: CubeSample, cells: number): boolean {
  return edgeDistance(sample.s, cells) >= 1e-8 && edgeDistance(sample.t, cells) >= 1e-8;
}

const awayFromTileEdges = samples.filter((py) => awayFromEdges(py, 2 ** py.L));
const awayFromTexelEdges = samples.filter((py) => awayFromEdges(py, TILE * 2 ** py.L));

function label(py: CubeSample): string {
  return `(${py.lon}, ${py.lat}) L${py.L}`;
}

describe('cube.ts against the Python samples', () => {
  it('agrees on s and t in the Python face frame within 1e-9', () => {
    const off = samples.filter((py) => {
      const [s, t] = faceSt(py.f, lonLatToDir(py.lon, py.lat));
      return Math.abs(s - py.s) > 1e-9 || Math.abs(t - py.t) > 1e-9;
    });
    expect(off.map(label)).toEqual([]);
  });

  it('agrees on the face, tile and node away from tile edges', () => {
    const off = awayFromTileEdges.filter((py) => {
      const p = lonLatToDir(py.lon, py.lat);
      const face = faceOf(p);
      const [s, t] = faceSt(face, p);
      const tile = { face, level: py.L, x: tileOf(s, py.L), y: tileOf(t, py.L) };
      return face !== py.f || tile.x !== py.x || tile.y !== py.y || nodeIndex(tile) !== py.node;
    });
    expect(off.map(label)).toEqual([]);
  });

  it('agrees on the texel and its center away from texel edges', () => {
    const off = awayFromTexelEdges.filter((py) => {
      const p = lonLatToDir(py.lon, py.lat);
      const face = faceOf(p);
      const [s, t] = faceSt(face, p);
      const x = tileOf(s, py.L);
      const y = tileOf(t, py.L);
      const i = texelOf(s, py.L, x);
      const j = texelOf(t, py.L, y);
      const center = stToDir(
        face,
        texelCenter(py.L, TILE * x + i),
        texelCenter(py.L, TILE * y + j),
      );
      const centerOff = center.some((value, k) => Math.abs(value - (py.center[k] ?? NaN)) > 1e-12);
      return i !== py.i || j !== py.j || centerOff;
    });
    expect(off.map(label)).toEqual([]);
  });

  // The 7.5° × 5° grid puts many points on tile edges (the equator, 0°, ±45°, the poles), where
  // the edge rules skip them; the rest must still be most of the samples.
  it('checks most samples under the edge rules', () => {
    expect(awayFromTileEdges.length).toBeGreaterThan(0.7 * samples.length);
    expect(awayFromTexelEdges.length).toBeGreaterThan(0.7 * samples.length);
  });
});
