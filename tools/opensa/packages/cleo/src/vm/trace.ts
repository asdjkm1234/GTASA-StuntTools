/**
 * The tracer IS the debugger (plan 097/07 decision 2): a bounded ring of readable lines — every
 * dispatched instruction in the disasm contract format (Sanny name + operands), condition results,
 * and host effects (atlas ops as SYMBOLS, never raw addresses) indented under the instruction that
 * caused them. Off = one boolean check per instruction; the ring never grows past its capacity, so
 * leaving tracing on in the field cannot leak.
 */

export interface TraceEntry {
  /** Mutable on purpose: the runner appends the condition result AFTER dispatch, keeping one line
   *  per instruction (a separate result line would double the gate-poll noise). */
  line: string;
  readonly seq: number;
  readonly thread: string;
}

/** Sized for the F2 view: enough back-story around a fault, bounded for an always-on field ring. */
const DEFAULT_CAPACITY = 512;

export class TraceRing {
  /** Set by the runner before a thread's dispatches — host-effect lines attribute to it. */
  currentThread = '';
  enabled = false;

  private readonly entries: TraceEntry[] = [];
  /** Index of the OLDEST entry once the ring is full — a true ring, no per-push array shifting
   *  (rhino dispatches ~2 000 instructions per frame; a shift-based ring would move the whole
   *  buffer for each of them). */
  private head = 0;
  private seq = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  clear(): void {
    this.entries.length = 0;
    this.head = 0;
    this.seq = 0;
  }

  /** A host-side effect line (atlas op, fault note) — indented under the current instruction. */
  hostEffect(line: string): void {
    this.push(this.currentThread, `  ${line}`);
  }

  /** Record one line; returns the entry so the runner can append the condition result. */
  push(thread: string, line: string): TraceEntry | undefined {
    if (!this.enabled) {
      return undefined;
    }
    const entry: TraceEntry = { line, seq: this.seq, thread };
    this.seq += 1;
    if (this.entries.length < this.capacity) {
      this.entries.push(entry);
    } else {
      this.entries[this.head] = entry;
      this.head = (this.head + 1) % this.capacity;
    }

    return entry;
  }

  /** Oldest-first view, optionally one thread's story only. */
  snapshot(thread?: string): readonly TraceEntry[] {
    const ordered = [...this.entries.slice(this.head), ...this.entries.slice(0, this.head)];

    return thread === undefined ? ordered : ordered.filter((entry) => entry.thread === thread);
  }
}
