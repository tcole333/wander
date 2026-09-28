// Test-only, served by Vite. Read GPU pixels after the sources are released, then draw again.
import {
  CanvasTexture,
  DataTexture,
  GLSL3,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from 'three';
import { BORDER_FACES, BORDER_TEXELS } from '../src/data/borders';
import { FULLSCREEN_VERTEX, drawFullscreen } from '../src/gpu/fullscreen';
import { createSampler, rendererName } from '../src/gpu/poolReadback';
import {
  releaseCanvasAfterUpload,
  releaseDataAfterUpload,
  releaseGeometryAfterUpload,
} from '../src/gpu/uploadOnce';
import { createBorderUniforms, fillBorderField, uploadBorderFace } from '../src/look/bordersHook';
import { MemoryAccount } from '../src/perf/memory';

function probe() {
  const renderer = new WebGLRenderer();
  document.body.append(renderer.domElement);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const target = new WebGLRenderTarget(2, 2, { depthBuffer: false });
  const read = () => {
    const bytes = new Uint8Array(16);
    renderer.readRenderTargetPixels(target, 0, 0, 2, 2, bytes);
    return [...bytes];
  };
  const accountOf = (texture: Texture) => {
    const account = new MemoryAccount();
    account.texture('probe', texture);
    return account.report().totals;
  };
  const sample2d = (texture: Texture) => {
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: `precision highp float;
        uniform sampler2D field; out vec4 color;
        void main() { color = textureLod(field, vec2(0.5), 1.0); }`,
      uniforms: { field: { value: texture } },
    });
    drawFullscreen(renderer, material, target);
    const pixels = read();
    material.dispose();
    return pixels;
  };

  // The real six-face field and upload path, including the initial allocation without data.
  const uniforms = createBorderUniforms();
  const field = uniforms.lookBorderField.value;
  renderer.initTexture(field);
  const faces = new Uint8Array(16 + BORDER_FACES * BORDER_TEXELS ** 2).subarray(16);
  for (let face = 0; face < BORDER_FACES; face++) {
    faces.fill(17 + face * 31, face * BORDER_TEXELS ** 2, (face + 1) * BORDER_TEXELS ** 2);
  }
  fillBorderField(uniforms, faces);
  const retained: number[] = [];
  for (let face = 0; face < BORDER_FACES; face++) {
    uploadBorderFace(uniforms, face);
    renderer.initTexture(field);
    retained.push(accountOf(field).arrayBuffers);
  }
  const sampler = createSampler(renderer);
  const borderErrors = Array.from({ length: BORDER_FACES }, (_, slot) =>
    sampler.worst(
      field,
      {
        slot,
        lod: 0,
        texels: [BORDER_TEXELS, BORDER_TEXELS],
        offset: 0.5,
        points: [2, 2],
      },
      () => [17 + slot * 31],
      (value) => Math.round(value * 255),
    ),
  );

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillStyle = '#264b91';
  context.fillRect(0, 0, 8, 8);
  const canvasTexture = releaseCanvasAfterUpload(new CanvasTexture(canvas));
  renderer.initTexture(canvasTexture);
  const canvasPixels = [sample2d(canvasTexture), sample2d(canvasTexture)];

  const atlas = releaseDataAfterUpload(
    new DataTexture(new Uint8Array(64).fill(73), 8, 8, RedFormat),
  );
  atlas.generateMipmaps = true;
  atlas.magFilter = NearestFilter;
  atlas.needsUpdate = true;
  renderer.initTexture(atlas);
  const atlasPixels = [sample2d(atlas), sample2d(atlas)];

  const geometry = new PlaneGeometry(2, 2);
  releaseGeometryAfterUpload(geometry);
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: `precision highp float; out vec4 color;
      void main() { color = vec4(32.0, 64.0, 128.0, 255.0) / 255.0; }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const geometryPixels = Array.from({ length: 2 }, () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, new OrthographicCamera());
    renderer.setRenderTarget(null);
    return read();
  });
  const account = new MemoryAccount();
  account.geometry('geometry', geometry);
  const report = {
    renderer: rendererName(gl),
    retained,
    borderErrors,
    canvasPixels,
    atlasPixels,
    geometryPixels,
    canvas: accountOf(canvasTexture),
    atlas: accountOf(atlas),
    geometryBytes: account.report().totals.arrayBuffers,
    glError: gl.getError(),
  };
  sampler.dispose();
  for (const texture of [field, canvasTexture, atlas]) texture.dispose();
  geometry.dispose();
  material.dispose();
  target.dispose();
  renderer.dispose();
  return report;
}

export type CpuMemoryProbe = ReturnType<typeof probe>;
declare global {
  interface Window {
    cpuMemoryProbe?: CpuMemoryProbe;
  }
}
window.cpuMemoryProbe = probe();
