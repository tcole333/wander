// The look prototype (prototype.html, dev only): the streamed globe in the look's material, hung
// in the museum scene's gimbal, with a camera that flies from the whole instrument down to a few
// tens of km. The gimbal turns the view center toward the lamp and the camera, as the spike's did.
//
// Query: ?data=region|global (global when its server answers), ?view=<preset>, ?ui=0 (no panel or
// HUD, for screenshots), and any module param by name (?kLand=10, ?exposure=1.1, ?refinePx=1).
// window.__proto serves scripts (scripts/prototypeShots.ts).
import { Mesh, PerspectiveCamera, WebGLRenderer } from 'three';
import type { Release } from '../../data/release';
import { loadSurfaceLayer } from '../../data/surfaceLayer';
import { ClearanceField } from '../../globe/clearance';
import { summarizeFrames } from '../../perf/frameStats';
import type { Params, StreamerStats } from '../contract';
import { createSurfaceStreamer } from '../globe/streamer';
import { createSurfaceLook } from '../look/surfaceLook';
import { createMuseumScene } from '../scene/museumScene';
import { CameraRig, maxViewKm, type Relief } from './cameraRig';
import { addParams, applyQuery, GUI } from './panel';
import { ViewControl } from './viewControl';
import { drawnView, reliefForWidth, type ViewState } from './viewState';

const DATA_HOSTS = { region: 'http://127.0.0.1:8792', global: 'http://127.0.0.1:8793' };
type DataName = keyof typeof DATA_HOSTS;

const TAMBORA = { lon: 118.0, lat: -8.25, heading: 0 };
const WORLD: ViewState = { lon: 75, lat: 15, viewKm: Infinity, tilt: 0, heading: 0 };
/**
 * Keys 1-9 in this order. world's width is the widest the zoom allows. The close views look down
 * at 25 degrees: at 45 the near rim hides Tambora's caldera floor, and its lit far wall reads as a
 * dome.
 */
const PRESETS: Record<string, ViewState> = {
  world: WORLD,
  sunda: { ...TAMBORA, viewKm: 1500, tilt: 20 },
  sumbawa: { ...TAMBORA, viewKm: 300, tilt: 45 },
  close100: { ...TAMBORA, viewKm: 100, tilt: 25 },
  close50: { ...TAMBORA, viewKm: 50, tilt: 25 },
  close30: { ...TAMBORA, viewKm: 30, tilt: 25 },
  himalaya: { lon: 87.0, lat: 28.0, viewKm: 300, tilt: 45, heading: 0 },
  mediterranean: { lon: 15, lat: 38, viewKm: 3000, tilt: 15, heading: 0 },
  magellan: { lon: -71, lat: -53.5, viewKm: 300, tilt: 45, heading: 0 },
};

/** The camera params that drive kLand and kSea, shown in the look's folder. */
const RELIEF_BY_ZOOM = ['reliefByZoom', 'reliefNear', 'reliefFar'];

/** Frames the HUD and the ready check look back over. */
const FRAMES = 120;
/** How long the streamer must stay idle before a screenshot. */
const IDLE_MS = 1000;
const IDLE_FRAMES = 5;

export interface ProtoStats extends StreamerStats {
  data: DataName;
  view: ViewState;
  preset: string;
  fps: number;
  frameP95: number;
  altitudeKm: number;
}

declare global {
  interface Window {
    __proto?: {
      presets: string[];
      stats(): ProtoStats;
      /** True once the view has settled and the streamer has been idle for a while. */
      ready(): boolean;
      go(preset: string, instant?: boolean): void;
      /** Flies to any view, or jumps there. */
      view(view: ViewState, instant?: boolean): void;
      settings(): string;
      error?: string;
    };
  }
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const showUi = query.get('ui') !== '0';
  const data = await pickData(query.get('data'));
  const release = (await (await fetch(`${DATA_HOSTS[data]}/release.json`)).json()) as Release;

  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  document.body.prepend(renderer.domElement);
  const museum = createMuseumScene(renderer);
  museum.setSize(innerWidth, innerHeight, devicePixelRatio);

  const [streamer, layer] = await Promise.all([
    createSurfaceStreamer(renderer, release),
    loadSurfaceLayer(release),
  ]);
  const look = createSurfaceLook(streamer.pools, release.surface);
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
    zoomFloorKm: 30,
    // kLand and kSea follow the zoom: reliefNear at 100 km wide and closer, reliefFar at 3,000 km
    // and wider. Off, the look's own kLand and kSea hold.
    reliefByZoom: true,
    reliefNear: 2,
    reliefFar: 8,
    // The gimbal tilts the globe toward the camera, so a tilted view keeps the lamp behind the
    // camera; off, it turns the view center to the front and the camera tilts instead.
    faceCamera: true,
    // Device pixels per CSS pixel. 1 holds 60 fps on the M5 in every preset with room to spare;
    // 1.5 is near the edge (the Mediterranean drops frames by 1.75), and 2 misses in regional
    // views. Up to 2 for the sharpest stills.
    pixelRatio: 1,
  };
  for (const params of [look.params, museum.params, streamer.params, cameraParams]) {
    applyQuery(params, query);
  }

  const asked = query.get('view') ?? 'world';
  let preset = asked in PRESETS ? asked : 'world';
  const control = new ViewControl(PRESETS[preset] ?? WORLD);
  const limitZoom = () => {
    control.minKm = cameraParams.zoomFloorKm;
    control.maxKm = maxViewKm(camera);
  };
  limitZoom();
  control.go(control.goal, true);
  control.attach(renderer.domElement);
  const go = (name: string, instant = false) => {
    const view = PRESETS[name];
    if (!view) return;
    preset = name;
    control.go(view, instant);
  };

  const settings = () =>
    JSON.stringify(
      {
        data,
        scene: withoutGimbal(museum.params),
        look: look.params,
        streamer: streamer.params,
        camera: { ...cameraParams, view: roundView(control.current) },
      },
      null,
      2,
    );
  if (showUi) buildUi({ museum, look, streamer, cameraParams, control, go, settings });
  else document.body.classList.add('clean');

  addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const name = Object.keys(PRESETS)[Number(event.key) - 1];
    if (name) go(name);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    museum.setSize(innerWidth, innerHeight, cameraParams.pixelRatio);
  });

  const deltas: number[] = [];
  let last = performance.now();
  let idleSince = Infinity;
  let idleFrames = 0;
  const stats = (): ProtoStats => {
    const frame = summarizeFrames(deltas);
    const total = deltas.reduce((sum, d) => sum + d, 0);
    return {
      ...streamer.stats(),
      data,
      view: roundView(control.current),
      preset,
      fps: total > 0 ? (1000 * deltas.length) / total : 0,
      frameP95: frame.p95,
      altitudeKm: rig.altitude * 6371.0088,
    };
  };
  window.__proto = {
    presets: Object.keys(PRESETS),
    stats,
    ready: () => idleFrames >= IDLE_FRAMES && performance.now() - idleSince >= IDLE_MS,
    go,
    view: (view, instant) => {
      preset = 'custom';
      control.go(view, instant);
    },
    settings,
  };

  const hud = document.getElementById('hud');
  let shown = 0;
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    deltas.push(now - last);
    if (deltas.length > FRAMES) deltas.shift();
    last = now;
    limitZoom();
    if (renderer.getPixelRatio() !== cameraParams.pixelRatio) {
      museum.setSize(innerWidth, innerHeight, cameraParams.pixelRatio);
    }
    control.step(now, dt);
    const view = control.current;
    if (cameraParams.reliefByZoom) {
      const k = reliefForWidth(view.viewKm, cameraParams.reliefNear, cameraParams.reliefFar);
      look.params.kLand = k;
      look.params.kSea = k;
    }

    // The gimbal turns the globe so the camera looks into the front of the instrument, where the
    // lamp lights it (or, with faceCamera off, turns the view center to the front); then the
    // camera goes where the view puts it in the turned globe frame. Wide views drop their tilt.
    const surfaceRelief = relief(look.params);
    const drawn = drawnView(view);
    const [lon, lat] = cameraParams.faceCamera
      ? rig.gimbalFacing(camera, drawn, surfaceRelief)
      : [drawn.lon, drawn.lat];
    museum.params.lat = lat;
    museum.params.lon = lon;
    museum.update(camera, now / 1000);
    rig.place(camera, drawn, surfaceRelief, museum.globeMount, Number(museum.params.hideAltitude));
    streamer.update(camera, { width: innerWidth, height: innerHeight }, museum.globeMount);
    look.update(now / 1000);
    museum.render(camera);

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
    if (hud && showUi && now - shown > 250) {
      shown = now;
      hud.textContent = describe(stats());
    }
  });
}

/** The relief the vertex shader draws, which the camera's clearance must clear. */
function relief(params: Params): Relief {
  const flat = params.flatRelief === true;
  return {
    kLand: flat ? 0 : Number(params.kLand),
    kSeaEff: flat || params.bathymetry !== true ? 0 : Number(params.kSea),
  };
}

/** The scene's params without lat and lon, which the view drives. */
function withoutGimbal(params: Params): Params {
  const rest = { ...params };
  delete rest.lat;
  delete rest.lon;
  return rest;
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

function describe(s: ProtoStats): string {
  const levels = s.levels
    .map((count, level) => (count > 0 ? `L${level} ${count}` : ''))
    .filter(Boolean)
    .join('  ');
  const lat = `${Math.abs(s.view.lat).toFixed(2)}°${s.view.lat < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(s.view.lon).toFixed(2)}°${s.view.lon < 0 ? 'W' : 'E'}`;
  return [
    `${s.fps.toFixed(0)} fps   p95 ${s.frameP95.toFixed(1)} ms`,
    `drawn ${s.drawn}   resident ${s.resident}   in flight ${s.inFlight + s.decoding + s.uploading}`,
    levels,
    `${lat} ${lon}   ${s.view.viewKm.toFixed(0)} km wide   ${s.altitudeKm.toFixed(0)} km up   tilt ${s.view.tilt.toFixed(0)}°`,
    `${s.data} bake`,
  ].join('\n');
}

interface UiParts {
  museum: { params: Params };
  look: { params: Params };
  streamer: { params: Params };
  cameraParams: Params;
  control: ViewControl;
  go: (name: string) => void;
  settings: () => string;
}

function buildUi({ museum, look, streamer, cameraParams, control, go, settings }: UiParts): void {
  const bar = document.getElementById('presets');
  Object.keys(PRESETS).forEach((name, i) => {
    const button = document.createElement('button');
    button.textContent = `${i + 1} ${name}`;
    button.addEventListener('click', () => go(name));
    bar?.append(button);
  });

  const gui = new GUI({ title: 'Wander look' });
  const cameraFolder = gui.addFolder('Camera');
  addParams(cameraFolder, cameraParams, { skip: RELIEF_BY_ZOOM });
  // The goal is replaced as it moves, so the slider reads and writes it through accessors.
  const tilt = {
    get tilt() {
      return control.goal.tilt;
    },
    set tilt(value: number) {
      control.stop();
      control.goal = { ...control.goal, tilt: value };
    },
  };
  cameraFolder.add(tilt, 'tilt', 0, 80, 1).listen();
  addParams(gui.addFolder('Scene'), museum.params, { skip: ['lat', 'lon'] });
  // Relief exaggeration in one place: kLand and kSea follow the zoom, and are locked, while
  // reliefByZoom is on.
  const lookFolder = gui.addFolder('Surface look');
  const byZoom = addParams(lookFolder, cameraParams, { only: RELIEF_BY_ZOOM });
  const lookControls = addParams(lookFolder, look.params, { listen: ['kLand', 'kSea'] });
  const lockRelief = () => {
    for (const name of ['kLand', 'kSea']) {
      lookControls.get(name)?.disable(cameraParams.reliefByZoom === true);
    }
  };
  byZoom.get('reliefByZoom')?.onChange(lockRelief);
  lockRelief();
  addParams(gui.addFolder('Streamer').close(), streamer.params);
  const copy = {
    'Copy settings': () => {
      const text = settings();
      navigator.clipboard.writeText(text).then(
        () => flash('Settings copied'),
        () => showText(text),
      );
    },
  };
  gui.add(copy, 'Copy settings');
}

function flash(message: string): void {
  const note = document.getElementById('note');
  if (!note) return;
  note.textContent = message;
  note.hidden = false;
  setTimeout(() => (note.hidden = true), 1600);
}

/** Where the clipboard is refused: the settings in a box to copy by hand. */
function showText(text: string): void {
  const box = document.createElement('textarea');
  box.id = 'settings';
  box.value = text;
  box.addEventListener('blur', () => box.remove());
  document.body.append(box);
  box.select();
  box.focus();
}

async function pickData(asked: string | null): Promise<DataName> {
  if (asked === 'region' || asked === 'global') return asked;
  try {
    const response = await fetch(`${DATA_HOSTS.global}/release.json`);
    if (response.ok) return 'global';
  } catch {
    // The global bake is not being served; the region bake is.
  }
  return 'region';
}

main().catch((error: unknown) => {
  console.error(error);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `failed: ${String(error)}`;
  window.__proto = {
    presets: [],
    stats: () => {
      throw error;
    },
    ready: () => false,
    go: () => {},
    view: () => {},
    settings: () => '',
    error: String(error),
  };
});
