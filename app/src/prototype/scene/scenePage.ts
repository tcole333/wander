// Entry of prototype-scene.html: the museum scene with a plain dark sphere in globeMount, framed
// like the spike's camera presets (?view=world|region|close, keys 1-3). Any scene param can be set
// from the URL, e.g. ?exposure=1.1&bloomStrength=0.6&shadows=false.
import {
  Mesh,
  MeshStandardMaterial,
  MOUSE,
  PerspectiveCamera,
  SphereGeometry,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MuseumScene } from '../contract';
import { createMuseumScene } from './museumScene';

const DEG = Math.PI / 180;

/**
 * The spike's presets: the story's camera center and map zoom, plus its composition (how much of
 * the MapLibre-equivalent radius to show, where to look, and the camera's azimuth and elevation).
 */
const VIEWS = {
  world: { lon: 75, lat: 15, zoom: 2.1, compose: 0.7, lookMix: 0, lookY: -0.12, az: -0.2, el: 0.1 },
  region: {
    lon: 105,
    lat: -2,
    zoom: 2.8,
    compose: 0.78,
    lookMix: 0.35,
    lookY: -0.02,
    az: -0.16,
    el: 0.06,
  },
  close: { lon: 118, lat: -8.25, zoom: 4.2, compose: 1, lookMix: 1, lookY: 0, az: -0.1, el: 0.42 },
};
type ViewName = keyof typeof VIEWS;

declare global {
  interface Window {
    /** Set by scenePage.ts for screenshot scripts. */
    sceneHarness?: {
      museum: MuseumScene;
      camera: PerspectiveCamera;
      controls: OrbitControls;
      setView(name: ViewName): void;
    };
  }
}

const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
document.body.prepend(renderer.domElement);
const museum = createMuseumScene(renderer);
museum.setSize(innerWidth, innerHeight, devicePixelRatio);

const url = new URLSearchParams(location.search);
for (const [name, value] of Object.entries(museum.params)) {
  const given = url.get(name);
  if (given === null) continue;
  museum.params[name] =
    typeof value === 'boolean' ? given !== 'false' && given !== '0' : Number(given);
}

const globe = new Mesh(
  new SphereGeometry(1, 192, 96),
  new MeshStandardMaterial({ color: 0x1b252c, roughness: 0.6, metalness: 0.2 }),
);
globe.castShadow = true;
globe.receiveShadow = true;
museum.globeMount.add(globe);

const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.005, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
controls.minDistance = 0.12;
controls.maxDistance = 9;

/** The camera distance at which the globe shows the radius a web map shows at `zoom`. */
function zoomToDistance(zoom: number, compose: number): number {
  const radiusPx = (compose * 512 * 2 ** zoom) / (2 * Math.PI);
  const t = Math.tan((camera.fov * DEG) / 2);
  return Math.sqrt(1 + (innerHeight / 2 / (t * radiusPx)) ** 2);
}

function setView(name: ViewName) {
  const v = VIEWS[name];
  museum.params.lat = v.lat;
  museum.params.lon = v.lon;
  const dist = zoomToDistance(v.zoom, v.compose);
  const dir = new Vector3(
    Math.sin(v.az) * Math.cos(v.el),
    Math.sin(v.el),
    Math.cos(v.az) * Math.cos(v.el),
  );
  const look = new Vector3(0, v.lookY, v.lookMix);
  camera.position.copy(look).addScaledVector(dir, dist - v.lookMix);
  controls.target.copy(look);
  camera.lookAt(look);
}

const initial = url.get('view') ?? 'world';
setView(initial in VIEWS ? (initial as ViewName) : 'world');

addEventListener('keydown', (event) => {
  const name = (['world', 'region', 'close'] as const)[Number(event.key) - 1];
  if (name) setView(name);
});

// Left-drag turns the globe inside the instrument, as in the spike: spin in longitude, tilt the
// meridian ring in latitude, at about the speed the surface under the cursor moves.
let drag: { x: number; y: number; lat: number; lon: number } | null = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = {
    x: event.clientX,
    y: event.clientY,
    lat: Number(museum.params.lat),
    lon: Number(museum.params.lon),
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const surface = Math.max(0.05, camera.position.distanceTo(new Vector3(0, 0, 1)));
  const k = (surface * Math.tan((camera.fov * DEG) / 2) * 2) / innerHeight / DEG;
  museum.params.lon = drag.lon - (event.clientX - drag.x) * k;
  museum.params.lat = Math.max(-75, Math.min(75, drag.lat - (event.clientY - drag.y) * k));
});
canvas.addEventListener('pointerup', () => {
  drag = null;
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  museum.setSize(innerWidth, innerHeight, devicePixelRatio);
});

window.sceneHarness = { museum, camera, controls, setView };

const timer = new Timer();
let frames = 0;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  controls.update();
  museum.update(camera, timer.getElapsed());
  museum.render(camera);
  if (++frames === 3) document.body.dataset.ready = 'true';
});
