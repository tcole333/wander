// release.json's shape (streaming.md 3.8), as far as the stages built so far fill it. Types only,
// shared by the page that reads a release and scripts/release.ts, which merges one.

/** release.json's `surface`: what the runtime needs to find, place and bound the surface tiles. */
export interface SurfaceRelease {
  ver: string;
  maxLevel: number;
  /** Meters per height code, by level. */
  qLand: number[];
  /** The code for −200 m, by level. */
  c200: number[];
  /** Base64 availability bitmap, one bit per node in node order (3.0 item 8). */
  avail: string;
  /** The key of the layer's bounds.bin. */
  bounds: string;
}

/** The part of release.json built so far: every stage adds its section. */
export interface Release {
  id: string;
  built: string;
  dataHost: string;
  surface: SurfaceRelease;
}
