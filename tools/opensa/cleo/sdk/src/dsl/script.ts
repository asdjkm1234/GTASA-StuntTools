/**
 * The typed authoring surface (plan cleo-sdk/004): a script is a plain TS module exporting `script` —
 * a {@link ScriptDefinition}; its `build` callback drives this builder, which produces the
 * assembler's IR. No new language, no parser — and no construct hides the bytecode model: the
 * disasm listing snapshot is the review surface, so every sugar lowers to instructions the author
 * can predict (if/else to the SCM `00D6 IF` + `004D GOTO_IF_FALSE` convention).
 */
import type { Operand } from '@opensa/cleo';

import { opcodeDef } from '@opensa/cleo';

import type { ScriptTarget } from '../whitelist/gate';

import { LvarAllocator, type LvarKind } from '../assemble/lvars';
import {
  gvar,
  instruction,
  int,
  IrError,
  type IrInstruction,
  type IrOperand,
  labelRef,
  lvar,
  lvarStr8,
  str8,
} from '../ir';

/** SA thread names are 7 chars + NUL (`03A4 SCRIPT_NAME` carries an 8-byte string). */
const SCM_NAME_LIMIT = 7;
const MAX_CONDITIONS = 8;

const OP_WAIT = 0x0001;
const OP_GOTO = 0x0002;
const OP_GOTO_IF_FALSE = 0x004d;
const OP_IF = 0x00d6;
const OP_SCRIPT_NAME = 0x03a4;

export interface BuiltScript {
  readonly instructions: readonly IrInstruction[];
  readonly target: ScriptTarget;
  /** Heuristic findings (e.g. a backwards jump enclosing no WAIT) — the build prints them. */
  readonly warnings: readonly string[];
}

export interface ScriptDefinition {
  /** Declared per-frame instruction budget — the story test asserts the measured cost against it. */
  readonly budgetPerTick: number;
  readonly build: (s: ScriptBuilder) => void;
  /** The artifact name (`<name>.cs` / `<name>.<target>.cs`) and the source folder's name. */
  readonly name: string;
  /** The SCM thread name (7 chars max); defaults to `name` truncated. */
  readonly scmName?: string;
  /**
   * Default `dual` — the whitelist gate holds both runtimes unless a single-runtime target is
   * declared (`opensa-only` lifts the real-CLEO half, `sa-only` lifts the VM half).
   */
  readonly target?: ScriptTarget;
}

interface BranchOptions {
  /** OR the conditions instead of AND. */
  readonly any?: boolean;
  readonly else?: () => void;
  readonly then: () => void;
}

interface LoopOptions {
  /** Suppress the missing-WAIT warning for this loop's backwards jump (stated heuristic). */
  readonly noWaitWarning?: boolean;
}

interface WhileOptions extends LoopOptions {
  /** OR the conditions instead of AND. */
  readonly any?: boolean;
}

export class ScriptBuilder {
  readonly warnings: string[] = [];
  private ifCounter = 0;
  private readonly instructions: IrInstruction[] = [];
  private readonly localOperands = new Map<string, Operand>();
  private readonly locals = new LvarAllocator();
  private readonly noWarnJumps = new Set<number>();
  private pendingLabels: string[] = [];

  /** Close the build: trailing labels are an error; backwards jumps are checked for a WAIT. */
  finalize(): readonly IrInstruction[] {
    if (this.pendingLabels.length > 0) {
      throw new IrError(`label(s) ${this.pendingLabels.join(', ')} queued after the last instruction`);
    }
    this.checkBackwardsJumps();

    return this.instructions;
  }

  /**
   * A global numeric variable by its RAW stream u16 — on real SA that is the BYTE offset, i.e.
   * `$n` × 4 (`$409` → 1636). Passing the `$n` slot number reads garbage inside `$(n/4)` — it cost
   * a game crash in the field (cutscene-override round 7). The disasm prints the raw value.
   */
  global(index: number): Operand {
    return gvar(index);
  }

  /** Structured branch: `00D6 IF` + conditions + `004D GOTO_IF_FALSE`, labels generated. */
  if(conditions: () => void, branches: BranchOptions): void {
    const id = this.ifCounter;
    this.ifCounter += 1;
    const elseLabel = `__if${id}_else`;
    const endLabel = `__if${id}_end`;
    const savedLabels = this.pendingLabels;
    this.pendingLabels = [];

    const start = this.instructions.length;
    conditions();
    const count = this.instructions.length - start;
    if (count < 1 || count > MAX_CONDITIONS) {
      throw new IrError(`if() takes 1-${MAX_CONDITIONS} conditions, got ${count}`);
    }
    for (const ins of this.instructions.slice(start)) {
      if (!opcodeDef(ins.opcode)?.condition) {
        throw new IrError(`if() condition ${opcodeDef(ins.opcode)?.name ?? ins.opcode} is not a condition opcode`);
      }
    }
    // The SCM group code: 0 = single, 1-7 = AND of n+1, 21-27 = OR of n-19.
    const code = count === 1 ? 0 : branches.any === true ? 19 + count : count - 1;
    this.instructions.splice(start, 0, instruction(OP_IF, [int(code)], { labels: savedLabels }));

    this.op(OP_GOTO_IF_FALSE, labelRef(branches.else ? elseLabel : endLabel));
    branches.then();
    if (branches.else) {
      this.op(OP_GOTO, labelRef(endLabel));
      this.label(elseLabel);
      branches.else();
    }
    this.label(endLabel);
  }

  /** Queue a label for the NEXT emitted instruction. */
  label(name: string): void {
    this.pendingLabels.push(name);
  }

  /** A named local (numeric slot, allocated on first use, declaration-ordered). */
  local(name: string): Operand {
    return this.namedLocal(name, 'int');
  }

  /** A named local short-string (8 bytes, two slots) — CLEO string reads (`0AF4`) land here. */
  localString(name: string): Operand {
    return this.namedLocal(name, 'string8');
  }

  /** Infinite loop: `label; body; GOTO label`. */
  loop(body: () => void, options: LoopOptions = {}): void {
    const label = `__loop${this.ifCounter}`;
    this.ifCounter += 1;
    this.label(label);
    body();
    this.op(OP_GOTO, labelRef(label));
    if (options.noWaitWarning === true) {
      this.noWarnJumps.add(this.instructions.length - 1);
    }
  }

  /** Negated condition (the 0x8000 stream bit). */
  not(opcode: number | string, ...operands: IrOperand[]): void {
    this.append(instruction(opcode, operands, { labels: this.takeLabels(), negated: true }));
  }

  /** Emit one instruction, opcode by Sanny name or raw id — arity-checked, nothing bypasses the gate. */
  op(opcode: number | string, ...operands: IrOperand[]): void {
    this.append(instruction(opcode, operands, { labels: this.takeLabels() }));
  }

  /** `0001 WAIT` — the cooperative heartbeat. */
  wait(ms: number): void {
    this.op(OP_WAIT, int(ms));
  }

  /** Conditional loop: runs while the conditions hold (exit via the if's own end label). */
  while(conditions: () => void, body: () => void, options: WhileOptions = {}): void {
    const id = this.ifCounter;
    this.ifCounter += 1;
    const top = `__while${id}_top`;
    this.label(top);
    this.if(conditions, {
      any: options.any,
      then: () => {
        body();
        this.op(OP_GOTO, labelRef(top));
        if (options.noWaitWarning === true) {
          this.noWarnJumps.add(this.instructions.length - 1);
        }
      },
    });
  }

  private append(ins: IrInstruction): void {
    this.instructions.push(ins);
  }

  /** The classic authored-script bug: a busy loop. Heuristic (index-level), suppressible per site. */
  private checkBackwardsJumps(): void {
    const labelIndex = new Map<string, number>();
    this.instructions.forEach((ins, index) => {
      for (const label of ins.labels) {
        labelIndex.set(label, index);
      }
    });
    this.instructions.forEach((ins, index) => {
      if (this.noWarnJumps.has(index)) {
        return;
      }
      for (const operand of ins.operands) {
        if (operand.kind !== 'label') {
          continue;
        }
        const target = labelIndex.get(operand.name);
        if (target === undefined || target > index) {
          continue;
        }
        const enclosesWait = this.instructions.slice(target, index).some((i) => i.opcode === OP_WAIT);
        if (!enclosesWait) {
          this.warnings.push(
            `backwards jump to "${operand.name}" (instruction ${index}) encloses no WAIT — a busy loop starves the scheduler (suppress with noWaitWarning if intended)`,
          );
        }
      }
    });
  }

  /** One namespace for named locals; asking for the same name as a different kind is an error. */
  private namedLocal(name: string, kind: LvarKind): Operand {
    const existing = this.localOperands.get(name);
    if (existing) {
      const expected = kind === 'int' ? lvar(0).type : lvarStr8(0).type;
      if (existing.type !== expected) {
        throw new IrError(`local "${name}" was allocated as a different kind`);
      }

      return existing;
    }
    const operand = kind === 'int' ? lvar(this.locals.alloc(name, kind)) : lvarStr8(this.locals.alloc(name, kind));
    this.localOperands.set(name, operand);

    return operand;
  }

  private takeLabels(): readonly string[] {
    const labels = this.pendingLabels;
    this.pendingLabels = [];

    return labels;
  }
}

/** Run the definition's build callback and return validated IR (SCRIPT_NAME auto-emitted first). */
export function buildScript(definition: ScriptDefinition): BuiltScript {
  defineScript(definition);
  const builder = new ScriptBuilder();
  builder.op(OP_SCRIPT_NAME, str8(definition.scmName ?? definition.name.slice(0, SCM_NAME_LIMIT)));
  definition.build(builder);

  return {
    instructions: builder.finalize(),
    target: definition.target ?? 'dual',
    warnings: builder.warnings,
  };
}

/** Identity with the definition's shape validated once, at module load. */
export function defineScript(definition: ScriptDefinition): ScriptDefinition {
  if (!/^[a-z0-9-]+$/.test(definition.name)) {
    throw new IrError(`script name "${definition.name}" must be kebab-case (it becomes the artifact name)`);
  }
  const scmName = definition.scmName ?? definition.name.slice(0, SCM_NAME_LIMIT);
  if (scmName.length > SCM_NAME_LIMIT) {
    throw new IrError(`scmName "${scmName}" exceeds ${SCM_NAME_LIMIT} chars (SA thread names are 7 + NUL)`);
  }
  if (!Number.isInteger(definition.budgetPerTick) || definition.budgetPerTick <= 0) {
    throw new IrError(`budgetPerTick must be a positive integer, got ${definition.budgetPerTick}`);
  }

  return definition;
}
