// GPU time per labelled pass from EXT_disjoint_timer_query_webgl2 (streaming.md 5.8, 8.2 E1).
// TIME_ELAPSED queries only, one at a time: they cannot nest, and ANGLE on Metal gives timestamps
// 0 bits. Results arrive a frame or more later and are read by poll(); a disjoint GPU (a clock
// change, a context switch) voids every query in flight. Where the extension is missing, as in
// Safari and Firefox, the timer is inert and says so.
//
// On ANGLE's Metal backend a query separates only work in render passes of its own. Two groups of
// one and eight draws into the same target, with no pass break between them, measured 10 ms and
// 15 ms; ending each group's pass (a one-pixel readback) gave 1.2 ms and 9.1 ms. Time passes that
// draw to targets of their own, as the globe, post and shadow passes do.

/** EXT_disjoint_timer_query_webgl2's enums, which TypeScript's DOM types lack. */
interface TimerQueryExtension {
  TIME_ELAPSED_EXT: GLenum;
  GPU_DISJOINT_EXT: GLenum;
}

export interface GpuTime {
  label: string;
  ms: number;
}

export class GpuTimer {
  readonly #gl: WebGL2RenderingContext;
  readonly #ext: TimerQueryExtension | null;
  #active: { label: string; query: WebGLQuery } | null = null;
  #pending: { label: string; query: WebGLQuery }[] = [];
  /** Queries voided by a disjoint GPU. */
  voided = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  }

  get available(): boolean {
    return this.#ext !== null;
  }

  /** Starts timing `label`; throws if another pass is being timed, since queries cannot nest. */
  begin(label: string): void {
    if (!this.#ext) return;
    if (this.#active) throw new Error(`timing ${label} inside ${this.#active.label}`);
    const query = this.#gl.createQuery();
    this.#gl.beginQuery(this.#ext.TIME_ELAPSED_EXT, query);
    this.#active = { label, query };
  }

  end(): void {
    if (!this.#ext || !this.#active) return;
    this.#gl.endQuery(this.#ext.TIME_ELAPSED_EXT);
    this.#pending.push(this.#active);
    this.#active = null;
  }

  /** The passes whose times have arrived since the last poll, oldest first. */
  poll(): GpuTime[] {
    if (!this.#ext) return [];
    const gl = this.#gl;
    if (gl.getParameter(this.#ext.GPU_DISJOINT_EXT)) {
      for (const { query } of this.#pending) gl.deleteQuery(query);
      this.voided += this.#pending.length;
      this.#pending = [];
      return [];
    }
    const done: GpuTime[] = [];
    while (this.#pending.length > 0) {
      const head = this.#pending[0];
      if (!head || !gl.getQueryParameter(head.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = gl.getQueryParameter(head.query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(head.query);
      this.#pending.shift();
      done.push({ label: head.label, ms: nanoseconds / 1e6 });
    }
    return done;
  }

  dispose(): void {
    const gl = this.#gl;
    if (this.#active) gl.deleteQuery(this.#active.query);
    for (const { query } of this.#pending) gl.deleteQuery(query);
    this.#active = null;
    this.#pending = [];
  }
}
