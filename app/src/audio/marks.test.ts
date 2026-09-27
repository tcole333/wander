import { describe, expect, it } from 'vitest';
import { dayFromIso } from '../story/dates';
import { marksPassed } from './marks';

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
});
