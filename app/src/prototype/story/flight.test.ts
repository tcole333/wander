import { describe, expect, it } from 'vitest';
import { arcKm, type ViewState } from '../app/viewState';
import { flightEase, flightPath, flightSeconds, MAX_LEAD } from './flight';

const view = (lon: number, lat: number, viewKm: number, tilt = 0): ViewState => ({
  lon,
  lat,
  viewKm,
  tilt,
  heading: 0,
});

const sumbawa = view(118, -8.25, 300, 45);
const europe = view(10, 50, 5000, 15);

describe('flightPath', () => {
  it('starts and ends at the two views', () => {
    const path = flightPath(sumbawa, europe);
    expect(path.at(0)).toEqual(sumbawa);
    expect(path.at(1)).toEqual(europe);
  });

  it('rises well above both ends on a long flight', () => {
    const middle = flightPath(view(0, 0, 1000), view(90, 0, 1000)).at(0.5);
    expect(middle.viewKm).toBeGreaterThan(5000);
  });

  it('keeps to the great circle, poleward of the parallel', () => {
    const path = flightPath(view(-60, 45, 1000), view(60, 45, 1000));
    expect(path.at(0.5).lat).toBeCloseTo((Math.atan(2) * 180) / Math.PI, 6);
  });

  it('is continuous along the way', () => {
    const path = flightPath(sumbawa, europe);
    for (let t = 0; t < 1; t += 0.01) {
      const [a, b] = [path.at(t), path.at(t + 0.01)];
      expect(arcKm(a, b)).toBeLessThan(Math.max(a.viewKm, b.viewKm) * 0.1);
    }
  });

  it('zooms in place when the centers match', () => {
    const path = flightPath(view(118, -8, 3000), view(118, -8, 300));
    expect(path.at(0.5).viewKm).toBeCloseTo(Math.sqrt(3000 * 300), 6);
  });
});

describe('flightSeconds', () => {
  it('holds short flights to 2.4 s and long ones to 5 s', () => {
    expect([flightSeconds(0), flightSeconds(20)]).toEqual([2.4, 5]);
    expect(flightSeconds(3)).toBeCloseTo(3.75, 9);
  });
});

describe('flightEase', () => {
  it('runs from 0 to 1, starting at the pace it takes over', () => {
    const lead = 1.5;
    expect([flightEase(0, lead), flightEase(1, lead)]).toEqual([0, 1]);
    expect(flightEase(1e-6, lead) / 1e-6).toBeCloseTo(lead, 4);
  });

  it('never backs up, up to the steepest start', () => {
    for (let t = 0; t < 1; t += 0.01) {
      expect(flightEase(t + 0.01, MAX_LEAD)).toBeGreaterThanOrEqual(flightEase(t, MAX_LEAD));
    }
  });
});
