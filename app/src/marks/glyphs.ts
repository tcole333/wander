// The glyphs the look's marks are cut from: SVG path data on a 64-unit grid, y down, filled by the
// nonzero rule (a subpath wound the other way cuts a hole). The look letters them once, as signed
// distance fields on a shelf of its sea-name atlas (glyphAtlas.ts), and every mark names one.
//
// The look letters four test glyphs, drawn only by the dev page's ?markDemo: a twin peak, crossed
// blades, an anchor and a compass star, until the event marks take the symbol family's
// EVENT_GLYPHS (symbols.ts).

/** Glyph names to SVG path data on a 64-unit grid, y down, nonzero fill. */
export type GlyphSet = Readonly<Record<string, string>>;

/** The grid a glyph is drawn on, in units. */
export const GLYPH_UNITS = 64;

/**
 * How far a glyph's outline reaches from its grid's center, in units: the farthest of its vertices
 * and of the circles its arcs are drawn on. Paths are absolute M, L, H, V, A and Z, as the glyphs
 * are drawn; anything else throws.
 */
export function glyphReach(path: string): number {
  const center = GLYPH_UNITS / 2;
  const from = (x: number, y: number) => Math.hypot(x - center, y - center);
  let [x, y] = [0, 0];
  let most = 0;
  for (const [, command, args] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (args?.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    if ((command === 'M' || command === 'L') && n.length === 2) [x, y] = [n[0]!, n[1]!];
    else if (command === 'H' && n.length === 1) x = n[0]!;
    else if (command === 'V' && n.length === 1) y = n[0]!;
    else if (command === 'A' && n.length === 7) {
      // The arc's circle (SVG's endpoint to center conversion, for a circle), whole: the arc
      // reaches no farther than its circle's far side.
      const [r, , , large, sweep, x2, y2] = n as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const [dx, dy] = [(x2 - x) / 2, (y2 - y) / 2];
      const half = Math.hypot(dx, dy);
      const radius = Math.max(r, half);
      const h = Math.sqrt(radius * radius - half * half) * (large === sweep ? -1 : 1);
      const [cx, cy] = half > 0 ? [x + dx - (h * dy) / half, y + dy + (h * dx) / half] : [x, y];
      most = Math.max(most, from(cx, cy) + radius);
      [x, y] = [x2, y2];
    } else if (command !== 'Z' || n.length > 0) {
      throw new Error(`glyphReach reads no ${command}${args ?? ''}`);
    }
    most = Math.max(most, from(x, y));
  }
  return most;
}

/** A regular star of `points` points about (32, 32), from radius `outer` to `inner`, clockwise. */
function star(points: number, outer: number, inner: number): string {
  const corners: string[] = [];
  for (let k = 0; k < 2 * points; k++) {
    const angle = (k * Math.PI) / points;
    const radius = k % 2 === 0 ? outer : inner;
    corners.push(
      `${(32 + radius * Math.sin(angle)).toFixed(2)} ${(32 - radius * Math.cos(angle)).toFixed(2)}`,
    );
  }
  return `M${corners.join('L')}Z`;
}

/** A blade from `from` to its point at `to`, `width` wide, with a crossguard near the hilt. */
function blade(from: [number, number], to: [number, number], width: number): string {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const length = Math.hypot(x1 - x0, y1 - y0);
  const [ux, uy] = [(x1 - x0) / length, (y1 - y0) / length];
  const [nx, ny] = [-uy, ux];
  const at = (along: number, across: number) =>
    `${(x0 + ux * along + nx * across).toFixed(2)} ${(y0 + uy * along + ny * across).toFixed(2)}`;
  const w = width / 2;
  const tip = length - 3 * w;
  // Clockwise on screen: up one side to the point, down the other, with the guard at 10 units.
  return [
    `M${at(0, -w)}`,
    `L${at(9, -w)}L${at(9, -3.2 * w)}L${at(12, -3.2 * w)}L${at(12, -w)}`,
    `L${at(tip, -w)}L${at(length, 0)}L${at(tip, w)}`,
    `L${at(12, w)}L${at(12, 3.2 * w)}L${at(9, 3.2 * w)}L${at(9, w)}L${at(0, w)}Z`,
  ].join('');
}

/** The dev page's four test glyphs. */
export const TEST_GLYPHS: GlyphSet = {
  'test-peak': 'M5 55L25 14L32 24L39 14L59 55Z',
  'test-blades': `${blade([10, 54], [54, 10], 6)}${blade([54, 54], [10, 10], 6)}`,
  'test-anchor': [
    // The ring, and its eye wound the other way.
    'M32 4A7 7 0 1 1 31.99 4Z',
    'M32 8A3 3 0 1 0 32.01 8Z',
    // Shank and stock.
    'M29 17H35V52H29Z',
    'M19 22H45V27H19Z',
    // The arms, an arc band wound as the rest (clockwise on screen), with flukes.
    'M56 36A24 24 0 0 1 8 36L14 36A18 18 0 0 0 50 36Z',
    'M4 38L11 29L15 39Z',
    'M60 38L53 29L49 39Z',
  ].join(''),
  'test-star': star(8, 29, 10),
};

/** The glyph set the look letters for its marks. */
export const MARK_GLYPHS: GlyphSet = TEST_GLYPHS;
