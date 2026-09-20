/** Little-endian growable byte writer — the mirror of `@opensa/cleo`'s `Cursor` reader. */
export class Writer {
  get offset(): number {
    return this.length;
  }
  private buffer = new Uint8Array(256);
  private length = 0;

  private view = new DataView(this.buffer.buffer);

  bytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  f32(value: number): void {
    this.reserve(4);
    this.view.setFloat32(this.length, value, true);
    this.length += 4;
  }

  i8(value: number): void {
    this.reserve(1);
    this.view.setInt8(this.length, value);
    this.length += 1;
  }

  i16(value: number): void {
    this.reserve(2);
    this.view.setInt16(this.length, value, true);
    this.length += 2;
  }

  i32(value: number): void {
    this.reserve(4);
    this.view.setInt32(this.length, value, true);
    this.length += 4;
  }

  raw(bytes: Uint8Array): void {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  u8(value: number): void {
    this.reserve(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
  }

  u16(value: number): void {
    this.reserve(2);
    this.view.setUint16(this.length, value, true);
    this.length += 2;
  }

  u32(value: number): void {
    this.reserve(4);
    this.view.setUint32(this.length, value, true);
    this.length += 4;
  }

  private reserve(count: number): void {
    if (this.length + count <= this.buffer.length) {
      return;
    }
    const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + count));
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
    this.view = new DataView(grown.buffer);
  }
}
