// What each drawn node samples: its deepest usable ancestor-or-self, then demoted until nodes that
// touch at an edge or only at a corner differ in source by at most one level (streaming.md 5.6
// rule 1: demote the finer source). A level is usable when its tile is resident and, above L0, so
// is that tile's parent, which a seam may read as the up tile.
import { ancestorAt, DrawnGroups, LATTICE, type DrawnNode } from '../../globe/seamFlags';
import type { Tile } from '../../surface/cube';

export function assignSources(
  tiles: readonly Tile[],
  usable: (tile: Tile) => boolean,
): DrawnNode[] {
  /** The deepest usable level of `tile`'s chain at or above `most`; L0 always is. */
  const deepest = (tile: Tile, most: number): number => {
    for (let level = Math.min(most, tile.level); level > 0; level -= 1) {
      if (usable(ancestorAt(tile, level))) return level;
    }
    return 0;
  };
  const nodes = tiles.map((tile): DrawnNode => ({ tile, source: deepest(tile, tile.level) }));
  const groups = new DrawnGroups(nodes);
  const touching = nodes.map((node) => {
    const others = new Set<DrawnNode>();
    for (const [X, Y] of touchPoints(node.tile)) {
      for (const other of groups.at(node.tile.face, X, Y)) if (other !== node) others.add(other);
    }
    return [...others];
  });
  // Sources only fall, so this ends.
  for (let changed = true; changed;) {
    changed = false;
    nodes.forEach((node, i) => {
      const low = Math.min(...(touching[i] ?? []).map((other) => other.source));
      if (node.source <= low + 1) return;
      node.source = deepest(node.tile, low + 1);
      changed = true;
    });
  }
  return nodes;
}

/**
 * Lattice points where every node that touches `tile` shows up: its corners, and a quarter and
 * three quarters along each edge, where a neighbor one level finer holds half the edge.
 */
function touchPoints(tile: Tile): [number, number][] {
  const span = LATTICE >> tile.level;
  const x0 = tile.x * span;
  const y0 = tile.y * span;
  const q = span / 4;
  const points: [number, number][] = [];
  for (const a of [0, span]) for (const b of [0, span]) points.push([x0 + a, y0 + b]);
  for (const t of [q, 3 * q]) {
    points.push([x0 + t, y0], [x0 + t, y0 + span], [x0, y0 + t], [x0 + span, y0 + t]);
  }
  return points;
}
