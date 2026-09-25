// Does the driver skip a block behind a uniform that is off, or flatten the branch and pay for the
// block anyway? E1 asks this of ANGLE (streaming.md 8.2): the surface toggles its layers with
// uniforms in one program (5.8), which only works if a layer that is off costs nothing. Each family
// draws the same heavy block three ways:
//   on   compiled in, its uniform on
//   off  compiled in, its uniform off
//   out  compiled out
// and reports paidWhenOff = (off − out) / (on − out): 0 when the branch is skipped, 1 when flattened.
// Raw WebGL 2, so the answer is the driver's and not three's.

/**
 * `texture` samples with implicit derivatives inside the branch, `textureLod` with an explicit
 * level, and `layers` splits the work over eight blocks, each behind its own uniform, as the
 * surface's layer toggles are.
 */
export const FAMILIES = ['texture', 'textureLod', 'layers'] as const;
export type Family = (typeof FAMILIES)[number];
export type Variant = 'on' | 'off' | 'out';

export interface BranchOptions {
  /** The square target's side in pixels. */
  size: number;
  /** Full-target draws per timed sample. */
  draws: number;
  /** Timed samples per variant; variants take turns, so drift spreads over all of them. */
  trials: number;
  /** Loop iterations in the heavy block. */
  iterations: number;
}

export const DEFAULT_OPTIONS: BranchOptions = { size: 2048, draws: 20, trials: 9, iterations: 48 };

export interface BranchResult {
  family: Family;
  variant: Variant;
  /** Compile and link, measured synchronously on first use. */
  linkMs: number;
  /** Median over trials of the wall time from the first draw to a one-pixel readback, per draw. */
  wallMsPerDraw: number;
  /** Median over trials of TIME_ELAPSED per draw, where EXT_disjoint_timer_query_webgl2 exists. */
  gpuMsPerDraw: number | null;
}

export interface UniformBranchReport {
  renderer: string;
  timerQuery: boolean;
  options: BranchOptions;
  results: BranchResult[];
  /** Per family, from GPU time where the timer query exists and wall time elsewhere. */
  paidWhenOff: Record<Family, number>;
  glError: number;
}

declare global {
  interface Window {
    /** Set by uniformBranches.main.ts when e2e/lab/uniform-branches.html loads. */
    uniformBranches?: Promise<UniformBranchReport>;
  }
}

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

function fragment(family: Family, compiledIn: boolean, options: BranchOptions): string {
  const sample = family === 'textureLod' ? 'textureLod(noise, q, 0.0)' : 'texture(noise, q)';
  let blocks = '';
  if (compiledIn && family === 'layers') {
    blocks = Array.from(
      { length: 8 },
      (_, i) => `if (enabled[${i}] > 0.5) color += heavy(p, ${options.iterations / 8}, ${i}.0);`,
    ).join('\n  ');
  } else if (compiledIn) {
    blocks = `if (enabled[0] > 0.5) color += heavy(p, ${options.iterations}, 0.0);`;
  }
  return `#version 300 es
precision highp float;
uniform float enabled[8];
uniform sampler2D noise;
uniform vec2 seed;
out vec4 fragColor;
vec3 heavy(vec2 p, int n, float k) {
  vec3 acc = vec3(k);
  for (int i = 0; i < n; i++) {
    vec2 q = p * (1.0 + float(i) * 0.013) + seed + acc.xy * 0.01;
    acc += ${sample}.rgb * sin(q.x * 3.1 + acc.y);
    acc = fract(acc * 1.37 + cos(acc.zxy));
  }
  return acc;
}
void main() {
  vec2 p = gl_FragCoord.xy / ${options.size}.0;
  vec3 color = texture(noise, p).rgb * 0.1;
  ${blocks}
  fragColor = vec4(color * 0.001, 1.0);
}`;
}

/** EXT_disjoint_timer_query_webgl2's enums, which TypeScript's DOM types lack. */
interface TimerQuery {
  TIME_ELAPSED_EXT: GLenum;
  GPU_DISJOINT_EXT: GLenum;
}

interface Program {
  program: WebGLProgram;
  linkMs: number;
}

interface Case {
  family: Family;
  variant: Variant;
  program: Program;
  wall: number[];
  gpu: number[];
}

export async function runUniformBranches(options = DEFAULT_OPTIONS): Promise<UniformBranchReport> {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('no WebGL 2');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
  setUpTarget(gl, options.size);

  const cases: Case[] = [];
  for (const family of FAMILIES) {
    const compiledIn = link(gl, fragment(family, true, options));
    const compiledOut = link(gl, fragment(family, false, options));
    for (const variant of ['on', 'off', 'out'] as const) {
      const program = variant === 'out' ? compiledOut : compiledIn;
      cases.push({ family, variant, program, wall: [], gpu: [] });
    }
  }

  const pixel = new Uint8Array(4);
  // Times `options.draws` draws of one case: wall time to a one-pixel readback, and GPU time.
  const sample = async (item: Case, seed: number) => {
    const { program } = item.program;
    gl.useProgram(program);
    const enabled = new Float32Array(8).fill(item.variant === 'on' ? 1 : 0);
    gl.uniform1fv(gl.getUniformLocation(program, 'enabled'), enabled);
    gl.uniform1i(gl.getUniformLocation(program, 'noise'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'seed'), seed, seed / 2);
    const query = timer ? gl.createQuery() : null;
    if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const start = performance.now();
    for (let i = 0; i < options.draws; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (timer && query) gl.endQuery(timer.TIME_ELAPSED_EXT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const wall = (performance.now() - start) / options.draws;
    const gpu = timer && query ? await elapsedMs(gl, timer, query) : null;
    return { wall, gpu: gpu === null ? null : gpu / options.draws };
  };

  // Two untimed rounds warm every program, then the variants take turns.
  for (let round = 0; round < 2; round++) for (const item of cases) await sample(item, 0.1);
  for (let trial = 0; trial < options.trials; trial++) {
    for (const item of cases) {
      const { wall, gpu } = await sample(item, 0.2 + trial * 0.01);
      item.wall.push(wall);
      if (gpu !== null) item.gpu.push(gpu);
    }
  }

  const results = cases.map(({ family, variant, program, wall, gpu }) => ({
    family,
    variant,
    linkMs: round(program.linkMs),
    wallMsPerDraw: round(median(wall)),
    gpuMsPerDraw: gpu.length === options.trials ? round(median(gpu)) : null,
  }));
  const paidWhenOff = {} as Record<Family, number>;
  for (const family of FAMILIES) {
    const cost = (variant: Variant) => {
      const result = results.find((r) => r.family === family && r.variant === variant);
      if (!result) throw new Error(`no ${family} ${variant} result`);
      return result.gpuMsPerDraw ?? result.wallMsPerDraw;
    };
    paidWhenOff[family] = round((cost('off') - cost('out')) / (cost('on') - cost('out')));
  }
  return {
    renderer: rendererName(gl),
    timerQuery: timer !== null,
    options,
    results,
    paidWhenOff,
    glError: gl.getError(),
  };
}

/**
 * A square RGBA8 target with additive blending, so every draw is shaded: without blending, Apple's
 * OpenGL driver (Firefox on macOS) shades only the last of a stack of full-target draws.
 */
function setUpTarget(gl: WebGL2RenderingContext, size: number): void {
  const target = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.viewport(0, 0, size, size);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  const noiseSize = 256;
  const texels = new Uint8Array(noiseSize * noiseSize * 4);
  let state = 12345;
  for (let i = 0; i < texels.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    texels[i] = state >>> 24;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    noiseSize,
    noiseSize,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    texels,
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): Program {
  const start = performance.now();
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed');
    }
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
  }
  return { program, linkMs: performance.now() - start };
}

/** The query's elapsed milliseconds, or null if the GPU was disjoint while it ran. */
async function elapsedMs(
  gl: WebGL2RenderingContext,
  timer: TimerQuery,
  query: WebGLQuery,
): Promise<number | null> {
  while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean;
  const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
  gl.deleteQuery(query);
  return disjoint ? null : nanoseconds / 1e6;
}

function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
