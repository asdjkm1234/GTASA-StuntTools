/**
 * The native-call/memory opcodes (plan 097/05): thin routes onto the host's `memory` facade
 * (`AtlasMemory` in production and tests alike). `INT_ADD 0A8E` is deliberately PURE arithmetic —
 * the token encoding survives it, and the corpus mixes it freely with plain `000A` adds anyway.
 *
 * WRITE_MEMORY's value needs the raw FLOAT as well as the int bits: vandoor writes door ratios and
 * `-0.15` as float immediates, and `readInt` would truncate them.
 *
 * `0AA5`-`0AA8` hand the atlas its args in **C argument order, i.e. REVERSED from the script**.
 * That is CLEO's own marshalling, not a convenience: it collects the operands in stream order and
 * then pushes them upward (`lea ecx, arguments / push [ecx] / add ecx, 4`,
 * `CCustomOpcodeSystem.cpp`), so on a downward-growing stack the LAST listed operand lands at
 * `[esp]` and becomes the function's FIRST argument. The atlas rows are written against the real SA
 * signatures, so the reversal belongs here, once, rather than in every row.
 */
import type { Instruction } from '../../core/decode';
import type { NativeArg, NativeValue } from '../native-atlas';
import type { HandlerContext, HandlerRegistry } from '../registry';

const scratch = new DataView(new ArrayBuffer(4));

export function registerNatives(registry: HandlerRegistry): void {
  // 0A8E INT_ADD a b out — pure (tokens ride the arithmetic).
  registry.register(0x0a8e, (ctx, instruction) => {
    ctx.thread.writeInt(
      instruction.operands[2],
      (ctx.thread.readInt(instruction.operands[0]) + ctx.thread.readInt(instruction.operands[1])) | 0,
    );

    return 'continue';
  });

  // 0A8D READ_MEMORY address size vp out
  registry.register(0x0a8d, (ctx, instruction) => {
    const address = ctx.thread.readInt(instruction.operands[0]);
    const size = ctx.thread.readInt(instruction.operands[1]);
    writeValue(ctx, instruction.operands[3], ctx.host.memory.read(address, size));

    return 'continue';
  });

  // 0A8C WRITE_MEMORY address size value vp
  registry.register(0x0a8c, (ctx, instruction) => {
    const address = ctx.thread.readInt(instruction.operands[0]);
    const size = ctx.thread.readInt(instruction.operands[1]);
    const operand = instruction.operands[2];
    const float = ctx.thread.readFloat(operand);
    const int = operand.kind === 'float' ? floatBits(operand.value) : ctx.thread.readInt(operand);
    ctx.host.memory.write(address, size, { float, int });

    return 'continue';
  });

  // 0A97 GET_VEHICLE_POINTER handle out / 0AEB GET_VEHICLE_REF address out
  registry.register(0x0a97, (ctx, instruction) => {
    const car = ctx.thread.readInt(instruction.operands[0]);
    ctx.thread.writeInt(instruction.operands[1], ctx.host.memory.pointerOf(car));

    return 'continue';
  });
  registry.register(0x0aeb, (ctx, instruction) => {
    const handle = ctx.host.memory.handleOf(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeInt(instruction.operands[1], handle ?? -1);

    return 'continue';
  });

  // 0AA5-0AA8: head (address, [struct], numParams, pop) + numParams args + output vars + terminator.
  const nativeCall =
    (method: boolean, returns: boolean) =>
    (ctx: HandlerContext, instruction: Instruction): 'continue' => {
      const head = method ? 4 : 3;
      const address = ctx.thread.readInt(instruction.operands[0]);
      const struct = method ? ctx.thread.readInt(instruction.operands[1]) : null;
      const numParams = ctx.thread.readInt(instruction.operands[method ? 2 : 1]);
      const tail = instruction.operands.slice(head);
      const args = nativeArgs(ctx, tail.slice(0, numParams)).reverse();
      const result = ctx.host.memory.call(address, struct, args);
      const outputs = tail.slice(numParams);
      if (returns && outputs.length > 0) {
        writeValue(ctx, outputs[0], result);
      }

      return 'continue';
    };
  registry.register(0x0aa5, nativeCall(false, false)); // CALL_FUNCTION
  registry.register(0x0aa6, nativeCall(true, false)); // CALL_METHOD
  registry.register(0x0aa7, nativeCall(false, true)); // CALL_FUNCTION_RETURN
  registry.register(0x0aa8, nativeCall(true, true)); // CALL_METHOD_RETURN

  // 095F GET_DOOR_ANGLE_RATIO car door out — the honest opcode (no memory involved).
  registry.register(0x095f, (ctx, instruction) => {
    const ratio = ctx.host.vehicles.doorAngleRatio(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readInt(instruction.operands[1]),
    );
    ctx.thread.writeFloat(instruction.operands[2], ratio ?? 0);

    return 'continue';
  });
}

function floatBits(value: number): number {
  scratch.setFloat32(0, value, true);

  return scratch.getInt32(0, true);
}

function nativeArgs(ctx: HandlerContext, operands: readonly Instruction['operands'][number][]): NativeArg[] {
  return operands.map((operand) => {
    if (operand.kind === 'string') {
      return { kind: 'string', value: operand.value };
    }
    if (operand.kind === 'float') {
      return { kind: 'float', value: operand.value };
    }
    if (operand.kind === 'int') {
      return { kind: 'int', value: operand.value };
    }
    // A var's 32 bits carry no type — pass BOTH readings; the atlas row decides (an angle row reads
    // the float bits, a pointer row the int bits). Explicit, never guessed.

    return { float: ctx.thread.readFloat(operand), int: ctx.thread.readInt(operand), kind: 'raw' };
  });
}

function writeValue(ctx: HandlerContext, operand: Instruction['operands'][number], value: NativeValue): void {
  if (value === null) {
    ctx.thread.writeInt(operand, 0);
  } else if (value.kind === 'float') {
    ctx.thread.writeFloat(operand, value.value);
  } else {
    ctx.thread.writeInt(operand, value.value);
  }
}
