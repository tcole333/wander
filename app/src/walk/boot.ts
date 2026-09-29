// The walk's boot: the streamed globe in the surface look, hung in the museum scene's gimbal, with
// a camera that flies from the whole instrument down to a few tens of km. The gimbal turns the
// view center toward the lamp and the camera, as the spike's did. Given a story, the walk plays
// over it: the director flies between its beats (story/director.ts), the card, time ruler,
// Meanwhile, climate legend and borders' year plate sit over the globe (story/ui/), the ember,
// plume, plaques, ash, veil, climate and borders follow story time (story/effects/), and its sound
// follows the walk from the visitor's first gesture (audio/walkAudio.ts). It starts paused on the
// first beat; Left and Right step beats, Space plays or pauses, WANDER and Escape return to the
// lobby, and M mutes. Or it starts in the lobby (lobby/lobby.ts), where choosing
// the story's plaque starts the walk and flies into its first beat. Where Explore is enabled, its
// plaque dives into free time instead (explore/explore.ts). A story or Explore is the page's one
// active mode (walk/mode.ts), which the frame loop calls at fixed points.
//
// The first frame follows the roots (L0-L1), every face the page draws (story/ui/fonts.ts) and the
// precompile; in the lobby the opening starts on it. The climate's years load the first time the
// view settles with the streamer idle, after the tiles in view.
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
import { createWalkAudio, type WalkAudio } from '../audio/walkAudio';
import type { MuseumScene, Params, StreamerStats, SurfaceLook, SurfaceStreamer } from '../contract';
import type { Release } from '../data/release';
import type { SurfaceLayer } from '../data/surfaceLayer';
import { ClearanceField } from '../globe/clearance';
import { createLobby, GLOW_FADE_S, type Lobby } from '../lobby/lobby';
import { lobbyPlaces } from '../lobby/places';
import { createSurfaceLook } from '../look/surfaceLook';
import { summarizeFrames } from '../perf/frameStats';
import type { MemoryAccount } from '../perf/memory';
import { FrameContext } from '../scene/frameContext';
import { createMuseumScene } from '../scene/museumScene';
import type { Meanwhile, WalkEffects, WalkUi } from '../story/contract';
import { bindWalkKeys, createWalk, type DirectedWalk } from '../story/director';
import { createWalkEffects } from '../story/effects/walkEffects';
import type { LonLat, Story } from '../story/story';
import { loadFaces } from '../story/ui/fonts';
import { WalkChrome } from '../story/ui/chrome';
import { createWalkUi } from '../story/ui/walkUi';
import { createSurfaceStreamer } from '../stream/streamer';
import { faceOf, faceSt, lonLatToDir, tileOf } from '../surface/cube';
import { CameraRig, maxViewKm, type Relief } from '../view/cameraRig';
import { ViewControl } from '../view/viewControl';
import { drawnView, reliefForWidth, type ViewState } from '../view/viewState';
import type { Choice, Mode } from './mode';
import { startExplore } from '../explore/explore';

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

/** A story to walk, Meanwhile's entries, and where the lobby's glows are: all from its lock. */
export interface StorySource {
  story: Story;
  meanwhile: Meanwhile;
  glows: LonLat[];
}

export interface BootOptions {
  /**
   * The story, or Explore, to start on directly; without one, starts in the lobby if stories are
   * supplied or Explore is enabled.
   */
  story?: StorySource | 'explore' | null;
  /** The lobby's stories, in plaque order. Defaults to the direct story alone. */
  stories?: readonly StorySource[];
  /**
   * Enables Explore: the lobby shows its plaque last, where the release has its events.
   */
  explore?: boolean;
  /**
   * Starts in the lobby, where choosing a plaque starts its story. Needs at least one story, or
   * Explore.
   */
  lobby?: boolean;
  /** Where the view starts. */
  view?: ViewState;
  /**
   * Called when the chosen story or Explore does not start from the lobby's plaque, after the boot
   * has resolved, so the page can bring its plate. Without it, the error goes on uncaught.
   */
  onFail?: (error: unknown, choice: Choice) => void;
  /** The chosen story or Explore, including during its dive; null once the lobby has returned. */
  onStory?: (choice: Choice | null) => void;
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
  inspectMemory(account: MemoryAccount): void;
  museum: MuseumScene;
  look: SurfaceLook;
  streamer: SurfaceStreamer;
  control: ViewControl;
  /** The camera's params: the zoom floor, relief by zoom, the gimbal's facing, the pixel ratio. */
  cameraParams: Params;
  /** The story's parts, once it has started: at once, or when its plaque is chosen. */
  readonly story: StoryParts | null;
  /** The lobby for any page with a story, including a dev page starting on a beat. */
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
    story: start = null,
    stories: sources = start && start !== 'explore' ? [start] : [],
    explore = false,
    lobby: inLobby = start === null,
    view = WORLD,
    tune = () => {},
    onFail = (error) => {
      throw error;
    },
    onStory = () => {},
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

  // The lobby stands where there are stories to choose, or Explore.
  const hasLobby = sources.length > 0 || explore;
  // Every story's faces load with the roots, and Explore's label faces with them where it is
  // enabled: switching plaques never fetches another font.
  const faces = hasLobby
    ? loadFaces(
        sources.map(({ story, meanwhile }) => JSON.stringify({ story, meanwhile })).join('') +
          creditsPage,
        { labels: explore },
      )
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
    pixelRatio: Math.min(devicePixelRatio, hasLobby ? 1.5 : 2),
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

  // The active mode, and a story's parts while it is one. A single slot: retaining one mode per
  // dive would keep all its UI and images.
  let mode: Mode | null = null;
  let story: StoryParts | null = null;
  const globeFrame = new FrameContext();
  const sound = hasLobby ? createWalkAudio() : null;
  if (sound) made.push(() => sound.dispose());
  const chrome = sound ? new WalkChrome(host, sound, () => lobby?.back()) : null;
  if (chrome) made.push(() => chrome.dispose());

  // What stands at the left shifts the lens right, and the streamer and the callout plaques read
  // the shifted projection. In the lobby, the story plaques: by half their reach, which centers
  // the instrument in the room beside them. In a story, the card: by LENS_SHIFT of its reach, so
  // each beat's place lands right of it and what lies around it clears both the card and
  // Meanwhile. Explore stands nothing there. The lens eases from one to the other during the dive.
  // A folded card reaches nothing, so folding it eases the lens back to the center; the card has
  // the lens measured again as it folds or unfolds, as a resize does, and where reduced motion is
  // asked for, the globe takes its new place at once.
  let cardShift = 0;
  let shift = 0;
  let drawnShift = NaN;
  const measureLens = () => {
    cardShift = mode?.lensShift() ?? 0;
  };
  const cardReachChanged = () => {
    measureLens();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) shift = cardShift;
  };

  // A story's effects hang in the globe frame from the start, so the precompile readies their
  // programs, the climate's and the borders' too, whose files come from the release's data host;
  // the borders' field loads in the background from the room's first frame. Its page steps
  // through its beats: the walk flies the camera, and holds a late landing until the streamer has
  // nothing in hand. It starts on its first beat, or in the lobby, which starts it in the press
  // that chooses its plaque.
  const prepared = new Map(
    sources.map((source) => {
      const effects = createWalkEffects(source.story, look, labels, release);
      made.push(() => effects.dispose());
      museum.globeMount.add(effects.group);
      tune(effects.params);
      return [source.story.id, { source, effects }] as const;
    }),
  );
  made.push(() => mode?.end());
  const idle = () => {
    const s = streamer.stats();
    return s.inFlight + s.decoding + s.uploading === 0;
  };
  const begin = (choice: Choice, arrive: 'jump' | 'fly'): Mode => {
    onStory(choice);
    if (!sound) throw new Error('the page has no lobby to begin from');
    let next: Mode;
    if (choice.kind === 'explore') {
      if (!explore) throw new Error('the page has no Explore to begin');
      next = startExplore({ root: host, control, sound, arrive });
      story = null;
    } else {
      const entry = prepared.get(choice.story.id);
      if (!entry) throw new Error(`the page has no story '${choice.story.id}' to begin`);
      const started = startStory(
        entry.source,
        entry.effects,
        release,
        control,
        host,
        sound,
        arrive,
        idle,
        cardReachChanged,
      );
      next = started.mode;
      story = started.parts;
    }
    mode = next;
    sound.start(arrive === 'fly');
    measureLens();
    return next;
  };
  const finish = () => {
    mode?.end();
    mode = null;
    story = null;
    onStory(null);
    measureLens();
  };
  const lobby =
    hasLobby && chrome
      ? createLobby({
          host,
          stories: sources.map(({ story }) => story),
          places: lobbyPlaces(sources.map(({ glows }) => glows)),
          museum,
          control,
          chrome,
          // The plaque needs the event index, which the release names once event-files has run.
          explore: explore && release.events !== undefined,
          initial: inLobby ? 'lobby' : start === 'explore' ? 'explore' : 'story',
          enter: (choice) => begin(choice, 'fly'),
          leave: () => mode?.leave(),
          finish,
          fail: onFail,
        })
      : null;
  if (lobby) made.push(() => lobby.dispose());
  // The sea names are lettered before the first frame, in faces loaded now, so none pops in.
  await look.ready;
  for (const { effects } of prepared.values()) effects.group.visible = false;
  if (prepared.size || lobby) {
    // Compile with one story's lights present, as the walk draws them. Compiling every story
    // together would warm a different light count and leave the first dive to compile again.
    for (const { effects } of prepared.values()) {
      effects.group.visible = true;
      await precompile(
        renderer,
        museum,
        camera,
        lobby ? [effects.group, lobby.glows] : [effects.group],
      );
      effects.hide();
    }
    if (!prepared.size && lobby) await precompile(renderer, museum, camera, [lobby.glows]);
    // precompile drew every program once, and three checks each link at its first use.
    if (unlinked > 0) throw new DrawError(`${unlinked} shaders did not link`);
  }
  if (!inLobby && start) {
    begin(
      start === 'explore' ? { kind: 'explore' } : { kind: 'story', story: start.story },
      'jump',
    );
  }
  let effectsLoading = false;
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
    for (const { effects } of prepared.values()) effects.background();
    mode?.beforeCamera(now, dt);
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
    // A story's effects set the look's layers and ash, so the mode runs before the look's update.
    if (mode) {
      globeFrame.place(camera, museum.globeMount, viewport);
      mode.afterPlace(globeFrame, now);
    }
    look.update(now / 1000);
    museum.render(camera);
    mode?.ui(drawn, now);
    chrome?.update();
    const heard = mode?.audio() ?? null;
    const walked = heard && 'state' in heard ? heard : null;
    sound?.update(walked?.state ?? null, walked?.unit ?? 'day', drawn, dt, lobby?.returning);

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
    if (!effectsLoading && ready()) {
      effectsLoading = true;
      for (const { effects } of prepared.values()) effects.load();
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
    inspectMemory(account) {
      streamer.inspectMemory?.(account);
      look.inspectMemory?.(account);
      for (const { effects } of prepared.values()) effects.inspectMemory?.(account);
      sound?.inspectMemory?.(account);
      mode?.inspectMemory(account);
      // Count specialized owners first, then the remaining instrument and lobby resources.
      account.geometry('surface.gridAndInstances', streamer.geometry);
      for (const { effects } of prepared.values()) account.object('effects', effects.group);
      if (lobby) account.object('lobby', lobby.glows);
      account.object('instrument', museum.scene);
      if (museum.scene.background && 'isTexture' in museum.scene.background) {
        account.texture('room.backdrop', museum.scene.background);
      }
      const { memory, render, programs } = renderer.info;
      account.details.renderer = {
        memory: { ...memory },
        render: { ...render },
        programs: programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(),
      };
      account.details.streamer = streamer.stats();
      account.details.cardFiles =
        story?.walk.state().story.beats.flatMap((beat) => beat.image.locked?.files ?? []) ?? [];
    },
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
 * The story mode and its parts: the director, arriving on the first beat by `arrive`, with input
 * on the globe breaking out and the arrow keys stepping beats instead of panning; the story's
 * `effects`, shown from now on and fading in over the dive; the card, ruler, Meanwhile and climate
 * legend over them in `root`, the card's images from `dataHost`. Sound, the mark and knob belong
 * to the page. Leaving stops the director and keys first and fades the effects out; ending
 * disposes the UI and director once they have left the screen and hides the effects.
 */
function startStory(
  { story, meanwhile }: StorySource,
  effects: WalkEffects,
  { dataHost }: Release,
  control: ViewControl,
  root: HTMLElement,
  sound: WalkAudio,
  arrive: 'jump' | 'fly',
  ready: () => boolean,
  reachChanged: () => void,
): { mode: Mode; parts: StoryParts } {
  const walk = createWalk(story, control, { ready, arrive, route: (name) => effects.route(name) });
  let ui: WalkUi;
  try {
    ui = createWalkUi(root, walk, meanwhile, dataHost, reachChanged);
  } catch (error) {
    walk.dispose();
    throw error;
  }
  control.arrowKeys = false;
  control.onInput = () => walk.breakOut();
  const unbindKeys = bindWalkKeys(walk);
  effects.group.visible = true;
  // The effects are compiled once and reused. A separate fade leaves the tuned params intact
  // and starts from zero on every dive, including one after a return in mid-flight.
  let strength = arrive === 'fly' ? 0 : 1;
  let left = false;
  const mode: Mode = {
    landed: (cb) =>
      walk.subscribe((state) => {
        if (state.flight === null) cb();
      }),
    lensShift: () => LENS_SHIFT * ui.cardReach(),
    beforeCamera(nowMs, dtS) {
      strength = Math.max(0, Math.min(1, strength + (left ? -dtS : dtS) / GLOW_FADE_S));
      if (!left) walk.update(nowMs, dtS);
    },
    afterPlace(frame, nowMs) {
      effects.update(walk.state(), frame, nowMs / 1000, strength);
    },
    ui(drawn) {
      ui.update(walk.state(), drawn, effects.climate(), effects.borders());
    },
    audio: () => (left ? null : { state: walk.state(), unit: ui.rulerUnit() }),
    leave() {
      left = true;
      unbindKeys();
      walk.breakOut();
      ui.leave();
      sound.leave();
    },
    end() {
      unbindKeys();
      ui.dispose();
      walk.dispose();
      effects.hide();
    },
    inspectMemory() {},
  };
  return { mode, parts: { walk, effects, ui, sound } };
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
