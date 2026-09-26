// The vertex mirror on two same-level neighbors, each drawn as a node of its own level at d = 0
// (streaming.md 5.6, 7.3 Bake check): the pair packed into instances as the globe packs them, and
// the mirror run on the shared edge's vertices from both sides. Every shared point must come out
// identical, and on a face edge both sides must choose land or sea alike.
import { neighbor, tileKey, type Edge, type Tile } from '../surface/cube';
import type { DecodedWst } from '../surface/wst';
import { packScenario } from '../globe/meshScenarios';
import { latticePoint } from '../globe/seamFlags';
import { GRID_SEGMENTS, SURFACE, type Segments } from '../globe/tileGrid';
import { mirrorVertex, type MirrorVertex } from '../globe/vertexMirror';
import { fieldMismatches, mirrorContext, type CodeScale } from './meshMirror';

export interface PairSeams {
  /** Shared points compared: the G + 1 vertices of the shared edge. */
  points: number;
  /** `point field: a vs b` wherever the two sides differ in code, shore, land, h, dir or position. */
  mismatches: string[];
  /** Face-edge points whose two sides choose land and sea differently. */
  landSplits: string[];
}

/**
 * Tile `a` and its same-level neighbor across `edge`, both drawing themselves: the mirror on every
 * vertex of the shared edge from each side, matched by lattice point.
 */
export function mirrorPair(
  a: Tile,
  edge: Edge,
  decodedA: DecodedWst,
  decodedB: DecodedWst,
  scale: CodeScale,
  segments: Segments = GRID_SEGMENTS.full,
): PairSeams {
  const across = neighbor(a, edge);
  const b = across.tile;
  const decoded = new Map([
    [tileKey(a), decodedA],
    [tileKey(b), decodedB],
  ]);
  const tileOf = (t: Tile): DecodedWst => {
    const found = decoded.get(tileKey(t));
    if (!found) throw new Error(`the pair ${tileKey(a)} ${edge} reads ${tileKey(t)}`);
    return found;
  };
  const scenario = {
    name: `${tileKey(a)} ${edge}`,
    nodes: [a, b].map((tile) => ({ tile, source: tile.level })),
    partial: true,
  };
  const packed = packScenario(scenario, (t) => tileOf(t).header.codeMid);
  const ctx = mirrorContext(packed, tileOf, scale, segments);
  const G = segments;
  const side = (instance: number, tile: Tile, facing: Edge) => {
    const vertices = new Map<string, { k: number; l: number; v: MirrorVertex }>();
    for (let i = 0; i <= G; i += 1) {
      const [k, l] = alongEdge(facing, i, G);
      const v = mirrorVertex(packed.words, instance, k, l, SURFACE, ctx);
      vertices.set(latticePoint(tile, k, l, G), { k, l, v });
    }
    return vertices;
  };
  const theirs = side(1, b, across.edge);
  const found: PairSeams = { points: 0, mismatches: [], landSplits: [] };
  const faceEdge = b.face !== a.face;
  side(0, a, edge).forEach((mine, point) => {
    const other = theirs.get(point);
    if (!other) {
      found.mismatches.push(`${point}: ${tileKey(b)} holds no vertex there`);
      return;
    }
    found.points += 1;
    const named = (tile: Tile, { k, l, v }: typeof mine) => ({
      v,
      name: `${tileKey(tile)} (${k}, ${l})`,
    });
    found.mismatches.push(...fieldMismatches(point, named(a, mine), named(b, other)));
    if (faceEdge && mine.v.land !== other.v.land) {
      found.landSplits.push(
        `${point}: ${tileKey(a)} land ${mine.v.land}, ${tileKey(b)} ${other.v.land}`,
      );
    }
  });
  return found;
}

/** Vertex (k, l) number i of the G + 1 along `edge`, in increasing s or t. */
function alongEdge(edge: Edge, i: number, G: number): [number, number] {
  switch (edge) {
    case 'N':
      return [i, G];
    case 'E':
      return [G, i];
    case 'S':
      return [i, 0];
    case 'W':
      return [0, i];
  }
}
