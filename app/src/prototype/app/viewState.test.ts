import { describe, expect, it } from 'vitest';
import { dragView, mixViews, reliefForWidth, type ViewState } from './viewState';

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
