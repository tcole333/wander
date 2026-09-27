import { describe, expect, it } from 'vitest';
import {
  drawnView,
  dragView,
  flightAt,
  mixViews,
  reliefForWidth,
  type ViewState,
} from './viewState';

const view = (lon: number, lat: number, viewKm: number): ViewState => ({
  lon,
  lat,
  viewKm,
  tilt: 0,
  heading: 0,
});

describe('mixViews', () => {
  it('crosses the antimeridian the short way', () => {
    expect(mixViews(view(170, 0, 100), view(-170, 0, 100), 0.25).lon).toBeCloseTo(175, 6);
  });

  it('zooms in log space', () => {
    expect(mixViews(view(0, 0, 100), view(0, 0, 10000), 0.5).viewKm).toBeCloseTo(1000, 6);
  });
});

describe('flightAt', () => {
  it('moves the center early on a flight that zooms in', () => {
    const at = flightAt(view(0, 0, 10000), view(20, 0, 30), 0.5, 0);
    expect(at.lon).toBeGreaterThan(15);
  });

  it('ends at the destination', () => {
    const at = flightAt(view(0, 0, 10000), view(20, 10, 30), 1, 2);
    expect([at.lon, at.lat, at.viewKm]).toEqual([20, 10, expect.closeTo(30, 6) as number]);
  });
});

describe('dragView', () => {
  it('moves the view center west when the ground is dragged right', () => {
    expect(dragView(view(10, 0, 1000), 100, 0, 1000).lon).toBeLessThan(10);
  });

  it('moves the view center north when the ground is dragged down', () => {
    expect(dragView(view(10, 0, 1000), 0, 100, 1000).lat).toBeGreaterThan(0);
  });
});

describe('reliefForWidth', () => {
  it('holds the near relief at 100 km and closer', () => {
    expect(reliefForWidth(30, 2, 8)).toBe(2);
  });

  it('holds the far relief at 3,000 km and wider', () => {
    expect(reliefForWidth(20000, 2, 8)).toBe(8);
  });
});

describe('drawnView', () => {
  const tilted = (viewKm: number): ViewState => ({ ...view(118, -8.25, viewKm), tilt: 45 });

  it('keeps the tilt at 3,000 km wide and closer', () => {
    expect(drawnView(tilted(3000)).tilt).toBe(45);
  });

  it('drops the tilt at 10,000 km wide and wider', () => {
    expect(drawnView(tilted(20000)).tilt).toBe(0);
  });
});
