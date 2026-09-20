/**
 * One cooperative SCM thread (plan 097/03 decisions 3+5): instruction pointer over plan 01's
 * `offsetIndex`, 32 locals + 2 auto-advancing timers, condition flag with the ANDOR state machine,
 * a gosub stack and CLEO_CALL frames (fresh local frame per call, outputs copied back on return).
 *
 * The thread is also the handler context: operand→value resolution lives here because every read
 * and write needs the thread's locals plus the runner's shared globals.
 */
import type { DecodedScript } from '../core/decode';
import type { Operand } from '../core/operands';

import { VarSpace } from './var-space';

/** Locals 0-31 + TIMERA/TIMERB at 32/33 — the SA layout (exported: the authoring SDK's allocator pins to it). */
export const LOCAL_SLOTS = 34;
export const TIMER_A = 32;
/** String-var data-type bytes → byte width (numeric vars read 32-bit slots). */
const STRING_WIDTH: Readonly<Record<number, 8 | 16>> = { 0x0a: 8, 0x0b: 8, 0x10: 16, 0x11: 16 };
/** Array element stride in SLOTS per data-type byte (numeric 1, string8 2, string16 4). */
const ARRAY_STRIDE: Readonly<Record<number, number>> = {
  0x07: 1,
  0x08: 1,
  0x0c: 2,
  0x0d: 2,
  0x12: 4,
  0x13: 4,
};
/** Array-ref flags: bit 7 = the index variable is a GLOBAL var. */
const ARRAY_GLOBAL_INDEX = 0x80;

interface AndOrState {
  mode: 'and' | 'or';
  /** Conditions still expected in the group. */
  remaining: number;
  value: boolean;
}

interface CleoCallFrame {
  readonly kind: 'cleo-call';
  /** The caller's operands after `numArgs` inputs — CLEO_RETURN's values copy into these. */
  readonly outputs: readonly Operand[];
  readonly returnIp: number;
  readonly savedLocals: ArrayBuffer;
}

interface GosubFrame {
  readonly kind: 'gosub';
  readonly returnIp: number;
}

export class CleoThread {
  andOr: AndOrState | null = null;
  condition = false;
  /** Instructions this thread dispatched in the last runner tick — the F2 thread list reads it. */
  instructionsLastTick = 0;
  /** Index into `script.instructions` of the NEXT instruction to run. */
  ip = 0;
  readonly locals = new VarSpace(LOCAL_SLOTS);
  name: string;
  terminated = false;
  /** Game-time ms this thread sleeps until (WAIT); compared against the runner's clock. */
  wakeAt = 0;

  /** Byte offset of the instruction most recently dispatched — for located faults. */
  get currentOffset(): number {
    const instruction = this.script.instructions[Math.max(0, this.ip - 1)];

    return instruction ? instruction.offset : 0;
  }

  private readonly stack: (CleoCallFrame | GosubFrame)[] = [];

  constructor(
    readonly script: DecodedScript,
    private readonly globals: VarSpace,
    name: string,
  ) {
    this.name = name;
  }

  advanceTimers(deltaMs: number): void {
    this.locals.setInt(TIMER_A, this.locals.int(TIMER_A) + deltaMs);
    this.locals.setInt(TIMER_A + 1, this.locals.int(TIMER_A + 1) + deltaMs);
  }

  /** CLEO_CALL: push the caller's frame, copy `args` into a ZEROED local frame. A var arg copies its
   *  raw 32 bits (lossless for float-bearing slots — SCM types by opcode, not by slot); only a float
   *  IMMEDIATE needs the float write. */
  callWithFrame(target: number, args: readonly Operand[], outputs: readonly Operand[]): void {
    const values = args.map((arg) => this.readRaw(arg));
    this.stack.push({ kind: 'cleo-call', outputs, returnIp: this.ip, savedLocals: this.locals.snapshot() });
    this.locals.zero();
    values.forEach((arg, slot) => {
      if (arg.float) {
        this.locals.setFloat(slot, arg.value);
      } else {
        this.locals.setInt(slot, arg.value);
      }
    });
    this.jump(target);
  }

  gosub(target: number): void {
    this.stack.push({ kind: 'gosub', returnIp: this.ip });
    this.jump(target);
  }

  /**
   * Jump to a script-local byte offset. Custom-script labels are NEGATIVE (main.scm space is
   * positive and has no meaning here) — the absolute value must land exactly on an instruction.
   */
  jump(offset: number): void {
    const target = this.script.offsetIndex.get(Math.abs(offset));
    if (target === undefined) {
      throw new ThreadFault(`jump target ${offset} is not an instruction boundary`, this.name, this.currentOffset);
    }
    this.ip = target;
  }

  readFloat(operand: Operand): number {
    switch (operand.kind) {
      case 'float':
        return operand.value;
      case 'int':
        return operand.value;
      case 'string':
        throw new ThreadFault('string operand where a float is needed', this.name, this.currentOffset);
      default:
        return this.spaceOf(operand).float(this.slotOf(operand));
    }
  }

  readInt(operand: Operand): number {
    switch (operand.kind) {
      case 'float':
        return operand.value | 0;
      case 'int':
        return operand.value;
      case 'string':
        throw new ThreadFault('string operand where an int is needed', this.name, this.currentOffset);
      default:
        return this.spaceOf(operand).int(this.slotOf(operand));
    }
  }

  readString(operand: Operand): string {
    if (operand.kind === 'string') {
      return operand.value;
    }
    if (operand.kind === 'var') {
      const width = STRING_WIDTH[operand.type];
      if (width) {
        return this.spaceOf(operand).string(this.slotOf(operand), width);
      }
    }
    throw new ThreadFault('operand is not a string', this.name, this.currentOffset);
  }

  ret(): void {
    const frame = this.stack.pop();
    if (!frame || frame.kind !== 'gosub') {
      throw new ThreadFault('RETURN without a GOSUB frame', this.name, this.currentOffset);
    }
    this.ip = frame.returnIp;
  }

  /** CLEO_RETURN: restore the caller's locals, then write `values` into the call's output operands. */
  returnFromCall(values: readonly Operand[]): void {
    const frame = this.stack.pop();
    if (!frame || frame.kind !== 'cleo-call') {
      throw new ThreadFault('CLEO_RETURN without a CLEO_CALL frame', this.name, this.currentOffset);
    }
    const returned = values.map((value) => this.readRaw(value));
    this.locals.restore(frame.savedLocals);
    this.ip = frame.returnIp;
    frame.outputs.forEach((output, index) => {
      const value = returned[index];
      if (value === undefined) {
        throw new ThreadFault(
          `CLEO_RETURN carries ${returned.length} values but the call expects ${frame.outputs.length}`,
          this.name,
          this.currentOffset,
        );
      }
      if (value.float) {
        this.writeFloat(output, value.value);
      } else {
        this.writeInt(output, value.value);
      }
    });
  }

  /** A conditional's result, negation applied, folded into any active ANDOR group. */
  setCondition(result: boolean, negated: boolean): void {
    const value = negated ? !result : result;
    if (!this.andOr) {
      this.condition = value;

      return;
    }
    this.andOr.value = this.andOr.mode === 'and' ? this.andOr.value && value : this.andOr.value || value;
    this.andOr.remaining -= 1;
    this.condition = this.andOr.value;
    if (this.andOr.remaining <= 0) {
      this.andOr = null;
    }
  }

  /** `00D6 IF n`: 0 = single, 1-7 = AND of n+1, 21-27 = OR of n-19 (the SCM encoding). */
  startAndOr(code: number): void {
    if (code === 0) {
      this.andOr = null;

      return;
    }
    if (code >= 1 && code <= 7) {
      this.andOr = { mode: 'and', remaining: code + 1, value: true };

      return;
    }
    if (code >= 21 && code <= 27) {
      this.andOr = { mode: 'or', remaining: code - 19, value: false };

      return;
    }
    throw new ThreadFault(`IF group code ${code} is outside the SCM encoding`, this.name, this.currentOffset);
  }

  wait(ms: number, now: number): void {
    this.wakeAt = now + Math.max(0, ms);
  }

  writeFloat(operand: Operand, value: number): void {
    this.spaceOf(operand).setFloat(this.slotOf(operand), value);
  }

  writeInt(operand: Operand, value: number): void {
    this.spaceOf(operand).setInt(this.slotOf(operand), value);
  }

  writeString(operand: Operand, value: string): void {
    if (operand.kind !== 'var' && operand.kind !== 'array') {
      throw new ThreadFault('write target is not a variable', this.name, this.currentOffset);
    }
    const width = operand.kind === 'var' ? STRING_WIDTH[operand.type] : undefined;
    this.spaceOf(operand).setString(this.slotOf(operand), value, width ?? 16);
  }

  private readRaw(operand: Operand): { float: boolean; value: number } {
    return operand.kind === 'float'
      ? { float: true, value: this.readFloat(operand) }
      : { float: false, value: this.readInt(operand) };
  }

  private slotOf(operand: Operand): number {
    if (operand.kind === 'var') {
      return operand.index;
    }
    if (operand.kind === 'array') {
      const indexSpace = (operand.flags & ARRAY_GLOBAL_INDEX) !== 0 ? this.globals : this.locals;
      const index = indexSpace.int(operand.indexVar);
      const stride = ARRAY_STRIDE[operand.type] ?? 1;

      return operand.offset + index * stride;
    }
    throw new ThreadFault('operand is not a variable', this.name, this.currentOffset);
  }

  private spaceOf(operand: Operand): VarSpace {
    if (operand.kind === 'var' || operand.kind === 'array') {
      return operand.scope === 'global' ? this.globals : this.locals;
    }
    throw new ThreadFault('operand is not a variable', this.name, this.currentOffset);
  }
}

export class ThreadFault extends Error {
  constructor(message: string, thread: string, offset: number) {
    super(`[cleo] thread '${thread}' at offset ${offset}: ${message}`);
    this.name = 'ThreadFault';
  }
}
