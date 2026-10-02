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
 * release.json's `borderSteps` (3.3): Cliopatria's polities as one field per state of the world
 * from 3400 BCE to 2000, each step with its astronomical first year, key and stored bytes in step
 * order, the preview chunks, the polities and the CC BY notice.
 */
export interface BorderStepsRelease {
  ver: string;
  /** Texels a face side, apron included, and the apron past each face edge. */
  size: number;
  apron: number;
  /** The year each step begins, astronomical, ascending; a step holds until the next begins. */
  years: number[];
  keys: string[];
  bytes: number[];
  /** Chunks of `per` steps' previews, the first starting at step 0. */
  previews: { per: number; keys: string[]; bytes: number[] };
  /** fd/borders/m/<sha16>.json: each polity's id, Wikidata ids and outer unit through the steps. */
  polities: string;
  /** lic/<sha16>.txt: Cliopatria's attribution, the license and every correction. */
  notice: string;
}

/**
 * release.json's `names` (3.3, Names): where the state names stand on the border steps, in chunks
 * of `per` steps (the previews' chunks), each `fd/names/<sha16>.wsn`, gzip-in-file JSON
 * (data/names.ts), with the faces their letters were fitted in.
 */
export interface NamesRelease {
  ver: string;
  /** The borderSteps section's `ver`: the names are placed on those steps alone. */
  steps: string;
  per: number;
  keys: string[];
  bytes: number[];
  /** Placements in all, each over a run of steps. */
  placements: number;
  /** The faces the letters were fitted in: outer names' capitals, inner names' small capitals. */
  faces: { outer: string; inner: string };
  /** The characters each face letters across every chunk, sorted: the glyphs made at boot. */
  glyphs: { outer: string; inner: string };
}

/**
 * release.json's `media`: every key the stories' committed locks name (streaming.md 3.9), sorted,
 * so publish-data uploads them and check-release reads one.
 */
export interface MediaRelease {
  images: string[];
}

/** One gzip-in-file columnar event page (streaming.md 3.4). */
export interface EventFile {
  key: string;
  t0: number;
  t1: number;
  rows: number;
  bytes: number;
  /** Exact resident typed-array bytes, including labels, extents and the qid lookup. */
  decoded: number;
  /** Inflated JSON bytes, released after decoding. */
  jsonBytes: number;
  /** Era page, 0–23; absent for overview, all and long. */
  bin?: number;
}

export interface EventsRelease {
  ver: string;
  overview: string;
  /** Unique rows across the corpus. */
  rows: number;
  /** The 23 finite bin boundaries, as Gregorian day numbers. */
  eraEdges: number[];
  /** Includes the overview, so its sizes are known before fetching it. */
  files: EventFile[];
}

/** Story route assets, keyed by story/dataset (dataset names are local to each story). */
export type FxRelease = Record<
  string,
  {
    key: string;
    /** 'route' so far; typed as release.json's JSON gives it, like the other sections. */
    kind: string;
    epochDay: number;
    /** West, south, east, north; east may exceed 180 across the dateline. */
    bbox: number[];
    bytes: number;
  }
>;

/** The part of release.json built so far: every stage adds its section. */
export interface Release {
  id: string;
  built: string;
  dataHost: string;
  surface: SurfaceRelease;
  /** Present once the build has run the modera stage. */
  modera?: ModeraRelease;
  /** Present once the build has baked the border steps (not the region profile). */
  borderSteps?: BorderStepsRelease;
  /** Present once the build has named the border steps, which it is placed on. */
  names?: NamesRelease;
  /** Present once the build has run the fx stage. */
  fx?: FxRelease;
  /** Present once the build has run event-files. */
  events?: EventsRelease;
  media: MediaRelease;
}
