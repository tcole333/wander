// The veil: a thin, warm haze on a shell above the highest exaggerated land, thicker toward the
// limb, lit on the lamp's side, with zonal streaks drifting around the globe so it reads as a veil
// and not a tint. Toward the limb it takes the colors of Luke Howard's twilight of 29 June 1815:
// orange low down, a purple glow at the very rim. Its coverage is timeline.ts veilDensity, baked into a small
// longitude-latitude texture whenever story time moves. Strongest at wide views, gone by a
// regional one.
import {
  Color,
  DataTexture,
  FrontSide,
  LinearFilter,
  Mesh,
  RepeatWrapping,
  RGFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three';
import { EARTH_M } from './geo';
import { smoothstep, veilDensity } from './timeline';

const W = 128;
const H = 64;
/** Above Everest at the relief's exaggeration. */
const SHELL_M = 8900;

const VERTEX = /* glsl */ `
uniform float uRadius;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uRadius, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uCover;
uniform vec3 uCamera;
uniform vec3 uLamp;
uniform vec3 uColor;
uniform vec3 uTwilight;
uniform vec3 uRim;
uniform float uRadius;
uniform float uStrength;
uniform float uTime;
varying vec3 vDir;
void main() {
  vec3 n = normalize(vDir);
  float lon = atan(n.x, n.z);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
  float d = texture2D(uCover, uv).r;
  // The streaks drift west, as the cloud circled the globe.
  float streak = texture2D(uCover, uv + vec2(uTime * 0.002, 0.0)).g;
  vec3 toCamera = normalize(uCamera - n * uRadius);
  float facing = dot(n, toCamera);
  float mu = max(facing, 0.2);
  float a = (1.0 - exp(-0.09 * d * (0.2 + 1.8 * streak * streak) / mu)) * uStrength;
  if (a < 0.002) discard;
  float lit = 0.3 + 0.7 * smoothstep(-0.35, 0.75, dot(n, uLamp));
  vec3 color = mix(uColor, uTwilight, smoothstep(0.75, 0.25, facing));
  color = mix(color, uRim, 0.6 * smoothstep(0.3, 0.08, facing));
  gl_FragColor = vec4(color * lit, a);
}
`;

/** Value noise drawn out along the parallels into bands, in the green channel: the veil's streaks. */
function streaks(cover: Uint8Array): Uint8Array {
  let seed = 1815;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const octaves = [
    { cols: 3, rows: 18, amp: 0.5 },
    { cols: 6, rows: 34, amp: 0.3 },
    { cols: 12, rows: 60, amp: 0.2 },
  ].map((o) => ({ ...o, grid: Array.from({ length: o.cols * o.rows }, rand) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      let sum = 0;
      for (const { cols, rows, amp, grid } of octaves) {
        const x = (i / W) * cols;
        const y = (j / (H - 1)) * (rows - 1);
        const [x0, y0] = [Math.floor(x), Math.min(rows - 2, Math.floor(y))];
        const [fx, fy] = [smooth(x - x0), smooth(y - y0)];
        const at = (c: number, r: number) => grid[r * cols + (c % cols)] ?? 0;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        sum += amp * (top + (bottom - top) * fy);
      }
      cover[(j * W + i) * 2 + 1] = Math.round(
        255 * Math.min(1, Math.max(0, (sum - 0.5) * 1.8 + 0.5)),
      );
    }
  }
  return cover;
}

export class Veil {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  /** Coverage in red, rebaked as story time moves; fixed streaks in green. */
  readonly #cover = streaks(new Uint8Array(W * H * 2));
  readonly #texture: DataTexture;
  #day = NaN;

  constructor() {
    this.#texture = new DataTexture(this.#cover, W, H, RGFormat, UnsignedByteType);
    this.#texture.wrapS = RepeatWrapping;
    this.#texture.minFilter = this.#texture.magFilter = LinearFilter;
    const material = new ShaderMaterial({
      uniforms: {
        uCover: { value: this.#texture },
        uCamera: { value: new Vector3() },
        uLamp: { value: new Vector3(0, 0, 1) },
        uColor: { value: new Color('#c9a27a') },
        uTwilight: { value: new Color('#d9894a') },
        uRim: { value: new Color('#9a6a8a') },
        uRadius: { value: 1 },
        uStrength: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: FrontSide,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 128, 64), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** `camera` and `lamp` in the globe frame, `lamp` a direction; `viewKm` the view's width. */
  update(
    day: number,
    kLand: number,
    viewKm: number,
    camera: Vector3,
    lamp: Vector3,
    strength: number,
    elapsedS: number,
  ): void {
    const fade = smoothstep(1500, 9000, viewKm) * strength;
    this.mesh.visible = fade > 0.001;
    if (!this.mesh.visible) return;
    if (Math.abs(day - this.#day) > 0.05 || Number.isNaN(this.#day)) this.#bake(day);
    const u = this.mesh.material.uniforms;
    const radius = 1 + (kLand * SHELL_M) / EARTH_M + 0.0008;
    if (u.uRadius) u.uRadius.value = radius;
    if (u.uStrength) u.uStrength.value = fade;
    if (u.uTime) u.uTime.value = elapsedS;
    (u.uCamera?.value as Vector3).copy(camera);
    (u.uLamp?.value as Vector3).copy(lamp);
  }

  #bake(day: number): void {
    this.#day = day;
    for (let j = 0; j < H; j += 1) {
      const lat = -90 + ((j + 0.5) * 180) / H;
      for (let i = 0; i < W; i += 1) {
        const lon = -180 + ((i + 0.5) * 360) / W;
        this.#cover[(j * W + i) * 2] = Math.round(255 * veilDensity(lon, lat, day));
      }
    }
    this.#texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.#texture.dispose();
    this.mesh.material.dispose();
  }
}
