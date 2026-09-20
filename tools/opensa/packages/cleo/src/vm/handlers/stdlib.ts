import type { Instruction } from '../../core/decode';
/**
 * The stdlib domain (plan 097/03 decision 4): engine-independent CLEO+/NewOpcodes the corpus uses,
 * implemented IN the VM — no host round-trip for things with no engine meaning. Scratch memory is
 * plain ArrayBuffers behind TOKENS, never the native address space: a struct op on a value that is
 * not a token (cardoor reads a native task pointer) routes through the plan 05 memory facade — a
 * nameable address resolves, anything else is a REPORTED atlas miss answering 0 (097/07).
 */
import type { HandlerContext, HandlerRegistry } from '../registry';

/** Token bases keep stdlib handles visibly outside any plausible SA address (< 0x00400000). */
const BUFFER_TOKEN_BASE = 0x40000000;
const LIST_TOKEN_BASE = 0x4c000000;

/** Ken Perlin's reference permutation — fixed, so the noise is deterministic across runs. */
const PERLIN = buildPermutation();

export interface StdlibState {
  readonly buffers: Map<number, DataView>;
  readonly lists: Map<number, number[]>;
  nextBuffer: number;
  nextList: number;
}

export function createStdlibState(): StdlibState {
  return { buffers: new Map(), lists: new Map(), nextBuffer: 1, nextList: 1 };
}

export function registerStdlib(registry: HandlerRegistry, state: StdlibState): void {
  registerMath(registry);
  registerLists(registry, state);
  registerBuffers(registry, state);

  // 0AD3 STRING_FORMAT target format args… — the corpus uses %d; %s/%f/%x/%% come along free.
  registry.register(0x0ad3, (ctx, instruction) => {
    const format = ctx.thread.readString(instruction.operands[1]);
    const args = instruction.operands.slice(2);
    let at = 0;
    const text = format.replace(/%[%disfx]/g, (spec) => {
      if (spec === '%%') {
        return '%';
      }
      const operand = args[at];
      at += 1;
      if (operand === undefined) {
        return '';
      }
      switch (spec) {
        case '%f':
          return String(ctx.thread.readFloat(operand));
        case '%s':
          return ctx.thread.readString(operand);
        case '%x':
          return (ctx.thread.readInt(operand) >>> 0).toString(16);
        default:
          return String(ctx.thread.readInt(operand));
      }
    });
    ctx.thread.writeString(instruction.operands[0], text);

    return 'continue';
  });
}

function buildPermutation(): Uint8Array {
  // prettier-ignore
  const reference = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  const table = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) {
    table[index] = reference[index & 255];
  }

  return table;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function gradient(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;

  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? 2 * v : -2 * v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Classic Perlin 2D over the fixed table — range roughly [-1, 1]. */
function perlin2(x: number, y: number): number {
  const cellX = Math.floor(x) & 255;
  const cellY = Math.floor(y) & 255;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const u = fade(fx);
  const v = fade(fy);
  const a = PERLIN[cellX] + cellY;
  const b = PERLIN[cellX + 1] + cellY;

  return lerp(
    lerp(gradient(PERLIN[a], fx, fy), gradient(PERLIN[b], fx - 1, fy), u),
    lerp(gradient(PERLIN[a + 1], fx, fy - 1), gradient(PERLIN[b + 1], fx - 1, fy - 1), u),
    v,
  );
}

function registerBuffers(registry: HandlerRegistry, state: StdlibState): void {
  // 0AC8 ALLOCATE_MEMORY size out — conditional: true on success.
  registry.register(0x0ac8, (ctx, instruction) => {
    const size = ctx.thread.readInt(instruction.operands[0]);
    const token = BUFFER_TOKEN_BASE + state.nextBuffer;
    state.nextBuffer += 1;
    state.buffers.set(token, new DataView(new ArrayBuffer(Math.max(0, size))));
    ctx.thread.writeInt(instruction.operands[1], token);
    ctx.thread.setCondition(true, instruction.negated);

    return 'continue';
  });
  // 0AC9 FREE_MEMORY
  registry.register(0x0ac9, (ctx, instruction) => {
    state.buffers.delete(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });

  const structAccess = (
    ctx: HandlerContext,
    instruction: Instruction,
    access: (view: DataView, byteOffset: number) => void,
    native: () => void,
  ): 'continue' => {
    const token = ctx.thread.readInt(instruction.operands[0]);
    const view = state.buffers.get(token);
    if (!view) {
      // A NATIVE pointer — route through the plan 05 memory facade: a nameable target resolves,
      // anything else lands in the atlas MISS ledger (F2 coverage + the corpus join), never in a
      // silent side channel. (Before 097/07 close-out this called onUnimplemented directly, which
      // bypassed the coverage counter — the field's 0D4E warn had no row anywhere.)
      native();

      return 'continue';
    }
    access(view, 0);

    return 'continue';
  };

  // 0D37 WRITE_STRUCT_PARAM struct index value — params are 4-byte slots.
  registry.register(0x0d37, (ctx, instruction) => {
    const struct = ctx.thread.readInt(instruction.operands[0]);
    const index = ctx.thread.readInt(instruction.operands[1]);
    const operand = instruction.operands[2];
    const value = ctx.thread.readInt(operand);

    return structAccess(
      ctx,
      instruction,
      (view) => view.setInt32(index * 4, value, true),
      () => void ctx.host.memory.write(struct + index * 4, 4, { float: ctx.thread.readFloat(operand), int: value }),
    );
  });
  // 0D38 READ_STRUCT_PARAM struct index out
  registry.register(0x0d38, (ctx, instruction) => {
    const struct = ctx.thread.readInt(instruction.operands[0]);
    const index = ctx.thread.readInt(instruction.operands[1]);

    return structAccess(
      ctx,
      instruction,
      (view) => ctx.thread.writeInt(instruction.operands[2], view.getInt32(index * 4, true)),
      () => writeNativeValue(ctx, instruction.operands[2], ctx.host.memory.read(struct + index * 4, 4)),
    );
  });
  // 0D4E GET_STRUCT_FIELD struct byteOffset size out
  registry.register(0x0d4e, (ctx, instruction) => {
    const struct = ctx.thread.readInt(instruction.operands[0]);
    const offset = ctx.thread.readInt(instruction.operands[1]);
    const size = ctx.thread.readInt(instruction.operands[2]);

    return structAccess(
      ctx,
      instruction,
      (view) => {
        const value =
          size === 1 ? view.getUint8(offset) : size === 2 ? view.getUint16(offset, true) : view.getInt32(offset, true);
        ctx.thread.writeInt(instruction.operands[3], value);
      },
      () => writeNativeValue(ctx, instruction.operands[3], ctx.host.memory.read(struct + offset, size)),
    );
  });
}

function registerLists(registry: HandlerRegistry, state: StdlibState): void {
  // 0E72 CREATE_LIST type out
  registry.register(0x0e72, (ctx, instruction) => {
    const token = LIST_TOKEN_BASE + state.nextList;
    state.nextList += 1;
    state.lists.set(token, []);
    ctx.thread.writeInt(instruction.operands[1], token);

    return 'continue';
  });
  const list = (ctx: HandlerContext, instruction: Instruction): number[] => {
    const token = ctx.thread.readInt(instruction.operands[0]);
    const entries = state.lists.get(token);
    if (!entries) {
      throw new RangeError(`list ${token.toString(16)} does not exist`);
    }

    return entries;
  };
  // 0E74 LIST_ADD list value
  registry.register(0x0e74, (ctx, instruction) => {
    list(ctx, instruction).push(ctx.thread.readInt(instruction.operands[1]));

    return 'continue';
  });
  // 0E77 GET_LIST_SIZE list out
  registry.register(0x0e77, (ctx, instruction) => {
    ctx.thread.writeInt(instruction.operands[1], list(ctx, instruction).length);

    return 'continue';
  });
  // 0E78 GET_LIST_VALUE_BY_INDEX list index out
  registry.register(0x0e78, (ctx, instruction) => {
    const entries = list(ctx, instruction);
    const index = ctx.thread.readInt(instruction.operands[1]);
    ctx.thread.writeInt(instruction.operands[2], entries[index] ?? 0);

    return 'continue';
  });
  // 0E79 RESET_LIST list
  registry.register(0x0e79, (ctx, instruction) => {
    list(ctx, instruction).length = 0;

    return 'continue';
  });
}

function registerMath(registry: HandlerRegistry): void {
  // 02F6 SIN / 02F7 COS — SA takes DEGREES.
  registry.register(0x02f6, (ctx, instruction) => {
    ctx.thread.writeFloat(
      instruction.operands[1],
      Math.sin((ctx.thread.readFloat(instruction.operands[0]) * Math.PI) / 180),
    );

    return 'continue';
  });
  registry.register(0x02f7, (ctx, instruction) => {
    ctx.thread.writeFloat(
      instruction.operands[1],
      Math.cos((ctx.thread.readFloat(instruction.operands[0]) * Math.PI) / 180),
    );

    return 'continue';
  });
  // 0208 GENERATE_RANDOM_FLOAT_IN_RANGE min max out — the runner's injectable random source.
  registry.register(0x0208, (ctx, instruction) => {
    const min = ctx.thread.readFloat(instruction.operands[0]);
    const max = ctx.thread.readFloat(instruction.operands[1]);
    ctx.thread.writeFloat(instruction.operands[2], min + ctx.random() * (max - min));

    return 'continue';
  });
  // 0604 GET_HEADING_FROM_VECTOR_2D x y out — GTA heading: 0 = north (+y), degrees, [0, 360).
  registry.register(0x0604, (ctx, instruction) => {
    const x = ctx.thread.readFloat(instruction.operands[0]);
    const y = ctx.thread.readFloat(instruction.operands[1]);
    const degrees = (Math.atan2(-x, y) * 180) / Math.PI;
    ctx.thread.writeFloat(instruction.operands[2], (degrees + 360) % 360);

    return 'continue';
  });
  // 0EF1 PERLIN_NOISE_FRACTAL_2D x y octaves frequency amplitude lacunarity persistence out —
  // deterministic classic Perlin fBm; judged in the field on Wind Farm's sway (plan 05 checkpoint).
  registry.register(0x0ef1, (ctx, instruction) => {
    const [x, y] = [ctx.thread.readFloat(instruction.operands[0]), ctx.thread.readFloat(instruction.operands[1])];
    const octaves = ctx.thread.readInt(instruction.operands[2]);
    let frequency = ctx.thread.readFloat(instruction.operands[3]);
    let amplitude = ctx.thread.readFloat(instruction.operands[4]);
    const lacunarity = ctx.thread.readFloat(instruction.operands[5]);
    const persistence = ctx.thread.readFloat(instruction.operands[6]);
    let total = 0;
    for (let octave = 0; octave < Math.max(1, octaves); octave += 1) {
      total += perlin2(x * frequency, y * frequency) * amplitude;
      frequency *= lacunarity;
      amplitude *= persistence;
    }
    ctx.thread.writeFloat(instruction.operands[7], total);

    return 'continue';
  });
}

/** An atlas answer into a script var, kind preserved (a matrix field reads as float, not bits). */
function writeNativeValue(
  ctx: HandlerContext,
  operand: Instruction['operands'][number],
  value: ReturnType<HandlerContext['host']['memory']['read']>,
): void {
  if (value?.kind === 'float') {
    ctx.thread.writeFloat(operand, value.value);
  } else {
    ctx.thread.writeInt(operand, value?.value ?? 0);
  }
}
