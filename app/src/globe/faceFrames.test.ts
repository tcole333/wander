// The WANDER_FACE table (streaming.md 3.0 items 1-3): cube.ts's face frames in three.js axes, as
// signed unit axes, so the shader and the mirror place points where cube.ts does.
import { describe, expect, test } from 'vitest';
import { FACES, stToDir, toThree, type Vec3 } from '../surface/cube';
import { FACE_THREE, faceColumnsThree } from './faceFrames';

describe('FACE_THREE', () => {
  test("holds cube.ts's U, V and C of every face in three.js axes", () => {
    expect(FACE_THREE).toEqual(FACES.map(({ u, v, c }) => [toThree(u), toThree(v), toThree(c)]));
  });

  test("puts tan(πs/4)·U + tan(πt/4)·V + C where cube.ts's stToDir points", () => {
    const worst = { error: 0, at: '' };
    FACE_THREE.forEach(([U, V, C], face) => {
      for (let i = 0; i <= 16; i += 1) {
        for (let j = 0; j <= 16; j += 1) {
          const [s, t] = [-1 + i / 8, -1 + j / 8];
          const a = Math.tan((Math.PI * s) / 4);
          const b = Math.tan((Math.PI * t) / 4);
          const dir: Vec3 = [
            a * U[0] + b * V[0] + C[0],
            a * U[1] + b * V[1] + C[1],
            a * U[2] + b * V[2] + C[2],
          ];
          const length = Math.hypot(...dir);
          const expected = toThree(stToDir(face, s, t));
          dir.forEach((value, k) => {
            const error = Math.abs(value / length - (expected[k] ?? NaN));
            if (!(error <= worst.error)) Object.assign(worst, { error, at: `${face} ${s} ${t}` });
          });
        }
      }
    });
    expect(worst.error, worst.at).toBeLessThanOrEqual(1e-15);
  });

  test('has one entry of ±1 per column and row, and +0 elsewhere', () => {
    for (const columns of FACE_THREE) {
      for (const column of columns) {
        expect(column.filter((x) => Math.abs(x) === 1)).toHaveLength(1);
        expect(column.filter((x) => Object.is(x, 0))).toHaveLength(2);
      }
      for (let row = 0; row < 3; row += 1) {
        expect(columns.filter((column) => column[row] !== 0)).toHaveLength(1);
      }
    }
  });
});

describe('faceColumnsThree refuses', () => {
  const face = { c: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };

  test('an axis that is not a signed unit axis', () => {
    expect(() => faceColumnsThree([{ ...face, u: [0, 0.5, 0] }])).toThrow(/signed unit axis/);
    expect(() => faceColumnsThree([{ ...face, u: [0, 1, 1] }])).toThrow(/signed unit axis/);
  });

  test('a frame with U × V ≠ C', () => {
    expect(() => faceColumnsThree([{ ...face, u: face.v, v: face.u }])).toThrow(/U × V/);
    expect(() => faceColumnsThree([{ ...face, v: face.u }])).toThrow(/U × V/);
  });
});
