// A state name's letters along its baseline (nameLayout.ts): the tracking that fills the span the
// names stage fitted, held within the plane's least and most.
import { describe, expect, test } from 'vitest';
import type { NameGlyph } from './nameGlyphs';
import { layoutName, letteredText, NAME_CAP_EM, NAME_SPACE_EM, NAME_TRACK } from './nameLayout';

/** Every capital and small letter, 0.6 em wide, Ạ and ệ among them. */
const GLYPHS = new Map<string, NameGlyph>(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzẠệĐ'].map((char, i) => [
    char,
    { x: 10 * i, y: 5, advance: 0.6 },
  ]),
);

describe('a name laid out', () => {
  test('outer in capitals, inner as written', () => {
    expect(letteredText('Kingdom of Bavaria', 'outer')).toBe('KINGDOM OF BAVARIA');
    expect(letteredText('Kingdom of Bavaria', 'inner')).toBe('Kingdom of Bavaria');
  });

  test('spreads its letters over the span the stage fitted', () => {
    const track = 0.5 * NAME_CAP_EM;
    const span = 4 * 0.6 + 3 * track;
    const laid = layoutName('Iran', 'outer', span, GLYPHS);
    expect(laid?.track).toBeCloseTo(track, 9);
    expect(laid?.length).toBeCloseTo(span, 9);
    expect(laid?.scale).toBeCloseTo(1, 9);
    laid?.letters.forEach(({ u }, i) => expect(u).toBeCloseTo(i * (0.6 + track), 9));
    expect(laid?.letters).toHaveLength(4);
  });

  test('holds a space as a letter with no glyph', () => {
    const laid = layoutName('A B', 'outer', 10, GLYPHS);
    const track = laid?.track ?? 0;
    expect(laid?.letters).toHaveLength(2);
    expect(laid?.letters[1]?.u).toBeCloseTo(0.6 + NAME_SPACE_EM + 2 * track, 9);
  });

  test('keeps its tracking within the plane’s and draws smaller what overruns its span', () => {
    const [least, most] = NAME_TRACK.inner.map((caps) => caps * NAME_CAP_EM);
    expect(layoutName('Abc', 'inner', 100, GLYPHS)?.track).toBeCloseTo(most!, 9);
    const tight = layoutName('Abc', 'inner', 1, GLYPHS);
    expect(tight?.track).toBeCloseTo(least!, 9);
    expect(tight?.scale).toBeCloseTo(1 / (1.8 + 2 * least!), 9);
  });

  test('reaches every letter of a Vietnamese name, and none without a glyph', () => {
    expect(layoutName('Đại Việt', 'outer', 10, GLYPHS)).toBeNull();
    const laid = layoutName(
      'ĐẠI VIỆT',
      'inner',
      10,
      new Map([...GLYPHS, ['I', GLYPHS.get('I')!], ['Ệ', GLYPHS.get('ệ')!]]),
    );
    expect(laid?.letters).toHaveLength(7);
  });
});
