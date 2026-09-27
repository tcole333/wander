// Smoke noise for the pulses' stain (pulses.ts): 3D gradient noise, the third axis presentation
// time so the smoke billows in place, summed in octaves that fade out as their cells near two
// pixels, so a small or distant stain does not shimmer.

export const SMOKE_NOISE = /* glsl */ `
uint smokeHash(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  return x ^ (x >> 16u);
}

// A lattice point's gradient, each component in [-1, 1].
vec3 smokeGradientAt(vec3 c) {
  uvec3 i = uvec3(ivec3(c));
  uint h = smokeHash(i.x * 0x8da6b343u + i.y * 0xd8163841u + i.z * 0xcb1ab31fu);
  return vec3(uvec3(h, h >> 10u, h >> 20u) & 1023u) * (2.0 / 1023.0) - 1.0;
}

// Gradient noise, about -1 to 1.
float smokeNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(smokeGradientAt(i), f);
  float b = dot(smokeGradientAt(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float c = dot(smokeGradientAt(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float d = dot(smokeGradientAt(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float e = dot(smokeGradientAt(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float g = dot(smokeGradientAt(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float h = dot(smokeGradientAt(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float k = dot(smokeGradientAt(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return 1.6 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

// Octaves of noise at p (x, y in cells, z time), each half the size of the last and turned so
// their lattices do not line up; cellPx is cells per pixel at the first octave. About -1 to 1.
float smokeFbm(vec3 p, int octaves, float cellPx) {
  const mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int k = 0; k < 6; k++) {
    if (k >= octaves) break;
    float shown = 1.0 - smoothstep(0.3, 0.55, cellPx);
    if (shown <= 0.0) break;
    sum += amp * shown * smokeNoise(p);
    norm += amp;
    p = vec3(turn * p.xy, p.z * 1.7 + 3.1);
    amp *= 0.5;
    cellPx *= 2.0;
  }
  return sum / norm;
}
`;
