// Each pace layer's family has a material of its own, so no two layers part by glyph alone, and
// holds every glyph of its family on its seal's face; the look without marks compiles none of their
// code.
import { Color, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { lookFragment } from '../look/lookFragment.glsl';
import { EVENT_CLASS_SYMBOLS } from './eventSymbols';
import { FAMILIES, familyUniforms, FAMILY_VEC4S, PACES, SEAL_INK, type Pace } from './families';
import { GLYPH_UNITS, glyphReach } from './glyphs';
import { markPx } from './marks';
import { EVENT_GLYPHS } from './symbols';

describe('FAMILIES', () => {
  it('gives each family a seal and a glyph of its own', () => {
    const seals = PACES.map((pace) => FAMILIES[pace].seal.color);
    const glyphs = PACES.map((pace) => FAMILIES[pace].glyph.color);
    expect(new Set(seals).size).toBe(PACES.length);
    expect(new Set(glyphs).size).toBe(PACES.length);
  });
});

describe('the seal', () => {
  /** How far each of a family's glyphs reaches from its seal's center, in r. */
  const reaches = (pace: Pace) => {
    const { glyph } = FAMILIES[pace];
    const glyphs = new Set(
      Object.values(EVENT_CLASS_SYMBOLS)
        .filter((symbol) => symbol.pace === pace)
        .map((symbol) => symbol.glyph),
    );
    return [...glyphs].map(
      (id) => [id, (glyph.scale * glyphReach(EVENT_GLYPHS[id])) / (GLYPH_UNITS / 2)] as const,
    );
  };

  it.each(PACES)('keeps every %s glyph on its seal’s face, as large as the face allows', (pace) => {
    const seal = SEAL_INK * FAMILIES[pace].seal.radius;
    const far = reaches(pace);
    expect(far.filter(([, reach]) => reach > seal)).toEqual([]);
    // Scaled for its farthest-reaching glyph: a hundredth more, and that glyph would leave it.
    const { scale } = FAMILIES[pace].glyph;
    const farthest = Math.max(...far.map(([, reach]) => reach));
    expect((farthest * (scale + 0.01)) / scale).toBeGreaterThan(seal);
  });

  it.each(PACES)('keeps the %s seal’s face inside its bezel', (pace) => {
    const { seal, bezel } = FAMILIES[pace];
    expect(SEAL_INK * seal.radius).toBeLessThan(seal.radius - bezel.width);
  });

  it.each(PACES)('holds the %s glyph over more than 7 device px on the smallest mark', (pace) => {
    // The least the drawing rules (symbols.ts) hold a glyph to: a 6-unit stroke two thirds of a
    // device pixel. markMinDevicePx takes it past that where the globe draws one to a CSS px.
    const { scale } = FAMILIES[pace].glyph;
    for (const ratio of [1, 1.25, 1.5, 2]) {
      expect(scale * markPx(Infinity, ratio) * ratio, `${ratio}`).toBeGreaterThan(7);
    }
  });
});

describe('familyUniforms', () => {
  it('holds each family’s seal, glyph and bezel in linear color, in PACES order', () => {
    const out = Array.from({ length: PACES.length * FAMILY_VEC4S }, () => new Vector4());
    familyUniforms(out);
    const { seal } = FAMILIES.nature;
    const color = new Color(seal.color);
    expect(out[0]?.toArray()).toEqual([color.r, color.g, color.b, seal.radius]);
    expect(out[FAMILY_VEC4S + 1]?.w).toBe(FAMILIES.governance.glyph.scale);
    const { bezel } = FAMILIES.infrastructure;
    const brass = new Color(bezel.color);
    expect(out[2 * FAMILY_VEC4S + 4]?.toArray()).toEqual([brass.r, brass.g, brass.b, bezel.width]);
  });
});

describe('lookFragment', () => {
  it('compiles no marks code without marks', () => {
    const chunks = Object.values(lookFragment({ marks: false })).join('\n');
    expect(chunks).not.toMatch(/mark/i);
  });

  it('cuts the marks in with them', () => {
    const chunks = lookFragment({ marks: true });
    expect(chunks.pars).toContain('void lookMarksApply(inout LookSurface o');
    expect(chunks.pars).toContain('lookMarksApply(o, gratDir, lookMarkDx, lookMarkDy);');
    expect(chunks.specular).toContain('totalEmissiveRadiance += lookS.marks.glow');
  });
});
