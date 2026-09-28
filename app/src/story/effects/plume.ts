// The eruption plume: seeded, analytic puffs of ash in three families. The column rises from the
// summit, widening and leaning downwind, its lower half lit by the fire (three columns of flame at
// the climax, merging high up); the umbrella cloud spreads from its top, farthest downwind and
// streaked along the wind, settling as it goes; glowing ash flows run down the flanks at the
// climax. Where each puff sits is a function of story time (timeline.ts plumeState); only its slow
// rise and drift through the column and cloud, and its turning, follow the clock. Heights are
// exaggerated with the relief, capped to a share of the view so the column reads at every beat.
// Each puff is a cluster of lit balls on a camera-facing quad, softened toward a wisp so the puffs
// blend into billows, sorted back to front each frame.
import {
  Color,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  type Matrix4,
} from 'three';
import { dirOf, EARTH_KM, tangents } from './geo';
import type { PlumeEffect, PlumeState } from './timeline';
import { smoothstep } from './timeline';

/** Tambora's summit today, as the bake's heights have it: the vent the plume rises from. */
export const VENT_M = 2850;
const COLUMN = 650;
const CLOUD = 1100;
const FLOWS = 200;
const COUNT = COLUMN + CLOUD + FLOWS;
/** The puff atlas: 2 x 2 cells of CELL texels. */
const CELL = 64;

interface Puff {
  kind: 0 | 1 | 2;
  u: number;
  a: number;
  b: number;
  size: number;
  shade: number;
  spin: number;
  rate: number;
  variant: number;
}

/** mulberry32: a small seeded generator, so a seed always draws the same plume. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Four cauliflower puffs, each a union of balls: coverage in red, the surface normal's x and y in
 * green and blue, so every lobe lights and shades on its own.
 */
function puffAtlas(seed: number): DataTexture {
  const rand = random(seed ^ 0x9e3779b9);
  const size = 2 * CELL;
  const data = new Uint8Array(size * size * 4);
  for (let cell = 0; cell < 4; cell += 1) {
    const balls = [{ x: 0, y: 0, r: 0.3 }];
    for (let k = 0; k < 9; k += 1) {
      const angle = rand() * Math.PI * 2;
      const out = 0.12 + 0.16 * rand();
      balls.push({ x: out * Math.cos(angle), y: out * Math.sin(angle), r: 0.08 + 0.12 * rand() });
    }
    const height = (x: number, y: number) => {
      let h = 0;
      for (const ball of balls) {
        const d2 = ball.r * ball.r - (x - ball.x) ** 2 - (y - ball.y) ** 2;
        if (d2 > 0) h = Math.max(h, Math.sqrt(d2));
      }
      return h;
    };
    const [ox, oy] = [(cell % 2) * CELL, Math.floor(cell / 2) * CELL];
    const step = 1 / CELL;
    for (let j = 0; j < CELL; j += 1) {
      for (let i = 0; i < CELL; i += 1) {
        // A little inside the cell, so no puff bleeds into its neighbor.
        const x = ((i + 0.5) / CELL - 0.5) * 1.12;
        const y = ((j + 0.5) / CELL - 0.5) * 1.12;
        const h = height(x, y);
        const dx = (height(x + step, y) - height(x - step, y)) / (2 * step);
        const dy = (height(x, y + step) - height(x, y - step)) / (2 * step);
        const n = new Vector3(-dx, -dy, 1).normalize();
        const k = ((oy + j) * size + ox + i) * 4;
        data[k] = Math.round(255 * smoothstep(0, 0.06, h));
        data[k + 1] = Math.round(255 * (0.5 + 0.5 * n.x));
        data[k + 2] = Math.round(255 * (0.5 + 0.5 * n.y));
        data[k + 3] = 255;
      }
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX = /* glsl */ `
uniform vec3 uWind;
attribute vec3 aCenter;
// Size (globe units), turn (radians), stretch along the wind (1: none), atlas cell.
attribute vec4 aShape;
// Brightness, ember glow, opacity, softness (0 a crisp cluster of balls, 1 a smooth wisp).
attribute vec4 aLook;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vRot;
varying vec4 vLook;
void main() {
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float angle = aShape.y;
  if (aShape.z > 1.01) {
    vec2 w = (modelViewMatrix * vec4(uWind, 0.0)).xy;
    angle += length(w) > 1e-6 ? atan(w.y, w.x) : 0.0;
  }
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = position.xy * vec2(aShape.z, 1.0);
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * aShape.x;
  gl_Position = projectionMatrix * mv;
  vUv = (uv + vec2(mod(aShape.w, 2.0), floor(aShape.w / 2.0))) * 0.5;
  vLocal = position.xy * 2.0;
  vRot = vec2(c, s);
  vLook = aLook;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uPuff;
uniform vec3 uLampView;
uniform vec3 uDownView;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uEmber;
uniform float uOpacity;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vRot;
varying vec4 vLook;
void main() {
  vec4 t = texture2D(uPuff, vUv);
  float r2 = dot(vLocal, vLocal);
  float wisp = exp(-3.0 * r2) * (1.0 - smoothstep(0.7, 1.0, r2)) * (0.7 + 0.3 * t.r);
  float a = mix(t.r, wisp, vLook.w) * vLook.z * uOpacity;
  if (a < 0.004) discard;
  vec2 nt = t.gb * 2.0 - 1.0;
  vec2 nxy = vec2(vRot.x * nt.x - vRot.y * nt.y, vRot.y * nt.x + vRot.x * nt.y) * (1.0 - 0.7 * vLook.w);
  vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  float light = 0.12 + 0.88 * max(dot(n, uLampView), 0.0);
  vec3 color = mix(uShadow, uLit, light) * vLook.x;
  // The fire lights the ash from within, most on its underside.
  color += uEmber * vLook.y * (0.6 + 0.4 * max(dot(n, uDownView), 0.0));
  gl_FragColor = vec4(color, min(a, 1.0));
}
`;

export interface PlumeFrame {
  state: PlumeState;
  /** The ember's heat, 0 to 1, for the column's glowing foot. */
  heat: number;
  kLand: number;
  /** About how wide the view is at the vent, km. */
  viewKm: number;
  /** The camera, and the direction toward the lamp, in the globe frame. */
  camera: Vector3;
  lamp: Vector3;
  /** From the globe frame to the camera's view space. */
  toView: Matrix4;
  strength: number;
  elapsedS: number;
}

export class Plume {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly #effect: PlumeEffect;
  readonly #puffs: Puff[];
  readonly #center = new Float32Array(COUNT * 3);
  readonly #shape = new Float32Array(COUNT * 4);
  readonly #look = new Float32Array(COUNT * 4);
  /** Per puff before sorting: position; size, turn, stretch; bright, glow, alpha, softness. */
  readonly #place = new Float32Array(COUNT * 3);
  readonly #form = new Float32Array(COUNT * 3);
  readonly #tone = new Float32Array(COUNT * 4);
  readonly #depth = new Float32Array(COUNT);
  readonly #order = Array.from({ length: COUNT }, (_, i) => i);
  readonly #up: Vector3;
  readonly #downwind: Vector3;
  readonly #across: Vector3;
  readonly #p = new Vector3();
  readonly #h = new Vector3();

  constructor(effect: PlumeEffect) {
    this.#effect = effect;
    const rand = random(effect.seed);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    this.#puffs = Array.from({ length: COUNT }, (_, i) => {
      const kind = i < COLUMN ? 0 : i < COLUMN + CLOUD ? 1 : 2;
      // The cloud's puffs gather along the wind: their angle off it leans toward 0.
      const v = 2 * rand() - 1;
      return {
        kind,
        u: rand(),
        a: kind === 1 ? Math.PI * Math.sign(v) * Math.abs(v) ** 1.5 : gauss(),
        b: gauss(),
        size: rand(),
        shade: 0.85 + 0.3 * rand(),
        spin: rand() * Math.PI * 2,
        rate: 0.7 + 0.6 * rand(),
        variant: Math.floor(rand() * 4),
      };
    });
    this.#up = dirOf(effect.at);
    const { east, north } = tangents(effect.at);
    this.#downwind = east
      .clone()
      .multiplyScalar(effect.drift[0])
      .addScaledVector(north, effect.drift[1]);
    if (this.#downwind.lengthSq() < 1e-6) this.#downwind.copy(north);
    this.#downwind.normalize();
    this.#across = new Vector3().crossVectors(this.#up, this.#downwind);

    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const attribute = (array: Float32Array, size: number) =>
      new InstancedBufferAttribute(array, size).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCenter', attribute(this.#center, 3));
    geometry.setAttribute('aShape', attribute(this.#shape, 4));
    geometry.setAttribute('aLook', attribute(this.#look, 4));
    geometry.instanceCount = COUNT;
    const material = new ShaderMaterial({
      uniforms: {
        uPuff: { value: puffAtlas(effect.seed) },
        uWind: { value: this.#downwind.clone() },
        uLampView: { value: new Vector3(0, 0, 1) },
        uDownView: { value: new Vector3(0, -1, 0) },
        // Dark ash warmed by the museum lamp, its shadow side a warm near black, and the ember's
        // glow.
        uLit: { value: new Color('#6e5e4f') },
        uShadow: { value: new Color('#1a130d') },
        uEmber: { value: new Color('#e8662c').multiplyScalar(3.5) },
        uOpacity: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  update(frame: PlumeFrame): void {
    const { state, kLand, viewKm, strength } = frame;
    const on = state.activity > 0.001 && strength > 0;
    this.mesh.visible = on;
    if (!on) return;
    const uniforms = this.mesh.material.uniforms;
    (uniforms.uLampView?.value as Vector3).copy(frame.lamp).transformDirection(frame.toView);
    (uniforms.uDownView?.value as Vector3).copy(this.#up).negate().transformDirection(frame.toView);
    if (uniforms.uOpacity) uniforms.uOpacity.value = Math.min(1, strength);

    // The lamp's side of the column is lit, the far side in shadow.
    const lampE = frame.lamp.dot(this.#downwind);
    const lampN = frame.lamp.dot(this.#across);
    const lampLen = Math.hypot(lampE, lampN) || 1;

    const heightKm = this.#effect.heightKm;
    // Exaggerated with the relief, but never taller than a seventh of the view, so a close,
    // tilted view keeps the umbrella in frame.
    const scale = Math.max(1, Math.min(kLand, (0.14 * viewKm) / heightKm));
    const top = heightKm * state.column * scale;
    const topR = 2 + 0.135 * top;
    const baseKm = (kLand * VENT_M) / 1000;
    const t = frame.elapsedS;
    // The umbrella's head over the column, and the cloud trailing downwind from it.
    const head = Math.min(2.2 * topR, 0.5 * state.cloudKm + topR);
    const trail = Math.max(state.cloudKm, head);
    const cloudOpacity = Math.min(1, state.activity * 1.5) ** 0.7;
    // A waning eruption's puffs lose their billows and thin into wisps.
    const waning = 1 - smoothstep(0.3, 0.8, state.activity);

    for (let i = 0; i < COUNT; i += 1) {
      const puff = this.#puffs[i];
      if (!puff) continue;
      let x: number;
      let y: number;
      let z: number;
      let size: number;
      let alpha: number;
      let stretch = 1;
      let soft: number;
      let turn = puff.spin + t * 0.04 * (puff.rate - 1);
      let bright = puff.shade;
      let glow = 0;
      if (puff.kind === 0) {
        // The column: rising through its height about once a minute, widening as it climbs.
        const u = (puff.u + t * 0.016 * puff.rate) % 1;
        const f = u ** 0.85;
        z = top * f;
        const r = 2 + 0.025 * top + 0.11 * z;
        // At the climax it rises as three columns of flame from the crater, merging high up.
        const apart = 0.12 * top * state.flows * (1 - smoothstep(0.05, 0.45, f));
        const stream = Math.floor((3 * puff.spin) / (2 * Math.PI)) * ((2 * Math.PI) / 3) + 0.4;
        x = 0.1 * top * f * f + puff.a * r * 0.45 + apart * Math.cos(stream);
        y = puff.b * r * 0.45 + apart * Math.sin(stream);
        size = r * (1.1 + 0.7 * puff.size);
        const side =
          (puff.a * lampE + puff.b * lampN) / lampLen / Math.max(1, Math.hypot(puff.a, puff.b));
        bright *= (0.3 + 0.4 * f) * (0.7 + 0.4 * side);
        // The fire runs half way up the column.
        glow = frame.heat * (1 - smoothstep(0.05, 0.6, f)) ** 1.5;
        soft = Math.max(0.45, 0.8 * waning);
        alpha =
          (0.95 - 0.4 * waning) *
          Math.min(1, state.activity * 1.6) *
          smoothstep(0, 0.05, u) *
          (1 - smoothstep(0.9, 1, u));
      } else if (puff.kind === 1) {
        // The umbrella: a lumpy head over the column, then a cloud drifting downwind, widening,
        // settling and smoothing into streaks as it goes.
        const u = (puff.u + t * 0.004 * puff.rate) % 1;
        const f = u ** 0.8;
        x = -0.6 * head + (trail + 0.6 * head) * f;
        const halfWidth =
          x < 0 ? head * Math.sqrt(Math.max(0, 1 - (x / head) ** 2)) : head + 0.45 * x;
        y = (halfWidth * puff.a) / Math.PI;
        const out = Math.max(0, x) / trail;
        z = top * (0.86 - 0.32 * out + 0.05 * puff.b);
        soft = Math.max(0.4, smoothstep(0.1, 0.55, out), waning);
        size = (0.55 * head + 0.1 * Math.max(0, x)) * (0.75 + 0.5 * puff.size) * (1 - 0.3 * soft);
        stretch = 1 + 2.4 * soft;
        turn = 0.3 * (puff.spin / Math.PI - 1) * soft + puff.spin * (1 - soft);
        bright *= (0.72 + 0.2 * Math.max(-1, Math.min(1.5, puff.b))) * (1 - 0.3 * out);
        alpha =
          (0.9 - 0.45 * soft) *
          cloudOpacity *
          (1 - out) ** 1.2 *
          smoothstep(0, 0.04, u) *
          (1 - smoothstep(0.85, 1, u));
      } else {
        // Glowing ash flows down the flanks at the climax.
        const u = (puff.u + t * 0.01 * puff.rate) % 1;
        const out = 3 + 27 * u ** 0.7;
        x = Math.cos(puff.spin) * out;
        y = Math.sin(puff.spin) * out;
        const ground = kLand * (VENT_M / 1000) * Math.max(0, 1 - out / 34) ** 1.3;
        z = ground - baseKm + 0.6 + 0.4 * Math.abs(puff.b);
        size = (4 + 5 * puff.size) * (0.7 + 0.5 * u) + 0.015 * top;
        soft = 0.9;
        bright *= 0.08;
        glow = 0.7 * state.flows * frame.heat * (1 - 0.7 * u);
        alpha = 0.45 * state.flows * smoothstep(0, 0.1, u) * (1 - smoothstep(0.7, 1, u));
      }
      this.#placeAt(i, x, y, baseKm + z);
      this.#form.set([size / EARTH_KM, turn, stretch], i * 3);
      this.#tone.set([bright, glow, alpha, soft], i * 4);
    }
    this.#sort(frame.camera);
  }

  /** The globe-frame point x km downwind, y across and z up from the foot of the vent. */
  #placeAt(i: number, x: number, y: number, zKm: number): void {
    const h = this.#h.copy(this.#downwind).multiplyScalar(x).addScaledVector(this.#across, y);
    const km = h.length();
    const angle = km / EARTH_KM;
    const p = this.#p.copy(this.#up).multiplyScalar(Math.cos(angle));
    if (km > 1e-9) p.addScaledVector(h, Math.sin(angle) / km);
    p.multiplyScalar(1 + zKm / EARTH_KM);
    this.#place.set([p.x, p.y, p.z], i * 3);
  }

  /** Writes the puffs far to near, as the blending needs. */
  #sort(camera: Vector3): void {
    const place = this.#place;
    for (let i = 0; i < COUNT; i += 1) {
      const dx = (place[i * 3] ?? 0) - camera.x;
      const dy = (place[i * 3 + 1] ?? 0) - camera.y;
      const dz = (place[i * 3 + 2] ?? 0) - camera.z;
      this.#depth[i] = dx * dx + dy * dy + dz * dz;
    }
    const depth = this.#depth;
    this.#order.sort((a, b) => (depth[b] ?? 0) - (depth[a] ?? 0));
    this.#order.forEach((i, k) => {
      this.#center.set(place.subarray(i * 3, i * 3 + 3), k * 3);
      this.#shape.set(this.#form.subarray(i * 3, i * 3 + 3), k * 4);
      this.#shape[k * 4 + 3] = this.#puffs[i]?.variant ?? 0;
      this.#look.set(this.#tone.subarray(i * 4, i * 4 + 4), k * 4);
    });
    const geometry = this.mesh.geometry;
    for (const name of ['aCenter', 'aShape', 'aLook'])
      geometry.getAttribute(name).needsUpdate = true;
  }

  inspectMemory(account: import('../../perf/memory').MemoryAccount): void {
    for (const array of [
      this.#center,
      this.#shape,
      this.#look,
      this.#place,
      this.#form,
      this.#tone,
      this.#depth,
    ]) {
      account.array('effects.plumeArrays', array);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material.uniforms.uPuff?.value as DataTexture | undefined)?.dispose();
    this.mesh.material.dispose();
  }
}
