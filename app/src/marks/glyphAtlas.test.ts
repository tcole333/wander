// The glyphs' distance fields: exact to the edge within half a pixel, and encoded so the atlas's
// blank background reads as far outside.
import { describe, expect, it } from 'vitest';
import {
  encodeDistance,
  extentOf,
  GLYPH_CELL,
  GLYPH_MARGIN,
  GLYPH_SPREAD,
  signedDistance,
} from './glyphAtlas';
import { GLYPH_UNITS } from './glyphs';
import { GLYPH_FIELD } from './marks.glsl';

describe('signedDistance', () => {
  it('measures a disc to within half a pixel, positive inside', () => {
    const size = 64;
    const radius = 20.3;
    const inside = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        inside[y * size + x] = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) < radius ? 1 : 0;
      }
    }
    const field = signedDistance(inside, size, size);
    let worst = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const exact = radius - Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
        worst = Math.max(worst, Math.abs((field[y * size + x] ?? 0) - exact));
      }
    }
    expect(worst).toBeLessThan(0.75);
  });

  it('puts every pixel far outside when there is no glyph', () => {
    const field = signedDistance(new Uint8Array(16), 4, 4);
    expect(Math.max(...field)).toBeLessThan(-1e6);
  });
});

describe('encodeDistance', () => {
  it('holds the edge at 128 and the spread either side at the ends', () => {
    expect([0, GLYPH_SPREAD, -GLYPH_SPREAD, -1e9].map(encodeDistance)).toEqual([128, 255, 1, 0]);
  });
});

describe('extentOf', () => {
  it('reaches a grid-filling glyph’s corners, in half grids', () => {
    const side = GLYPH_CELL * 4;
    const [from, to] = [GLYPH_MARGIN * 4, (GLYPH_MARGIN + GLYPH_UNITS) * 4];
    const inside = new Uint8Array(side * side);
    for (let y = from; y < to; y++) inside.fill(1, y * side + from, y * side + to);
    expect(extentOf(inside, side)).toBeCloseTo(Math.SQRT2, 2);
  });
});

describe('the look’s reading of a glyph field', () => {
  const half = GLYPH_UNITS / 2;

  it('ends every edge before the bytes run out, a step short of their end', () => {
    const lastStep = ((127 - 2) / 127) * GLYPH_SPREAD;
    expect(GLYPH_FIELD.reach * half).toBeLessThan(lastStep);
  });

  it('reads within the cell, and reaches past a glyph at the grid’s edge', () => {
    expect(GLYPH_FIELD.box * half).toBeLessThanOrEqual(half + GLYPH_MARGIN);
    expect(GLYPH_FIELD.box - GLYPH_FIELD.reach).toBeGreaterThan(1 - 1e-9);
  });
});
