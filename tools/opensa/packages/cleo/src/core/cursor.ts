/** Little-endian byte cursor over a script buffer — the one reader both operand layers share. */
export class Cursor {
  private readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    public offset = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  f32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;

    return value;
  }

  i8(): number {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;

    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;

    return value;
  }

  i32(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;

    return value;
  }

  /** Raw bytes, advancing — fixed-length string payloads. */
  take(length: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    if (slice.length !== length) {
      throw new RangeError(`read past end of script at offset ${this.offset} (wanted ${length} bytes)`);
    }
    this.offset += length;

    return slice;
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;

    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;

    return value;
  }
}
