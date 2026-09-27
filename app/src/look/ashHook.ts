// The look's ash hook: an illustrative ashfall that greys and dulls the surface where ash has
// arrived. The walk's effects drive it (story/effects/walkEffects.ts); with its strength at 0, the
// default, the look is unchanged. The ash front spreads from a center, fastest along a downwind axis, and
// slows as it spreads, as an umbrella cloud's edge does: it reaches a place
// t0 + (e / kKm)^1.5 days after the anchor, e being the distance scaled by direction (below).
import { Vector3, Vector4, type Material } from 'three';

export const ASH_MODEL = {
  /** Days after the anchor date when ash starts falling at the center. */
  t0: -0.25,
  /** How far the front reaches in the reference direction one day after t0, km. */
  kKm: 390,
  /** The front's speed by the angle θ off the axis: gMin + (1 - gMin)·((1 + cos θ)/2)^gPow. */
  gMin: 0.2,
  gPow: 1.5,
  /** The angle off the axis at which kKm holds: due west for a northwest axis. */
  refDeg: 45,
  /** The ash thins with distance as 1 / (1 + (e / thinKm)²). */
  thinKm: 500,
  /** Days the ash takes to pile up, most of it before its arrival day. */
  pileDays: 0.9,
  /** Ash fades on land and at sea with these time constants, days. */
  landDays: 400,
  seaDays: 12,
} as const;

function ashG(cosTheta: number): number {
  return ASH_MODEL.gMin + (1 - ASH_MODEL.gMin) * ((1 + cosTheta) / 2) ** ASH_MODEL.gPow;
}

const G_REF = ashG(Math.cos((ASH_MODEL.refDeg * Math.PI) / 180));

/** The front's speed at cos θ off the axis, 1 in the reference direction. */
export function ashSpeed(cosTheta: number): number {
  return ashG(cosTheta) / G_REF;
}

/** Days after the anchor when ash reaches a place `km` out at cos θ off the axis (as lookAsh). */
export function ashArrival(km: number, cosTheta: number): number {
  return ASH_MODEL.t0 + (km / ashSpeed(cosTheta) / ASH_MODEL.kKm) ** 1.5;
}

/** How far out the front is `days` after the anchor, at cos θ off the axis, km. */
export function ashReachKm(days: number, cosTheta: number): number {
  const t = days - ASH_MODEL.t0;
  return t <= 0 ? 0 : ASH_MODEL.kKm * t ** (2 / 3) * ashSpeed(cosTheta);
}

export interface AshUniforms {
  /** 0 leaves the look as it is. */
  lookAshStrength: { value: number };
  /** The center, a unit direction in the globe frame. */
  lookAshCenter: { value: Vector3 };
  /** The downwind axis, a unit tangent at the center. */
  lookAshAxis: { value: Vector3 };
  /** Story time in days after the anchor date. */
  lookAshDay: { value: number };
  /** The extent: west, east, south and north edges in degrees. */
  lookAshBox: { value: Vector4 };
}

export function createAshUniforms(): AshUniforms {
  return {
    lookAshStrength: { value: 0 },
    lookAshCenter: { value: new Vector3(0, 0, 1) },
    lookAshAxis: { value: new Vector3(0, 1, 0) },
    lookAshDay: { value: 0 },
    lookAshBox: { value: new Vector4(-180, 180, -90, 90) },
  };
}

const registry = new WeakMap<Material, AshUniforms>();

export function registerAsh(material: Material, uniforms: AshUniforms): void {
  registry.set(material, uniforms);
}

/** The ash uniforms of a surface look's material, if it has the hook. */
export function ashUniformsOf(material: Material): AshUniforms | undefined {
  return registry.get(material);
}

const f = (x: number) => x.toFixed(6);

/** After the look's pars: the uniforms and lookAsh(), which reads lookDirAt and LookSurface. */
export const ASH_FRAGMENT_PARS = /* glsl */ `
uniform float lookAshStrength;
uniform vec3 lookAshCenter;
uniform vec3 lookAshAxis;
uniform float lookAshDay;
uniform vec4 lookAshBox;

void lookAsh(inout LookSurface s) {
  if (lookAshStrength <= 0.0 || lookDebug != 0) return;
  vec3 dir = lookDirAt(vLookSt);
  float cosD = clamp(dot(dir, lookAshCenter), -1.0, 1.0);
  float km = acos(cosD) * 6371.0;
  vec3 toward = dir - lookAshCenter * cosD;
  float len = length(toward);
  float cosT = len > 1e-7 ? dot(toward / len, lookAshAxis) : 1.0;
  float g = ${f(ASH_MODEL.gMin)} + ${f(1 - ASH_MODEL.gMin)} * pow(0.5 + 0.5 * cosT, ${f(ASH_MODEL.gPow)});
  float e = km * ${f(G_REF)} / g;
  float arrive = ${f(ASH_MODEL.t0)} + pow(e / ${f(ASH_MODEL.kKm)}, 1.5);
  float fallen = smoothstep(arrive - ${f(0.55 * ASH_MODEL.pileDays)}, arrive + ${f(0.45 * ASH_MODEL.pileDays)}, lookAshDay);
  float age = max(lookAshDay - arrive, 0.0);
  float keep = mix(exp(-age / ${f(ASH_MODEL.seaDays)}), exp(-age / ${f(ASH_MODEL.landDays)}), s.land);
  float thin = 1.0 / (1.0 + (e / ${f(ASH_MODEL.thinKm)}) * (e / ${f(ASH_MODEL.thinKm)}));
  vec2 ll = lookLonLat(dir);
  float box = smoothstep(lookAshBox.x - 1.5, lookAshBox.x + 1.5, ll.x) *
    (1.0 - smoothstep(lookAshBox.y - 1.5, lookAshBox.y + 1.5, ll.x)) *
    smoothstep(lookAshBox.z - 1.0, lookAshBox.z + 1.0, ll.y) *
    (1.0 - smoothstep(lookAshBox.w - 1.0, lookAshBox.w + 1.0, ll.y));
  float a = clamp(lookAshStrength * fallen * keep * thin * box, 0.0, 1.0);
  // Grey dust on the bronze, a faint grey film on the lacquer; both lose some of their shine.
  float grey = dot(s.albedo, vec3(0.3, 0.55, 0.15));
  vec3 ash = mix(vec3(0.1, 0.097, 0.092), vec3(0.22, 0.207, 0.188) + grey * 0.15, s.land);
  s.albedo = mix(s.albedo, ash, a * mix(0.5, 0.8, s.land));
  s.roughness = mix(s.roughness, 0.9, a * 0.8);
  s.metalness = mix(s.metalness, 0.3, a);
}
`;

/** After the look's color chunk has computed lookS and set the diffuse color from it. */
export const ASH_FRAGMENT_APPLY = /* glsl */ `
  lookAsh(lookS);
  diffuseColor.rgb = lookS.albedo;
`;
