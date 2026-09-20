/** One INST record for a binary ("bnry") IPL stream. Rotation uses the same (conjugated) quaternion
 *  convention as text IPL rows — real SA and the OpenSA parser treat both paths identically. */
export interface BinaryIplInstance {
  readonly id: number;
  readonly interior: number;
  /** Index into the area's companion TEXT IPL inst array (the LOD parent), or -1. */
  readonly lod: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

const HEADER_SIZE = 76;
const INST_SIZE = 40;
const CARS_SIZE = 48;
const FIELD_NUM_INST = 0x04;
const FIELD_NUM_CARS = 0x14;
const OFFSET_INST = 0x1c;
const OFFSET_CARS = 0x3c;

/**
 * Throw when a stream uses any header section this writer doesn't preserve. SA binary IPLs in practice carry
 * only INST + CARS; a nonzero count elsewhere means a rebuild would silently drop data — refuse instead.
 */
export function assertRebuildSafe(buffer: ArrayBuffer, label: string): void {
  const view = new DataView(buffer);
  for (const offset of [0x08, 0x0c, 0x10, 0x18]) {
    const count = view.getUint32(offset, true);
    if (count !== 0) {
      throw new Error(
        `${label}: unsupported binary-IPL section (count ${count} @0x${offset.toString(16)}) — rebuild would drop it`,
      );
    }
  }
}

/**
 * Encode instances as a binary IPL stream (`<area>_streamN.ipl`, shipped inside an IMG).
 *
 * Mirror of the engine's `parseBinaryIpl`: 76-byte header — `"bnry"`, `numInst` @0x04, `instOffset` @0x1C,
 * `numCars` @0x14 with `carsOffset` @0x3C right past the INST block; all other counts stay 0. Then `numInst`
 * × 40-byte records: pos (3×f32), rot quat (4×f32), id (u32), interior (i32), lod (i32). `carsRaw` (optional)
 * is a verbatim block of 48-byte CARS records (see {@link extractRawCars}) appended after the instances —
 * stock streams carry map-baked parked cars that a rebuild must not drop.
 */
export function encodeBinaryIpl(instances: readonly BinaryIplInstance[], carsRaw?: Uint8Array): Uint8Array {
  const cars = carsRaw ?? new Uint8Array(0);
  if (cars.length % CARS_SIZE !== 0) {
    throw new Error(`carsRaw length ${cars.length} is not a multiple of the 48-byte CARS record`);
  }
  const bytes = new Uint8Array(HEADER_SIZE + instances.length * INST_SIZE + cars.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79], 0); // 'bnry'
  view.setUint32(FIELD_NUM_INST, instances.length, true);
  view.setUint32(FIELD_NUM_CARS, cars.length / CARS_SIZE, true);
  view.setUint32(OFFSET_INST, HEADER_SIZE, true);
  view.setUint32(OFFSET_CARS, HEADER_SIZE + instances.length * INST_SIZE, true);
  bytes.set(cars, HEADER_SIZE + instances.length * INST_SIZE);

  instances.forEach((inst, i) => {
    const at = HEADER_SIZE + i * INST_SIZE;
    view.setFloat32(at + 0, inst.position[0], true);
    view.setFloat32(at + 4, inst.position[1], true);
    view.setFloat32(at + 8, inst.position[2], true);
    view.setFloat32(at + 12, inst.rotation[0], true);
    view.setFloat32(at + 16, inst.rotation[1], true);
    view.setFloat32(at + 20, inst.rotation[2], true);
    view.setFloat32(at + 24, inst.rotation[3], true);
    view.setUint32(at + 28, inst.id, true);
    view.setInt32(at + 32, inst.interior, true);
    view.setInt32(at + 36, inst.lod, true);
  });

  return bytes;
}

/**
 * The verbatim CARS block of an existing binary stream (`numCars` @0x14 × 48 bytes at `carsOffset` @0x3C) —
 * for carrying map-baked parked cars through a rebuild. Empty array when the stream has none.
 */
export function extractRawCars(buffer: ArrayBuffer): Uint8Array {
  const view = new DataView(buffer);
  const numCars = view.getUint32(FIELD_NUM_CARS, true);
  const carsOffset = view.getUint32(OFFSET_CARS, true);

  return new Uint8Array(buffer, carsOffset, numCars * CARS_SIZE).slice();
}
