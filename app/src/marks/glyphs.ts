// The glyphs the look's marks are cut from: SVG path data on a 64-unit grid, y down, filled by the
// nonzero rule (a subpath wound the other way cuts a hole). The look letters them once, as signed
// distance fields on a shelf of its sea-name atlas (glyphAtlas.ts), and every mark names one: the
// event glyphs of the symbol family (symbols.ts), which Explore's marks take by their class
// (eventSymbols.ts).
import { EVENT_GLYPHS, GLYPH_UNITS } from './symbols';

export { GLYPH_UNITS };

/** Glyph names to SVG path data on a 64-unit grid, y down, nonzero fill. */
export type GlyphSet = Readonly<Record<string, string>>;

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

/** The glyph set the look letters for its marks. */
export const MARK_GLYPHS: GlyphSet = EVENT_GLYPHS;
