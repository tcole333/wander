// One draw of a full-screen triangle into a render target, for GPU work outside the scene: a
// pool's warm() step, and the readback in the pool smoke test.
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  type Material,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/** The vertex shader for a GLSL3 RawShaderMaterial drawn by drawFullscreen. */
export const FULLSCREEN_VERTEX = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Draws `material` over all of `target`, then restores the renderer's previous target. */
export function drawFullscreen(
  renderer: WebGLRenderer,
  material: Material,
  target: WebGLRenderTarget,
): void {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const triangle = new Mesh(geometry, material);
  triangle.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(new Scene().add(triangle), new OrthographicCamera());
  renderer.setRenderTarget(previous);
  geometry.dispose();
}
