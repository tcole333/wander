// Armillary / orrery hardware as real geometry: engraved graduated rings, yoke, bearings, gears.
import * as THREE from 'three';

function brushedNoiseTexture(size = 512, streak = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    let run = Math.random();
    for (let i = 0; i < size; i++) {
      run = streak ? run * 0.96 + Math.random() * 0.04 : Math.random();
      const v = 110 + (run - 0.5) * 120 + (Math.random() - 0.5) * 40;
      const q = (j * size + i) * 4;
      img.data[q] = 255; img.data[q + 1] = Math.max(0, Math.min(255, v)); img.data[q + 2] = 255; img.data[q + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function brassMaterial({ color = 0xb88a45, roughness = 0.38, aged = 0.5 } = {}) {
  const rough = brushedNoiseTexture();
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color(0x5a4020), aged * 0.35),
    metalness: 1,
    roughness: roughness * 1.6,
    roughnessMap: rough,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    envMapIntensity: 1.5,
  });
}

// Polar engraving drawn in a square canvas; RingGeometry/Extrude caps use planar UVs so it lines up.
function engravedRingTexture({ inner, outer, numerals = 36, label = '' }) {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const cx = S / 2;
  const scale = (S / 2) / outer;
  const rIn = inner * scale, rOut = outer * scale;
  const band = rOut - rIn;
  x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  x.strokeStyle = '#000'; x.fillStyle = '#000';
  x.lineWidth = 3;
  // border grooves
  for (const r of [rIn + band * 0.08, rOut - band * 0.08]) { x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.stroke(); }
  x.lineWidth = 1.6;
  x.beginPath(); x.arc(cx, cx, rIn + band * 0.42, 0, Math.PI * 2); x.stroke();
  for (let d = 0; d < 360; d++) {
    const a = (d * Math.PI) / 180;
    const len = d % 10 === 0 ? 0.3 : d % 5 === 0 ? 0.22 : 0.13;
    const r0 = rIn + band * 0.1, r1 = r0 + band * len;
    x.lineWidth = d % 10 === 0 ? 3 : 1.8;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); x.stroke();
  }
  x.font = `600 ${Math.round(band * 0.3)}px "Hoefler Text", Baskerville, Georgia, serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let n = 0; n < numerals; n++) {
    const deg = (n * 360) / numerals;
    const a = (deg * Math.PI) / 180 - Math.PI / 2;
    const r = rIn + band * 0.66;
    x.save(); x.translate(cx + Math.cos(a) * r, cx + Math.sin(a) * r); x.rotate(a + Math.PI / 2);
    x.fillText(String(Math.round(deg / 10) * 10 % 360 === 0 ? 0 : Math.round(deg)), 0, 0);
    x.restore();
  }
  if (label) {
    x.font = `italic ${Math.round(band * 0.22)}px "Hoefler Text", Baskerville, Georgia, serif`;
    const chars = [...label];
    chars.forEach((ch, i) => {
      const a = Math.PI / 2 + (i - chars.length / 2) * 0.012;
      const r = rIn + band * 0.66;
      x.save(); x.translate(cx + Math.cos(a) * r, cx + Math.sin(a) * r); x.rotate(a - Math.PI / 2); x.fillText(ch, 0, 0); x.restore();
    });
  }
  const tex = new THREE.CanvasTexture(c);
  // Extrude cap UVs are raw shape coords in [-outer, outer]; remap to [0,1].
  tex.repeat.set(1 / (2 * outer), 1 / (2 * outer));
  tex.offset.set(0.5, 0.5);
  tex.anisotropy = 8;
  return tex;
}

function annulusShape(inner, outer) {
  const s = new THREE.Shape();
  s.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, inner, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

export function graduatedRing({ inner, outer, depth, numerals = 36, label = '', brass }) {
  const geo = new THREE.ExtrudeGeometry(annulusShape(inner, outer), {
    depth, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: (outer - inner) * 0.06, bevelSegments: 3, curveSegments: 256,
  });
  geo.translate(0, 0, -depth / 2);
  const engraving = engravedRingTexture({ inner, outer, numerals, label });
  const face = brass.clone();
  face.bumpMap = engraving;
  face.bumpScale = 1.6;
  // Dark niello in the engraved grooves.
  face.map = engraving;
  face.color = brass.color.clone().multiplyScalar(1.05);
  const mesh = new THREE.Mesh(geo, [face, brass]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function gearGeometry({ teeth = 24, radius = 0.3, toothDepth = 0.035, thickness = 0.04, spokes = 5, hub = 0.06 }) {
  const s = new THREE.Shape();
  const rRoot = radius - toothDepth, rTip = radius;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [rRoot, a], [rRoot, a + step * 0.12], [rTip, a + step * 0.28], [rTip, a + step * 0.52], [rRoot, a + step * 0.68], [rRoot, a + step],
    ];
    pts.forEach(([r, t], k) => {
      const px = Math.cos(t) * r, py = Math.sin(t) * r;
      if (i === 0 && k === 0) s.moveTo(px, py); else s.lineTo(px, py);
    });
  }
  const rimIn = rRoot * 0.78;
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2 + 0.16, a1 = ((k + 1) / spokes) * Math.PI * 2 - 0.16;
    const hole = new THREE.Path();
    hole.absarc(0, 0, rimIn, a0, a1, false);
    hole.absarc(0, 0, hub * 1.5, a1 - 0.05, a0 + 0.05, true);
    hole.closePath();
    s.holes.push(hole);
  }
  const axle = new THREE.Path();
  axle.absarc(0, 0, hub * 0.35, 0, Math.PI * 2, true);
  s.holes.push(axle);
  const geo = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.2, bevelSize: 0.004, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

function bolt(radius, brass) {
  const g = new THREE.CylinderGeometry(radius, radius * 1.05, radius * 0.7, 6);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, brass);
  m.castShadow = true;
  return m;
}

export function buildInstrument() {
  const brass = brassMaterial({ color: 0xc09252, roughness: 0.3, aged: 0.35 });
  const darkBrass = brassMaterial({ color: 0x8e6a36, roughness: 0.42, aged: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.9, roughness: 0.45 });
  const gearBrass = brassMaterial({ color: 0x6a4e2a, roughness: 0.5, aged: 1 });
  gearBrass.envMapIntensity = 0.7;

  const fixed = new THREE.Group();      // yoke, outer ring, gears, pedestal
  const tilting = new THREE.Group();    // meridian ring + polar pivots (tilts with latitude)

  // Meridian ring: carries the polar pivots, tilts with the globe.
  const meridian = graduatedRing({ inner: 1.075, outer: 1.18, depth: 0.045, numerals: 36, brass });
  tilting.add(meridian);
  for (const sgn of [1, -1]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 24), steel);
    pin.position.set(0, sgn * 1.04, 0);
    tilting.add(pin);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.07, 32), brass);
    cap.position.set(0, sgn * 1.2, 0);
    cap.castShadow = true;
    tilting.add(cap);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 16), brass);
    knob.position.set(0, sgn * 1.25, 0);
    tilting.add(knob);
  }

  // Outer fixed graduated ring, turned a little so it reads as a 3D ellipse behind the globe.
  const outer = graduatedRing({ inner: 1.27, outer: 1.42, depth: 0.06, numerals: 72, label: 'WANDER · ANNO MDCCCXV', brass: darkBrass });
  outer.rotation.y = 0.32;
  outer.rotation.x = -0.08;
  outer.position.z = -0.12;
  fixed.add(outer);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const b = bolt(0.022, brass);
    b.position.set(Math.cos(a) * 1.345, Math.sin(a) * 1.345, 0.052);
    outer.add(b);
  }

  // Yoke: lower half-ring from pedestal to the horizontal bearings at ±x.
  const yokeGeo = new THREE.TorusGeometry(1.25, 0.035, 20, 128, Math.PI);
  const yoke = new THREE.Mesh(yokeGeo, darkBrass);
  yoke.rotation.z = Math.PI;
  yoke.scale.set(1, 1, 1.6);
  yoke.castShadow = true;
  fixed.add(yoke);
  for (const sgn of [1, -1]) {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 40), brass);
    housing.rotation.z = Math.PI / 2;
    housing.position.set(sgn * 1.23, 0, 0);
    housing.castShadow = true;
    fixed.add(housing);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 12, 40), darkBrass);
    collar.rotation.y = Math.PI / 2;
    collar.position.set(sgn * 1.3, 0, 0);
    fixed.add(collar);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const b = bolt(0.011, darkBrass);
      b.rotation.set(0, Math.PI / 2, 0);
      b.position.set(sgn * 1.3, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
      fixed.add(b);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 16), steel);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(sgn * 1.14, 0, 0);
    tilting.add(axle);
  }

  // Pedestal
  const profile = [
    [0.0, -2.35], [0.62, -2.35], [0.64, -2.3], [0.5, -2.24], [0.28, -2.18], [0.16, -2.0], [0.12, -1.75], [0.16, -1.62], [0.1, -1.5], [0.07, -1.3], [0.0, -1.28],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pedestal = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), darkBrass);
  pedestal.castShadow = true; pedestal.receiveShadow = true;
  fixed.add(pedestal);

  // Gear train on a rear plate; rotations are driven by the globe's spin/tilt.
  const gears = [];
  const gearSpecs = [
    { teeth: 40, radius: 0.46, pos: [-1.52, -0.7, -0.55], mat: gearBrass, ratio: 1 },
    { teeth: 18, radius: 0.215, pos: [-1.06, -1.1, -0.5], mat: brass, ratio: -40 / 18 },
    { teeth: 32, radius: 0.37, pos: [1.58, -0.85, -0.6], mat: gearBrass, ratio: -1.2 },
    { teeth: 14, radius: 0.17, pos: [1.2, -1.22, -0.52], mat: brass, ratio: 1.2 * 32 / 14 },
    { teeth: 56, radius: 0.62, pos: [1.25, 1.05, -0.95], mat: gearBrass, ratio: 0.5 },
  ];
  for (const spec of gearSpecs) {
    const g = new THREE.Mesh(gearGeometry({ teeth: spec.teeth, radius: spec.radius, thickness: 0.04, spokes: spec.teeth > 20 ? 6 : 0, hub: spec.radius * 0.25 }), spec.mat);
    g.position.set(...spec.pos);
    g.castShadow = true; g.receiveShadow = true;
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(spec.radius * 0.12, spec.radius * 0.14, 0.06, 24), brass);
    hubCap.rotation.x = Math.PI / 2;
    g.add(hubCap);
    fixed.add(g);
    gears.push({ mesh: g, ratio: spec.ratio });
  }

  return { fixed, tilting, gears, materials: { brass, darkBrass } };
}
