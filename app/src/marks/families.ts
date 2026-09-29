// Each pace layer's marks as one family: the material its marks take in each variant, so that no
// two layers part by glyph alone (docs/design/globe-language.md, principle 4). The variants are
// the owner's candidates, drawn side by side on renders until one is chosen:
//
//   0 Cast token (E1b): a raised bronze boss with its glyph worn bright; a raised dark seal with a
//     niello glyph; a small gilt seal with its glyph sunk. Each casts a contact shadow.
//   1 Cast and cut: a glyph raised in the bronze; a glyph engraved flush and filled with niello; a
//     gilt seal laid on.
//   2 Niello: a patina disc with a bright glyph; a polished disc with a black one; a gilt disc
//     with a black one.
//   3 Muted champlevé: verdigris, oxblood and ivory enamel in cells cut into the bronze.
//
// Every family is drawn by the look's inlay (marks.glsl.ts). A family whose chosen material has to
// stand proud of the relief, as E1b's token does, would get an instanced backend of its own.
import { Color, Vector4 } from 'three';

/** The pace layers whose events mark the globe (globe-language.md, Speeds and pace layers). */
export type Pace = 'nature' | 'governance' | 'infrastructure';
export const PACES: readonly Pace[] = ['nature', 'governance', 'infrastructure'];

export const MARK_VARIANTS = ['Cast token', 'Cast and cut', 'Niello', 'Muted champlevé'] as const;
export type MarkVariant = 0 | 1 | 2 | 3;

/** One part of a mark: its height (in r, the mark's radius: + raised, − cut), sRGB color, finish. */
export interface Part {
  height: number;
  color: string;
  roughness: number;
  metalness: number;
  /** How much of its own color it takes over the ground's: 1 all, 0 the ground's bronze. */
  fill: number;
}

/** A family's material in one variant. */
export interface Treatment {
  /** The disc the glyph sits on, `radius` in r; none, and the glyph is cut in the ground. */
  disc: (Part & { radius: number }) | null;
  /** The glyph, its 64-unit grid spanning `scale` of the mark's diameter. */
  glyph: Part & { scale: number };
  /** The share of the ground's relief a disc hides: a cast token sits on the relief. */
  flatten: number;
  /** A contact shadow cast on the ground away from the lamp. */
  shadow: boolean;
  /** A band of polished metal round the glyph, in r: champlevé's cell walls. */
  rim: number;
}

export interface Family {
  /** How the family's marks are drawn: inlaid by the look. */
  backend: 'inlay';
  variants: readonly [Treatment, Treatment, Treatment, Treatment];
}

const NIELLO = { color: '#0d0a08', roughness: 0.55, metalness: 0.1, fill: 1 };
const GILT = { color: '#dcb25a', roughness: 0.36, metalness: 1, fill: 1 };

/** A disc: its radius and height in r, color, roughness and metalness. */
const disc = (radius: number, height: number, color: string, roughness: number, metalness = 1) => ({
  radius,
  height,
  color,
  roughness,
  metalness,
  fill: 1,
});
/** A glyph over `scale` of the mark's diameter, `height` in r, in a finish. */
const glyph = (
  scale: number,
  height: number,
  finish: { color: string; roughness: number; metalness: number; fill: number },
) => ({ scale, height, ...finish });
const worn = (color: string, fill = 1) => ({ color, roughness: 0.35, metalness: 1, fill });

/** A cast token standing on the relief, which it hides, casting a contact shadow. */
const token = { flatten: 0.9, shadow: true, rim: 0 };
/**
 * Cut or laid into the bronze: the relief carries on round it, smoothed under the glyph so the
 * glyph's own edges catch the lamp, even at world view.
 */
const cut = { flatten: 0.6, shadow: false, rim: 0 };
/** A flush inlay, polished smooth. */
const inlay = { flatten: 0.85, shadow: false, rim: 0 };
/** Champlevé: enamel in cells cut into the bronze, with walls of polished metal round them. */
const enamel = (color: string): Treatment => ({
  disc: null,
  glyph: glyph(0.96, -0.025, { color, roughness: 0.3, metalness: 0, fill: 1 }),
  flatten: 0.7,
  shadow: false,
  rim: 0.09,
});

export const FAMILIES: Record<Pace, Family> = {
  nature: {
    backend: 'inlay',
    variants: [
      { disc: disc(1, 0.13, '#76552a', 0.5), glyph: glyph(0.6, 0.04, worn('#ecd08c')), ...token },
      { disc: null, glyph: glyph(0.96, 0.1, worn('#e2bc72', 0.8)), ...cut },
      {
        disc: disc(1, 0.015, '#43604e', 0.65, 0.3),
        glyph: glyph(0.66, 0, worn('#e8c880')),
        ...inlay,
      },
      enamel('#4f7563'),
    ],
  },
  governance: {
    backend: 'inlay',
    variants: [
      { disc: disc(1, 0.12, '#5a4029', 0.5, 0.85), glyph: glyph(0.6, -0.07, NIELLO), ...token },
      { disc: null, glyph: glyph(0.96, -0.07, NIELLO), ...cut },
      { disc: disc(1, 0.015, '#a06a36', 0.35), glyph: glyph(0.66, -0.02, NIELLO), ...inlay },
      enamel('#6a2620'),
    ],
  },
  infrastructure: {
    backend: 'inlay',
    variants: [
      {
        disc: { ...GILT, radius: 0.8, height: 0.12 },
        glyph: glyph(0.5, -0.05, worn('#7d5b26', 0.85)),
        ...token,
      },
      {
        disc: { ...GILT, radius: 0.9, height: 0.07 },
        glyph: glyph(0.6, -0.04, worn('#7a5a24', 0.85)),
        ...cut,
      },
      {
        disc: { ...GILT, radius: 1, height: 0.015, color: '#e6c062' },
        glyph: glyph(0.66, -0.02, NIELLO),
        ...inlay,
      },
      enamel('#bfb294'),
    ],
  },
};

/** The vec4s the look reads per family (marks.glsl.ts, lookMarkFamily). */
export const FAMILY_VEC4S = 5;

/**
 * Every family's treatment in `variant`, in PACES order, as the look's uniform: per family the
 * disc's linear color and radius (0: none); the glyph's color and scale; the disc's and glyph's
 * heights and roughness; their metalness, the flattening and the shadow; their fills and the rim.
 */
export function familyUniforms(variant: MarkVariant, out: Vector4[]): Vector4[] {
  const color = new Color();
  PACES.forEach((pace, f) => {
    const t = FAMILIES[pace].variants[variant];
    const disc = t.disc;
    const at = (k: number) => out[f * FAMILY_VEC4S + k] ?? new Vector4();
    color.set(disc?.color ?? '#000000');
    at(0).set(color.r, color.g, color.b, disc?.radius ?? 0);
    color.set(t.glyph.color);
    at(1).set(color.r, color.g, color.b, t.glyph.scale);
    at(2).set(disc?.height ?? 0, t.glyph.height, disc?.roughness ?? 1, t.glyph.roughness);
    at(3).set(disc?.metalness ?? 0, t.glyph.metalness, t.flatten, t.shadow ? 1 : 0);
    at(4).set(disc?.fill ?? 0, t.glyph.fill, t.rim, 0);
  });
  return out;
}
