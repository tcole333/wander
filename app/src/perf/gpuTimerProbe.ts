// The GPU timer test's page logic (e2e/gpu-timer.html): time one and eight heavy full-target draws
// with GpuTimer, after warm-up rounds, and report every time that arrives. On a real GPU eight
// draws take about eight times one; the spec checks the timer works everywhere and scales there.
// Each group ends with a one-pixel readback, which ends its render pass (see gpuTimer.ts).
import { GpuTimer, type GpuTime } from './gpuTimer';

export interface GpuTimerReport {
  renderer: string;
  available: boolean;
  times: GpuTime[];
  voided: number;
  /** Whether a nested begin() threw, as it must. */
  nestingRefused: boolean;
  glError: number;
}

declare global {
  interface Window {
    /** Set by gpuTimerProbe.main.ts when e2e/gpu-timer.html loads. */
    gpuTimerProbe?: Promise<GpuTimerReport>;
  }
}

const SIZE = 1024;
const ROUNDS = 7;
const WARM_ROUNDS = 3;

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;
void main() {
  vec3 acc = vec3(gl_FragCoord.xy / ${SIZE}.0, 0.5);
  for (int i = 0; i < 64; i++) acc = fract(acc * 1.37 + sin(acc.zxy * 3.1));
  color = vec4(acc, 1.0);
}`;

export async function runGpuTimerProbe(): Promise<GpuTimerReport> {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('no WebGL 2');
  const timer = new GpuTimer(gl);
  setUp(gl);

  let nestingRefused = !timer.available;
  if (timer.available) {
    timer.begin('outer');
    try {
      timer.begin('inner');
    } catch {
      nestingRefused = true;
    }
    timer.end();
  }

  const times: GpuTime[] = [];
  const pixel = new Uint8Array(4);
  const draw = (label: string, count: number) => {
    timer.begin(label);
    for (let i = 0; i < count; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    timer.end();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  for (let round = 0; round < WARM_ROUNDS + ROUNDS; round++) {
    const warm = round < WARM_ROUNDS;
    draw(warm ? 'warm' : 'one', 1);
    draw(warm ? 'warm' : 'eight', 8);
    await nextFrame();
    times.push(...timer.poll());
  }
  // The last rounds' results arrive a frame or more late.
  const timed = () => times.filter((t) => t.label === 'one' || t.label === 'eight').length;
  for (let wait = 0; wait < 600 && timed() < 2 * ROUNDS; wait++) {
    await nextFrame();
    times.push(...timer.poll());
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const report = {
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    available: timer.available,
    times: times.filter((t) => t.label === 'one' || t.label === 'eight'),
    voided: timer.voided,
    nestingRefused,
    glError: gl.getError(),
  };
  timer.dispose();
  return report;
}

function setUp(gl: WebGL2RenderingContext): void {
  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, SIZE, SIZE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.viewport(0, 0, SIZE, SIZE);
  // Additive blending, so every stacked draw is shaded (see src/lab/uniformBranches.ts).
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
