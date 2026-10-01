// Where the height pool holds the ground the surface draws at a place (contract.ts, HeightTexel):
// what the look's marks read their anchors' heights from, so each seal lies at the height of the
// relief drawn around it (marks.glsl.ts).
import type { HeightTexel } from '../contract';
import type { SlotTable } from '../gpu/slotTable';
import { faceOf, faceSt, tileKey, tileOf, tileUv, type Vec3 } from '../surface/cube';

/**
 * The texel at `dir` (the cube's frame G) in the tile the surface draws there: the source of the
 * drawn node holding it (`drawn`, each drawn node's key to its source level), so the height changes
 * only as the drawn surface does, not as finer tiles land or leave the pool. A place no drawn node
 * holds, culled past the view, reads its finest resident tile no finer than the finest source
 * drawn. Null when no tile there is resident.
 */
export function heightTexelAt(
  dir: Vec3,
  drawn: ReadonlyMap<string, number>,
  table: Pick<SlotTable, 'slotOf' | 'stateOf'>,
  codeMids: ReadonlyMap<string, number>,
  maxLevel: number,
): HeightTexel | null {
  const face = faceOf(dir);
  const [s, t] = faceSt(face, dir);
  const texelAt = (level: number): HeightTexel | null => {
    const x = tileOf(s, level);
    const y = tileOf(t, level);
    const key = tileKey({ face, level, x, y });
    const slot = table.slotOf(key);
    const codeMid = codeMids.get(key);
    if (slot === undefined || codeMid === undefined || table.stateOf(key) !== 'resident') {
      return null;
    }
    return { slot, u: tileUv(s, level, x), v: tileUv(t, level, y), level, codeMid };
  };
  let finest = 0;
  for (const source of drawn.values()) finest = Math.max(finest, source);
  for (let level = maxLevel; level >= 0; level -= 1) {
    const source = drawn.get(tileKey({ face, level, x: tileOf(s, level), y: tileOf(t, level) }));
    if (source === undefined) continue;
    const texel = texelAt(source);
    if (texel) return texel;
    finest = Math.min(finest, source);
    break;
  }
  for (let level = Math.min(finest, maxLevel); level >= 0; level -= 1) {
    const texel = texelAt(level);
    if (texel) return texel;
  }
  return null;
}
