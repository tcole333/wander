// Every variant gives each pace layer's family a material of its own, so no two layers part by
// glyph alone; and the look without marks compiles none of their code.
import { Color, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { lookFragment } from '../look/lookFragment.glsl';
import { EVENT_CLASS_SYMBOLS } from './eventSymbols';
import {
  FAMILIES,
  familyUniforms,
  FAMILY_VEC4S,
  MARK_VARIANTS,
  PACES,
  TOKEN_INK,
  type Pace,
} from './families';
import { GLYPH_UNITS, glyphReach } from './glyphs';
import { markPx } from './marks';
import { EVENT_GLYPHS } from './symbols';

describe('FAMILIES', () => {
  it.each(MARK_VARIANTS.map((name, variant) => [name, variant] as const))(
    '%s gives each family its own material',
    (_, variant) => {
      const looks = PACES.map((pace) => {
        const t = FAMILIES[pace].variants[variant];
        return JSON.stringify([t?.disc?.color, t?.disc?.radius, t?.glyph.color, t?.glyph.height]);
      });
      expect(new Set(looks).size).toBe(PACES.length);
    },
  );
});

describe('the cast token', () => {
  /** How far each of a family's glyphs reaches from its token's center, in r. */
  const reaches = (pace: Pace) => {
    const { glyph } = FAMILIES[pace].variants[0];
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
    const seal = TOKEN_INK * (FAMILIES[pace].variants[0].disc?.radius ?? 0);
    const far = reaches(pace);
    expect(far.filter(([, reach]) => reach > seal)).toEqual([]);
    // Scaled for its farthest-reaching glyph: a hundredth more, and that glyph would leave it.
    const { scale } = FAMILIES[pace].variants[0].glyph;
    const farthest = Math.max(...far.map(([, reach]) => reach));
    expect((farthest * (scale + 0.01)) / scale).toBeGreaterThan(seal);
  });

  it.each(PACES)('holds the %s glyph over more than 7 device px on the smallest mark', (pace) => {
    // The least the drawing rules (symbols.ts) hold a glyph to: a 6-unit stroke two thirds of a
    // device pixel. markMinDevicePx takes it past that where the globe draws one to a CSS px.
    const { scale } = FAMILIES[pace].variants[0].glyph;
    for (const ratio of [1, 1.25, 1.5, 2]) {
      expect(scale * markPx(Infinity, ratio) * ratio, `${ratio}`).toBeGreaterThan(7);
    }
  });
});

describe('familyUniforms', () => {
  it('holds each family’s disc and glyph in linear color, in PACES order', () => {
    const out = Array.from({ length: PACES.length * FAMILY_VEC4S }, () => new Vector4());
    familyUniforms(2, out);
    const nature = FAMILIES.nature.variants[2];
    const color = new Color(nature.disc?.color);
    expect(out[0]?.toArray()).toEqual([color.r, color.g, color.b, nature.disc?.radius]);
    expect(out[FAMILY_VEC4S + 1]?.w).toBe(FAMILIES.governance.variants[2].glyph.scale);
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
