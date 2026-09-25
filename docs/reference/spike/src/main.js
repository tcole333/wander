import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { bakeSurface } from './surface.js';
import { buildInstrument } from './instrument.js';

const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const spike = (window.__spike = { marks: { navStart: 0 }, ready: false, settled: false, stats: {} });
const mark = (k) => { spike.marks[k] = Math.round(performance.now()); };

// ---------- renderer / scene ----------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? 0.95);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = backdropTexture();
scene.environment = museumEnvironment(renderer);
scene.environmentIntensity = 0.75;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.005, 100);
camera.position.set(0, 0, 6);

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(560, 250, 20, 520, 320, 700);
  g.addColorStop(0, '#2a2016'); g.addColorStop(0.35, '#17110b'); g.addColorStop(1, '#050403');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A dark museum room with a few warm softboxes, prefiltered for PBR reflections.
function museumEnvironment(r) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: 0x0c0906, side: THREE.BackSide })));
  const panel = (w, h, pos, color, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(9, 4, [-8, 6, 9], 0xffc88a, 5.5);     // key lamp
  panel(4, 10, [11, 1, -3], 0xff9448, 1.4);   // warm side wall
  panel(14, 3, [0, -7.5, 4], 0x4a3320, 1.2);  // table bounce
  panel(6, 3, [2, 7, -10], 0x8fa3b8, 0.35);   // cool window far behind
  panel(18, 7, [0, 1.5, 14], 0xffb574, 0.55);  // warm gallery wall behind the viewer
  const pmrem = new THREE.PMREMGenerator(r);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

// ---------- lights ----------
const key = new THREE.SpotLight(0xffd6a8, Number(params.get('key') ?? 4.0), 0, 0.62, 0.85, 0);
key.position.set(-4.2, 5.2, 9.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 4;
key.shadow.camera.near = 4; key.shadow.camera.far = 20;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffb77a, 0.7);
rim.position.set(6, 2.5, -6);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x4a3c2c, 0x0a0705, 0.5));

// ---------- instrument + globe gimbal ----------
const instrument = buildInstrument();
scene.add(instrument.fixed);
const tiltGroup = new THREE.Group();
const spinGroup = new THREE.Group();
scene.add(tiltGroup);
tiltGroup.add(instrument.tilting, spinGroup);

const globeMat = new THREE.MeshStandardMaterial({ color: 0x1b252c, roughness: 0.6, metalness: 0.2 });
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), globeMat);
globe.castShadow = true; globe.receiveShadow = true;
spinGroup.add(globe);

function latLonToVec3(lat, lon, r = 1) {
  const phi = (lon + 180) * DEG, theta = (90 - lat) * DEG;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
}

function surfaceTextures(bake) {
  const make = (data, srgb) => {
    const t = new THREE.DataTexture(data, bake.width, bake.height, THREE.RGBAFormat);
    t.flipY = true;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.needsUpdate = true;
    return t;
  };
  return { map: make(bake.albedo, true), orm: make(bake.orm, false), normal: make(bake.normal, false) };
}

function surfaceMaterial(tex, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex.map, roughnessMap: tex.orm, metalnessMap: tex.orm, normalMap: tex.normal,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 1, envMapIntensity: 1, ...extra,
  });
}

function edgeFadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const img = x.createImageData(256, 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const e = Math.min(i, 255 - i, j, 255 - j) / 22;
    const v = Math.round(Math.min(1, e) ** 1.5 * 255);
    const q = (j * 256 + i) * 4; img.data[q] = img.data[q + 1] = img.data[q + 2] = v; img.data[q + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// ---------- story / markers ----------
const story = await (await fetch('stories/tambora-april-1815.json')).json();
const cams = Object.fromEntries(story.scene.cameras.map((c) => [c.state, c]));
const focal = story.events.find((e) => e.story_role === 'focal');

const markerGroup = new THREE.Group();
spinGroup.add(markerGroup);
const bezelGeo = new THREE.TorusGeometry(1, 0.22, 16, 48);
const domeGeo = new THREE.SphereGeometry(0.86, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.55);
const bezelMat = instrument.materials.brass;
const cabochonMat = new THREE.MeshPhysicalMaterial({ color: 0x3a1410, metalness: 0.1, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0 });
const emberMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff4a0a, emissiveIntensity: 4.5, roughness: 0.3, metalness: 0 });
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,190,110,1)'); g.addColorStop(0.18, 'rgba(255,110,30,0.75)'); g.addColorStop(0.5, 'rgba(200,60,10,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

const labelLayer = document.getElementById('labels');
const markers = story.events.map((ev) => {
  const [lon, lat] = ev.display_anchor;
  const isFocal = ev.story_role === 'focal';
  const normal = latLonToVec3(lat, lon).normalize();
  const node = new THREE.Group();
  node.position.copy(normal).multiplyScalar(1.0008);
  node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const bezel = new THREE.Mesh(bezelGeo, bezelMat); bezel.castShadow = true;
  const dome = new THREE.Mesh(domeGeo, isFocal ? emberMat : cabochonMat);
  node.add(bezel, dome);
  if (isFocal) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(4.2); glow.position.z = 0.6; node.add(glow);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.36, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    pulse.position.z = 0.05; node.add(pulse); node.userData.pulse = pulse;
    const lamp = new THREE.PointLight(0xff6a20, 0.0035, 0.07, 2);
    lamp.position.z = 0.8; node.add(lamp); node.userData.lamp = lamp;
  }
  markerGroup.add(node);
  const el = document.createElement('div');
  el.className = `plaque${isFocal ? ' focal' : ''}`;
  el.innerHTML = `<span>${ev.title}</span>`;
  labelLayer.appendChild(el);
  return { ev, node, normal, el, isFocal, importance: ev.importance ?? 0 };
});

// ---------- HUD ----------
function renderHud(state) {
  const card = document.getElementById('account');
  const mode = cams[state]?.narrative_mode ?? 'standard';
  card.querySelector('h1').textContent = focal.title;
  card.querySelector('.date').textContent = focal.display_date;
  card.querySelector('.body').textContent = focal.narrative;
  card.querySelector('.detail').textContent = mode === 'expanded' ? focal.narrative_detail : '';
  card.dataset.mode = mode;
  const list = document.getElementById('meanwhile-list');
  const rest = story.events.filter((e) => e.story_role !== 'focal').sort((a, b) => (a.meanwhile_rank ?? 99) - (b.meanwhile_rank ?? 99)).slice(0, 3);
  list.innerHTML = rest.map((e) => `<li><div><b>${e.title}</b><small>${e.display_date}</small></div><i aria-hidden="true">✦</i></li>`).join('');
  document.querySelectorAll('[data-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scene === state)));
}

// ---------- camera presets ----------
// MapLibre globe radius in px at zoom z (512px tiles) is 512 * 2^z / 2π; solve for the camera
// distance that gives the same apparent radius, with a per-scene composition factor.
function zoomToDistance(zoom, compose = 1) {
  const rPx = compose * (512 * 2 ** zoom) / (2 * Math.PI);
  const t = Math.tan((camera.fov * DEG) / 2);
  return Math.sqrt(1 + ((innerHeight / 2) / (t * rPx)) ** 2);
}
const composition = {
  world: { compose: 0.7, lookMix: 0.0, lookY: -0.12, az: -0.2, el: 0.1 },
  region: { compose: 0.78, lookMix: 0.35, lookY: -0.02, az: -0.16, el: 0.06 },
  close: { compose: 1.0, lookMix: 1.0, lookY: 0, az: -0.1, el: 0.42 },
};
function presetState(name) {
  const cam = cams[name];
  const c = composition[name];
  return { lon: cam.center[0], lat: cam.center[1], dist: zoomToDistance(cam.zoom, c.compose), lookMix: c.lookMix, lookY: c.lookY, az: c.az, el: c.el };
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.minDistance = 0.12;
controls.maxDistance = 9;

let view = presetState(params.get('scene') ?? story.scene.default_camera ?? 'region');
let tween = null;
let currentScene = params.get('scene') ?? story.scene.default_camera ?? 'region';

function gimbal(lat, lon) {
  tiltGroup.rotation.x = lat * DEG;
  spinGroup.rotation.y = Math.PI / 2 - (lon + 180) * DEG;
  for (const g of instrument.gears) g.mesh.rotation.z = (spinGroup.rotation.y * 0.35 + tiltGroup.rotation.x) * g.ratio;
}
function cameraFrom(s) {
  const dir = new THREE.Vector3(Math.sin(s.az) * Math.cos(s.el), Math.sin(s.el), Math.cos(s.az) * Math.cos(s.el));
  const look = new THREE.Vector3(0, s.lookY, s.lookMix);
  const pos = look.clone().addScaledVector(dir, s.dist - s.lookMix);
  return { pos, look };
}
function applyView(s, moveCamera) {
  gimbal(s.lat, s.lon);
  if (!moveCamera) return;
  const { pos, look } = cameraFrom(s);
  camera.position.copy(pos);
  controls.target.copy(look);
  camera.lookAt(look);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function goTo(name, instant = false) {
  currentScene = name;
  const target = presetState(name);
  renderHud(name);
  const u = new URL(location.href); u.searchParams.set('scene', name); history.replaceState(null, '', u);
  if (instant) { view = target; applyView(view, true); spike.settled = true; return; }
  const from = { ...view, ...cameraStateFromControls() };
  let dLon = ((target.lon - from.lon + 540) % 360) - 180;
  tween = { from, to: { ...target, lon: from.lon + dLon }, t0: performance.now(), dur: 1900 };
  spike.settled = false;
}
function cameraStateFromControls() {
  // Recover az/el/dist from the live camera so tweens start where the user left off.
  const look = controls.target.clone();
  const off = camera.position.clone().sub(look);
  const len = off.length();
  return { az: Math.atan2(off.x, off.z), el: Math.asin(off.y / len), dist: len + look.z, lookMix: look.z, lookY: look.y };
}

document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.scene)));
document.getElementById('close-btn').addEventListener('click', () => goTo('close'));

// Left-drag turns the globe inside the instrument (lon spin + meridian-ring tilt).
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const surface = Math.max(0.05, camera.position.distanceTo(new THREE.Vector3(0, 0, 1)));
  const k = (surface * Math.tan((camera.fov * DEG) / 2) * 2) / innerHeight / DEG;
  view.lon = drag.lon - (e.clientX - drag.x) * k;
  view.lat = Math.max(-75, Math.min(75, drag.lat - (e.clientY - drag.y) * k));
  tween = null;
});
renderer.domElement.addEventListener('pointerup', () => { drag = null; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- post ----------
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.45, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, aspect: { value: innerWidth / innerHeight }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float aspect; uniform float time; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = vUv - 0.5; p.x *= aspect;
      float v = smoothstep(1.05, 0.28, length(p)); c.rgb *= mix(0.28, 1.0, v);
      float g = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.02; gl_FragColor = c; }`,
});
composer.addPass(finish);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  finish.uniforms.aspect.value = innerWidth / innerHeight;
});

// ---------- labels ----------
const v3 = new THREE.Vector3(), n3 = new THREE.Vector3(), toCam = new THREE.Vector3();
function updateMarkers(time) {
  const mode = cams[currentScene]?.marker_mode ?? 'all';
  const surface = camera.position.distanceTo(controls.target) + (1 - controls.target.length());
  const s = THREE.MathUtils.clamp(0.0068 * Math.max(0.25, surface), 0.0022, 0.03);
  const placed = [];
  const ordered = [...markers].sort((a, b) => (b.isFocal - a.isFocal) || (b.importance - a.importance));
  for (const m of ordered) {
    m.node.scale.setScalar(s * (m.isFocal ? 1.35 : 1));
    m.node.getWorldPosition(v3);
    n3.copy(v3).normalize();
    toCam.copy(camera.position).sub(v3).normalize();
    const facing = n3.dot(toCam);
    const allowed = mode === 'all' || m.isFocal;
    m.node.visible = allowed || mode === 'focal_detail';
    if (m.node.userData.pulse) {
      const k = (time / 1600) % 1;
      m.node.userData.pulse.scale.setScalar(1 + k * 1.3);
      m.node.userData.pulse.material.opacity = 0.4 * (1 - k) ** 1.5;
    }
    v3.project(camera);
    const x = (v3.x * 0.5 + 0.5) * innerWidth, y = (-v3.y * 0.5 + 0.5) * innerHeight;
    let show = allowed && facing > 0.12 && v3.z < 1 && x > 0 && x < innerWidth && y > 0 && y < innerHeight;
    const w = m.el.offsetWidth || 120, h = m.el.offsetHeight || 24;
    const rect = { x0: x - w / 2, x1: x + w / 2, y0: y + 16, y1: y + 16 + h };
    if (show && placed.some((r) => !(rect.x1 < r.x0 || rect.x0 > r.x1 || rect.y1 < r.y0 || rect.y0 > r.y1))) show = false;
    if (show) placed.push(rect);
    m.el.style.transform = `translate(${Math.round(rect.x0)}px, ${Math.round(rect.y0)}px)`;
    m.el.style.opacity = show ? String(Math.min(1, (facing - 0.12) * 5)) : '0';
  }
}

// ---------- boot ----------
renderHud(currentScene);
applyView(view, true);
composer.render();
mark('firstFrame');
document.body.dataset.state = 'baking';

const globalBake = await bakeSurface({
  bounds: { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 }, width: 4096, height: 2048, vectorZoom: 3, terrainZoom: 4,
  tune: { relief: Number(params.get('relief') ?? 1), normalStrength: Number(params.get('ns') ?? 1) },
});
spike.stats.global = globalBake.stats;
globe.material = surfaceMaterial(surfaceTextures(globalBake));
globeMat.dispose();
mark('globalBaked');

const renderLoop = (time) => {
  if (tween) {
    const t = Math.min(1, (time - tween.t0) / tween.dur);
    const e = ease(t);
    const s = {};
    for (const k of Object.keys(tween.to)) s[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
    // Arc the dolly out a little mid-flight so the instrument reads during transitions.
    s.dist += Math.sin(Math.PI * e) * 0.35 * Math.abs(tween.to.dist - tween.from.dist) ** 0.5;
    view = { ...view, ...s };
    applyView(view, true);
    if (t >= 1) { tween = null; spike.settled = true; }
  } else {
    gimbal(view.lat, view.lon);
    controls.update();
  }
  updateMarkers(time);
  finish.uniforms.time.value = (time % 1000) / 1000;
  composer.render();
};
renderer.setAnimationLoop(renderLoop);
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
mark('texturedFrame');
document.body.dataset.state = 'ready';
spike.ready = true;
spike.settled = true;

// Regional high-res patch (Close LOD) baked after first paint.
if (params.get('patch') !== '0') {
  const pb = { lonMin: 100, lonMax: 136, latMin: -22, latMax: 6 };
  const patchBake = await bakeSurface({ bounds: pb, width: 3072, height: Math.round(3072 * 28 / 36), vectorZoom: 6, terrainZoom: 6,
    tune: { relief: Number(params.get('relief') ?? 1), normalStrength: Number(params.get('pns') ?? 0.45), bevelDeg: Number(params.get('bevel') ?? 0.1) } });
  spike.stats.patch = patchBake.stats;
  const geo = new THREE.SphereGeometry(1.0004, 256, 200, (pb.lonMin + 180) * DEG, (pb.lonMax - pb.lonMin) * DEG, (90 - pb.latMax) * DEG, (pb.latMax - pb.latMin) * DEG);
  const mat = surfaceMaterial(surfaceTextures(patchBake), { transparent: true, alphaMap: edgeFadeTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const patch = new THREE.Mesh(geo, mat);
  patch.receiveShadow = true;
  spinGroup.add(patch);
  mark('patchBaked');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  spike.patchReady = true;
}

if (params.get('tour') === '1') {
  goTo('world', true);
}
