// The walk's boot: the streamed globe in the surface look, hung in the museum scene's gimbal, with
// a camera that flies from the whole instrument down to a few tens of km. The gimbal turns the
// view center toward the lamp and the camera, as the spike's did. Given a story, the walk plays
// over it: the director flies between its beats (story/director.ts), the card, time ruler and
// Meanwhile sit over the globe (story/ui/), and the ember, plume, plaques, ash and veil follow
// story time (story/effects/). It starts paused on the first beat; Left and Right step beats,
// Space plays or pauses, and Escape resumes after the visitor breaks out to explore.
//
// The host fills the window: the canvas goes first in it, the story's plaques over the canvas, and
// the story's UI last (walk.css). The production entry (main.ts) and the dev shell
// (prototype/app/main.ts) boot it.
import './walk.css';
import {
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
  type Object3D,
} from 'three';
import type { MuseumScene, Params, StreamerStats, SurfaceLook, SurfaceStreamer } from '../contract';
import type { Release } from '../data/release';
import { loadSurfaceLayer, type SurfaceLayer } from '../data/surfaceLayer';
import { ClearanceField } from '../globe/clearance';
import { createSurfaceLook } from '../look/surfaceLook';
import { summarizeFrames } from '../perf/frameStats';
import { createMuseumScene } from '../scene/museumScene';
import type { MeanwhileByBeat, WalkEffects, WalkUi } from '../story/contract';
import { bindWalkKeys, createWalk, type DirectedWalk } from '../story/director';
import { createWalkEffects } from '../story/effects/walkEffects';
import type { Story } from '../story/story';
import { createWalkUi } from '../story/ui/walkUi';
import { createSurfaceStreamer } from '../stream/streamer';
import { faceOf, faceSt, lonLatToDir, tileOf } from '../surface/cube';
import { CameraRig, maxViewKm, type Relief } from '../view/cameraRig';
import { ViewControl } from '../view/viewControl';
import { drawnView, reliefForWidth, type ViewState } from '../view/viewState';

/** The whole instrument: the widest view the zoom allows, where the view starts by default. */
export const WORLD: ViewState = { lon: 75, lat: 15, viewKm: Infinity, tilt: 0, heading: 0 };

/** The level whose tiles zoomFloorKm is the floor over; each coarser level doubles it. */
const FLOOR_LEVEL = 7;

/**
 * How far right a story shifts the lens, as a share of the card's reach from the left edge: 0.5
 * would center the view in the space right of the card, but Meanwhile covers its top right, and
 * a beat's neighbors (Makassar on the sound beat, Yunnan on the last) would slip under it.
 */
const LENS_SHIFT = 0.35;

/** Frames the frame rate and p95 look back over. */
const FRAMES = 120;
/** How long the streamer must stay idle before the walk counts as ready. */
const IDLE_MS = 1000;
const IDLE_FRAMES = 5;

/** A story to walk, and Meanwhile's entries by beat. */
export interface StorySource {
  story: Story;
  meanwhile: MeanwhileByBeat;
}

export interface BootOptions {
  /** The story to walk; without one, the globe is the visitor's to explore. */
  story?: StorySource | null;
  /** Where the view starts. */
  view?: ViewState;
  /**
   * Called with each part's params (the look's, the scene's, the streamer's, the camera's, and a
   * story's effects') before anything reads them: the dev shell's query overrides.
   */
  tune?: (params: Params) => void;
}

/** The director, the effects hung in the globe's frame, and the card, ruler and Meanwhile. */
export interface StoryParts {
  walk: DirectedWalk;
  effects: WalkEffects;
  ui: WalkUi;
}

export interface WalkStats extends StreamerStats {
  view: ViewState;
  fps: number;
  frameP95: number;
  altitudeKm: number;
}

/** A booted walk: the parts the dev shell's panel and hooks reach into, and its checks. */
export interface WalkPage {
  /** The renderer's canvas, whose context loss the production entry watches. */
  canvas: HTMLCanvasElement;
  museum: MuseumScene;
  look: SurfaceLook;
  streamer: SurfaceStreamer;
  control: ViewControl;
  /** The camera's params: the zoom floor, relief by zoom, the gimbal's facing, the pixel ratio. */
  cameraParams: Params;
  story: StoryParts | null;
  stats(): WalkStats;
  /** True once the view has settled and the streamer has been idle for a while. */
  ready(): boolean;
  /** Stops the frame loop and releases what the boot made, its canvas and DOM too. */
  dispose(): void;
}

/** This browser cannot draw the walk: it gives no WebGL 2 context, or a shader does not link. */
export class DrawError extends Error {
  override name = 'DrawError';
}

/**
 * Builds the renderer, the museum scene, the streamer, the look, the camera and its controls in
 * `host`, starts the story if given, readies its shaders and runs the frame loop. When any step
 * throws (a DrawError, data that does not arrive), what the earlier steps made is released, its
 * DOM and keys too, before the error goes on.
 */
export async function bootWalk(
  host: HTMLElement,
  release: Release,
  options: BootOptions = {},
): Promise<WalkPage> {
  const made: (() => void)[] = [];
  try {
    return await assemble(host, release, options, made);
  } catch (error) {
    for (const undo of made.reverse()) undo();
    throw error;
  }
}

/** The boot's steps, each pushing onto `made` what releases the part it made. */
async function assemble(
  host: HTMLElement,
  release: Release,
  { story: source = null, view = WORLD, tune = () => {} }: BootOptions,
  made: (() => void)[],
): Promise<WalkPage> {
  const renderer = createRenderer();
  renderer.shadowMap.enabled = true;
  // A shader that does not link draws nothing and throws nowhere, so the boot counts them. This
  // replaces three's own report, so the logs are reported here.
  let unlinked = 0;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    unlinked += 1;
    console.error(
      'A shader did not link:',
      gl.getProgramInfoLog(program),
      gl.getShaderInfoLog(vertex),
      gl.getShaderInfoLog(fragment),
    );
  };
  renderer.domElement.className = 'walk-canvas';
  const labels = document.createElement('div');
  labels.className = 'walk-labels';
  host.prepend(renderer.domElement, labels);
  made.push(() => {
    renderer.dispose();
    renderer.domElement.remove();
    labels.remove();
  });
  const museum = createMuseumScene(renderer);
  made.push(() => museum.dispose());
  museum.setSize(innerWidth, innerHeight, devicePixelRatio);

  // The streamer is released once made, even when the layer fails to load first.
  const streaming = createSurfaceStreamer(renderer, release);
  made.push(() => {
    streaming.then((streamer) => streamer.dispose()).catch(() => {});
  });
  const [streamer, layer] = await Promise.all([streaming, loadSurfaceLayer(release)]);
  const look = createSurfaceLook(streamer.pools, release.surface);
  made.push(() => look.dispose());
  const rig = new CameraRig(new ClearanceField(layer));

  const globe = new Mesh(streamer.geometry, look.material);
  // The grid's positions are lattice indices; the vertex shader places them.
  globe.frustumCulled = false;
  globe.castShadow = true;
  globe.receiveShadow = true;
  globe.customDepthMaterial = look.depthMaterial;
  museum.globeMount.add(globe);

  const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 100);
  const cameraParams = {
    // The closest view over L7 tiles. Where the deepest tile is coarser, each level doubles it
    // (60 km on L6 land, 240 km over open ocean), so every place bottoms out at the same stretch.
    zoomFloorKm: 30,
    // kLand and kSea follow the zoom: reliefNear at 100 km wide and closer, reliefFar at 3,000 km
    // and wider. Off, the look's own kLand and kSea hold.
    reliefByZoom: true,
    reliefNear: 2,
    reliefFar: 8,
    // The gimbal tilts the globe toward the camera, so a tilted view keeps the lamp behind the
    // camera; off, it turns the view center to the front and the camera tilts instead.
    faceCamera: true,
    // Device pixels per CSS pixel, the display's up to 2, as the spike drew. From 1.5 the scene
    // drops MSAA, so a Retina display holds 60 fps on the M5 at 2. A story draws at most 1.5:
    // at 2 the plume's overlapping puffs and the flights miss frames on a Retina display.
    pixelRatio: Math.min(devicePixelRatio, source ? 1.5 : 2),
  };
  for (const params of [look.params, museum.params, streamer.params, cameraParams]) tune(params);

  const control = new ViewControl(view);
  control.minKmAt = (at) =>
    Number(cameraParams.zoomFloorKm) * 2 ** (FLOOR_LEVEL - deepestLevel(layer, at.lon, at.lat));
  const limitZoom = () => {
    control.maxKm = maxViewKm(camera);
  };
  limitZoom();
  control.go(control.goal, true);
  made.push(control.attach(renderer.domElement));

  // A story's page steps through its beats. The walk flies the camera, and holds a late landing
  // until the streamer has nothing in hand.
  const [story, endStory] = source
    ? startStory(source, control, look, labels, host, () => {
        const s = streamer.stats();
        return s.inFlight + s.decoding + s.uploading === 0;
      })
    : [null, () => {}];
  made.push(endStory);
  if (story) {
    museum.globeMount.add(story.effects.group);
    tune(story.effects.params);
    await precompile(renderer, museum, camera, story.effects.group);
    // precompile drew every program once, and three checks each link at its first use.
    if (unlinked > 0) throw new DrawError(`${unlinked} shaders did not link`);
  }
  const walk = story?.walk ?? null;

  // In a story the card covers the view's left, so the lens shifts right by LENS_SHIFT of the
  // card's reach: each beat's place lands right of the card, and what lies around it clears both
  // the card and Meanwhile. The streamer and the plaques read the shifted projection.
  const frameLens = () => {
    const card = story ? host.querySelector('.wu-card') : null;
    const shift = card ? LENS_SHIFT * card.getBoundingClientRect().right : 0;
    if (shift === 0) return;
    camera.setViewOffset(innerWidth, innerHeight, -shift, 0, innerWidth, innerHeight);
  };
  frameLens();
  const listeners = new AbortController();
  made.push(() => listeners.abort());
  addEventListener(
    'resize',
    () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      frameLens();
      museum.setSize(innerWidth, innerHeight, cameraParams.pixelRatio);
    },
    { signal: listeners.signal },
  );

  const deltas: number[] = [];
  let last = performance.now();
  let idleSince = Infinity;
  let idleFrames = 0;
  made.push(() => renderer.setAnimationLoop(null));
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    deltas.push(now - last);
    if (deltas.length > FRAMES) deltas.shift();
    last = now;
    limitZoom();
    if (renderer.getPixelRatio() !== cameraParams.pixelRatio) {
      museum.setSize(innerWidth, innerHeight, cameraParams.pixelRatio);
    }
    walk?.update(now, dt);
    control.step(now, dt);
    const current = control.current;
    if (cameraParams.reliefByZoom) {
      const k = reliefForWidth(current.viewKm, cameraParams.reliefNear, cameraParams.reliefFar);
      look.params.kLand = k;
      look.params.kSea = k;
    }

    // The gimbal turns the globe so the camera looks into the front of the instrument, where the
    // lamp lights it (or, with faceCamera off, turns the view center to the front); then the
    // camera goes where the view puts it in the turned globe frame. Wide views drop their tilt.
    const surfaceRelief = relief(look.params);
    const drawn = drawnView(current);
    const [lon, lat] = cameraParams.faceCamera
      ? rig.gimbalFacing(camera, drawn, surfaceRelief)
      : [drawn.lon, drawn.lat];
    museum.params.lat = lat;
    museum.params.lon = lon;
    museum.update(camera, now / 1000);
    rig.place(camera, drawn, surfaceRelief, museum.globeMount, Number(museum.params.hideAltitude));
    const viewport = { width: innerWidth, height: innerHeight };
    streamer.update(camera, viewport, museum.globeMount);
    // The story's effects set the look's layers and ash, so they run before the look's update.
    story?.effects.update(story.walk.state(), camera, museum.globeMount, viewport, now / 1000);
    look.update(now / 1000);
    museum.render(camera);
    story?.ui.update(story.walk.state(), drawn);

    const s = streamer.stats();
    // Not the streamer's queue: when the pool is full, a wanted tile can wait there for good.
    const busy = s.inFlight + s.decoding + s.uploading > 0;
    if (busy || !control.settled) {
      idleSince = Infinity;
      idleFrames = 0;
    } else {
      idleSince = Math.min(idleSince, now);
      idleFrames += 1;
    }
  });

  return {
    canvas: renderer.domElement,
    museum,
    look,
    streamer,
    control,
    cameraParams,
    story,
    stats: () => {
      const frame = summarizeFrames(deltas);
      const total = deltas.reduce((sum, d) => sum + d, 0);
      return {
        ...streamer.stats(),
        view: roundView(control.current),
        fps: total > 0 ? (1000 * deltas.length) / total : 0,
        frameP95: frame.p95,
        altitudeKm: rig.altitude * 6371.0088,
      };
    },
    ready: () => idleFrames >= IDLE_FRAMES && performance.now() - idleSince >= IDLE_MS,
    dispose() {
      for (const undo of made.splice(0).reverse()) undo();
    },
  };
}

/** The walk's renderer, or a DrawError when this browser gives no WebGL 2 context. */
function createRenderer(): WebGLRenderer {
  try {
    return new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (error) {
    throw new DrawError('no WebGL 2 context', { cause: error });
  }
}

/**
 * The story mode's parts: the director, with input on the globe breaking out and the arrow keys
 * stepping beats instead of panning; the effects, with their plaques in `labels`; and the card,
 * ruler and Meanwhile over them in `root`. With them, what ends the story.
 */
function startStory(
  { story, meanwhile }: StorySource,
  control: ViewControl,
  look: SurfaceLook,
  labels: HTMLElement,
  root: HTMLElement,
  ready: () => boolean,
): [StoryParts, () => void] {
  const walk = createWalk(story, control, { ready });
  control.arrowKeys = false;
  control.onInput = () => walk.breakOut();
  const unbindKeys = bindWalkKeys(walk);

  const effects = createWalkEffects(story, look, labels);
  const ui = createWalkUi(root, walk, meanwhile);
  const end = () => {
    unbindKeys();
    ui.dispose();
    effects.dispose();
    walk.dispose();
  };
  return [{ walk, effects, ui }, end];
}

/**
 * Readies every shader the walk draws before it starts, so no flight stalls on one. The scene's
 * materials compile, hidden ones too (the plume, the veil, every beat's pulses), and the
 * instrument's brass also as it draws while fading out near the globe (transparent), against a
 * render target as the composer draws them (no tone mapping, linear output). Then one frame is
 * drawn with every effect shown, as the GPU finishes some programs only at their first draw; the
 * effects' first update hides them again.
 */
async function precompile(
  renderer: WebGLRenderer,
  museum: MuseumScene,
  camera: PerspectiveCamera,
  effects: Object3D,
): Promise<void> {
  const brass = new Set<Material>();
  museum.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material as Material | Material[]].flat()) {
      if (material instanceof MeshStandardMaterial && !material.transparent) brass.add(material);
    }
  });
  const target = new WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(target);
  const opaque = renderer.compileAsync(museum.scene, camera);
  for (const material of brass) material.transparent = true;
  const fading = renderer.compileAsync(museum.scene, camera);
  for (const material of brass) {
    material.transparent = false;
    material.needsUpdate = true;
  }
  renderer.setRenderTarget(null);
  await Promise.all([opaque, fading]);
  target.dispose();
  effects.traverse((object) => (object.visible = true));
  museum.render(camera);
}

/** The deepest level with a tile under a point. */
function deepestLevel(layer: SurfaceLayer, lon: number, lat: number): number {
  const dir = lonLatToDir(lon, lat);
  const face = faceOf(dir);
  const [s, t] = faceSt(face, dir);
  for (let level = layer.surface.maxLevel; level > 0; level -= 1) {
    if (layer.available({ face, level, x: tileOf(s, level), y: tileOf(t, level) })) return level;
  }
  return 0;
}

/** The relief the vertex shader draws, which the camera's clearance must clear. */
function relief(params: Params): Relief {
  const flat = params.flatRelief === true;
  return {
    kLand: flat ? 0 : Number(params.kLand),
    kSeaEff: flat || params.bathymetry !== true ? 0 : Number(params.kSea),
  };
}

function roundView(view: ViewState): ViewState {
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  return {
    lon: round(view.lon, 3),
    lat: round(view.lat, 3),
    viewKm: round(view.viewKm, 1),
    tilt: round(view.tilt, 1),
    heading: round(view.heading, 1),
  };
}
