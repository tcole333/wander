// The streamer's debug page (prototype-streamer.html): the streamed globe with a minimal material
// that colors by node level, source level or height, over a magenta sphere at 0.98 R so any hole
// shows; OrbitControls, a stats readout and preset views from viewPose. The globe hangs tilted
// (?tilt=, degrees) so the streamer's globe-frame math is exercised. ?data=region|global picks the
// bake (global when its server answers), ?view=<preset> the first view, ?color=level|source|height
// the coloring. window.streamerPage lets a script poll the stats and switch views.
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StreamerStats } from '../../contract';
import type { Release } from '../../data/release';
import { ClearanceField } from '../../globe/clearance';
import { EARTH_RADIUS_KM, viewPose, type View } from '../../globe/viewCamera';
import { nearestRank, summarizeFrames, type FrameSummary } from '../../perf/frameStats';
import { GpuTimer } from '../../perf/gpuTimer';
import { createSurfaceStreamer, type StreamerDetails } from '../../stream/streamer';
import type { Vec3 } from '../../surface/cube';
import { COLOR_MODES, createDebugMaterial, type ColorMode } from './debugMaterial';

const DATA_HOSTS = { region: 'http://127.0.0.1:8792', global: 'http://127.0.0.1:8793' };
const FOV = 30;
const FRAMES = 120;
const SUMBAWA = { lon: 118.0, lat: -8.25, headingDeg: 0 };

/** Preset views through viewPose; `world` (null) is sized to put the camera 4 radii out. */
const VIEWS: Record<string, View | null> = {
  world: null,
  sunda: { ...SUMBAWA, viewKm: 1500, tiltDeg: 20 },
  sumbawa: { ...SUMBAWA, viewKm: 300, tiltDeg: 45 },
  close100: { ...SUMBAWA, viewKm: 100, tiltDeg: 45 },
  close30: { ...SUMBAWA, viewKm: 30, tiltDeg: 45 },
  himalaya: { lon: 87.0, lat: 28.0, headingDeg: 0, viewKm: 300, tiltDeg: 45 },
  kirkuk: { lon: 45.0, lat: 35.26, headingDeg: 0, viewKm: 300, tiltDeg: 30 },
};

export interface PageStats extends StreamerStats, StreamerDetails {
  view: string;
  data: string;
  altitudeKm: number;
  frame: FrameSummary;
  /** The streamer's update, CPU milliseconds, over the last frames. */
  updateMs: { p50: number; max: number };
  /** The frame's draw on the GPU, where EXT_disjoint_timer_query_webgl2 is (NaN elsewhere). */
  gpuMs: { p50: number; p95: number };
}

declare global {
  interface Window {
    streamerPage?: { stats(): PageStats; setView(preset: string | View): void };
  }
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const data = await pickData(query.get('data'));
  const release = (await (await fetch(`${DATA_HOSTS[data]}/release.json`)).json()) as Release;

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);

  const streamer = await createSurfaceStreamer(renderer, release);
  const field = new ClearanceField(streamer.layer);
  const look = createDebugMaterial(streamer.pools, release.surface);

  const scene = new Scene();
  scene.background = new Color(0x15171a);
  const globe = new Group();
  globe.rotation.z = (Number(query.get('tilt') ?? 23.44) * Math.PI) / 180;
  scene.add(globe);
  globe.updateMatrixWorld();
  const surface = new Mesh(streamer.geometry, look.material);
  surface.frustumCulled = false;
  globe.add(surface);
  const holes = new Mesh(
    new SphereGeometry(0.98, 128, 64),
    new MeshBasicMaterial({ color: 0xff00ff }),
  );
  globe.add(holes);

  const camera = new PerspectiveCamera(FOV, innerWidth / innerHeight, 0.01, 10);
  // OrbitControls orbits about the camera's up at construction: the globe's north.
  camera.up.set(0, 1, 0).applyQuaternion(globe.quaternion);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1e-4;
  controls.zoomSpeed = 0.6;

  let viewName = 'world';
  /** A preset by name, or any view (named 'custom'), for scripts. */
  const setView = (preset: string | View) => {
    if (typeof preset === 'string' && !(preset in VIEWS)) return;
    viewName = typeof preset === 'string' ? preset : 'custom';
    const lens = { fovYDeg: FOV, aspect: innerWidth / innerHeight };
    // The world view's width puts the camera 3 radii above Sumbawa, 4 from the center.
    const halfWidth = Math.tan((FOV * Math.PI) / 360) * lens.aspect;
    const world = { ...SUMBAWA, viewKm: 6 * EARTH_RADIUS_KM * halfWidth, tiltDeg: 0 };
    const view = typeof preset === 'string' ? (VIEWS[preset] ?? world) : preset;
    const relief = {
      kLand: look.uniforms.wanderKLand.value,
      kSeaEff: look.uniforms.wanderKSeaEff.value,
    };
    const pose = viewPose(view, lens, field, relief);
    camera.position.copy(globe.localToWorld(new Vector3(...pose.position)));
    controls.target.copy(globe.localToWorld(new Vector3(...pose.target)));
    controls.update();
  };
  setView(query.get('view') ?? 'world');

  // Near is half the gap to the terrain ceiling under the camera, far reaches the displaced
  // horizon, as viewPose sets them.
  const fitDepth = () => {
    const local = globe.worldToLocal(camera.position.clone());
    const d = local.length();
    const altitude = d - 1;
    const g: Vec3 = [local.z / d, local.x / d, local.y / d];
    const kLand = look.uniforms.wanderKLand.value;
    const kSea = look.uniforms.wanderKSeaEff.value;
    const R = EARTH_RADIUS_KM * 1000;
    const ceiling = field.ceilingM(g, Math.max(altitude, 1e-4), kLand) / R;
    const low = 1 + Math.min(0, kSea * field.hMin) / R;
    const high = 1 + Math.max(0, kLand * field.hMax) / R;
    camera.near = Math.max(1e-6, 0.5 * (altitude - ceiling));
    camera.far = Math.max(
      camera.near * 10,
      Math.sqrt(Math.max(0, d * d - low * low)) + Math.sqrt(high * high - low * low),
    );
    camera.updateProjectionMatrix();
    return altitude * EARTH_RADIUS_KM;
  };

  look.uniforms.colorMode.value = Math.max(0, COLOR_MODES.indexOf(query.get('color') as ColorMode));
  buildControls(streamer.params, look.uniforms, setView);

  const deltas: number[] = [];
  const updates: number[] = [];
  const gpuTimes: number[] = [];
  const gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  let altitudeKm = 0;
  const pageStats = (): PageStats => ({
    ...streamer.stats(),
    ...streamer.details(),
    view: viewName,
    data,
    altitudeKm,
    frame: summarizeFrames(deltas),
    updateMs: { p50: nearestRank(updates, 0.5), max: Math.max(...updates) },
    gpuMs: { p50: nearestRank(gpuTimes, 0.5), p95: nearestRank(gpuTimes, 0.95) },
  });
  window.streamerPage = { stats: pageStats, setView };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    renderer.setSize(innerWidth, innerHeight);
  });
  addEventListener('keydown', (event) => {
    const name = Object.keys(VIEWS)[Number(event.key) - 1];
    if (name) setView(name);
  });

  const statsText = document.getElementById('stats');
  let last = performance.now();
  let shown = 0;
  const frame = (now: number) => {
    push(deltas, now - last);
    last = now;
    controls.update();
    altitudeKm = fitDepth();
    const start = performance.now();
    streamer.update(camera, { width: innerWidth, height: innerHeight }, globe);
    push(updates, performance.now() - start);
    gpu.begin('frame');
    renderer.render(scene, camera);
    gpu.end();
    for (const { ms } of gpu.poll()) push(gpuTimes, ms);
    if (statsText && now - shown > 250) {
      shown = now;
      statsText.textContent = describe(pageStats());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function pickData(asked: string | null): Promise<keyof typeof DATA_HOSTS> {
  if (asked === 'region' || asked === 'global') return asked;
  try {
    const response = await fetch(`${DATA_HOSTS.global}/release.json`);
    if (response.ok) return 'global';
  } catch {
    // The global bake is not being served; the region bake is.
  }
  return 'region';
}

function buildControls(
  params: Record<string, number | boolean | string>,
  uniforms: ReturnType<typeof createDebugMaterial>['uniforms'],
  setView: (name: string) => void,
): void {
  const views = document.getElementById('views');
  const controls = document.getElementById('controls');
  if (!views || !controls) return;
  Object.keys(VIEWS).forEach((name, i) => {
    const button = document.createElement('button');
    button.textContent = `${i + 1} ${name}`;
    button.onclick = () => setView(name);
    views.append(button);
  });
  const add = (label: string, input: HTMLElement) => {
    const wrap = document.createElement('label');
    wrap.append(`${label} `, input);
    controls.append(wrap);
  };
  const color = document.createElement('select');
  COLOR_MODES.forEach((mode, i) => color.add(new Option(mode, String(i))));
  color.value = String(uniforms.colorMode.value);
  color.onchange = () => (uniforms.colorMode.value = Number(color.value));
  add('color', color);
  const check = (name: string, get: () => boolean, set: (on: boolean) => void) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = get();
    box.onchange = () => set(box.checked);
    add(name, box);
  };
  check(
    'freeze',
    () => params.freeze === true,
    (on) => (params.freeze = on),
  );
  check(
    'cull',
    () => params.cull === true,
    (on) => (params.cull = on),
  );
  check(
    'skirts',
    () => uniforms.showSkirts.value,
    (on) => (uniforms.showSkirts.value = on),
  );
  const number = (name: string, get: () => number, set: (value: number) => void, step: number) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(get());
    input.onchange = () => set(Number(input.value));
    add(name, input);
  };
  number(
    'refinePx',
    () => Number(params.refinePx),
    (v) => (params.refinePx = v),
    0.05,
  );
  number(
    'maxLevel',
    () => Number(params.maxLevel),
    (v) => (params.maxLevel = v),
    1,
  );
  number(
    'kLand',
    () => uniforms.wanderKLand.value,
    (v) => (uniforms.wanderKLand.value = v),
    1,
  );
  number(
    'kSea',
    () => uniforms.wanderKSeaEff.value,
    (v) => (uniforms.wanderKSeaEff.value = v),
    1,
  );
}

function describe(s: PageStats): string {
  const ms = (value: number) => value.toFixed(1);
  return [
    `${s.data} bake, view ${s.view}, altitude ${s.altitudeKm.toFixed(0)} km`,
    `drawn ${s.drawn}  culled ${s.culled}  resident ${s.resident}`,
    `inFlight ${s.inFlight}  decoding ${s.decoding}  uploading ${s.uploading}  queued ${s.queued}` +
      `  trimmed ${s.trimmed}`,
    `levels  ${s.levels.join(' ')}`,
    `sources ${s.sources.join(' ')}`,
    `frame p50 ${ms(s.frame.p50)}  p95 ${ms(s.frame.p95)}  max ${ms(s.frame.max)} ms` +
      `  (GPU p50 ${ms(s.gpuMs.p50)}  p95 ${ms(s.gpuMs.p95)})`,
    `update p50 ${ms(s.updateMs.p50)}  max ${ms(s.updateMs.max)} ms` +
      `  (select ${ms(s.selectMs)}, pack ${ms(s.packMs)})`,
    `failed ${s.failed}  cover errors ${s.coverErrors}`,
  ].join('\n');
}

function push(values: number[], value: number): void {
  values.push(value);
  if (values.length > FRAMES) values.shift();
}

main().catch((error: unknown) => {
  const statsText = document.getElementById('stats');
  if (statsText) statsText.textContent = `failed: ${String(error)}`;
  console.error(error);
});
