import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../story/dates';
import { marksPassed, paceDetents, type Detent } from './marks';

describe("the ruler's marks", () => {
  it('passes the marks the ruler engraves, each weighted by what it begins', () => {
    const [from, to] = [dayFromIso('1815-12-30') + 0.5, dayFromIso('1816-01-02') + 0.5];
    const weights = (finest: 'day' | 'month' | 'year') =>
      marksPassed(from, to, finest).map((mark) => mark.weight);
    expect(weights('day')).toEqual(['day', 'year', 'day']);
    expect(weights('month')).toEqual(['year']);
    expect(marksPassed(to, from, 'day').map((mark) => mark.day)).toEqual([
      dayFromIso('1816-01-02'),
      dayFromIso('1816-01-01'),
      dayFromIso('1815-12-31'),
    ]);
  });

  it('keeps a fast sweep to the cap, dropping days before months and years', () => {
    // Sixty days in a second, with a month's mark and a year's among them.
    const asked: Detent[] = Array.from({ length: 60 }, (_, k) => ({ at: k / 60, weight: 'day' }));
    asked[20] = { at: 20 / 60, weight: 'month' };
    asked[50] = { at: 50 / 60, weight: 'year' };
    const kept = paceDetents(asked, 1 / 25, null);
    expect(kept.length).toBeLessThanOrEqual(25);
    expect(kept.filter((d) => d.weight !== 'day')).toEqual([asked[20], asked[50]]);
    const gaps = kept.slice(1).map((d, k) => d.at - (kept[k]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1 / 25 - 1e-9);
  });
});
