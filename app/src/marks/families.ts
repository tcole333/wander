// Each pace layer's marks as one family: the material its marks take, so that no two layers part by
// glyph alone (docs/design/globe-language.md, principle 4). Every mark is a seal standing on the
// relief, which it hides, casting a contact shadow, ringed by a polished brass bezel that catches
// the lamp and parts it from the bronze around it; each family's seal and glyph are its own:
//
//   nature          a green patina seal with a bright worn glyph;
//   governance      a dark niello seal with a gilt glyph;
//   infrastructure  a smaller gilt seal with a niello glyph.
//
// Every family is drawn by the look's inlay (marks.glsl.ts). A family whose material has to stand
// proud of the relief would get an instanced backend of its own.
import { Color, Vector4 } from 'three';

/** The pace layers whose events mark the globe (globe-language.md, Speeds and pace layers). */
export type Pace = 'nature' | 'governance' | 'infrastructure';
export const PACES: readonly Pace[] = ['nature', 'governance', 'infrastructure'];

/** One part of a mark: its height (in r, the mark's radius: + raised, − cut), sRGB color, finish. */
export interface Part {
  height: number;
  color: string;
  roughness: number;
  metalness: number;
}

/** A family's material. */
export interface Family {
  /** The seal the glyph sits on, `radius` in r. */
  seal: Part & { radius: number };
  /** The polished band just inside the seal's edge: its width in r, sRGB color and roughness. */
  bezel: { width: number; color: string; roughness: number };
  /** The glyph, its 64-unit grid spanning `scale` of the mark's diameter. */
  glyph: Part & { scale: number };
  /** The share of the ground's relief the seal hides, standing on it. */
  flatten: number;
}

/**
 * How far a seal's glyph may reach from its center, as a share of the seal's radius: its farthest
 * ink keeps to the seal's face, inside the bezel and clear of the rim the seal's bevel (markBevel)
 * casts. Each family's glyph scale is the largest that holds its farthest-reaching glyph there,
 * which families.test.ts measures; legible on the smallest mark is markMinDevicePx's part.
 */
export const SEAL_INK = 0.8;

const NIELLO = { color: '#0d0a08', roughness: 0.55, metalness: 0.1 };
/** A seal: its radius and height in r, color, roughness and metalness. */
const seal = (
  radius: number,
  height: number,
  color: string,
  roughness: number,
  metalness: number,
) => ({
  radius,
  height,
  color,
  roughness,
  metalness,
});
/** A glyph over `scale` of the mark's diameter, `height` in r, in a finish. */
const glyph = (
  scale: number,
  height: number,
  finish: { color: string; roughness: number; metalness: number },
) => ({ scale, height, ...finish });
/**
 * Gilt's metalness: polished, but with a share of its color lit as a diffuse surface is. Wholly
 * metal, gilt reflects only what lies in its mirror direction, which in a tilted view is the dark
 * room rather than the lamp behind the camera: a flat gilt face reads as dark as niello there, and a
 * glyph as its bevel's two bright rims.
 */
const GILT_METALNESS = 0.6;
/** A glyph's worn metal, bright where hands have polished it. */
const worn = (color: string) => ({ color, roughness: 0.35, metalness: GILT_METALNESS });
/** A polished bezel `width` of r inside the seal's edge. */
const bezel = (width: number, color: string) => ({ width, color, roughness: 0.3 });

export const FAMILIES: Record<Pace, Family> = {
  nature: {
    // The eruption and the slide reach 37.5 of the grid's 32 units from its center.
    seal: seal(1, 0.13, '#4a6a55', 0.5, 0.5),
    bezel: bezel(0.13, '#ecca80'),
    glyph: glyph(0.68, 0.05, worn('#efd28e')),
    flatten: 0.9,
  },
  governance: {
    // The treaty's seal reaches 35.4 units.
    seal: seal(1, 0.12, '#1c1510', 0.5, 0.2),
    bezel: bezel(0.13, '#e2bc6c'),
    glyph: glyph(0.72, 0.04, { color: '#e8bf64', roughness: 0.32, metalness: GILT_METALNESS }),
    flatten: 0.9,
  },
  infrastructure: {
    // The wreck reaches 36.1 units, on a seal 0.8 of the mark's radius.
    seal: seal(0.8, 0.12, '#dcb25a', 0.36, GILT_METALNESS),
    bezel: bezel(0.1, '#f6de9c'),
    glyph: glyph(0.56, -0.05, NIELLO),
    flatten: 0.9,
  },
};

/** The vec4s the look reads per family (marks.glsl.ts, lookMarkFamily). */
export const FAMILY_VEC4S = 5;

/**
 * Every family's material, in PACES order, as the look's uniform: per family the seal's linear
 * color and radius; the glyph's color and scale; the seal's and glyph's heights and roughness;
 * their metalness, the flattening and the bezel's roughness; the bezel's linear color and width.
 */
export function familyUniforms(out: Vector4[]): Vector4[] {
  const color = new Color();
  PACES.forEach((pace, f) => {
    const { seal, bezel, glyph, flatten } = FAMILIES[pace];
    const at = (k: number) => out[f * FAMILY_VEC4S + k] ?? new Vector4();
    color.set(seal.color);
    at(0).set(color.r, color.g, color.b, seal.radius);
    color.set(glyph.color);
    at(1).set(color.r, color.g, color.b, glyph.scale);
    at(2).set(seal.height, glyph.height, seal.roughness, glyph.roughness);
    at(3).set(seal.metalness, glyph.metalness, flatten, bezel.roughness);
    color.set(bezel.color);
    at(4).set(color.r, color.g, color.b, bezel.width);
  });
  return out;
}
