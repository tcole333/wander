// Every variant gives each pace layer's family a material of its own, so no two layers part by
// glyph alone; and the look without marks compiles none of their code.
import { Color, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { lookFragment } from '../look/lookFragment.glsl';
import { FAMILIES, familyUniforms, FAMILY_VEC4S, MARK_VARIANTS, PACES } from './families';

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
  it('holds its glyph over three quarters of its seal, inside the rim, at every size', () => {
    const smallest = Math.min(...tunables.markPx.map((row) => row.px));
    for (const pace of PACES) {
      const { disc, glyph } = FAMILIES[pace].variants[0];
      const radius = disc?.radius ?? 0;
      // A glyph keeps to its grid's inscribed circle, 28 of its 32 units from the centre.
      expect(glyph.scale * (28 / 32), pace).toBeLessThan(0.7 * radius);
      expect(glyph.scale / radius, pace).toBeCloseTo(0.74);
      expect(glyph.scale * smallest, pace).toBeGreaterThan(7);
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
