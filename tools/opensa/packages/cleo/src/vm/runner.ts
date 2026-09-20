/**
 * `ScriptRunner` (plan 097/03 decisions 5-7): the cooperative scheduler on GAME time. Time comes IN
 * as a delta — no `performance.now()` in the core (replays and tests feed synthetic deltas). Every
 * handler throw is caught HERE: the offending thread dies with a located fault and the tick returns
 * cleanly, because the host wiring runs inside `runFixedSteps` and a leaked throw would poison the
 * physics step (recon fact). An opcode nobody registered routes to `host.onUnimplemented` once per
 * id and — for conditionals — leaves the FINAL condition false (the tier-b default; plan 07's
 * policy refines it), so a script's own not-installed guard runs, same as real CLEO.
 */
import type { DecodedScript, Instruction } from '../core/decode';
import type { CleoHost } from './host.interface';
import type { TierResolution, UnimplementedTier } from './tiers';
import type { TraceRing } from './trace';

import { formatInstruction } from '../core/disasm';
import { opcodeDef } from '../core/opcode-table';
import { registerControlFlow } from './handlers/control-flow';
import { registerNatives } from './handlers/natives';
import { createStdlibState, registerStdlib } from './handlers/stdlib';
import { registerVars } from './handlers/vars';
import { registerWorld } from './handlers/world';
import { HandlerRegistry } from './registry';
import { CleoThread } from './thread';
import { tierOf } from './tiers';
import { VarSpace } from './var-space';

/** Global var slots ($n is u16 in the operand stream). */
const GLOBAL_SLOTS = 0x10000;
/**
 * Default per-thread per-tick instruction budget. Rhino — the corpus's worst case BY DESIGN — runs
 * its whole 2 085-instruction script per frame; 10 000 bounds a runaway at ~5× that headroom.
 */
const DEFAULT_BUDGET = 10_000;

export interface ScriptRunnerOptions {
  readonly host: CleoHost;
  /** Override the per-thread per-tick instruction budget (tests use small values). */
  readonly maxInstructionsPerTick?: number;
  /** Deterministic random source for 0208 and friends (defaults to Math.random). */
  readonly random?: () => number;
  /** Per-opcode tier overrides layered over {@link DECLARED_TIERS} (tests; a runtime policy later). */
  readonly tiers?: ReadonlyMap<number, UnimplementedTier>;
  /** The plan 07 tracer — instruction + condition lines land here while `trace.enabled`. */
  readonly trace?: TraceRing;
}

export interface ThreadFaultRecord {
  readonly message: string;
  readonly thread: string;
}

/** One unimplemented opcode the run actually hit — the coverage surface (plan 097/07 decision 4). */
export interface UnimplementedHit extends TierResolution {
  readonly count: number;
  readonly opcode: number;
}

export class ScriptRunner {
  /** Threads killed by a handler throw — located, observable, and the tick went on without them. */
  readonly faults: ThreadFaultRecord[] = [];
  readonly globals = new VarSpace(GLOBAL_SLOTS);
  /** Instructions dispatched across all threads in the last `tick` — the budget/rhino measurement. */
  instructionsLastTick = 0;
  readonly registry = new HandlerRegistry();

  get activeThreads(): readonly CleoThread[] {
    return this.threads.filter((thread) => !thread.terminated);
  }

  /** Every spawned thread, terminated included — the F2 thread list shows the dead ones as 'done'. */
  get allThreads(): readonly CleoThread[] {
    return this.threads;
  }
  /** The runner's game clock (ms) — the F2 view derives "sleeping for N ms" from it. */
  get now(): number {
    return this.clock;
  }
  private readonly budget: number;
  private clock = 0;
  private readonly host: CleoHost;
  private readonly random: () => number;

  private readonly reportedUnimplemented = new Set<number>();
  private readonly threads: CleoThread[] = [];
  private readonly tierOverrides: ReadonlyMap<number, UnimplementedTier> | undefined;
  private readonly trace: TraceRing | undefined;

  private readonly unimplementedHits = new Map<number, number>();

  constructor(options: ScriptRunnerOptions) {
    this.host = options.host;
    this.budget = options.maxInstructionsPerTick ?? DEFAULT_BUDGET;
    this.random = options.random ?? Math.random;
    this.tierOverrides = options.tiers;
    this.trace = options.trace;
    registerControlFlow(this.registry);
    registerVars(this.registry);
    registerStdlib(this.registry, createStdlibState());
    registerWorld(this.registry);
    registerNatives(this.registry);
  }

  /** Every unimplemented opcode this run hit, worst first — the F2/CI coverage read (plan 07). */
  coverage(): readonly UnimplementedHit[] {
    return [...this.unimplementedHits.entries()]
      .map(([opcode, count]) => ({ count, opcode, ...tierOf(opcode) }))
      .sort((a, b) => b.count - a.count);
  }

  dispose(): void {
    for (const thread of this.threads) {
      thread.terminated = true;
    }
    this.threads.length = 0;
  }

  /** Start a script as a new thread at instruction 0. */
  spawn(script: DecodedScript, name: string): CleoThread {
    const thread = new CleoThread(script, this.globals, name);
    this.threads.push(thread);

    return thread;
  }

  /**
   * The F2 debugger's step: dispatch exactly ONE instruction on the thread, wait state overridden —
   * a step during WAIT means "run the next instruction now", the debugger's meaning of the word.
   */
  step(thread: CleoThread): void {
    if (thread.terminated) {
      return;
    }
    if (this.trace?.enabled) {
      this.trace.currentThread = thread.name;
    }
    thread.wakeAt = this.clock;
    this.stepOnce(thread, 0);
  }

  /** One game step for every runnable thread. */
  tick(deltaMs: number): void {
    this.clock += deltaMs;
    this.instructionsLastTick = 0;
    for (const thread of this.threads) {
      if (thread.terminated) {
        continue;
      }
      thread.instructionsLastTick = 0;
      thread.advanceTimers(deltaMs);
      if (this.clock < thread.wakeAt) {
        continue;
      }
      this.run(thread, deltaMs);
    }
  }

  private dispatch(thread: CleoThread, instruction: Instruction, deltaMs: number): 'continue' | 'terminate' | 'yield' {
    const handler = this.registry.get(instruction.opcode);
    if (!handler) {
      return this.unimplemented(thread, instruction);
    }

    return handler(
      {
        deltaMs,
        host: this.host,
        now: this.clock,
        random: this.random,
        spawnAt: (target, args): void => {
          const spawned = new CleoThread(thread.script, this.globals, `${thread.name}+${target}`);
          args.forEach((arg, slot) => {
            if (arg.kind === 'float') {
              spawned.locals.setFloat(slot, thread.readFloat(arg));
            } else {
              spawned.locals.setInt(slot, thread.readInt(arg));
            }
          });
          spawned.jump(target);
          this.threads.push(spawned);
        },
        thread,
      },
      instruction,
    );
  }

  private run(thread: CleoThread, deltaMs: number): void {
    if (this.trace?.enabled) {
      this.trace.currentThread = thread.name;
    }
    for (let spent = 0; spent < this.budget; spent += 1) {
      if (this.stepOnce(thread, deltaMs) === 'stop') {
        return;
      }
    }
    // Budget exhausted: a WAIT-less loop yields here instead of hanging the tab (plan 03 decision 6).
  }

  /** Fetch + dispatch one instruction — the shared body of the tick loop and the F2 step. */
  private stepOnce(thread: CleoThread, deltaMs: number): 'continue' | 'stop' {
    const instruction = thread.script.instructions[thread.ip];
    if (!instruction) {
      // Fell off the end of the code region — the script is done (Sanny scripts normally
      // terminate explicitly; running off the end is treated the same, not as a fault).
      thread.terminated = true;

      return 'stop';
    }
    thread.ip += 1;
    this.instructionsLastTick += 1;
    thread.instructionsLastTick += 1;
    const entry = this.trace?.enabled ? this.trace.push(thread.name, formatInstruction(instruction)) : undefined;
    try {
      const result = this.dispatch(thread, instruction, deltaMs);
      if (entry && opcodeDef(instruction.opcode)?.condition) {
        // Appended AFTER dispatch so the gate's ANSWER is on the gate's own line — the windfarm
        // lesson: when headless and field disagree, it is the gate answers you diff.
        entry.line += ` -> ${thread.condition}`;
      }
      if (result === 'terminate') {
        thread.terminated = true;

        return 'stop';
      }
      if (result === 'yield') {
        return 'stop';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.faults.push({ message, thread: thread.name });
      this.trace?.push(thread.name, `  ! thread killed at offset ${instruction.offset}: ${message}`);
      // eslint-disable-next-line no-console -- a silently dead script is undiagnosable in the field
      console.warn(`[cleo] thread '${thread.name}' killed at offset ${instruction.offset}: ${message}`);
      thread.terminated = true;

      return 'stop';
    }

    return 'continue';
  }

  private unimplemented(thread: CleoThread, instruction: Instruction): 'continue' | 'terminate' {
    this.unimplementedHits.set(instruction.opcode, (this.unimplementedHits.get(instruction.opcode) ?? 0) + 1);
    if (!this.reportedUnimplemented.has(instruction.opcode)) {
      this.reportedUnimplemented.add(instruction.opcode);
      this.host.onUnimplemented(instruction.opcode, thread.name);
    }
    // The tier policy (plan 07 decision 4): override, else declared tier, else DB-condition → b, else noop.
    const override = this.tierOverrides?.get(instruction.opcode);
    const tier = override ?? tierOf(instruction.opcode).tier;
    if (tier === 'kill-thread') {
      this.faults.push({
        message: `opcode ${instruction.opcode.toString(16)} is tier kill-thread`,
        thread: thread.name,
      });
      // eslint-disable-next-line no-console -- a silently dead script is undiagnosable in the field
      console.warn(`[cleo] thread '${thread.name}' killed at offset ${instruction.offset}: unrunnable opcode`);

      return 'terminate';
    }
    const def = opcodeDef(instruction.opcode);
    if (tier === 'conditional-false' || def?.condition || instruction.negated) {
      // FINAL false, negation NOT applied — "the check did not pass", the deterministic tier-b default.
      thread.setCondition(false, false);
    }

    return 'continue';
  }
}
