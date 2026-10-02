// The state names' glyphs (streaming.md 3.3, Names): every character the release's names section
// lists for a face, outer names' capitals in Cormorant Garamond 700 and inner names' small capitals
// in Cormorant SC 700, as signed distance fields in fixed cells on shelves of the sea-name atlas,
// below the marks' glyphs (seaNames.ts). The cells are fixed, so the atlas keeps their rows from
// boot; the faces load and the glyphs are lettered after the first frame, a glyph a turn, each
// filled at SUPERSAMPLE times its cell on a 2D canvas and its exact distance transform averaged
// down (marks/glyphAtlas.ts), and the canvas released.
//
// A cell holds its glyph's pen origin NAME_SPREAD texels in from its left and top edges plus
// NAME_CELL_EM's reach, at NAME_EM texels an em. A texel holds 128 + 127 × distance / NAME_SPREAD,
// the distance in texels to the glyph's edge, positive inside.
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-sc/700.css';
import { signedDistance, writeField, yieldToPage } from '../marks/glyphAtlas';

/** Texels an em. */
export const NAME_EM = 40;
/**
 * Texels of distance either side of an edge that a byte spans, and the cells' margin: past the
 * calm band's reach of a third of an em.
 */
export const NAME_SPREAD = 14;
/**
 * How far a cell reaches from its glyph's pen origin, ems: past every glyph of both faces, whose
 * ink spans −0.06 to 0.92 across and −0.28 to 0.91 up (Ễ, ę and W).
 */
export const NAME_CELL_EM = { left: 0.08, right: 0.95, up: 0.93, down: 0.3 } as const;
export const NAME_CELL = {
  width: Math.ceil((NAME_CELL_EM.left + NAME_CELL_EM.right) * NAME_EM) + 2 * NAME_SPREAD,
  height: Math.ceil((NAME_CELL_EM.up + NAME_CELL_EM.down) * NAME_EM) + 2 * NAME_SPREAD,
} as const;
/** The pen origin within its cell, texels from its top-left corner. */
export const NAME_ORIGIN = {
  x: NAME_SPREAD + NAME_CELL_EM.left * NAME_EM,
  y: NAME_SPREAD + NAME_CELL_EM.up * NAME_EM,
} as const;
/** The fill's resolution over the cell's, before the field is averaged down. */
const SUPERSAMPLE = 4;

export type NamePlane = 'outer' | 'inner';

/** Each face's family, at weight 700. */
export const NAME_FAMILIES: Record<NamePlane, string> = {
  outer: 'Cormorant Garamond',
  inner: 'Cormorant SC',
};

/** The characters each face letters: the release's `names.glyphs`. */
export interface NameGlyphSet {
  outer: string;
  inner: string;
}

/** A lettered glyph: its pen origin in the atlas, texels, and its advance, ems. */
export interface NameGlyph {
  x: number;
  y: number;
  advance: number;
}

export type NameGlyphs = Record<NamePlane, ReadonlyMap<string, NameGlyph>>;

/** Where each glyph's cell lies on shelves `width` texels wide, row 0 first. */
export interface NameShelf {
  width: number;
  height: number;
  cells: { plane: NamePlane; char: string; x: number; y: number }[];
}

/** The font a face is lettered in at `px` px an em. */
export function nameFont(plane: NamePlane, px: number): string {
  return `700 ${px}px "${NAME_FAMILIES[plane]}"`;
}

/** The shelves' cells for every character of both faces, outer first, before any is lettered. */
export function nameShelf(set: NameGlyphSet, width: number): NameShelf {
  const perRow = Math.max(1, Math.floor(width / NAME_CELL.width));
  const cells: NameShelf['cells'] = [];
  for (const plane of ['outer', 'inner'] as const) {
    for (const char of new Set(set[plane])) {
      if (char.trim() === '') continue;
      const n = cells.length;
      cells.push({
        plane,
        char,
        x: (n % perRow) * NAME_CELL.width,
        y: Math.floor(n / perRow) * NAME_CELL.height,
      });
    }
  }
  const rows = Math.ceil(cells.length / perRow);
  return { width, height: rows * NAME_CELL.height, cells };
}

/**
 * Letters every glyph of `shelf` into its cell: the shelf's bytes, row 0 first, and each glyph's
 * origin (texels, `top` rows down the atlas) and advance. The faces must have loaded.
 */
export async function letterNameShelf(
  shelf: NameShelf,
  top: number,
): Promise<{ data: Uint8Array; glyphs: NameGlyphs }> {
  const { width, height, cells } = shelf;
  const data = new Uint8Array(width * height);
  const glyphs = { outer: new Map<string, NameGlyph>(), inner: new Map<string, NameGlyph>() };
  if (cells.length === 0) return { data, glyphs };
  const s = SUPERSAMPLE;
  const canvas = document.createElement('canvas');
  canvas.width = NAME_CELL.width * s;
  canvas.height = NAME_CELL.height * s;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D canvas');
  const cell = { width: NAME_CELL.width, height: NAME_CELL.height, supersample: s };
  try {
    for (const [n, { plane, char, x, y }] of cells.entries()) {
      if (n > 0) await yieldToPage();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      ctx.font = nameFont(plane, NAME_EM * s);
      ctx.fillText(char, NAME_ORIGIN.x * s, NAME_ORIGIN.y * s);
      const advance = ctx.measureText(char).width / (NAME_EM * s);
      const { data: rgba } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const inside = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < inside.length; i++) inside[i] = (rgba[i * 4] ?? 0) >= 128 ? 1 : 0;
      const field = signedDistance(inside, canvas.width, canvas.height);
      writeField(field, cell, NAME_SPREAD, data, width, x, y);
      glyphs[plane].set(char, { x: x + NAME_ORIGIN.x, y: top + y + NAME_ORIGIN.y, advance });
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  return { data, glyphs };
}

/**
 * Loads both faces for the characters they letter; false when either is not there after, as
 * where a face's file fails, and its glyphs would be the fallback's.
 */
export async function loadNameFaces(set: NameGlyphSet): Promise<boolean> {
  const planes = ['outer', 'inner'] as const;
  await Promise.all(
    planes.map((plane) => document.fonts.load(nameFont(plane, NAME_EM), set[plane])),
  );
  return planes.every((plane) => document.fonts.check(nameFont(plane, NAME_EM), set[plane]));
}
