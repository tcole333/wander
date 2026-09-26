// The museum scene, ported from the spike (docs/reference/spike/src/main.js): a dark room lit by
// one warm lamp, the brass instrument in its gimbal, and the post chain (bloom, ACES tone mapping,
// a vignette and a little grain).
//
// The gimbal keeps the spike's arrangement: the yoke, outer ring, gears and pedestal stay put; a
// tilting group carries the meridian ring and globeMount; globeMount turns about the polar axis.
// params.lat and params.lon name the globe point the gimbal turns to face +Z, where the camera
// usually sits (both 0 leave the globe frame unturned).
import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { CreateMuseumScene } from '../contract';
import { instrumentOpacity, partOpacity } from './fade';
import { buildInstrument, type FadePart } from './instrument';

const DEG = Math.PI / 180;
const MAX_PIXEL_RATIO = 2;

function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  return meshes;
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** A warm pool of light off-center on a near-black wall. */
function backdropTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 640;
  const x = canvas.getContext('2d');
  if (!x) throw new Error('no 2D canvas context');
  const g = x.createRadialGradient(560, 250, 20, 520, 320, 700);
  g.addColorStop(0, '#2a2016');
  g.addColorStop(0.35, '#17110b');
  g.addColorStop(1, '#050403');
  x.fillStyle = g;
  x.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A dark room with a few warm softboxes, prefiltered for the brass's reflections. */
function museumEnvironment(renderer: WebGLRenderer): Texture {
  const room = new Scene();
  const walls = new Mesh(
    new BoxGeometry(30, 16, 30),
    new MeshBasicMaterial({ color: 0x0c0906, side: BackSide }),
  );
  room.add(walls);
  const panel = (
    w: number,
    h: number,
    position: [number, number, number],
    color: number,
    intensity: number,
  ) => {
    const material = new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(intensity),
      side: DoubleSide,
    });
    const mesh = new Mesh(new PlaneGeometry(w, h), material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(9, 4, [-8, 6, 9], 0xffc88a, 5.5); // the key lamp
  panel(4, 10, [11, 1, -3], 0xff9448, 1.4); // a warm side wall
  panel(14, 3, [0, -7.5, 4], 0x4a3320, 1.2); // bounce off the table
  panel(6, 3, [2, 7, -10], 0x8fa3b8, 0.35); // a cool window far behind
  panel(18, 7, [0, 1.5, 14], 0xffb574, 0.55); // the warm gallery wall behind the viewer
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  for (const mesh of meshesOf(room)) {
    mesh.geometry.dispose();
    for (const material of materialsOf(mesh)) material.dispose();
  }
  return texture;
}

/** A fade part with its own copies of its materials, so its opacity is its own. */
class Fader {
  readonly part: FadePart;
  readonly #materials: Material[];
  readonly #casters: Mesh[] = [];
  readonly #point = new Vector3();

  constructor(part: FadePart) {
    this.part = part;
    const copies = new Map<Material, Material>();
    const copy = (material: Material) => {
      const known = copies.get(material);
      if (known) return known;
      const made = material.clone();
      copies.set(material, made);
      return made;
    };
    for (const mesh of meshesOf(part.object)) {
      const material = mesh.material;
      mesh.material = Array.isArray(material) ? material.map(copy) : copy(material);
      if (mesh.castShadow) this.#casters.push(mesh);
    }
    this.#materials = [...copies.values()];
  }

  /** How far `eye` (world space) is from the part's surface; needs a current matrixWorld. */
  gap(eye: Vector3): number {
    let nearest = Infinity;
    for (const sample of this.part.samples) {
      const point = this.#point.copy(sample).applyMatrix4(this.part.object.matrixWorld);
      nearest = Math.min(nearest, point.distanceTo(eye));
    }
    return nearest - this.part.halfWidth;
  }

  apply(opacity: number) {
    this.part.object.visible = opacity > 0.001;
    const transparent = opacity < 1;
    for (const material of this.#materials) {
      material.opacity = opacity;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }
    // A fading part stops casting its shadow halfway.
    for (const mesh of this.#casters) mesh.castShadow = opacity > 0.5;
  }
}

const FINISH_VERTEX = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Darkens toward the corners and adds a faint animated grain, after tone mapping. */
const FINISH_FRAGMENT = `uniform sampler2D tDiffuse;
uniform float aspect;
uniform float time;
uniform float vignette;
uniform float grain;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 p = vUv - 0.5;
  p.x *= aspect;
  float v = 1.0 - smoothstep(0.28, 1.05, length(p));
  c.rgb *= mix(1.0 - vignette, 1.0, v);
  float g = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
  c.rgb += (g - 0.5) * grain;
  gl_FragColor = c;
}`;

export const createMuseumScene: CreateMuseumScene = (renderer) => {
  const params = {
    exposure: 0.95,
    keyIntensity: 4.0,
    rimIntensity: 0.7,
    hemiIntensity: 0.5,
    envIntensity: 0.75,
    bloomStrength: 0.42,
    bloomRadius: 0.45,
    bloomThreshold: 1.05,
    vignette: 0.72,
    grain: 0.02,
    ringsVisible: true,
    instrumentVisible: true,
    shadows: true,
    /** The globe point the gimbal turns toward +Z, in degrees. */
    lat: 15,
    lon: 75,
    /** A part fades out as the camera comes within fadeFar of it, and is gone at fadeNear. */
    fadeNear: 0.25,
    fadeFar: 0.8,
    /** The instrument is gone once the camera is this many radii above the globe's surface. */
    hideAltitude: 0.3,
  };

  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = params.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const backdrop = backdropTexture();
  scene.background = backdrop;
  scene.environment = museumEnvironment(renderer);
  scene.environmentIntensity = params.envIntensity;

  // One warm museum lamp high to the left, a warm rim from behind, and a faint room fill.
  const key = new SpotLight(0xffd6a8, params.keyIntensity, 0, 0.62, 0.85, 0);
  key.position.set(-4.2, 5.2, 9.5);
  key.castShadow = params.shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 20;
  const rim = new DirectionalLight(0xffb77a, params.rimIntensity);
  rim.position.set(6, 2.5, -6);
  const hemi = new HemisphereLight(0x4a3c2c, 0x0a0705, params.hemiIntensity);
  scene.add(key, key.target, rim, hemi);

  const instrument = buildInstrument();
  const tiltGroup = new Group();
  const globeMount = new Group();
  tiltGroup.add(instrument.tilting, globeMount);
  scene.add(instrument.fixed, tiltGroup);
  const faders = instrument.fadeParts.map((part) => new Fader(part));

  const size = renderer.getSize(new Vector2());
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, new PerspectiveCamera());
  const bloom = new UnrealBloomPass(
    new Vector2(1, 1),
    params.bloomStrength,
    params.bloomRadius,
    params.bloomThreshold,
  );
  const output = new OutputPass();
  const finishUniforms = {
    tDiffuse: { value: null },
    aspect: { value: size.x / Math.max(1, size.y) },
    time: { value: 0 },
    vignette: { value: params.vignette },
    grain: { value: params.grain },
  };
  const finish = new ShaderPass(
    new ShaderMaterial({
      uniforms: finishUniforms,
      vertexShader: FINISH_VERTEX,
      fragmentShader: FINISH_FRAGMENT,
    }),
  );
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(finish);

  const setSize = (width: number, height: number, pixelRatio: number) => {
    const ratio = Math.min(pixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    finishUniforms.aspect.value = width / Math.max(1, height);
  };
  setSize(size.x, size.y, renderer.getPixelRatio());

  const eye = new Vector3();
  const center = new Vector3();

  return {
    scene,
    globeMount,
    params,

    update(camera, elapsedS) {
      renderer.toneMappingExposure = params.exposure;
      key.intensity = params.keyIntensity;
      key.castShadow = params.shadows;
      rim.intensity = params.rimIntensity;
      hemi.intensity = params.hemiIntensity;
      scene.environmentIntensity = params.envIntensity;
      bloom.strength = params.bloomStrength;
      bloom.radius = params.bloomRadius;
      bloom.threshold = params.bloomThreshold;
      finishUniforms.vignette.value = params.vignette;
      finishUniforms.grain.value = params.grain;
      finishUniforms.time.value = elapsedS % 1;

      // The gimbal: tilt about the bearings' axis, spin about the pole; the gears follow both
      // (driven from the spike's spin angle, so they sit as in its screenshots).
      tiltGroup.rotation.x = params.lat * DEG;
      globeMount.rotation.y = -params.lon * DEG;
      const drive = -(params.lon + 90) * DEG * 0.35 + tiltGroup.rotation.x;
      for (const gear of instrument.gears) gear.mesh.rotation.z = drive * gear.ratio;

      scene.updateMatrixWorld();
      camera.getWorldPosition(eye);
      globeMount.getWorldPosition(center);
      const whole = instrumentOpacity(eye.distanceTo(center) - 1, params.hideAltitude);
      for (const fader of faders) {
        const isRing = instrument.rings.includes(fader.part.object);
        const shown = whole > 0 && params.instrumentVisible && (params.ringsVisible || !isRing);
        const near = shown ? partOpacity(fader.gap(eye), params.fadeNear, params.fadeFar) : 0;
        fader.apply(whole * near);
      }
    },

    setSize,

    render(camera) {
      renderPass.camera = camera;
      composer.render();
    },

    dispose() {
      composer.dispose();
      bloom.dispose();
      output.dispose();
      finish.dispose();
      const textures = new Set<Texture>();
      const meshes = [...meshesOf(instrument.fixed), ...meshesOf(instrument.tilting)];
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        for (const material of materialsOf(mesh)) {
          for (const value of Object.values(material)) {
            if (value instanceof CanvasTexture) textures.add(value);
          }
          material.dispose();
        }
      }
      for (const texture of textures) texture.dispose();
      scene.environment?.dispose();
      backdrop.dispose();
      key.dispose();
      rim.dispose();
      hemi.dispose();
    },
  };
};
