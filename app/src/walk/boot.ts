// The walk's boot: the streamed globe in the surface look, hung in the museum scene's gimbal, with
// a camera that flies from the whole instrument down to a few tens of km. The gimbal turns the
// view center toward the lamp and the camera, as the spike's did. Given a story, the walk plays
// over it: the director flies between its beats (story/director.ts), the card, time ruler,
// Meanwhile and climate legend sit over the globe (story/ui/), the ember, plume, plaques, ash, veil
// and climate follow story time (story/effects/), and its sound follows the walk from the
// visitor's first gesture (audio/walkAudio.ts). It starts paused on the first beat; Left and Right
// step beats, Space plays or pauses, Escape resumes after the visitor breaks out to explore, and M
// mutes. Or it starts in the lobby (lobby/lobby.ts), where choosing the story's plaque starts the
// walk and flies into its first beat.
//
// The first frame follows the roots (L0-L1), every face the page draws (story/ui/fonts.ts) and the
// precompile; in the lobby the opening starts on it. The climate's years load once the opening has
// started, or at once without a lobby.
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
import creditsPage from '../../credits.html?raw';
import { unlockSound } from '../audio/engine';
import { createWalkAudio, type WalkAudio } from '../audio/walkAudio';
import type { MuseumScene, Params, StreamerStats, SurfaceLook, SurfaceStreamer } from '../contract';
import type { Release } from '../data/release';
import type { SurfaceLayer } from '../data/surfaceLayer';
import { ClearanceField } from '../globe/clearance';
import { createLobby, GLOW_FADE_S, type Lobby } from '../lobby/lobby';
import { createSurfaceLook } from '../look/surfaceLook';
import { summarizeFrames } from '../perf/frameStats';
import { createMuseumScene } from '../scene/museumScene';
import type { MeanwhileByBeat, Walk, WalkEffects, WalkUi } from '../story/contract';
import { bindWalkKeys, createWalk, type DirectedWalk } from '../story/director';
import { createWalkEffects } from '../story/effects/walkEffects';
import type { Story } from '../story/story';
import { loadFaces } from '../story/ui/fonts';
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
/** The time constant with which the lens eases from the lobby's shift to the story's, seconds. */
const LENS_EASE_S = 0.6;

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
  /**
   * Starts in the lobby, where choosing the story's plaque starts it, rather than on its first
   * beat. Needs a story.
   */
  lobby?: boolean;
  /** Where the view starts. */
  view?: ViewState;
  /**
   * Called when the story does not start from the lobby's plaque, after the boot has resolved, so
   * the page can bring its plate. Without it, the error goes on uncaught.
   */
  onFail?: (error: unknown) => void;
  /**
   * Called with each part's params (the look's, the scene's, the streamer's, the camera's, and a
   * story's effects') before anything reads them: the dev shell's query overrides.
   */
  tune?: (params: Params) => void;
}

/** The director, the effects hung in the globe's frame, the card, ruler and Meanwhile, and sound. */
export interface StoryParts {
  walk: DirectedWalk;
  effects: WalkEffects;
  ui: WalkUi;
  sound: WalkAudio;
}

export interface WalkStats extends StreamerStats {
  view: ViewState;
  fps: number;
  frameP95: number;
  altitudeKm: number;
}

/** A booted walk: the parts the dev shell's panel and hooks reach into, and its checks. */
export interface WalkPage {
  museum: MuseumScene;
  look: SurfaceLook;
  streamer: SurfaceStreamer;
  control: ViewControl;
  /** The camera's params: the zoom floor, relief by zoom, the gimbal's facing, the pixel ratio. */
  cameraParams: Params;
  /** The story's parts, once it has started: at once, or when its plaque is chosen. */
  readonly story: StoryParts | null;
  /** The lobby, when the page starts in one. */
  lobby: Lobby | null;
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
  {
    story: source = null,
    lobby: inLobby = false,
    view = WORLD,
    tune = () => {},
    onFail = (error) => {
      throw error;
    },
  }: BootOptions,
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

  // The faces load beside the roots, for every character of the story, Meanwhile and the credits.
  const faces = source
    ? loadFaces(JSON.stringify(source.story) + JSON.stringify(source.meanwhile) + creditsPage)
    : null;
  const streamer = await createSurfaceStreamer(renderer, release);
  made.push(() => streamer.dispose());
  const layer = streamer.layer;
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

  const deltas: number[] = [];
  let last = performance.now();
  let idleSince = Infinity;
  let idleFrames = 0;
  const ready = () => idleFrames >= IDLE_FRAMES && performance.now() - idleSince >= IDLE_MS;

  let story: StoryParts | null = null;

  // What stands at the left shifts the lens right, and the streamer and the callout plaques read
  // the shifted projection. In the lobby, the story plaques: by half their reach, which centers
  // the instrument in the room beside them. In a story, the card: by LENS_SHIFT of its reach, so
  // each beat's place lands right of it and what lies around it clears both the card and
  // Meanwhile. The lens eases from one to the other during the dive.
  let cardShift = 0;
  let shift = 0;
  let drawnShift = NaN;
  const measureLens = () => {
    cardShift = story ? LENS_SHIFT * story.ui.cardReach() : 0;
  };

  // A story's effects hang in the globe frame from the start, so the precompile readies their
  // programs, the climate's too, whose files come from the release's data host. Its page steps
  // through its beats: the walk flies the camera, and holds a late landing until the streamer has
  // nothing in hand. It starts on its first beat, or in the lobby, which starts it in the press
  // that chooses its plaque.
  const effects = source && createWalkEffects(source.story, look, labels, release);
  if (effects) {
    made.push(() => effects.dispose());
    museum.globeMount.add(effects.group);
    tune(effects.params);
  }
  // Flying in from the lobby, the story's effects come up from nothing as the lobby's glows go,
  // so Tambora's ember never pops in: `rising` holds their strengths to come up to.
  let rising: Params | null = null;
  let risen = 0;
  const begin = (arrive: 'jump' | 'fly'): Walk => {
    if (!source || !effects) throw new Error('the page has no story to begin');
    const [parts, end] = startStory(source, effects, release, control, host, arrive, () => {
      const s = streamer.stats();
      return s.inFlight + s.decoding + s.uploading === 0;
    });
    made.push(end);
    story = parts;
    measureLens();
    if (arrive === 'fly') {
      rising = { ...effects.params };
      riseEffects(0);
    }
    return parts.walk;
  };
  const riseEffects = (dtS: number) => {
    if (!rising || !effects) return;
    risen = Math.min(1, risen + dtS / GLOW_FADE_S);
    for (const [name, full] of Object.entries(rising)) effects.params[name] = Number(full) * risen;
    if (risen === 1) rising = null;
  };
  const lobby =
    source && inLobby
      ? createLobby({
          host,
          story: source.story,
          places: Object.values(source.meanwhile).flatMap((entries) => entries.map((e) => e.at)),
          museum,
          control,
          // The press that chose the plaque is the visitor's first gesture: sound unlocks in its
          // handler, since the walk's sound, made in it, hears only the gestures after it. Audio
          // that fails leaves silence, never the story unstarted (streaming.md 5.9); a story that
          // does not start leaves no sound running behind its plate.
          enter: () => {
            let ctx: AudioContext | undefined;
            try {
              ctx = unlockSound().ctx as AudioContext;
            } catch (error) {
              console.warn('Sound did not start:', error);
            }
            try {
              return begin('fly');
            } catch (error) {
              void ctx?.suspend();
              throw error;
            }
          },
          fail: onFail,
        })
      : null;
  if (lobby) made.push(() => lobby.dispose());
  if (effects) {
    await precompile(
      renderer,
      museum,
      camera,
      lobby ? [effects.group, lobby.glows] : [effects.group],
    );
    // precompile drew every program once, and three checks each link at its first use.
    if (unlinked > 0) throw new DrawError(`${unlinked} shaders did not link`);
  }
  if (lobby && effects) effects.group.visible = false;
  else if (source) begin('jump');
  if (effects) void (lobby?.opened ?? Promise.resolve()).then(() => effects.load());
  await faces;

  const frameLens = (dtS: number) => {
    const target = lobby?.lensShift() ?? cardShift;
    shift += (target - shift) * (1 - Math.exp(-dtS / LENS_EASE_S));
    if (Math.abs(target - shift) < 0.05) shift = target;
    if (shift === drawnShift) return;
    drawnShift = shift;
    camera.setViewOffset(innerWidth, innerHeight, -shift, 0, innerWidth, innerHeight);
  };
  frameLens(Infinity);
  const listeners = new AbortController();
  made.push(() => listeners.abort());
  addEventListener(
    'resize',
    () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      measureLens();
      drawnShift = NaN;
      museum.setSize(innerWidth, innerHeight, cameraParams.pixelRatio);
    },
    { signal: listeners.signal },
  );

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
    lobby?.update(dt, camera);
    riseEffects(dt);
    story?.walk.update(now, dt);
    control.step(now, dt);
    frameLens(dt);
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
    if (story) {
      const state = story.walk.state();
      story.ui.update(state, drawn, story.effects.climate());
      story.sound.update(state, story.ui.rulerUnit(), drawn, dt);
    }

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
    museum,
    look,
    streamer,
    control,
    cameraParams,
    get story() {
      return story;
    },
    lobby,
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
    ready,
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
 * The story mode's parts: the director, arriving on the first beat by `arrive`, with input on the
 * globe breaking out and the arrow keys stepping beats instead of panning; the story's `effects`,
 * shown from now on; the card, ruler, Meanwhile, climate legend and sound knob over them in
 * `root`, the card's images from `dataHost`; and the sound. With them, what ends the story (the
 * effects end with the boot, which made them). The sound and UI are made before the keys and the
 * view are taken, so a story that throws leaves them as they were.
 */
function startStory(
  { story, meanwhile }: StorySource,
  effects: WalkEffects,
  { dataHost }: Release,
  control: ViewControl,
  root: HTMLElement,
  arrive: 'jump' | 'fly',
  ready: () => boolean,
): [StoryParts, () => void] {
  const walk = createWalk(story, control, { ready, arrive });
  const sound = createWalkAudio();
  let ui: WalkUi;
  try {
    ui = createWalkUi(root, walk, meanwhile, sound, dataHost);
  } catch (error) {
    sound.dispose();
    walk.dispose();
    throw error;
  }
  control.arrowKeys = false;
  control.onInput = () => walk.breakOut();
  const unbindKeys = bindWalkKeys(walk);
  effects.group.visible = true;
  const end = () => {
    unbindKeys();
    sound.dispose();
    ui.dispose();
    walk.dispose();
  };
  return [{ walk, effects, ui, sound }, end];
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
  effects: Object3D[],
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
  for (const group of effects) group.traverse((object) => (object.visible = true));
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
