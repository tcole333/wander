import { expect, it } from 'vitest';
import { stories } from '../story/catalog';
import { arcKm } from '../story/effects/geo';
import type { LonLat } from '../story/story';
import { lobbyPlaces } from './places';

it('merges ranked picks from both locks without doubling shared or nearby glows', () => {
  const locks: LonLat[][] = [
    [
      [0, 0],
      [40, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [-40, 0],
    ],
  ];
  expect(lobbyPlaces(locks)).toEqual([
    [0, 0],
    [40, 0],
    [-40, 0],
  ]);
  expect(lobbyPlaces([])).toEqual([]);
  const places = lobbyPlaces(stories.map(({ glows }) => glows));
  expect(places.length).toBeLessThanOrEqual(120);
  expect(places.length).toBeGreaterThan(0);
  for (let i = 0; i < places.length; i++) {
    for (const other of places.slice(i + 1))
      expect(arcKm(places[i]!, other)).toBeGreaterThanOrEqual(450);
  }
});
