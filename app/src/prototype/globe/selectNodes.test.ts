// The streamer's node selection: whole covers seamFlags accepts, refined toward the eye, capped at
// maxLevel and at the available tiles, and culled behind the horizon.
import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { checkCover } from '../../globe/seamFlags';
import { EARTH_RADIUS_KM } from '../../globe/viewCamera';
import { lonLatToDir, toThree, type Tile } from '../../surface/cube';
import { NodeSelector, type LodData, type LodView } from './selectNodes';
import { assignSources } from './sources';

const everywhere: LodData = { available: () => true, heightRange: () => [0, 0], hMin: 0 };

function eyeAbove(lon: number, lat: number, altitudeKm: number): Vector3 {
  const dir = new Vector3(...toThree(lonLatToDir(lon, lat)));
  return dir.multiplyScalar(1 + altitudeKm / EARTH_RADIUS_KM);
}

function view(eye: Vector3, options: Partial<LodView> = {}): LodView {
  // A 30° lens on a 900 px tall viewport.
  const pxPerUnit = 900 / (2 * Math.tan(Math.PI / 12));
  return { eye, frustum: null, pxPerUnit, refinePx: 0.83, maxLevel: 7, cull: false, ...options };
}

/**
 * The nodes with every tile usable: sources at their own levels, less one where a node two levels
 * coarser touches a corner (assignSources), so checkCover judges the node levels.
 */
const drawn = (tiles: Tile[]) => assignSources(tiles, () => true);

describe('NodeSelector', () => {
  test.each([
    ['Sumbawa', 118.0, -8.25],
    ['the Kirkuk cube corner', 45.0, 35.26],
    ['a face edge', 45.0, 0],
  ])('covers the globe, balanced, over %s', (_name, lon, lat) => {
    for (const altitudeKm of [20_000, 1_500, 100]) {
      const tiles = new NodeSelector(everywhere).select(view(eyeAbove(lon, lat, altitudeKm)));
      expect(() => checkCover(drawn(tiles))).not.toThrow();
    }
  });

  test('refines toward the eye and stops at maxLevel', () => {
    const selector = new NodeSelector(everywhere);
    const tiles = selector.select(view(eyeAbove(118.0, -8.25, 50), { maxLevel: 6 }));
    const below = new Vector3(...toThree(lonLatToDir(118.0, -8.25)));
    const byAngle = [...tiles].sort(
      (a, b) => selector.centerOf(a).angleTo(below) - selector.centerOf(b).angleTo(below),
    );
    expect(byAngle[0]?.level).toBe(6);
    expect(byAngle.at(-1)?.level).toBeLessThanOrEqual(3);
    expect(Math.max(...tiles.map((t) => t.level))).toBe(6);
  });

  test('goes deeper than the available tiles only as far as balancing needs', () => {
    // Tiles to L2 everywhere, and to L7 on face 1 only; the eye looks down on its edge with face 2.
    const data: LodData = {
      ...everywhere,
      available: (t) => t.level <= 2 || t.face === 1,
    };
    const selector = new NodeSelector(data);
    const tiles = selector.select(view(eyeAbove(134.5, 0, 20)));
    expect(() => checkCover(drawn(tiles))).not.toThrow();
    // Next to face 1's L7 nodes, balancing grades face 2 down one level at a time.
    const face2 = tiles.filter((t) => t.face === 2);
    expect(Math.max(...face2.map((t) => t.level))).toBe(6);
    // Over the far side of face 3, away from face 1, nothing refines past the tiles.
    const far = selector.select(view(eyeAbove(-90.0, 0, 20)));
    expect(Math.max(...far.filter((t) => t.face === 3).map((t) => t.level))).toBe(2);
  });

  test('culls what lies behind the horizon, keeping a cover seamFlags accepts', () => {
    const selector = new NodeSelector(everywhere);
    const eye = eyeAbove(118.0, -8.25, 300);
    const tiles = selector.select(view(eye, { cull: true }));
    expect(selector.culled).toBeGreaterThan(0);
    expect(() => checkCover(drawn(tiles), { partial: true })).not.toThrow();
    const antipode = new Vector3().copy(eye).normalize().negate();
    for (const tile of tiles) {
      expect(selector.centerOf(tile).angleTo(antipode)).toBeGreaterThan(Math.PI / 4);
    }
  });
});
