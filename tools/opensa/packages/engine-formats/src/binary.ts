/**
 * Little-endian binary IO shared by the format codecs (plan 074/02). A growable writer and a bounds-checked
 * reader — no dependencies, usable in Node (tool) and the browser (runtime) alike.
 */

/** Bounds-checked little-endian reader over a byte range. */
export class ByteReader {
  position = 0;
  get byteLength(): number {
    return this.view.byteLength;
  }

  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  f32(): number {
    const value = this.view.getFloat32(this.position, true);
    this.position += 4;

    return value;
  }

  i8(): number {
    const value = this.view.getInt8(this.position);
    this.position += 1;

    return value;
  }

  /** Signed 32-bit — parent/bone indices use -1 for "none". */
  i32(): number {
    const value = this.view.getInt32(this.position, true);
    this.position += 4;

    return value;
  }

  raw(length: number): Uint8Array {
    if (this.position + length > this.view.byteLength) {
      throw new RangeError(`raw(${length}) overruns buffer (at ${this.position}/${this.view.byteLength})`);
    }
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.position, length);
    this.position += length;

    return bytes;
  }

  seek(position: number): void {
    if (position < 0 || position > this.view.byteLength) {
      throw new RangeError(`seek(${position}) outside buffer (${this.view.byteLength})`);
    }
    this.position = position;
  }

  u8(): number {
    const value = this.view.getUint8(this.position);
    this.position += 1;

    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.position, true);
    this.position += 2;

    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.position, true);
    this.position += 4;

    return value;
  }

  /** 64-bit little-endian, read as a double. Throws past 2^53 rather than returning a number that is quietly
   *  a few bytes wrong — the formats that need this width carry file offsets, and one off by 1024 reads a
   *  neighbouring tile's pixels with no error anywhere. */
  u64(): number {
    const low = this.view.getUint32(this.position, true);
    const high = this.view.getUint32(this.position + 4, true);
    this.position += 8;
    const value = high * 2 ** 32 + low;
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`u64 ${high}:${low} is not an exact double`);
    }

    return value;
  }
}

/** Growable little-endian writer. `align(n)` zero-pads to an n-byte boundary (section alignment). */
export class ByteWriter {
  get offset(): number {
    return this.length;
  }
  private buffer: ArrayBuffer;
  private length = 0;

  private view: DataView;

  constructor(initialCapacity = 1024) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
  }

  align(boundary: number): void {
    const rem = this.length % boundary;
    if (rem !== 0) {
      this.ensure(boundary - rem);
      this.length += boundary - rem; // ArrayBuffer is zero-initialized
    }
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.length);
  }

  f32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, value, true);
    this.length += 4;
  }

  i8(value: number): void {
    this.ensure(1);
    this.view.setInt8(this.length, value);
    this.length += 1;
  }

  /** Signed 32-bit — parent/bone indices use -1 for "none". */
  i32(value: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, value, true);
    this.length += 4;
  }

  patchU32(at: number, value: number): void {
    this.view.setUint32(at, value >>> 0, true);
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength);
    new Uint8Array(this.buffer, this.length, bytes.byteLength).set(bytes);
    this.length += bytes.byteLength;
  }

  /** Reserve a u32 slot to be patched later (section offset tables). Returns the slot position. */
  reserveU32(): number {
    const at = this.length;
    this.u32(0);

    return at;
  }

  u8(value: number): void {
    this.ensure(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
  }

  u16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, value, true);
    this.length += 2;
  }

  u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, value >>> 0, true);
    this.length += 4;
  }

  /** 64-bit little-endian from a double — see the reader's note on the ceiling. */
  u64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`u64 ${value} is not an exact non-negative integer`);
    }
    this.ensure(8);
    this.view.setUint32(this.length, value >>> 0, true);
    this.view.setUint32(this.length + 4, Math.floor(value / 2 ** 32), true);
    this.length += 8;
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.byteLength) {
      return;
    }
    let capacity = this.buffer.byteLength * 2;
    while (capacity < this.length + extra) {
      capacity *= 2;
    }
    const next = new ArrayBuffer(capacity);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.length));
    this.buffer = next;
    this.view = new DataView(next);
  }
}

/** FNV-1a 32-bit — deterministic name/content hashing (no crypto dependency; collisions are acceptable for
 *  names because the manifest keeps full strings; content hashes are integrity hints, not security). */
export function fnv1a(bytes: string | Uint8Array): number {
  let hash = 0x811c9dc5;
  if (typeof bytes === 'string') {
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes.charCodeAt(index) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  } else {
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return hash >>> 0;
}
