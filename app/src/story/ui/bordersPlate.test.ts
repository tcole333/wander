// The borders' year plate names the year their step begins, as history writes it.
import { expect, test } from 'vitest';
import { bordersLabel } from './bordersPlate';

test('the plate names the year', () => {
  expect(bordersLabel(1815)).toBe('Borders · 1815');
});
