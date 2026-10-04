/**
 * The opcode-handler registry (plan 097/03 decision 2) — the extensibility keystone. Built-ins
 * (control flow, vars, stdlib) register here in this package; world handlers register over the
 * host facets; plan 05 adds the native-call domain. One id, one handler — a duplicate registration
 * is a programming error, not a merge.
 */
import type { Instruction } from '../core/decode';
import type { Operand } from '../core/operands';
import type { CleoHost } from './host.interface';
import type { CleoThread } from './thread';

export interface HandlerContext {
  /** Delta of the CURRENT tick, game ms — timed opcodes scale by it. */
  readonly deltaMs: number;
  readonly host: CleoHost;
  /** The runner's game-time clock, ms since start — WAIT arms against it. */
  readonly now: number;
  /** Deterministic-injectable random source (0208 and friends). */
  random(): number;
  /** `004F START_NEW_SCRIPT`: a fresh thread on the SAME script at a local label, args into its locals. */
  spawnAt(target: number, args: readonly Operand[]): void;
  readonly thread: CleoThread;
}

export type OpcodeHandler = (ctx: HandlerContext, instruction: Instruction) => OpcodeResult;

/** What an instruction did to the thread's flow. */
export type OpcodeResult = 'continue' | 'terminate' | 'yield';

export class HandlerRegistry {
  private readonly handlers = new Map<number, OpcodeHandler>();

  get(opcode: number): OpcodeHandler | undefined {
    return this.handlers.get(opcode);
  }

  has(opcode: number): boolean {
    return this.handlers.has(opcode);
  }

  /** Every registered id — the census join (plan 02's `status` column, plan 07's CI gate). */
  ids(): readonly number[] {
    return [...this.handlers.keys()];
  }

  register(opcode: number, handler: OpcodeHandler): void {
    if (this.handlers.has(opcode)) {
      throw new Error(`opcode ${opcode.toString(16)} registered twice`);
    }
    this.handlers.set(opcode, handler);
  }
}
