// The borders' year plate names the snapshot's year as history writes it.
import { expect, test } from 'vitest';
import { bordersLabel } from './bordersPlate';

test('the plate names the year, BC years as history writes them', () => {
  expect(bordersLabel(1815)).toBe('Borders · 1815');
  expect(bordersLabel(-122999)).toBe('Borders · 123000 BC');
});
