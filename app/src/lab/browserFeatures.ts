// What a browser offers that the design leans on or checks (streaming.md 5.1, 5.8, 8.2 E1): the
// idle-work APIs, the decompression formats, the WebGL 2 limits and extensions, and the timer's
// resolution, which bounds what wall-clock timings can show.

export interface BrowserFeatures {
  requestIdleCallback: boolean;
  schedulerPostTask: boolean;
  /** DecompressionStream formats; tiles inflate with gzip (3.1), and E1 weighs zstd. */
  decompression: { gzip: boolean; zstd: boolean };
  crossOriginIsolated: boolean;
  /** The smallest step performance.now() takes, in milliseconds. */
  timerResolutionMs: number;
  hardwareConcurrency: number;
  devicePixelRatio: number;
  webgl2: WebGl2Features | null;
}

export interface WebGl2Features {
  renderer: string;
  vendor: string;
  version: string;
  limits: Record<(typeof LIMITS)[number], number>;
  /** Timer-query bit counts, where EXT_disjoint_timer_query_webgl2 exists. */
  timerBits: { elapsed: number; timestamp: number } | null;
  extensions: string[];
}

declare global {
  interface Window {
    /** Set by browserFeatures.main.ts when e2e/lab/browser-features.html loads. */
    browserFeatures?: Promise<BrowserFeatures>;
  }
}

const LIMITS = [
  'MAX_TEXTURE_SIZE',
  'MAX_3D_TEXTURE_SIZE',
  'MAX_ARRAY_TEXTURE_LAYERS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS',
  'MAX_SAMPLES',
  'MAX_DRAW_BUFFERS',
  'MAX_RENDERBUFFER_SIZE',
] as const;

// EXT_disjoint_timer_query_webgl2's enums, which TypeScript's DOM types lack.
const QUERY_COUNTER_BITS_EXT = 0x8864;
const TIME_ELAPSED_EXT = 0x88bf;
const TIMESTAMP_EXT = 0x8e28;

export function detectBrowserFeatures(): BrowserFeatures {
  return {
    requestIdleCallback: 'requestIdleCallback' in window,
    schedulerPostTask:
      'scheduler' in window &&
      typeof (window as { scheduler?: { postTask?: unknown } }).scheduler?.postTask === 'function',
    decompression: { gzip: decompresses('gzip'), zstd: decompresses('zstd') },
    crossOriginIsolated: window.crossOriginIsolated,
    timerResolutionMs: timerResolution(),
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    webgl2: webGl2Features(),
  };
}

function decompresses(format: string): boolean {
  try {
    new DecompressionStream(format as CompressionFormat);
    return true;
  } catch {
    return false;
  }
}

function timerResolution(): number {
  let smallest = Infinity;
  let last = performance.now();
  for (let i = 0; i < 200_000 && smallest > 0.001; i++) {
    const now = performance.now();
    if (now > last) smallest = Math.min(smallest, now - last);
    last = now;
  }
  return Math.round(smallest * 1e6) / 1e6;
}

function webGl2Features(): WebGl2Features | null {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as object | null;
  const limits = {} as WebGl2Features['limits'];
  for (const name of LIMITS) limits[name] = Number(gl.getParameter(gl[name]));
  const bits = (target: number) => Number(gl.getQuery(target, QUERY_COUNTER_BITS_EXT));
  return {
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
    version: String(gl.getParameter(gl.VERSION)),
    limits,
    timerBits: timer ? { elapsed: bits(TIME_ELAPSED_EXT), timestamp: bits(TIMESTAMP_EXT) } : null,
    extensions: (gl.getSupportedExtensions() ?? []).sort(),
  };
}
