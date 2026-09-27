// Pulses drawn on the globe: a disc of the sphere around the place, on a shell just above the
// land's exaggerated heights there. rumble: faint warm waves welling out; sound: one wave racing
// out to its reach, or the reach alone once the day is past; contagion: a smoky stain of dried
// blood seeping out over the land. The wave and stain sizes come from story time (timeline.ts
// pulseState); the racing and the smoke's billowing are presentation. A pulse smaller than a few
// percent of the view is drawn at that size, so it still reads.
//
// Neither is paint laid over the globe; both multiply the globe's color under them, so they take
// the lamp and the relief's shading from the land they lie on and have no edge to draw. A wave is
// a soft swell, tens of km across, that lets the land gleam brighter as it passes, as if the lamp
// caught it; the stain is a dye that drinks the light.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MultiplyBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import { dirOf, EARTH_KM, EARTH_M, tangents } from './geo';
import { SMOKE_NOISE } from './smoke.glsl';
import type { PulseEffect, PulseState } from './timeline';

/** The shell's height over the sea, before exaggeration: above most land a pulse spreads over. */
const SHELL_M = 3200;
const STYLES: Record<string, number> = { rumble: 0, sound: 1, contagion: 2 };
const SMALLEST = { rumble: 0.035, sound: 0, contagion: 0.022 };
/** How far out the disc reaches, in the pulse's radii: the stain's wisps stray past it. */
const DISC_REACH = [1.2, 1.2, 1.4];
/** The smoke's grain, in the stain's radii: a few billows across it, at any size. */
const GRAIN = 0.4;
/** The light the stain passes where it is densest: dried blood. */
const STAIN = new Color('#944a3e');
/** How much the land's color is scaled up at a wave's crest, less one, at full strength. */
const GLEAM = 2.6;

/** A disc of the sphere as a polar grid: position.x the radius 0 to 1, position.y the angle. */
function discGeometry(rings = 48, spokes = 128): BufferGeometry {
  const positions: number[] = [];
  for (let r = 0; r <= rings; r += 1) {
    for (let s = 0; s <= spokes; s += 1) positions.push(r / rings, (s / spokes) * Math.PI * 2, 0);
  }
  const index: number[] = [];
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < spokes; s += 1) {
      const a = r * (spokes + 1) + s;
      const b = a + spokes + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  return geometry;
}

// The stain's curl is a slow, smooth field, so it is found at the disc's vertices; only the fine
// smoke is found per fragment.
const VERTEX = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uDiscKm;
uniform float uShell;
uniform int uStyle;
uniform float uGrainKm;
uniform float uTime;
varying vec2 vKm;
varying vec2 vCurl;

${SMOKE_NOISE}

void main() {
  float angle = position.x * uDiscKm / ${EARTH_KM.toFixed(4)};
  vec3 h = cos(position.y) * uEast + sin(position.y) * uNorth;
  vec3 p = (uUp * cos(angle) + h * sin(angle)) * uShell;
  vKm = vec2(cos(position.y), sin(position.y)) * position.x * uDiscKm;
  vCurl = vec2(0.0);
  if (uStyle == 2) {
    vec2 at = vKm / uGrainKm;
    float t = uTime * 0.03;
    vCurl = vec2(
      smokeFbm(vec3(at, t), 2, 0.0),
      smokeFbm(vec3(at + vec2(5.2, 1.3), t + 7.0), 2, 0.0)
    );
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform int uStyle;
uniform float uRadiusKm;
uniform float uGrainKm;
uniform float uStrength;
uniform float uTime;
uniform bool uRacing;
uniform vec3 uColor;
varying vec2 vKm;
varying vec2 vCurl;

${SMOKE_NOISE}

// A soft swell of light about radius r, w km to either side: no line and no hard core.
float swell(float d, float r, float w) {
  float x = (d - r) / max(w, 1e-3);
  return exp(-x * x);
}

// The stain's density, 0 to 1: densest at the source and thinning out to about R. The curl
// pushes its reach in and out and draws its smoke into wisps, more so as it thins; the noise's
// third axis is presentation time, so the smoke billows in place. It is gone before the disc's
// rim, however the smoke curls.
float stain(float R) {
  vec2 p = vKm / uGrainKm;
  float cellPx = length(fwidth(p));
  float reach = length(vKm) / R;
  if (reach > 1.35) return 0.0;
  float q = length(vKm + (0.2 + 0.25 * reach) * R * vCurl) / R;
  float smoke = smokeFbm(vec3(2.0 * (p + 1.5 * vCurl), 0.04 * uTime), 6, 2.0 * cellPx);
  float body = 0.85 * (1.0 - smoothstep(0.25, 1.1, q));
  float density = body + (0.25 + 0.6 * (0.85 - body)) * smoke;
  density *= (1.0 - smoothstep(1.0, 1.4, q)) * (1.0 - smoothstep(1.1, 1.35, reach));
  return smoothstep(0.0, 1.0, density);
}

void main() {
  float d = length(vKm);
  float R = uRadiusKm;
  if (uStyle == 2) {
    // Light through the stain, by its density: red passes, green and blue are drunk up.
    float density = clamp(stain(R) * uStrength, 0.0, 1.0);
    if (density < 0.004) discard;
    gl_FragColor = vec4(exp(-uColor * density), 1.0);
    return;
  }
  float a = 0.0;
  if (uStyle == 0) {
    // Waves welling out from the mountain, fading as they go.
    for (int k = 0; k < 3; k++) {
      float f = fract(uTime / 3.2 + float(k) / 3.0);
      a += swell(d, f * R, 0.08 * R) * pow(1.0 - f, 1.3) * smoothstep(0.0, 0.08, f);
    }
  } else if (uRacing) {
    // One report racing out, a faint wash behind it; then the next.
    float f = fract(uTime / 4.5);
    float r = R * (1.0 - (1.0 - f) * (1.0 - f));
    // Outside the wave the wash is 0; exp() of the distance there overflows to infinity, and
    // 0 times infinity is NaN, which the bloom spreads over the whole frame.
    float behind = d <= r ? exp(-(r - d) / max(0.08 * r, 1.0)) : 0.0;
    a = (swell(d, r, 0.05 * R) + 0.12 * behind) * (1.0 - 0.6 * f);
  } else {
    a = 0.6 * swell(d, R, 0.05 * R);
  }
  a *= uStrength;
  if (a < 0.002) discard;
  // The land under the wave gleams: its own color, scaled up.
  gl_FragColor = vec4(1.0 + uColor * a, 1.0);
}
`;

export class PulseDisc {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly effect: PulseEffect;
  readonly #style: number;

  constructor(effect: PulseEffect) {
    this.effect = effect;
    const style = STYLES[effect.style] ?? 2;
    this.#style = style;
    const { east, north } = tangents(effect.at);
    const stained = style === 2;
    // Rumble gleams in the ember's color, sound in lit brass; the stain as the light it takes away.
    const color = stained
      ? new Vector3(-Math.log(STAIN.r), -Math.log(STAIN.g), -Math.log(STAIN.b))
      : new Color(['#e8662c', '#e8c889'][style]).multiplyScalar(GLEAM);
    const material = new ShaderMaterial({
      uniforms: {
        uUp: { value: dirOf(effect.at) },
        uEast: { value: east },
        uNorth: { value: north },
        uDiscKm: { value: effect.radiusKm },
        uShell: { value: 1 },
        uStyle: { value: style },
        uRadiusKm: { value: effect.radiusKm },
        uGrainKm: { value: effect.radiusKm * GRAIN },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uRacing: { value: true },
        uColor: { value: color },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Each scales the color of what lies under it (the scene's target is half float, so a
      // wave's factor over 1 is kept).
      blending: MultiplyBlending,
      premultipliedAlpha: true,
    });
    // The stain's disc is finer, for its curl found at the vertices.
    this.mesh = new Mesh(stained ? discGeometry(64, 256) : discGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** `viewKm`: about how wide the view is at the pulse. */
  update(state: PulseState, kLand: number, viewKm: number, strength: number, elapsedS: number) {
    const on = state.strength > 0.001 && strength > 0;
    this.mesh.visible = on;
    if (!on) return;
    const smallest = SMALLEST[this.effect.style as keyof typeof SMALLEST] ?? 0;
    const radiusKm = Math.max(state.radiusKm, smallest * viewKm);
    const u = this.mesh.material.uniforms;
    const set = (name: string, value: unknown) => {
      const uniform = u[name];
      if (uniform) uniform.value = value;
    };
    set('uRadiusKm', radiusKm);
    set('uGrainKm', radiusKm * GRAIN);
    set('uDiscKm', radiusKm * (DISC_REACH[this.#style] ?? 1.2) + 0.01 * viewKm);
    set('uShell', 1 + (kLand * SHELL_M) / EARTH_M);
    set('uStrength', state.strength * Math.min(1.5, strength));
    set('uTime', elapsedS);
    set('uRacing', state.racing);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
