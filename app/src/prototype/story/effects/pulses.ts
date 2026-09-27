// Pulses drawn on the globe: a disc of the sphere around the place, on a shell just above the
// land's exaggerated heights there. rumble: faint rings welling out; sound: one bright ring racing
// out to its reach, or the reach alone once the day is past; contagion: a smoky stain of dried
// blood seeping out over the land. The ring and stain sizes come from story time (timeline.ts
// pulseState); the racing and the smoke's billowing are presentation. A pulse smaller than a few
// percent of the view is drawn at that size, so it still reads.
//
// The rings are light, added over the globe. The stain is no light of its own: it multiplies the
// globe's color under it, as a dye would, so it takes the lamp and the relief's shading from the
// land it lies on and has no edge to draw.
import {
  AdditiveBlending,
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

const VERTEX = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uDiscKm;
uniform float uShell;
varying vec2 vKm;
void main() {
  float angle = position.x * uDiscKm / ${EARTH_KM.toFixed(4)};
  vec3 h = cos(position.y) * uEast + sin(position.y) * uNorth;
  vec3 p = (uUp * cos(angle) + h * sin(angle)) * uShell;
  vKm = vec2(cos(position.y), sin(position.y)) * position.x * uDiscKm;
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

${SMOKE_NOISE}

// A line widthPx wide around radius r, with a softer glow glowPx wide.
float ring(float d, float r, float widthPx, float glowPx) {
  float px = max(fwidth(d), 1e-4);
  float x = abs(d - r) / px;
  return 1.0 - smoothstep(0.5 * widthPx - 0.5, 0.5 * widthPx + 0.5, x) + 0.3 * exp(-x / glowPx);
}

// The stain's density, 0 to 1: densest at the source and thinning out to about R. Curling noise
// pushes its reach in and out and draws its smoke into wisps, more so as it thins; the noise's
// third axis is presentation time, so the smoke billows in place. It is gone before the disc's
// rim, however the smoke curls.
float stain(float R) {
  vec2 p = vKm / uGrainKm;
  float cellPx = length(fwidth(p));
  float reach = length(vKm) / R;
  if (reach > 1.35) return 0.0;
  float t = uTime * 0.03;
  vec2 curl = vec2(
    smokeFbm(vec3(p, t), 3, cellPx),
    smokeFbm(vec3(p + vec2(5.2, 1.3), t + 7.0), 3, cellPx)
  );
  float q = length(vKm + (0.2 + 0.25 * reach) * R * curl) / R;
  float smoke = smokeFbm(vec3(2.0 * (p + 1.5 * curl), 1.3 * t), 6, 2.0 * cellPx);
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
    // Rings welling out from the mountain, fading as they go.
    for (int k = 0; k < 3; k++) {
      float f = fract(uTime / 3.2 + float(k) / 3.0);
      a += ring(d, f * R, 1.4, 5.0) * pow(1.0 - f, 1.3) * smoothstep(0.0, 0.08, f);
    }
    a *= 0.55;
  } else if (uRacing) {
    // One report racing out, a faint wash behind it; then the next.
    float f = fract(uTime / 4.5);
    float r = R * (1.0 - (1.0 - f) * (1.0 - f));
    // Outside the ring the wash is 0; exp() of the distance there overflows to infinity, and
    // 0 times infinity is NaN, which the bloom spreads over the whole frame.
    float behind = d <= r ? exp(-(r - d) / max(0.08 * r, 1.0)) : 0.0;
    a = (ring(d, r, 2.2, 7.0) + 0.12 * behind) * (1.0 - 0.6 * f);
  } else {
    a = 0.6 * ring(d, R, 1.2, 4.0);
  }
  a *= uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, a);
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
    // Rumble in the ember's color, sound in lit brass; the stain as the light it takes away.
    const color = stained
      ? new Vector3(-Math.log(STAIN.r), -Math.log(STAIN.g), -Math.log(STAIN.b))
      : new Color(['#e8662c', '#e8c889'][style]).multiplyScalar(1.6);
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
      // Rings are added as light; the stain multiplies what lies under it.
      blending: stained ? MultiplyBlending : AdditiveBlending,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(discGeometry(), material);
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
