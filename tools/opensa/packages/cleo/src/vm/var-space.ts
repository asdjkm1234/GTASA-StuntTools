/**
 * SCM variable storage (plan 097/03 decision 3): 32-bit slots reinterpreted int/float per operand
 * type, with long strings occupying consecutive slots (string8 = 2 slots, string16 = 4) — the real
 * SCM layout, which is what makes string vars fall out of the same byte space for free.
 */
export class VarSpace {
  private readonly view: DataView;

  constructor(readonly slots: number) {
    this.view = new DataView(new ArrayBuffer(slots * 4));
  }

  float(slot: number): number {
    return this.view.getFloat32(slot * 4, true);
  }

  int(slot: number): number {
    return this.view.getInt32(slot * 4, true);
  }

  restore(snapshot: ArrayBuffer): void {
    new Uint8Array(this.view.buffer).set(new Uint8Array(snapshot));
  }

  setFloat(slot: number, value: number): void {
    this.view.setFloat32(slot * 4, value, true);
  }

  setInt(slot: number, value: number): void {
    this.view.setInt32(slot * 4, value | 0, true);
  }

  setString(slot: number, value: string, bytes: 8 | 16): void {
    for (let index = 0; index < bytes; index += 1) {
      this.view.setUint8(slot * 4 + index, index < value.length ? value.charCodeAt(index) & 0xff : 0);
    }
  }

  /** Whole-space copy (CLEO_CALL frame save/restore). */
  snapshot(): ArrayBuffer {
    return this.view.buffer.slice(0) as ArrayBuffer;
  }

  string(slot: number, bytes: 8 | 16): string {
    let out = '';
    for (let index = 0; index < bytes; index += 1) {
      const code = this.view.getUint8(slot * 4 + index);
      if (code === 0) {
        break;
      }
      out += String.fromCharCode(code);
    }

    return out;
  }

  zero(): void {
    new Uint8Array(this.view.buffer).fill(0);
  }
}
