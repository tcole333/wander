import { describe, expect, it } from 'vitest';
import { EVENT_GLYPHS, GLYPH_GRID } from './symbols';

const MARGIN = 4;

/** Each subpath's reach: its vertices, and for each half-circle arc the circle's box. */
function reach(path: string): { closed: boolean; x: number[]; y: number[] }[] {
  const subpaths: { closed: boolean; x: number[]; y: number[] }[] = [];
  let at: [number, number] = [0, 0];
  for (const [, command, args] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (args!.match(/-?[\d.]+/g) ?? []).map(Number);
    const current = subpaths.at(-1);
    if (command === 'M' && n.length === 2) {
      at = [n[0]!, n[1]!];
      subpaths.push({ closed: false, x: [at[0]], y: [at[1]] });
    } else if (command === 'L' && n.length === 2 && current && !current.closed) {
      at = [n[0]!, n[1]!];
      current.x.push(at[0]);
      current.y.push(at[1]);
    } else if (command === 'A' && n.length === 7 && current && !current.closed) {
      const [r, , , , , x, y] = n as [number, number, number, number, number, number, number];
      // Circles are drawn as two half-circle arcs, so each arc spans a diameter.
      expect(Math.hypot(x - at[0], y - at[1])).toBeCloseTo(2 * r, 1);
      const center = [(x + at[0]) / 2, (y + at[1]) / 2] as const;
      current.x.push(center[0] - r, center[0] + r);
      current.y.push(center[1] - r, center[1] + r);
      at = [x, y];
    } else if (command === 'Z' && n.length === 0 && current) {
      current.closed = true;
    } else {
      throw new Error(`unexpected ${command}${args} in ${path.slice(0, 40)}…`);
    }
  }
  return subpaths;
}

describe('glyphs', () => {
  it.each(Object.entries(EVENT_GLYPHS))(
    '%s is closed subpaths of lines and circles, 4 units inside its cell',
    (_, path) => {
      const subpaths = reach(path);
      expect(subpaths.length).toBeGreaterThan(0);
      expect(subpaths.every((s) => s.closed)).toBe(true);
      const all = subpaths.flatMap((s) => [...s.x, ...s.y]);
      expect(all.every(Number.isFinite)).toBe(true);
      expect(Math.min(...all)).toBeGreaterThanOrEqual(MARGIN);
      expect(Math.max(...all)).toBeLessThanOrEqual(GLYPH_GRID - MARGIN);
    },
  );
});
