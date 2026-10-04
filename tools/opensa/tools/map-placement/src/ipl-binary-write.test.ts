import { parseBinaryCarGenerators, parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { describe, expect, it } from 'vitest';

import { stripBinaryIpl } from './ipl-binary-strip';
import { assertRebuildSafe, type BinaryIplInstance, encodeBinaryIpl, extractRawCars } from './ipl-binary-write';

const inst = (id: number, lod: number): BinaryIplInstance => ({
  id,
  interior: 0,
  lod,
  position: [100.5, -200.25, 30.125],
  rotation: [0, 0, -0.7071, 0.7071],
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('encodeBinaryIpl', () => {
  describe('negative cases', () => {
    it('encodes an empty stream that still parses with zero instances and zero cars', () => {
      const bytes = encodeBinaryIpl([]);

      expect(bytes.byteLength).toBe(76);
      expect(parseBinaryIpl(toArrayBuffer(bytes))).toEqual([]);
      expect(parseBinaryCarGenerators(toArrayBuffer(bytes))).toEqual([]);
    });

    it('rejects a carsRaw block that is not whole 48-byte records', () => {
      expect(() => encodeBinaryIpl([], new Uint8Array(47))).toThrow(/48-byte/);
    });

    it('assertRebuildSafe throws on a stream using a section the writer does not preserve', () => {
      const bytes = encodeBinaryIpl([inst(803, -1)]);
      new DataView(bytes.buffer).setUint32(0x10, 3, true); // pretend 3 records of an unknown section
      expect(() => assertRebuildSafe(toArrayBuffer(bytes), 'x_stream0.ipl')).toThrow(/unsupported/);
    });
  });

  describe('positive cases', () => {
    it('round-trips instances through the engine parser', () => {
      const bytes = encodeBinaryIpl([inst(803, 5), inst(4542, -1)]);

      const parsed = parseBinaryIpl(toArrayBuffer(bytes));
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({ id: 803, interior: 0, lod: 5 });
      expect(parsed[0].position[0]).toBeCloseTo(100.5, 5);
      expect(parsed[0].rotation[2]).toBeCloseTo(-0.7071, 5);
      expect(parsed[1]).toMatchObject({ id: 4542, lod: -1 });
    });

    it('produces streams the binary strip tooling accepts', () => {
      const bytes = encodeBinaryIpl([inst(803, 0), inst(804, 1)]);

      const { changed, removed } = stripBinaryIpl(bytes, (id) => id !== 804, null);
      expect(changed).toBe(true);
      expect(removed).toBe(1);
    });

    it('carries a raw CARS block through a rebuild (parked cars survive)', () => {
      // one synthetic 48-byte CARS record: pos + angle + id + the trailing fields
      const car = new Uint8Array(48);
      const carView = new DataView(car.buffer);
      carView.setFloat32(0, 2476.5, true);
      carView.setFloat32(4, -1668.25, true);
      carView.setFloat32(8, 13.3, true);
      carView.setFloat32(12, 1.5708, true);
      carView.setInt32(16, 415, true); // model id (cheetah)

      const bytes = encodeBinaryIpl([inst(803, -1)], car);
      const parsedInst = parseBinaryIpl(toArrayBuffer(bytes));
      const parsedCars = parseBinaryCarGenerators(toArrayBuffer(bytes));
      expect(parsedInst).toHaveLength(1);
      expect(parsedCars).toHaveLength(1);
      expect(parsedCars[0].position[0]).toBeCloseTo(2476.5, 4);
      expect(extractRawCars(toArrayBuffer(bytes))).toEqual(car); // extractor gives the block back verbatim
      expect(() => assertRebuildSafe(toArrayBuffer(bytes), 'x')).not.toThrow();
    });
  });
});
