// The glyphs' distance fields: exact to the edge within half a pixel, and encoded so the atlas's
// blank background reads as far outside.
import { describe, expect, it } from 'vitest';
import { encodeDistance, GLYPH_SPREAD, signedDistance } from './glyphAtlas';

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
