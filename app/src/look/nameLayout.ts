// A state name's letters as the look cuts them (stateNames.glsl.ts): each letter's glyph and where
// its pen stands along the baseline, ems from the name's left end. The names stage fits the letters
// with the faces' own advances and spreads them by tracking over the span it records (streaming.md
// 3.3, Names), so the tracking that fills that span again is the span less the advances over the
// gaps between letters, a space being a letter there as in the stage; it is held within the plane's
// least and most, and a name whose letters at their least overrun the span is drawn smaller.
import type { NameGlyph, NamePlane } from './nameGlyphs';

/** Both faces' capitals' height, ems (their OS/2 cap height, as the names stage reads it). */
export const NAME_CAP_EM = 0.625;
/** The space's advance in both faces, ems: a space is a letter without a glyph. */
export const NAME_SPACE_EM = 0.234;
/** Tracking between letters, cap heights, least and most, by plane: names.yaml's `track`. */
export const NAME_TRACK: Record<NamePlane, readonly [number, number]> = {
  outer: [0.32, 1.04],
  inner: [0.13, 0.58],
};

/** A name lettered: its letters with glyphs, its length and tracking in ems, and its em's scale. */
export interface NameLetters {
  /** Each letter that has a glyph, and its pen's place, ems from the name's left end. */
  letters: { glyph: NameGlyph; u: number }[];
  /** From the first letter's pen to the last letter's advance, ems: the drawn span. */
  length: number;
  track: number;
  /** Below 1 where the letters at their least tracking overrun the span: the em drawn smaller. */
  scale: number;
}

/** The letters a name is drawn in: outer names in capitals, inner names as written. */
export function letteredText(text: string, plane: NamePlane): string {
  return plane === 'outer' ? text.toUpperCase() : text;
}

/**
 * Lays a name's letters out over `spanEm`, its span in its own ems; null where a letter has no
 * glyph in `glyphs`, which the names stage's check rules out for the release's faces.
 */
export function layoutName(
  text: string,
  plane: NamePlane,
  spanEm: number,
  glyphs: ReadonlyMap<string, NameGlyph>,
): NameLetters | null {
  const chars = [...letteredText(text, plane)];
  const advances: number[] = [];
  for (const char of chars) {
    if (char === ' ') {
      advances.push(NAME_SPACE_EM);
      continue;
    }
    const glyph = glyphs.get(char);
    if (!glyph) return null;
    advances.push(glyph.advance);
  }
  const natural = advances.reduce((sum, advance) => sum + advance, 0);
  const gaps = Math.max(1, chars.length - 1);
  const [least, most] = NAME_TRACK[plane].map((caps) => caps * NAME_CAP_EM) as [number, number];
  const track = Math.min(most, Math.max(least, (spanEm - natural) / gaps));
  const length = natural + track * (chars.length - 1);
  const letters: NameLetters['letters'] = [];
  let u = 0;
  chars.forEach((char, i) => {
    const glyph = char === ' ' ? undefined : glyphs.get(char);
    if (glyph) letters.push({ glyph, u });
    u += (advances[i] ?? 0) + track;
  });
  return { letters, length, track, scale: Math.min(1, spanEm / Math.max(length, 1e-9)) };
}
