import { arcKm } from '../story/effects/geo';
import type { LonLat } from '../story/story';

/**
 * Alternate the locks' ranked picks, keeping the meanwhile stage's 450 km spacing and 120-point
 * ceiling across the whole lobby. Shared events and nearby picks earn only one pinprick.
 */
export function lobbyPlaces(locks: readonly (readonly LonLat[])[]): LonLat[] {
  const places: LonLat[] = [];
  const length = Math.max(0, ...locks.map((glows) => glows.length));
  for (let i = 0; i < length; i++) {
    for (const glows of locks) {
      const at = glows[i];
      if (at && places.every((other) => arcKm(at, other) >= 450)) places.push(at);
      if (places.length === 120) return places;
    }
  }
  return places;
}
