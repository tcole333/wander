// The armillary hardware as real geometry, ported from the spike (docs/reference/spike/src/
// instrument.js): engraved graduated rings, the yoke and its bearings, the gear train and the
// pedestal. Each part that can come between the camera and the globe is a FadePart, so the scene
// can fade it as the camera passes through it.
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';

/** A piece of the instrument that fades as the camera nears it. */
export interface FadePart {
  object: Object3D;
  /** Points along the part, in `object`'s local frame. */
  samples: Vector3[];
  /** How far the part's surface reaches beyond its samples. */
  halfWidth: number;
}

export interface Instrument {
  /** The yoke, the outer ring, the gears and the pedestal: they stay put. */
  fixed: Group;
  /** The meridian ring and its polar pivots: they tilt with the globe. */
  tilting: Group;
  /** The two graduated rings, for the rings toggle. */
  rings: Object3D[];
  gears: { mesh: Mesh; ratio: number }[];
  fadeParts: FadePart[];
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas context');
  return [canvas, context];
}

/** Streaky noise in the green channel, the roughness a roughnessMap reads. */
function brushedNoiseTexture(size = 512): CanvasTexture {
  const [canvas, x] = canvas2d(size, size);
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    let run = Math.random();
    for (let i = 0; i < size; i++) {
      run = run * 0.96 + Math.random() * 0.04;
      const v = 110 + (run - 0.5) * 120 + (Math.random() - 0.5) * 40;
      const q = (j * size + i) * 4;
      img.data[q] = 255;
      img.data[q + 1] = Math.max(0, Math.min(255, v));
      img.data[q + 2] = 255;
      img.data[q + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

function brassMaterial(color: number, roughness: number, aged: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color(color).lerp(new Color(0x5a4020), aged * 0.35),
    metalness: 1,
    roughness: roughness * 1.6,
    roughnessMap: brushedNoiseTexture(),
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    envMapIntensity: 1.5,
  });
}

const ENGRAVING_FONT = '"Hoefler Text", Baskerville, Georgia, serif';

/**
 * Degree ticks, grooves and numerals drawn around a square canvas; the extruded ring's cap UVs are
 * its shape coordinates, so the texture's repeat and offset map [-outer, outer] onto [0, 1].
 */
function engravedRingTexture(
  inner: number,
  outer: number,
  numerals: number,
  label: string,
): CanvasTexture {
  const S = 2048;
  const [canvas, x] = canvas2d(S, S);
  const c = S / 2;
  const scale = S / 2 / outer;
  const rIn = inner * scale;
  const band = (outer - inner) * scale;
  const at = (a: number, r: number): [number, number] => [c + Math.cos(a) * r, c + Math.sin(a) * r];

  x.fillStyle = '#fff';
  x.fillRect(0, 0, S, S);
  x.strokeStyle = '#000';
  x.fillStyle = '#000';
  x.lineWidth = 3;
  for (const r of [rIn + band * 0.08, rIn + band * 0.92]) {
    x.beginPath();
    x.arc(c, c, r, 0, Math.PI * 2);
    x.stroke();
  }
  x.lineWidth = 1.6;
  x.beginPath();
  x.arc(c, c, rIn + band * 0.42, 0, Math.PI * 2);
  x.stroke();
  for (let d = 0; d < 360; d++) {
    const a = (d * Math.PI) / 180;
    const length = d % 10 === 0 ? 0.3 : d % 5 === 0 ? 0.22 : 0.13;
    const r0 = rIn + band * 0.1;
    x.lineWidth = d % 10 === 0 ? 3 : 1.8;
    x.beginPath();
    x.moveTo(...at(a, r0));
    x.lineTo(...at(a, r0 + band * length));
    x.stroke();
  }

  const textRadius = rIn + band * 0.66;
  x.font = `600 ${Math.round(band * 0.3)}px ${ENGRAVING_FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (let n = 0; n < numerals; n++) {
    const deg = (n * 360) / numerals;
    const a = (deg * Math.PI) / 180 - Math.PI / 2;
    x.save();
    x.translate(...at(a, textRadius));
    x.rotate(a + Math.PI / 2);
    x.fillText(String(Math.round(deg)), 0, 0);
    x.restore();
  }
  if (label) {
    x.font = `italic ${Math.round(band * 0.22)}px ${ENGRAVING_FONT}`;
    const chars = [...label];
    chars.forEach((ch, i) => {
      const a = Math.PI / 2 + (i - chars.length / 2) * 0.012;
      x.save();
      x.translate(...at(a, textRadius));
      x.rotate(a - Math.PI / 2);
      x.fillText(ch, 0, 0);
      x.restore();
    });
  }

  const texture = new CanvasTexture(canvas);
  texture.repeat.set(1 / (2 * outer), 1 / (2 * outer));
  texture.offset.set(0.5, 0.5);
  texture.anisotropy = 8;
  return texture;
}

function annulusShape(inner: number, outer: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

interface RingSpec {
  inner: number;
  outer: number;
  depth: number;
  numerals: number;
  label?: string;
  brass: MeshPhysicalMaterial;
}

/** A flat brass annulus in its XY plane, engraved on both faces, beveled at the edges. */
function graduatedRing({ inner, outer, depth, numerals, label = '', brass }: RingSpec): Mesh {
  const geometry = new ExtrudeGeometry(annulusShape(inner, outer), {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.25,
    bevelSize: (outer - inner) * 0.06,
    bevelSegments: 3,
    curveSegments: 256,
  });
  geometry.translate(0, 0, -depth / 2);
  const engraving = engravedRingTexture(inner, outer, numerals, label);
  const face = brass.clone();
  face.bumpMap = engraving;
  face.bumpScale = 1.6;
  // The map darkens the grooves like niello.
  face.map = engraving;
  face.color = brass.color.clone().multiplyScalar(1.05);
  const mesh = new Mesh(geometry, [face, brass]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface GearSpec {
  teeth: number;
  radius: number;
  thickness: number;
  spokes: number;
  hub: number;
}

function gearGeometry({ teeth, radius, thickness, spokes, hub }: GearSpec): ExtrudeGeometry {
  const toothDepth = 0.035;
  const shape = new Shape();
  const rRoot = radius - toothDepth;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const profile: [number, number][] = [
      [rRoot, a],
      [rRoot, a + step * 0.12],
      [radius, a + step * 0.28],
      [radius, a + step * 0.52],
      [rRoot, a + step * 0.68],
      [rRoot, a + step],
    ];
    profile.forEach(([r, t], k) => {
      if (i === 0 && k === 0) shape.moveTo(Math.cos(t) * r, Math.sin(t) * r);
      else shape.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    });
  }
  const rimInner = rRoot * 0.78;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2 + 0.16;
    const a1 = ((k + 1) / spokes) * Math.PI * 2 - 0.16;
    const opening = new Path();
    opening.absarc(0, 0, rimInner, a0, a1, false);
    opening.absarc(0, 0, hub * 1.5, a1 - 0.05, a0 + 0.05, true);
    opening.closePath();
    shape.holes.push(opening);
  }
  const axle = new Path();
  axle.absarc(0, 0, hub * 0.35, 0, Math.PI * 2, true);
  shape.holes.push(axle);
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.2,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

function bolt(radius: number, brass: MeshPhysicalMaterial): Mesh {
  const geometry = new CylinderGeometry(radius, radius * 1.05, radius * 0.7, 6);
  geometry.rotateX(Math.PI / 2);
  const mesh = new Mesh(geometry, brass);
  mesh.castShadow = true;
  return mesh;
}

/** `count` points on a circle of `radius` in the XY plane, from angle `a0` to `a1`. */
function arcSamples(radius: number, count: number, a0 = 0, a1 = Math.PI * 2): Vector3[] {
  return Array.from({ length: count }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / (count - 1);
    return new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  });
}

export function buildInstrument(): Instrument {
  const brass = brassMaterial(0xc09252, 0.3, 0.35);
  const darkBrass = brassMaterial(0x8e6a36, 0.42, 0.8);
  const steel = new MeshStandardMaterial({ color: 0x2a2622, metalness: 0.9, roughness: 0.45 });
  const gearBrass = brassMaterial(0x6a4e2a, 0.5, 1);
  gearBrass.envMapIntensity = 0.7;

  const fixed = new Group();
  fixed.name = 'instrument';
  const tilting = new Group();
  tilting.name = 'meridian';
  const fadeParts: FadePart[] = [];

  // The meridian ring carries the polar pivots and tilts with the globe.
  const meridian = graduatedRing({ inner: 1.075, outer: 1.18, depth: 0.045, numerals: 36, brass });
  tilting.add(meridian);
  for (const sign of [1, -1]) {
    const pin = new Mesh(new CylinderGeometry(0.018, 0.018, 0.1, 24), steel);
    pin.position.set(0, sign * 1.04, 0);
    const cap = new Mesh(new CylinderGeometry(0.05, 0.058, 0.07, 32), brass);
    cap.position.set(0, sign * 1.2, 0);
    cap.castShadow = true;
    const knob = new Mesh(new SphereGeometry(0.035, 24, 16), brass);
    knob.position.set(0, sign * 1.25, 0);
    const axle = new Mesh(new CylinderGeometry(0.02, 0.02, 0.12, 16), steel);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(sign * 1.14, 0, 0);
    tilting.add(pin, cap, knob, axle);
  }
  fadeParts.push({
    object: tilting,
    samples: [...arcSamples(1.1275, 97), new Vector3(0, 1.23, 0), new Vector3(0, -1.23, 0)],
    halfWidth: 0.06,
  });

  // The outer fixed ring, turned a little so it reads as an ellipse behind the globe.
  const outer = graduatedRing({
    inner: 1.27,
    outer: 1.42,
    depth: 0.06,
    numerals: 72,
    label: 'WANDER · ANNO MDCCCXV',
    brass: darkBrass,
  });
  outer.rotation.y = 0.32;
  outer.rotation.x = -0.08;
  outer.position.z = -0.12;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const b = bolt(0.022, brass);
    b.position.set(Math.cos(a) * 1.345, Math.sin(a) * 1.345, 0.052);
    outer.add(b);
  }
  outer.name = 'outerRing';
  fixed.add(outer);
  fadeParts.push({ object: outer, samples: arcSamples(1.345, 97), halfWidth: 0.08 });

  // The yoke: a lower half ring from the pedestal to the horizontal bearings at ±x.
  const yokeGroup = new Group();
  const yoke = new Mesh(new TorusGeometry(1.25, 0.035, 20, 128, Math.PI), darkBrass);
  yoke.rotation.z = Math.PI;
  yoke.scale.set(1, 1, 1.6);
  yoke.castShadow = true;
  yokeGroup.add(yoke);
  for (const sign of [1, -1]) {
    const housing = new Mesh(new CylinderGeometry(0.075, 0.075, 0.13, 40), brass);
    housing.rotation.z = Math.PI / 2;
    housing.position.set(sign * 1.23, 0, 0);
    housing.castShadow = true;
    const collar = new Mesh(new TorusGeometry(0.075, 0.012, 12, 40), darkBrass);
    collar.rotation.y = Math.PI / 2;
    collar.position.set(sign * 1.3, 0, 0);
    yokeGroup.add(housing, collar);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const b = bolt(0.011, darkBrass);
      b.rotation.set(0, Math.PI / 2, 0);
      b.position.set(sign * 1.3, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
      yokeGroup.add(b);
    }
  }
  yokeGroup.name = 'yoke';
  fixed.add(yokeGroup);
  fadeParts.push({
    object: yokeGroup,
    samples: arcSamples(1.25, 49, Math.PI, Math.PI * 2),
    halfWidth: 0.08,
  });

  // The pedestal, turned on a lathe.
  const profile = [
    [0.0, -2.35],
    [0.62, -2.35],
    [0.64, -2.3],
    [0.5, -2.24],
    [0.28, -2.18],
    [0.16, -2.0],
    [0.12, -1.75],
    [0.16, -1.62],
    [0.1, -1.5],
    [0.07, -1.3],
    [0.0, -1.28],
  ].map(([r, y]) => new Vector2(r, y));
  const pedestal = new Mesh(new LatheGeometry(profile, 72), darkBrass);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pedestal.name = 'pedestal';
  fixed.add(pedestal);
  fadeParts.push({
    object: pedestal,
    samples: Array.from({ length: 8 }, (_, i) => new Vector3(0, -2.3 + i * 0.14, 0)),
    halfWidth: 0.2,
  });

  // The gear train behind the globe; the scene turns it with the gimbal.
  const gears: Instrument['gears'] = [];
  const gearSpecs = [
    { teeth: 40, radius: 0.46, pos: [-1.52, -0.7, -0.55], material: gearBrass, ratio: 1 },
    { teeth: 18, radius: 0.215, pos: [-1.06, -1.1, -0.5], material: brass, ratio: -40 / 18 },
    { teeth: 32, radius: 0.37, pos: [1.58, -0.85, -0.6], material: gearBrass, ratio: -1.2 },
    { teeth: 14, radius: 0.17, pos: [1.2, -1.22, -0.52], material: brass, ratio: (1.2 * 32) / 14 },
    { teeth: 56, radius: 0.62, pos: [1.25, 1.05, -0.95], material: gearBrass, ratio: 0.5 },
  ] as const;
  for (const spec of gearSpecs) {
    const geometry = gearGeometry({
      teeth: spec.teeth,
      radius: spec.radius,
      thickness: 0.04,
      spokes: spec.teeth > 20 ? 6 : 0,
      hub: spec.radius * 0.25,
    });
    const gear = new Mesh(geometry, spec.material);
    gear.position.fromArray(spec.pos);
    gear.castShadow = true;
    gear.receiveShadow = true;
    const hubCap = new Mesh(
      new CylinderGeometry(spec.radius * 0.12, spec.radius * 0.14, 0.06, 24),
      brass,
    );
    hubCap.rotation.x = Math.PI / 2;
    gear.add(hubCap);
    gear.name = `gear${gears.length}`;
    fixed.add(gear);
    gears.push({ mesh: gear, ratio: spec.ratio });
    fadeParts.push({ object: gear, samples: [new Vector3()], halfWidth: spec.radius });
  }

  return { fixed, tilting, rings: [tilting, outer], gears, fadeParts };
}
