import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../story/dates';
import { rumbleLevel } from './bed';

describe("the Tambora bed's rumble", () => {
  it('peaks at the eruption and recedes to room tone', () => {
    const at = (iso: string) => rumbleLevel(dayFromIso(iso));
    expect(at('1815-04-11')).toBe(1);
    expect(at('1815-03-01')).toBeLessThan(at('1815-04-05'));
    expect(at('1816-07-01')).toBeLessThan(at('1815-07-15'));
    expect(at('1818-01-01')).toBe(0);
  });
});
