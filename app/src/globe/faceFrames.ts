// The cube's face frames in three.js axes (streaming.md 3.0 items 1-3), as the surface vertex
// shader's WANDER_FACE table holds them and the vertex mirror reads them: per face, the columns U,
// V and C. Every entry is 0 or ±1, so WANDER_FACE[face]·(a, b, 1) = a·U + b·V + C has one nonzero
// term per component and is exact in float32: the same point named from two faces gets the same
// vector bit for bit.
import constants from '@shared/constants.json' with { type: 'json' };
import { toThree, type Vec3 } from '../surface/cube';

/** A face's columns U, V and C in three.js axes. */
export type FaceColumns = readonly [u: Vec3, v: Vec3, c: Vec3];

interface FaceAxes {
  c: readonly number[];
  u: readonly number[];
  v: readonly number[];
}

/**
 * The WANDER_FACE table from constants.json's faces (globe frame G), mapped to three.js axes with
 * cube.ts's `toThree`. Throws unless each face's U, V and C are distinct signed unit axes with
 * U × V = C.
 */
export function faceColumnsThree(faces: readonly FaceAxes[] = constants.cube.faces): FaceColumns[] {
  return faces.map(({ u, v, c }, face) => {
    const columns = [u, v, c].map((axis) => toThree(unitAxis(axis, face)));
    const [U, V, C] = columns as [Vec3, Vec3, Vec3];
    const cross: Vec3 = [
      U[1] * V[2] - U[2] * V[1],
      U[2] * V[0] - U[0] * V[2],
      U[0] * V[1] - U[1] * V[0],
    ];
    if (cross.some((value, i) => value !== C[i])) {
      throw new RangeError(`face ${face}: U × V is not C`);
    }
    return [U, V, C] as const;
  });
}

/** The table the shader emits and the mirror reads. */
export const FACE_THREE: readonly FaceColumns[] = faceColumnsThree();

/** A signed unit axis, with +0 in its other entries (JSON's 0 is +0; a −0 would flip bits). */
function unitAxis(values: readonly number[], face: number): Vec3 {
  const [x, y, z, ...rest] = values;
  const axis = [x, y, z];
  const ones = axis.filter((value) => value === 1 || value === -1).length;
  const zeros = axis.filter((value) => Object.is(value, 0)).length;
  if (rest.length > 0 || ones !== 1 || zeros !== 2) {
    throw new RangeError(`face ${face}: ${JSON.stringify(values)} is not a signed unit axis`);
  }
  return axis as Vec3;
}
