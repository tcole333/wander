// The walk's modules (issue #4, re-scoped to a look checkpoint): the streaming globe, the surface
// look and the museum scene are built separately and joined by the walk's boot (walk/boot.ts). Each
// module owns a plain `params` object of numbers, booleans and '#rrggbb' strings; the dev shell's
// lil-gui panel edits those objects in place, and each module reads them every frame in `update`.
// The globe frame is the one the surface vertex shader writes: three.js axes, Earth radius 1
// (streaming.md 3.0).
import type {
  InstancedBufferGeometry,
  Material,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Release, SurfaceRelease } from './data/release';
import type { SurfaceLayer } from './data/surfaceLayer';
import type { SurfacePools } from './gpu/surfaceUploads';
import type { UploadJob } from './gpu/uploadQueue';
import type { GlyphSet } from './marks/glyphs';
import type { MarkLayer } from './marks/marks';
import type { MemoryAccount } from './perf/memory';

export type Params = Record<string, number | boolean | string>;

export interface ViewportCss {
  width: number;
  height: number;
}

export interface StreamerStats {
  drawn: number;
  resident: number;
  inFlight: number;
  decoding: number;
  uploading: number;
  /** Drawn nodes per node level, L0 first. */
  levels: number[];
}

/** Selects, fetches, decodes and uploads surface tiles, and packs the drawn instances. */
export interface SurfaceStreamer {
  inspectMemory?(account: MemoryAccount): void;
  release: Release;
  /** The layer it streams: availability and each node's bounds, which the camera's clearance reads. */
  layer: SurfaceLayer;
  pools: SurfacePools;
  /**
   * The shared tile grid (position = (k, l, role), normal) with the instanced uvec4 attributes
   * `wanderNode` and `wanderPrev`; `instanceCount` is the drawn set's size after each update.
   */
  geometry: InstancedBufferGeometry;
  /** Includes at least `refinePx`, `maxLevel` and `freeze`. */
  params: Params;
  /**
   * One frame: pick the drawn set for `camera` seen through the globe's local frame (`globe` is the
   * object the globe mesh hangs from), queue what is missing, drain decodes, run uploads within
   * the frame's byte budget, and repack the instances.
   */
  update(camera: PerspectiveCamera, viewport: ViewportCss, globe: Object3D): void;
  /**
   * Queues an upload behind the tiles', run within the same frame's byte budget once no tile has a
   * part left: the border steps' bands and preview cells (streaming.md 3.3).
   */
  uploadBehind(job: UploadJob): void;
  /** Drops the rest of an upload queued behind. */
  cancelUpload(key: string): void;
  stats(): StreamerStats;
  dispose(): void;
}

export type CreateSurfaceStreamer = (
  renderer: WebGLRenderer,
  release: Release,
) => Promise<SurfaceStreamer>;

/** The globe's material: the merged surface vertex chunk plus the spike's look, live. */
export interface SurfaceLook {
  inspectMemory?(account: MemoryAccount): void;
  material: Material;
  /** For the globe mesh's customDepthMaterial, so the displaced globe casts true shadows. */
  depthMaterial: Material;
  /** Includes at least `kLand`, `kSea`, `bathymetry` and `flatRelief`. */
  params: Params;
  update(elapsedS: number): void;
  /** Resolves once the look's ocean and sea names are lettered; it never rejects. */
  ready: Promise<void>;
  /** The marks cut into the surface, where the look was made with glyphs; otherwise null. */
  marks: MarkLayer | null;
  dispose(): void;
}

export type CreateSurfaceLook = (
  pools: SurfacePools,
  surface: SurfaceRelease,
  /** `marks`: the glyphs of the marks to cut into the surface, only where Explore stands. */
  options?: { marks?: GlyphSet },
) => SurfaceLook;

/** The dark museum room, its lamps, the instrument and the post chain, ported from the spike. */
export interface MuseumScene {
  scene: Scene;
  /** The globe mesh goes here; its local frame is the globe frame (radius 1, north +Y). */
  globeMount: Object3D;
  params: Params;
  /** Ring fades by camera distance and similar per-frame state. */
  update(camera: PerspectiveCamera, elapsedS: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Renders the scene through the composer (bloom, tone mapping, output). */
  render(camera: PerspectiveCamera): void;
  dispose(): void;
}

export type CreateMuseumScene = (renderer: WebGLRenderer) => MuseumScene;
