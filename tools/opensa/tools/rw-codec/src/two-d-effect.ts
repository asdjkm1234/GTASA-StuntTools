/**
 * Typed codecs for the 2d-effect payloads a far LOD has to carry (plan 07, `rw-codec/01`). `dff.ts` treats
 * every entry as opaque bytes and rewrites only its 12 position bytes — enough to MOVE an entry, not enough to
 * ROTATE one, which is why baked cells drop every rotation-bearing type. These pairs decode and re-encode the
 * three payloads that matter at LOD range; every other type stays opaque and byte-verbatim.
 *
 * An entry is `position(3×f32) + type(u32) + dataSize(u32) + data`; the functions here take and return a WHOLE
 * entry (header + data), so a decoded value can be edited and dropped straight back into a
 * {@link import('./dff').Raw2dfxEntry}'s `bytes`.
 *
 * **`encode(decode(entry)) === entry` byte-for-byte is the contract.** Character fields and any bytes past the
 * documented layout are therefore kept as raw spans rather than re-derived — a re-derived NUL pad would round
 * to "probably the same", and an asymmetric codec is invisible corruption in a DFF nobody reads by hand.
 */

/** A 2d-effect entry header: `position` (3×f32) + `type` (u32) + `dataSize` (u32). */
export const ENTRY_HEADER_BYTES = 20;

/** Escalator (type 10): the step path's three points + a direction. */
export const ESCALATOR_2DFX = 10;
/** Particle emitter (type 1): an `effects.fxp` system — factory smoke, fire, fountains, vents. */
export const PARTICLE_2DFX = 1;
/** Road sign (type 7): a street-name plate whose text is baked into the model. */
export const ROADSIGN_2DFX = 7;

/** Fixed payload of an escalator entry: bottom + top + end vec3s, then `direction` u32. */
const ESCALATOR_PAYLOAD_BYTES = 40;
/** Fixed payload of a particle entry: the 24-byte FX-system name. */
const PARTICLE_PAYLOAD_BYTES = 24;
/** One road-sign text line: a fixed 16-char field ('_' is the space glyph). */
const ROADSIGN_LINE_BYTES = 16;
/** Road-sign lines are always four fields on the wire; `flags` says how many are drawn. */
const ROADSIGN_LINES = 4;
/**
 * Fixed payload of a road-sign entry: plate size vec2, rotation vec3 (degrees), flags u16, 4×16 chars. The
 * stock entries are 88 bytes — the trailing 2-byte pad is kept verbatim rather than re-derived.
 */
const ROADSIGN_PAYLOAD_BYTES = 22 + ROADSIGN_LINES * ROADSIGN_LINE_BYTES;

/** A decoded escalator (type 10) entry. Every point is geometry-local, like the entry position. */
export interface Escalator2dfx {
  /** Lower landing. */
  bottom: Vec3;
  direction: number;
  /** Upper landing (the path runs position → bottom → top → end). */
  end: Vec3;
  position: Vec3;
  /** Top of the incline. */
  top: Vec3;
  /** Bytes past the 40-byte payload, kept verbatim (none in the stock corpus). */
  trailing: Uint8Array;
}

/** A decoded particle-emitter (type 1) entry. */
export interface Particle2dfx {
  /**
   * The `effects.fxp` system name as its raw fixed 24-byte field. NUL-terminated, but the tail is not
   * guaranteed zeroed, so re-deriving it from a string would break byte identity — read it with
   * {@link fixedFieldText}.
   */
  name: Uint8Array;
  position: Vec3;
  /** Bytes past the 24-byte payload, kept verbatim. */
  trailing: Uint8Array;
}

/** A decoded road-sign (type 7) entry. */
export interface Roadsign2dfx {
  /** Bits 0–1 line count, 2–3 chars per line, 4–5 colour palette. Left raw — this codec applies no policy. */
  flags: number;
  /** Exactly four raw 16-byte text fields, drawn or not; read one with {@link fixedFieldText}. */
  lines: Uint8Array[];
  /** Plate width × height in metres. */
  plateSize: [number, number];
  position: Vec3;
  /** Plate rotation in degrees (XYZ) — the field a position-only transplant leaves facing the wrong way. */
  rotation: Vec3;
  /** Bytes past the 86-byte layout, kept verbatim — the stock 2-byte pad lands here. */
  trailing: Uint8Array;
}

type Vec3 = [number, number, number];

export function decodeEscalator2dfx(entry: Uint8Array): Escalator2dfx {
  const data = payloadOf(entry, ESCALATOR_2DFX, ESCALATOR_PAYLOAD_BYTES, 'escalator');
  const view = viewOf(data);

  return {
    bottom: vec3(view, 0),
    direction: view.getUint32(36, true),
    end: vec3(view, 24),
    position: vec3(viewOf(entry), 0),
    top: vec3(view, 12),
    trailing: data.subarray(ESCALATOR_PAYLOAD_BYTES),
  };
}

export function decodeParticle2dfx(entry: Uint8Array): Particle2dfx {
  const data = payloadOf(entry, PARTICLE_2DFX, PARTICLE_PAYLOAD_BYTES, 'particle');

  return {
    name: data.subarray(0, PARTICLE_PAYLOAD_BYTES),
    position: vec3(viewOf(entry), 0),
    trailing: data.subarray(PARTICLE_PAYLOAD_BYTES),
  };
}

export function decodeRoadsign2dfx(entry: Uint8Array): Roadsign2dfx {
  const data = payloadOf(entry, ROADSIGN_2DFX, ROADSIGN_PAYLOAD_BYTES, 'roadsign');
  const view = viewOf(data);
  const lines: Uint8Array[] = [];
  for (let line = 0; line < ROADSIGN_LINES; line += 1) {
    const start = 22 + line * ROADSIGN_LINE_BYTES;
    lines.push(data.subarray(start, start + ROADSIGN_LINE_BYTES));
  }

  return {
    flags: view.getUint16(20, true),
    lines,
    plateSize: [view.getFloat32(0, true), view.getFloat32(4, true)],
    position: vec3(viewOf(entry), 0),
    rotation: vec3(view, 8),
    trailing: data.subarray(ROADSIGN_PAYLOAD_BYTES),
  };
}

export function encodeEscalator2dfx(value: Escalator2dfx): Uint8Array {
  const { data, entry, view } = allocate(ESCALATOR_2DFX, ESCALATOR_PAYLOAD_BYTES, value.position, value.trailing);
  putVec3(view, 0, value.bottom);
  putVec3(view, 12, value.top);
  putVec3(view, 24, value.end);
  view.setUint32(36, value.direction, true);
  data.set(value.trailing, ESCALATOR_PAYLOAD_BYTES);

  return entry;
}

export function encodeParticle2dfx(value: Particle2dfx): Uint8Array {
  if (value.name.length !== PARTICLE_PAYLOAD_BYTES) {
    throw new RangeError(`2dfx particle: name field is ${value.name.length} bytes, expected ${PARTICLE_PAYLOAD_BYTES}`);
  }
  const { data, entry } = allocate(PARTICLE_2DFX, PARTICLE_PAYLOAD_BYTES, value.position, value.trailing);
  data.set(value.name, 0);
  data.set(value.trailing, PARTICLE_PAYLOAD_BYTES);

  return entry;
}

export function encodeRoadsign2dfx(value: Roadsign2dfx): Uint8Array {
  if (value.lines.length !== ROADSIGN_LINES) {
    throw new RangeError(`2dfx roadsign: ${value.lines.length} text lines, expected ${ROADSIGN_LINES}`);
  }
  const { data, entry, view } = allocate(ROADSIGN_2DFX, ROADSIGN_PAYLOAD_BYTES, value.position, value.trailing);
  view.setFloat32(0, value.plateSize[0], true);
  view.setFloat32(4, value.plateSize[1], true);
  putVec3(view, 8, value.rotation);
  view.setUint16(20, value.flags, true);
  value.lines.forEach((line, index) => {
    if (line.length !== ROADSIGN_LINE_BYTES) {
      throw new RangeError(
        `2dfx roadsign: text line ${index} is ${line.length} bytes, expected ${ROADSIGN_LINE_BYTES}`,
      );
    }
    data.set(line, 22 + index * ROADSIGN_LINE_BYTES);
  });
  data.set(value.trailing, ROADSIGN_PAYLOAD_BYTES);

  return entry;
}

/** Read a fixed-width character field (a particle name, a road-sign line) up to its NUL terminator. */
export function fixedFieldText(field: Uint8Array): string {
  const end = field.indexOf(0);

  return String.fromCharCode(...field.subarray(0, end < 0 ? field.length : end));
}

/** A zeroed entry of `type` sized for its payload + trailing, with the header already written. */
function allocate(
  type: number,
  payloadBytes: number,
  position: Vec3,
  trailing: Uint8Array,
): { data: Uint8Array; entry: Uint8Array; view: DataView } {
  const dataSize = payloadBytes + trailing.length;
  const entry = new Uint8Array(ENTRY_HEADER_BYTES + dataSize);
  const header = viewOf(entry);
  putVec3(header, 0, position);
  header.setUint32(12, type, true);
  header.setUint32(16, dataSize, true);
  const data = entry.subarray(ENTRY_HEADER_BYTES);

  return { data, entry, view: viewOf(data) };
}

/**
 * The entry's payload, after checking it is the type asked for and long enough to hold its layout. These bytes
 * come from a FILE, so every field is validated before it is read — a short entry is rejected loudly rather
 * than decoded into garbage.
 */
function payloadOf(entry: Uint8Array, type: number, payloadBytes: number, label: string): Uint8Array {
  if (entry.length < ENTRY_HEADER_BYTES) {
    throw new RangeError(
      `2dfx ${label}: entry is ${entry.length} bytes, shorter than its ${ENTRY_HEADER_BYTES}-byte header`,
    );
  }
  const view = viewOf(entry);
  const entryType = view.getUint32(12, true);
  if (entryType !== type) {
    throw new TypeError(`2dfx ${label}: entry is type ${entryType}, expected ${type}`);
  }
  const dataSize = view.getUint32(16, true);
  if (dataSize !== entry.length - ENTRY_HEADER_BYTES) {
    throw new RangeError(
      `2dfx ${label}: header declares ${dataSize} payload bytes, ${entry.length - ENTRY_HEADER_BYTES} supplied`,
    );
  }
  if (dataSize < payloadBytes) {
    throw new RangeError(`2dfx ${label}: payload is ${dataSize} bytes, shorter than its ${payloadBytes}-byte layout`);
  }

  return entry.subarray(ENTRY_HEADER_BYTES);
}

function putVec3(view: DataView, at: number, value: Vec3): void {
  view.setFloat32(at, value[0], true);
  view.setFloat32(at + 4, value[1], true);
  view.setFloat32(at + 8, value[2], true);
}

function vec3(view: DataView, at: number): Vec3 {
  return [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)];
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
