import { describe, expect, it } from 'vitest';
import { flightEase, flightPath, flightSeconds } from '../story/flight';
import { FreeFlight } from './freeFlight';
import type { ViewState } from './viewState';

const from: ViewState = { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 };
const to: ViewState = { lon: 4.4, lat: 35, viewKm: 30000, tilt: 0, heading: 0 };

describe('a free flight', () => {
  it('follows the walk’s path and easing, landing on its target', () => {
    const flight = new FreeFlight(from, to);
    const path = flightPath(from, to);
    expect(flight.seconds).toBe(flightSeconds(path.length));
    const half = flight.step(flight.seconds / 2);
    expect(half).toEqual(path.at(flightEase(0.5)));
    expect(flight.done).toBe(false);
    const end = flight.step(flight.seconds);
    expect(flight.done).toBe(true);
    expect(end.lon).toBeCloseTo(to.lon, 9);
    expect(end.lat).toBeCloseTo(to.lat, 9);
    expect(end.viewKm).toBeCloseTo(to.viewKm, 6);
  });
});
