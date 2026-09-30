// The look's one climate field: it rewrites and uploads only for a blend it does not hold, so a
// story's month drawn after Explore's draws again instead of keeping Explore's.
import { describe, expect, it } from 'vitest';
import { monthsAround, parseClimate } from '../data/climate';
import { createClimateUniforms } from '../look/climateHook';
import { dayFromIso } from '../story/dates';
import { syntheticYear } from '../test/climate';
import { climateFieldOf, ClimateField } from './field';

const read = (year: number) => parseClimate(syntheticYear(96, 192, year));

describe('the climate field', () => {
  it('is one per look', () => {
    const uniforms = createClimateUniforms();
    expect(climateFieldOf(uniforms)).toBe(climateFieldOf(uniforms));
    expect(climateFieldOf(createClimateUniforms())).not.toBe(climateFieldOf(uniforms));
    expect(climateFieldOf(undefined)).toBeUndefined();
  });

  it('uploads a blend once, however often it is asked for', () => {
    const uniforms = createClimateUniforms();
    const field = new ClimateField(uniforms);
    const texture = uniforms.lookClimateField.value;
    const [a, b] = [read(1816), read(1816)];
    const blend = monthsAround(dayFromIso('1816-07-01'));
    const before = texture.version;
    expect(field.draw(a, b, blend)).toBe(true);
    expect(field.draw(a, b, blend)).toBe(false);
    expect(field.draw(a, b, { ...blend, w: blend.w + 1e-5 })).toBe(false);
    expect(texture.version - before).toBe(1);
  });

  it('rewrites for another month, another weight or another file', () => {
    const field = new ClimateField(createClimateUniforms());
    const [a, b] = [read(1816), read(1816)];
    const july = monthsAround(dayFromIso('1816-07-01'));
    field.draw(a, a, july);
    expect(field.draw(a, a, monthsAround(dayFromIso('1816-07-02')))).toBe(true);
    expect(field.draw(a, a, monthsAround(dayFromIso('1816-08-20')))).toBe(true);
    expect(field.draw(b, b, monthsAround(dayFromIso('1816-08-20')))).toBe(true);
  });
});
