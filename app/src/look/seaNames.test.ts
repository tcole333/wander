// The sea names the look inlays: a name shows while its letters stand between about 7 and 48 px on
// screen and the view's width at it is within its bounds, and never from the globe's far side.
import { describe, expect, it } from 'vitest';
import { dirOf } from '../story/effects/geo';
import { pickSeaNames, seaNameFade, type PlacedName, type SeaName } from './seaNames';

const JAVA_SEA: SeaName = { text: 'Java Sea', lon: 111.5, lat: -4.9, size: 0.62, style: 'sea' };
const placed = (name: SeaName): PlacedName => ({
  name,
  dir: dirOf([name.lon, name.lat]),
  reach: 0.05,
});

/** A camera `altitude` globe radii above a place, projecting a 30-degree view 900 px tall. */
function over(lon: number, lat: number, altitude: number) {
  const pxPerUnit = 450 / Math.tan((15 * Math.PI) / 180);
  return { camera: dirOf([lon, lat]).multiplyScalar(1 + altitude), pxPerUnit, width: 1440 };
}

describe('seaNameFade', () => {
  it('shows a name whose letters stand between about 7 and 48 px', () => {
    expect([5, 9, 20, 42, 50].map((px) => seaNameFade(JAVA_SEA, px, 3000))).toEqual([
      0,
      expect.closeTo(0.5, 1),
      1,
      expect.closeTo(0.5, 1),
      0,
    ]);
  });

  it('hides a name outside its view widths', () => {
    const close = { ...JAVA_SEA, maxKm: 2400 };
    expect([seaNameFade(close, 20, 1500), seaNameFade(close, 20, 3200)]).toEqual([1, 0]);
  });
});

describe('pickSeaNames', () => {
  it('picks a name under the camera and none on the far side of the globe', () => {
    const names = [placed(JAVA_SEA), placed({ ...JAVA_SEA, lon: -68.5 })];
    // About 3,200 km wide at the name: the Java Sea's letters some 30 px tall.
    const view = over(117.5, -5.5, 0.55);
    expect(pickSeaNames(names, view)).toEqual([{ index: 0, alpha: 1 }]);
  });
});
