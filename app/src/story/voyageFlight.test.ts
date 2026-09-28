import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import type { FxRelease } from '../data/release';
import { parseRoute, type RouteData } from '../data/route';
import { readFixtureFile, readStageRecord } from '../test/fixture';
import { type ViewState } from '../view/viewState';
import { beatView } from './director';
import { dirOf, EARTH_KM } from './effects/geo';
import { routeFrame } from './effects/route';
import { flightEase } from './flight';
import { parseStory } from './story';
import { voyagePath } from './voyageFlight';

const from: ViewState = { lon: 1, lat: 2, viewKm: 120, tilt: 30, heading: -10 };
const to: ViewState = { lon: 55, lat: -20, viewKm: 16500, tilt: 10, heading: 20 };
const route: RouteData = {
  v: 1,
  epochDay: 100,
  labels: [],
  pts: [
    [0, 0, 0, 0],
    [20, -10, 20, 0],
    [20, -10, 170, 0],
    [60, -30, 200, 0],
  ],
};

describe('voyagePath', () => {
  const path = voyagePath(from, to, route, 100, 300)!;

  it('starts and ends on the exact views and dates, including tilt and heading', () => {
    expect(path.at(0)).toEqual(from);
    expect(path.at(1)).toEqual(to);
    expect([path.dayAt(0), path.dayAt(1)]).toEqual([100, 300]);
    expect(path.at(flightEase(1e-4))).toMatchObject({ tilt: from.tilt, heading: from.heading });
    expect(path.at(flightEase(1 - 1e-4)).viewKm).toBeCloseTo(to.viewKm, 6);
  });

  it('centers the following view on the fleet throughout the middle of the flight', () => {
    for (let t = 0.15; t <= 0.85; t += 0.05) {
      const view = path.at(t);
      const fleet = routeFrame(route, path.dayAt(t), 7).fleet!;
      expect(dirOf([view.lon, view.lat]).distanceTo(fleet)).toBeLessThan(1e-12);
      expect(view.viewKm).toBe(path.followKm);
      expect(view.tilt).toBe(0);
    }
  });

  it('keeps the fleet within a narrow departure view while the camera lifts', () => {
    const narrow = voyagePath({ ...from, lon: 0, lat: 0 }, to, route, 100, 300)!;
    for (let t = 0.01; t < tunables.voyageBlend; t += 0.01) {
      const view = narrow.at(t);
      const fleet = routeFrame(route, narrow.dayAt(t), 0).fleet!;
      const offCenterKm = dirOf([view.lon, view.lat]).angleTo(fleet) * EARTH_KM;
      expect(offCenterKm).toBeLessThan(view.viewKm / 2);
    }
  });

  it('passes five months in port in less than a tenth of the path, without jumping dates', () => {
    let portSteps = 0;
    let previous = path.dayAt(0);
    for (let i = 1; i <= 10000; i++) {
      const day = path.dayAt(i / 10000);
      expect(day).toBeGreaterThan(previous);
      expect(day - previous).toBeLessThan(0.21);
      if (day >= 120 && day <= 270) portSteps++;
      previous = day;
    }
    expect(portSteps / 10000).toBeCloseTo(0.075, 3);
  });

  it('sails at an even distance pace despite quite different dated segment speeds', () => {
    // Equal route arcs, one dated to 1 day, the other to 100: their flight shares are near equal.
    const uneven: RouteData = {
      ...route,
      pts: [
        [0, 0, 0, 0],
        [20, 0, 1, 0],
        [40, 0, 101, 0],
      ],
    };
    const leg = voyagePath(from, to, uneven, 100, 201)!;
    const middle = leg.at(0.5);
    expect(middle.lon).toBeGreaterThan(18);
    expect(middle.lon).toBeLessThan(22);
    expect(leg.dayAt(0.5)).toBeLessThan(112);
  });

  it('runs the same track backward and lands exactly on the earlier date and view', () => {
    const back = voyagePath(to, from, route, 300, 100)!;
    expect(back.at(0)).toEqual(to);
    expect(back.at(1)).toEqual(from);
    expect(back.dayAt(1)).toBe(100);
    expect(back.sailedKm).toBeCloseTo(path.sailedKm, 8);
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(back.dayAt(t)).toBeLessThan(back.dayAt(t - 0.05));
      expect(back.dayAt(t)).toBeCloseTo(path.dayAt(1 - t), 8);
      const a = back.at(t);
      const b = path.at(1 - t);
      expect(dirOf([a.lon, a.lat]).distanceTo(dirOf([b.lon, b.lat]))).toBeLessThan(1e-10);
    }
  });

  it('clips partial legs, handles a whole stay and refuses a day without a fleet', () => {
    const partial = voyagePath(from, to, route, 110, 290)!;
    expect(partial.sailedKm).toBeLessThan(path.sailedKm);
    expect([partial.dayAt(0), partial.dayAt(1)]).toEqual([110, 290]);
    const stay = voyagePath(from, to, route, 130, 250)!;
    expect(stay.sailedKm).toBeLessThan(1e-8);
    expect(stay.dayAt(0.5)).toBe(190);
    expect(stay.at(0.5)).toMatchObject({ lon: 20, lat: -10 });
    expect(voyagePath(from, to, route, 99, 200)).toBeNull();
    expect(voyagePath(from, to, route, 100, 100)).toBeNull();
  });

  it('crosses the dateline along the fleet arc', () => {
    const crossing: RouteData = {
      ...route,
      pts: [
        [-170, 0, 0, 0],
        [170, 0, 10, 0],
      ],
    };
    const leg = voyagePath(from, to, crossing, 100, 110)!;
    expect(Math.abs(leg.at(0.5).lon)).toBeCloseTo(180, 8);
    expect(leg.sailedKm).toBeCloseTo(2223.9, 1);
  });

  it('keeps dates continuous and finite through equal-date controls', () => {
    const equal: RouteData = {
      ...route,
      pts: [
        [0, 0, 0, 0],
        [1, 0, 1, 0],
        [2, 0, 1, 0],
        [3, 0, 2, 0],
      ],
    };
    const leg = voyagePath(from, to, equal, 100, 102)!;
    for (let t = 0; t < 1; t += 0.01) {
      expect(leg.dayAt(t + 0.01)).toBeGreaterThan(leg.dayAt(t));
      expect(Number.isFinite(leg.at(t).lon)).toBe(true);
    }
  });
});

describe('Magellan’s actual voyage legs', () => {
  const story = parseStory(
    readFileSync(new URL('../../../stories/magellan/story.md', import.meta.url), 'utf8'),
  );
  const fx = readStageRecord<FxRelease>('fx');
  const track = parseRoute(readFixtureFile(fx['magellan/route']!.key).buffer);

  it.each(story.beats.slice(1).map((beat, i) => ({ from: story.beats[i]!, to: beat })))(
    '$from.id → $to.id follows the sailed track within the width and duration bounds',
    ({ from, to }) => {
      const path = voyagePath(beatView(from), beatView(to), track, from.day, to.day)!;
      expect(path.at(0)).toEqual(beatView(from));
      expect(path.at(1)).toEqual(beatView(to));
      expect(path.sailedKm).toBeGreaterThan(0);
      expect(path.followKm).toBeGreaterThanOrEqual(tunables.voyageWidth.min);
      expect(path.followKm).toBeLessThanOrEqual(tunables.voyageWidth.max);
      expect(path.durationS).toBeGreaterThanOrEqual(tunables.voyageDuration.min / 1000);
      expect(path.durationS).toBeLessThanOrEqual(tunables.voyageDuration.max / 1000);
      for (let t = 0.2; t < 0.85; t += 0.05) {
        const view = path.at(t);
        expect(
          dirOf([view.lon, view.lat]).distanceTo(routeFrame(track, path.dayAt(t), 7).fleet!),
        ).toBeLessThan(1e-10);
        expect(path.dayAt(t)).toBeGreaterThan(path.dayAt(t - 0.05));
      }
    },
  );
});
