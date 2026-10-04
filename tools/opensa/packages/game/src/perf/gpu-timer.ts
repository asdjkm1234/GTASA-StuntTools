/**
 * Labelled GPU pass timings via `EXT_disjoint_timer_query_webgl2` (plan 063). One timer query may be active
 * at a time (the extension forbids nesting), results arrive frames later — {@link poll} drains finished
 * queries into an EMA per label. Missing extension → `available` is false and every call no-ops.
 */

/** The subset of WebGL2 the timer touches (narrow so tests can fake it). */
export interface TimerGl {
  beginQuery(target: number, query: WebGLQuery): void;
  createQuery(): null | WebGLQuery;
  deleteQuery(query: WebGLQuery): void;
  endQuery(target: number): void;
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
}

interface Pending {
  label: string;
  query: WebGLQuery;
}

interface TimerExt {
  GPU_DISJOINT_EXT: number;
  TIME_ELAPSED_EXT: number;
}

/** WebGL2 core enums (constant in the spec — no context needed). */
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

/** In-flight cap — a stalled GPU must not grow the queue without bound. */
const MAX_PENDING = 64;

/** New-sample weight of the per-label EMA (light smoothing over the async result stream). */
const EMA_ALPHA = 0.3;

export class GpuTimer {
  readonly available: boolean;
  /** Sampling switch — mirror of the perf HUD/bench state; off = zero queries issued. */
  enabled = false;

  private active: null | Pending = null;
  private readonly ext: null | TimerExt;
  private readonly gl: TimerGl;
  private readonly ms = new Map<string, number>();
  private readonly pending: Pending[] = [];

  private constructor(gl: TimerGl, ext: null | TimerExt) {
    this.gl = gl;
    this.ext = ext;
    this.available = ext !== null;
  }

  static create(gl: TimerGl): GpuTimer {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as null | TimerExt;

    return new GpuTimer(gl, ext);
  }

  /** Open a labelled timing scope. Ignored while another scope is open (no nesting) or over the cap. */
  begin(label: string): void {
    if (!this.enabled || !this.ext || this.active || this.pending.length >= MAX_PENDING) {
      return;
    }
    const query = this.gl.createQuery();
    if (!query) {
      return;
    }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  /** Close the open scope; the result is drained by a later {@link poll}. */
  end(): void {
    if (!this.ext || !this.active) {
      return;
    }
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Drain finished queries (call once per frame). A disjoint interval discards everything in flight. */
  poll(): void {
    if (!this.ext || this.pending.length === 0) {
      return;
    }
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) === true) {
      for (const entry of this.pending) {
        this.gl.deleteQuery(entry.query);
      }
      this.pending.length = 0;

      return;
    }
    while (this.pending.length > 0) {
      const head = this.pending[0];
      if (this.gl.getQueryParameter(head.query, QUERY_RESULT_AVAILABLE) !== true) {
        return; // results arrive in order — the head blocks the rest
      }
      const ns = Number(this.gl.getQueryParameter(head.query, QUERY_RESULT));
      this.gl.deleteQuery(head.query);
      this.pending.shift();
      const sample = ns / 1e6;
      const prev = this.ms.get(head.label);
      this.ms.set(head.label, prev === undefined ? sample : prev + (sample - prev) * EMA_ALPHA);
    }
  }

  /** EMA-smoothed milliseconds per label. */
  timings(): ReadonlyMap<string, number> {
    return this.ms;
  }
}
