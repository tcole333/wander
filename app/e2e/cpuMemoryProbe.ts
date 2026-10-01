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
import { FULLSCREEN_VERTEX, drawFullscreen } from '../src/gpu/fullscreen';
import { rendererName } from '../src/gpu/poolReadback';
import {
  releaseCanvasAfterUpload,
  releaseDataAfterUpload,
  releaseGeometryAfterUpload,
} from '../src/gpu/uploadOnce';
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
    canvasPixels,
    atlasPixels,
    geometryPixels,
    canvas: accountOf(canvasTexture),
    atlas: accountOf(atlas),
    geometryBytes: account.report().totals.arrayBuffers,
    glError: gl.getError(),
  };
  for (const texture of [canvasTexture, atlas]) texture.dispose();
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
