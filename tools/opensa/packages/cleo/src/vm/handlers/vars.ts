import type { Instruction } from '../../core/decode';
/**
 * The var/arith/compare family the corpus uses (plan 097/03 decision 3, scoped by the plan 01
 * whitelist). Operand resolution is polymorphic (an lvar/var/number distinction is the DECODER's
 * concern), so the whole SCM grid collapses to int/float × operation — each id below is one cell
 * the corpus actually exercises.
 *
 * TIMED ops scale by the frame delta in SA timestep units: `ms_fTimeStep` = frame ms / 20 (one unit
 * = one 50 fps frame — gta-reversed `CTimer`). The 04 field checkpoint judges the wheel's speed.
 */
import type { HandlerContext } from '../registry';
import type { HandlerRegistry } from '../registry';

type Binary = (a: number, b: number) => number;
type Compare = (a: number, b: number) => boolean;

const TIMESTEP_MS = 20;

export function registerVars(registry: HandlerRegistry): void {
  const setInt = (ctx: HandlerContext, instruction: Instruction): 'continue' => {
    ctx.thread.writeInt(instruction.operands[0], ctx.thread.readInt(instruction.operands[1]));

    return 'continue';
  };
  const setFloat = (ctx: HandlerContext, instruction: Instruction): 'continue' => {
    ctx.thread.writeFloat(instruction.operands[0], ctx.thread.readFloat(instruction.operands[1]));

    return 'continue';
  };
  const applyInt =
    (op: Binary) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const target = instruction.operands[0];
      ctx.thread.writeInt(target, op(ctx.thread.readInt(target), ctx.thread.readInt(instruction.operands[1])) | 0);

      return 'continue';
    };
  const applyFloat =
    (op: Binary) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const target = instruction.operands[0];
      ctx.thread.writeFloat(target, op(ctx.thread.readFloat(target), ctx.thread.readFloat(instruction.operands[1])));

      return 'continue';
    };
  /** value × ms_fTimeStep — the SA "timed" scaling. */
  const applyTimedFloat =
    (op: Binary) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const target = instruction.operands[0];
      const scaled = ctx.thread.readFloat(instruction.operands[1]) * (ctx.deltaMs / TIMESTEP_MS);
      ctx.thread.writeFloat(target, op(ctx.thread.readFloat(target), scaled));

      return 'continue';
    };
  const compareInt =
    (op: Compare) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const result = op(ctx.thread.readInt(instruction.operands[0]), ctx.thread.readInt(instruction.operands[1]));
      ctx.thread.setCondition(result, instruction.negated);

      return 'continue';
    };
  const compareFloat =
    (op: Compare) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const result = op(ctx.thread.readFloat(instruction.operands[0]), ctx.thread.readFloat(instruction.operands[1]));
      ctx.thread.setCondition(result, instruction.negated);

      return 'continue';
    };

  const add: Binary = (a, b) => a + b;
  const sub: Binary = (a, b) => a - b;
  const mul: Binary = (a, b) => a * b;
  const div: Binary = (a, b) => a / b;
  const gt: Compare = (a, b) => a > b;
  const ge: Compare = (a, b) => a >= b;
  const eq: Compare = (a, b) => a === b;

  for (const id of [0x0006, 0x0085]) {
    registry.register(id, setInt);
  }
  for (const id of [0x0007, 0x0087]) {
    registry.register(id, setFloat);
  }
  for (const id of [0x000a, 0x005a]) {
    registry.register(id, applyInt(add));
  }
  for (const id of [0x000b, 0x005b]) {
    registry.register(id, applyFloat(add));
  }
  registry.register(0x000e, applyInt(sub));
  for (const id of [0x000f, 0x0063]) {
    registry.register(id, applyFloat(sub));
  }
  registry.register(0x0012, applyInt(mul));
  for (const id of [0x0013, 0x006b]) {
    registry.register(id, applyFloat(mul));
  }
  registry.register(0x0017, applyFloat(div));
  registry.register(0x0079, applyTimedFloat(add));
  registry.register(0x007f, applyTimedFloat(sub));
  for (const id of [0x0019, 0x001b, 0x001d]) {
    registry.register(id, compareInt(gt));
  }
  for (const id of [0x0021, 0x0023, 0x0025]) {
    registry.register(id, compareFloat(gt));
  }
  for (const id of [0x0029, 0x002b]) {
    registry.register(id, compareInt(ge));
  }
  registry.register(0x0034, compareFloat(ge));
  for (const id of [0x0038, 0x0039, 0x003b]) {
    registry.register(id, compareInt(eq));
  }
  registry.register(0x0043, compareFloat(eq));
  // 0097 ABS_LVAR_FLOAT — unary, in place.
  registry.register(0x0097, (ctx, instruction) => {
    const target = instruction.operands[0];
    ctx.thread.writeFloat(target, Math.abs(ctx.thread.readFloat(target)));

    return 'continue';
  });
}
