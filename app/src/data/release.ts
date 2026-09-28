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

/**
 * release.json's `modera` (3.5): ModE-RA's monthly 2 m temperature anomalies (K, against
 * 1901-2000) as a mean and a spread file per year under fd/modera/<ver>/, and annual.bin.
 */
export interface ModeraRelease {
  ver: string;
  /** The first and last years with files. */
  years: number[];
  /** The grid's latitudes in degrees, north first: row 0 of every frame. */
  lat: number[];
  /** Column 0's center and the step between columns, degrees. */
  lon0: number;
  dlon: number;
  /** Each stored file's bytes: mean and spread by year, and annual.bin. */
  bytes: { mean: Record<string, number>; spread: Record<string, number>; annual: number };
}

/**
 * release.json's `borders` in milestone 1 (3.3): one field of distances to the borders per
 * historical-basemaps snapshot under fd/borders/<ver>/, each with its GPL notice and its corrected
 * source under lic/ (owner decision 6).
 */
export interface BordersRelease {
  ver: string;
  /** The snapshots' stems ('1815', 'bc123000') and astronomical years, oldest first. */
  stems: string[];
  years: number[];
  /** By stem: the field's key and stored bytes, and the keys of its notice and its source. */
  files: Record<string, { key: string; bytes: number; notice: string; source: string }>;
}

/**
 * release.json's `media`: every key the stories' committed locks name (streaming.md 3.9), sorted,
 * so publish-data uploads them and check-release reads one.
 */
export interface MediaRelease {
  images: string[];
}

/** The part of release.json built so far: every stage adds its section. */
export interface Release {
  id: string;
  built: string;
  dataHost: string;
  surface: SurfaceRelease;
  /** Present once the build has run the modera stage. */
  modera?: ModeraRelease;
  /** Present once the build has run the borders stage. */
  borders?: BordersRelease;
  media: MediaRelease;
}
