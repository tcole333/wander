// Pulses drawn on the globe: a disc of the sphere around the place, on a shell just above the
// land's exaggerated heights there, shaded by distance from the center. rumble: faint rings
// welling out; sound: one bright ring racing out to its reach, or the reach alone once the day is
// past; contagion: a ragged red stain. The ring and stain sizes come from story time
// (timeline.ts pulseState); the racing is presentation. A pulse smaller than a few percent of the
// view is drawn at that size, so it still reads.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three';
import { dirOf, EARTH_KM, EARTH_M, tangents } from './geo';
import type { PulseEffect, PulseState } from './timeline';

/** The shell's height over the sea, before exaggeration: above most land a pulse spreads over. */
const SHELL_M = 3200;
const STYLES: Record<string, number> = { rumble: 0, sound: 1, contagion: 2 };
const SMALLEST = { rumble: 0.035, sound: 0, contagion: 0.022 };

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
uniform float uStrength;
uniform float uTime;
uniform bool uRacing;
uniform vec3 uColor;
uniform vec3 uEdge;
varying vec2 vKm;

// A line widthPx wide around radius r, with a softer glow glowPx wide.
float ring(float d, float r, float widthPx, float glowPx) {
  float px = max(fwidth(d), 1e-4);
  float x = abs(d - r) / px;
  return 1.0 - smoothstep(0.5 * widthPx - 0.5, 0.5 * widthPx + 0.5, x) + 0.3 * exp(-x / glowPx);
}

void main() {
  float d = length(vKm);
  float R = uRadiusKm;
  float a = 0.0;
  vec3 color = uColor;
  if (uStyle == 0) {
    // Rings welling out from the mountain, fading as they go.
    for (int k = 0; k < 3; k++) {
      float f = fract(uTime / 3.2 + float(k) / 3.0);
      a += ring(d, f * R, 1.4, 5.0) * pow(1.0 - f, 1.3) * smoothstep(0.0, 0.08, f);
    }
    a *= 0.55;
  } else if (uStyle == 1) {
    if (uRacing) {
      // One report racing out, a faint wash behind it; then the next.
      float f = fract(uTime / 4.5);
      float r = R * (1.0 - (1.0 - f) * (1.0 - f));
      float behind = step(d, r) * exp(-(r - d) / max(0.08 * r, 1.0));
      a = (ring(d, r, 2.2, 7.0) + 0.12 * behind) * (1.0 - 0.6 * f);
    } else {
      a = 0.6 * ring(d, R, 1.2, 4.0);
    }
  } else {
    // A ragged stain, breathing a little at its edge.
    float t = atan(vKm.y, vKm.x);
    float edge = R * (1.0 + 0.1 * sin(3.0 * t + 1.3) + 0.06 * sin(7.0 * t + 0.4) + 0.035 * sin(13.0 * t + 2.1));
    float inside = 1.0 - smoothstep(edge * 0.6, edge, d);
    float breathe = 0.75 + 0.25 * sin(uTime * 1.3);
    float line = ring(d, edge, 1.6, 4.0) * breathe;
    a = 0.62 * inside + 0.8 * line;
    color = mix(uColor, uEdge, clamp(line, 0.0, 1.0));
  }
  a *= uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(color * a, a);
}
`;

export class PulseDisc {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly effect: PulseEffect;

  constructor(effect: PulseEffect) {
    this.effect = effect;
    const style = STYLES[effect.style] ?? 2;
    const { east, north } = tangents(effect.at);
    const additive = style !== 2;
    const material = new ShaderMaterial({
      uniforms: {
        uUp: { value: dirOf(effect.at) },
        uEast: { value: east },
        uNorth: { value: north },
        uDiscKm: { value: effect.radiusKm },
        uShell: { value: 1 },
        uStyle: { value: style },
        uRadiusKm: { value: effect.radiusKm },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uRacing: { value: true },
        // Rumble in the ember's color, sound in lit brass, contagion in dried blood.
        uColor: {
          value: new Color(['#e8662c', '#e8c889', '#6e1810'][style]).multiplyScalar(
            additive ? 1.6 : 1,
          ),
        },
        uEdge: { value: new Color('#b8321f') },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Colors come premultiplied: added for light, laid over for the stain.
      blending: additive ? AdditiveBlending : NormalBlending,
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
    set('uDiscKm', radiusKm * 1.2 + 0.01 * viewKm);
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
