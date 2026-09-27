import { describe, expect, it } from 'vitest';
import { ashArrival } from '../../look/ashHook';
import { dayFromIso } from '../dates';
import type { LonLat } from '../story';
import { arcKm, cosOffAxis } from './geo';
import {
  plumeState,
  pulseState,
  veilDensity,
  type PlumeEffect,
  type PulseEffect,
} from './timeline';

const TAMBORA: LonLat = [118.0, -8.25];
const NORTHWEST: [number, number] = [-0.7, 0.7];
const day = (iso: string) => dayFromIso(iso);

/** The day number the ash reaches a place, its anchor being the climax on 10 April 1815. */
const ashDay = (place: LonLat) =>
  day('1815-04-10') + ashArrival(arcKm(TAMBORA, place), cosOffAxis(TAMBORA, place, NORTHWEST));

describe('the illustrative ashfall', () => {
  // Ash that falls on a date shows from that date's start.
  const fallsOn = (iso: string) => [day(iso) - 1, day(iso)] as const;
  const places: [string, LonLat, string][] = [
    ['Sumbawa Besar', [117.42, -8.49], '1815-04-10'],
    ['Bima', [118.72, -8.46], '1815-04-11'],
    ['Mataram, Lombok', [116.12, -8.58], '1815-04-11'],
    ['Denpasar, Bali', [115.22, -8.65], '1815-04-11'],
    ['Banyuwangi', [114.37, -8.22], '1815-04-11'],
    ['Gresik', [112.65, -7.16], '1815-04-12'],
    ['Madura', [113.4, -7.05], '1815-04-12'],
    ['Makassar', [119.41, -5.13], '1815-04-12'],
    ['Solo', [110.82, -7.57], '1815-04-13'],
  ];
  for (const [name, place, iso] of places) {
    it(`reaches ${name} on ${iso}`, () => {
      const [after, by] = fallsOn(iso);
      const arrives = ashDay(place);
      if (iso !== '1815-04-10') expect(arrives).toBeGreaterThan(after);
      expect(arrives).toBeLessThanOrEqual(by);
    });
  }
});

describe('the illustrative veil', () => {
  it('is not there before the climax', () => {
    expect(veilDensity(118, -8, day('1815-04-09'))).toBe(0);
  });

  it('circles the tropics within four weeks', () => {
    for (let lon = -180; lon < 180; lon += 15) {
      expect(veilDensity(lon, 0, day('1815-05-08'))).toBeGreaterThan(0.3);
    }
  });

  it('reaches England by 28 June 1815, not in May', () => {
    expect(veilDensity(-0.1, 51.5, day('1815-05-15'))).toBeLessThan(0.05);
    expect(veilDensity(-0.1, 51.5, day('1815-06-28'))).toBeGreaterThan(0.4);
  });

  it('covers both hemispheres in 1816 and thins through 1817', () => {
    const mid1816 = day('1816-07-01');
    expect(veilDensity(10, 60, mid1816)).toBeGreaterThan(0.4);
    expect(veilDensity(10, -60, mid1816)).toBeGreaterThan(0.4);
    expect(veilDensity(10, 30, day('1817-10-01'))).toBeLessThan(veilDensity(10, 30, mid1816) / 2);
    expect(veilDensity(10, 30, day('1818-12-01'))).toBe(0);
  });
});

describe('the eruption and pulses', () => {
  const plume: PlumeEffect = {
    kind: 'plume',
    at: TAMBORA,
    start: day('1815-04-05'),
    peak: day('1815-04-10'),
    end: day('1815-07-15'),
    heightKm: 43,
    drift: NORTHWEST,
    seed: 1815,
  };

  it('erupts on its dates and is gone after', () => {
    expect(plumeState(plume, day('1815-04-04')).activity).toBe(0);
    expect(plumeState(plume, day('1815-04-05')).activity).toBeGreaterThan(0.5);
    expect(plumeState(plume, day('1815-04-10')).activity).toBe(1);
    expect(plumeState(plume, day('1815-07-15')).activity).toBe(0);
  });

  it('spreads its cloud as the climax goes on', () => {
    const km = (iso: string) => plumeState(plume, day(iso)).cloudKm;
    expect(km('1815-04-12')).toBeGreaterThan(km('1815-04-10'));
    expect(km('1815-04-14')).toBeGreaterThan(km('1815-04-12'));
  });

  it('sends the sound out on its day and lets it fade', () => {
    const sound: PulseEffect = {
      kind: 'pulse',
      at: TAMBORA,
      start: day('1815-04-05'),
      end: day('1815-04-06'),
      radiusKm: 1400,
      style: 'sound',
    };
    expect(pulseState(sound, day('1815-04-04')).strength).toBe(0);
    expect(pulseState(sound, day('1815-04-05'))).toMatchObject({ strength: 1, racing: true });
    expect(pulseState(sound, day('1815-04-07')).racing).toBe(false);
    expect(pulseState(sound, day('1815-04-09')).strength).toBe(0);
  });
});
