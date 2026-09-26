// The spike's room, lamps and post chain (docs/reference/spike/src/main.js), copied for the look
// harness so it lights the globe exactly as the spike did: the museum environment through PMREM,
// the key SpotLight with its shadow, the rim DirectionalLight, the hemisphere light, ACES at 0.95,
// bloom, then the vignette and grain. The museum scene module replaces this in prototype.html.
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
  SpotLight,
  SRGBColorSpace,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const DEG = Math.PI / 180;

export interface SpikeStage {
  scene: Scene;
  camera: PerspectiveCamera;
  /** The globe hangs here: its local frame is the globe frame. */
  globeMount: Group;
  /** Turns the globe so (lon, lat) faces +Z, as the spike's gimbal did. */
  gimbal(lon: number, lat: number): void;
  setSize(width: number, height: number): void;
  render(timeMs: number): void;
}

export function createSpikeStage(renderer: WebGLRenderer): SpikeStage {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = backdropTexture();
  scene.environment = museumEnvironment(renderer);
  scene.environmentIntensity = 0.75;

  const size = renderer.getSize(new Vector2());
  const camera = new PerspectiveCamera(30, size.x / size.y, 0.005, 100);
  camera.position.set(0, 0, 6);

  const key = new SpotLight(0xffd6a8, 4.0, 0, 0.62, 0.85, 0);
  key.position.set(-4.2, 5.2, 9.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 20;
  scene.add(key, key.target);
  const rim = new DirectionalLight(0xffb77a, 0.7);
  rim.position.set(6, 2.5, -6);
  scene.add(rim);
  scene.add(new HemisphereLight(0x4a3c2c, 0x0a0705, 0.5));

  const tilt = new Group();
  const spin = new Group();
  scene.add(tilt);
  tilt.add(spin);

  const buffer = renderer.getDrawingBufferSize(new Vector2());
  const target = new WebGLRenderTarget(buffer.x, buffer.y, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new Vector2(buffer.x, buffer.y), 0.42, 0.45, 1.05));
  composer.addPass(new OutputPass());
  const finish = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      aspect: { value: size.x / size.y },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float aspect; uniform float time; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv); vec2 p = vUv - 0.5; p.x *= aspect;
        float v = smoothstep(1.05, 0.28, length(p)); c.rgb *= mix(0.28, 1.0, v);
        float g = fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (g - 0.5) * 0.02; gl_FragColor = c;
      }`,
  });
  composer.addPass(finish);
  const finishUniforms = finish.uniforms as { aspect: { value: number }; time: { value: number } };

  return {
    scene,
    camera,
    globeMount: spin,
    gimbal(lon, lat) {
      // The globe frame's longitude 0 faces +Z and north is +Y (streaming.md 3.0).
      tilt.rotation.x = lat * DEG;
      spin.rotation.y = -lon * DEG;
    },
    setSize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      finishUniforms.aspect.value = width / height;
    },
    render(timeMs) {
      finishUniforms.time.value = (timeMs % 1000) / 1000;
      composer.render();
    },
  };
}

function backdropTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D context');
  const g = ctx.createRadialGradient(560, 250, 20, 520, 320, 700);
  g.addColorStop(0, '#2a2016');
  g.addColorStop(0.35, '#17110b');
  g.addColorStop(1, '#050403');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A dark museum room with a few warm softboxes, prefiltered for PBR reflections. */
function museumEnvironment(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  env.add(
    new Mesh(
      new BoxGeometry(30, 16, 30),
      new MeshBasicMaterial({ color: 0x0c0906, side: BackSide }),
    ),
  );
  const panel = (
    w: number,
    h: number,
    at: [number, number, number],
    color: number,
    intensity: number,
  ) => {
    const material = new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(intensity),
      side: DoubleSide,
    });
    const mesh = new Mesh(new PlaneGeometry(w, h), material);
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(9, 4, [-8, 6, 9], 0xffc88a, 5.5); // key lamp
  panel(4, 10, [11, 1, -3], 0xff9448, 1.4); // warm side wall
  panel(14, 3, [0, -7.5, 4], 0x4a3320, 1.2); // table bounce
  panel(6, 3, [2, 7, -10], 0x8fa3b8, 0.35); // cool window far behind
  panel(18, 7, [0, 1.5, 14], 0xffb574, 0.55); // warm gallery wall behind the viewer
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return texture;
}
