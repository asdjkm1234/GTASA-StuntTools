import { describe, expect, it } from 'vitest';

import {
  decodeOscell,
  encodeOscell,
  type Oscell,
  OSCELL_VERSION_MAJOR,
  OSCELL_VERTEX_STRIDE,
  OscellChannel,
} from './oscell';

function sampleCell(overrides: Partial<Oscell> = {}): Oscell {
  const vertexCount = 3;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  // Distinct bytes so round-trip corruption would show.
  for (let index = 0; index < vertexData.length; index += 1) {
    vertexData[index] = index % 251;
  }
  const indexData = new Uint8Array(new Uint32Array([0, 1, 2]).buffer);

  return {
    bounds: [1, 2, 3, 40],
    // B7: distinct values per field — an equal-count assertion would have missed the field ROTATION the
    // linter introduced by sorting an object literal whose values were side-effecting reads.
    breakables: [
      { indexCount: 207, indexOffset: 14121, keyHash: 2449560454 },
      { indexCount: 33, indexOffset: 14328, keyHash: 1901043656 },
    ],
    channelMask: OscellChannel.NIGHT_PRELIT | OscellChannel.SWAY,
    groups: [
      {
        bounds: [1, 2, 3, 10],
        indexCount: 3,
        indexOffset: 0,
        pipelineClass: 1,
        side: 1,
        textureArrayRef: 7,
      },
    ],
    index16: false,
    indexCount: 3,
    indexData,
    lights: [{ color: [255, 200, 100, 255], farClip: 120, owner: 3913926212, position: [10, 20, 30], size: 1.5 }],
    names: ['sw_shop01', 'sw_shops', 'lamppost1'],
    objects: [
      {
        groupCount: 1,
        groupStart: 0,
        kind: 0,
        params: (20 << 8) | 6,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5],
      },
    ],
    origin: [2500, -1600, 0],
    particles: [
      { effectName: 'ws_factorysmoke', position: [12, 3, -4] },
      { effectName: 'fire', position: [-1, 0, 2] },
    ],
    // Distinct values per field, for the same reason as the breakable rows above: a field ROTATION
    // survives any count-only assertion.
    placements: [
      { bounds: [-1, -2, -3, 4, 5, 6], id: 3141592653, indexCount: 33, indexOffset: 0, nameRef: 0, txdRef: 1 },
      { bounds: [7, 8, 9, 10, 11, 12], id: 2718281828, indexCount: 12, indexOffset: 33, nameRef: 2, txdRef: 1 },
    ],
    roadsignQuads: 5,
    vertexCount,
    vertexData,
    ...overrides,
  };
}

describe('oscell codec', () => {
  describe('negative cases', () => {
    it('throws when vertexData does not match vertexCount × stride', () => {
      const cell = sampleCell({ vertexData: new Uint8Array(10) });

      expect(() => encodeOscell(cell)).toThrow(/vertexData/);
    });

    it('throws when indexData does not match indexCount and width', () => {
      const cell = sampleCell({ indexData: new Uint8Array(5) });

      expect(() => encodeOscell(cell)).toThrow(/indexData/);
    });

    it('throws on a placement AABB that is not min+max', () => {
      const cell = sampleCell();
      cell.placements[0] = { ...cell.placements[0], bounds: [1, 2, 3] };

      expect(() => encodeOscell(cell)).toThrow(/6 floats/);
    });

    it('throws on an object transform that is not 3×4', () => {
      const cell = sampleCell();
      cell.objects[0] = { ...cell.objects[0], transform: [1, 2, 3] };

      expect(() => encodeOscell(cell)).toThrow(/12 floats/);
    });

    it('rejects a wrong magic', () => {
      const bytes = encodeOscell(sampleCell());
      bytes[0] = 0x00;

      expect(() => decodeOscell(bytes)).toThrow(/not an .oscell/);
    });

    it('rejects an unknown major version', () => {
      const bytes = encodeOscell(sampleCell());
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(4, OSCELL_VERSION_MAJOR + 1, true);

      expect(() => decodeOscell(bytes)).toThrow(/unsupported .oscell major/);
    });
  });

  describe('positive cases', () => {
    it('round-trips a cell byte-exactly (payloads, groups, objects, lights, particles)', () => {
      const cell = sampleCell();

      const decoded = decodeOscell(encodeOscell(cell));

      expect([...decoded.vertexData]).toEqual([...cell.vertexData]);
      expect([...decoded.indexData]).toEqual([...cell.indexData]);
      expect(decoded.groups).toEqual(cell.groups);
      expect(decoded.objects).toEqual(cell.objects);
      // B6: the 2dfx emitter anchors, names and all (the host resolves the name against effects.fxp).
      expect(decoded.particles).toEqual(cell.particles);
      expect(decoded.lights).toEqual(cell.lights);
      // B7·a: the smashable index ranges — a physics hit resolves against `keyHash`, so a rotated field here
      // makes every prop unbreakable while everything still decodes and renders.
      expect(decoded.breakables).toEqual(cell.breakables);
      expect(decoded.bounds).toEqual(cell.bounds);
      expect(decoded.origin).toEqual(cell.origin);
      expect(decoded.channelMask).toBe(cell.channelMask);
      expect(decoded.index16).toBe(false);
    });

    it('round-trips a uint16-index cell and preserves the flag', () => {
      const cell = sampleCell({
        index16: true,
        indexData: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
      });

      const decoded = decodeOscell(encodeOscell(cell));

      expect(decoded.index16).toBe(true);
      expect([...new Uint16Array(decoded.indexData.buffer, decoded.indexData.byteOffset, 3)]).toEqual([0, 1, 2]);
    });

    it('round-trips the placement mapper and its name pool (minor 6)', () => {
      const cell = sampleCell();

      const back = decodeOscell(encodeOscell(cell));

      expect(back.names).toEqual(['sw_shop01', 'sw_shops', 'lamppost1']);
      // Field-by-field, not a count: a rotation inside the reader is exactly what cost a round on the
      // breakable table, and every field here is a different width.
      expect(back.placements).toEqual(cell.placements);
      expect(back.names[back.placements[1].nameRef]).toBe('lamppost1');
      expect(back.names[back.placements[1].txdRef]).toBe('sw_shops');
    });

    it('reads a pre-mapper cell as simply having no placements', () => {
      const bytes = encodeOscell(sampleCell({ names: [], placements: [] }));

      const back = decodeOscell(bytes);

      expect(back.placements).toEqual([]);
      expect(back.names).toEqual([]);
    });

    it('round-trips the roadsign glyph-quad count (minor 8)', () => {
      const back = decodeOscell(encodeOscell(sampleCell({ roadsignQuads: 137 })));

      expect(back.roadsignQuads).toBe(137);
    });

    it('keeps every later offset intact when the quad count is zero', () => {
      // The count is a header word, so a zero must still be WRITTEN — reading it back as a table offset is
      // the failure mode every minor bump in this file has had to defend against.
      const back = decodeOscell(encodeOscell(sampleCell({ roadsignQuads: 0 })));

      expect(back.roadsignQuads).toBe(0);
      expect(back.placements).toEqual(sampleCell().placements);
      expect(back.particles).toEqual(sampleCell().particles);
    });

    it('encodes deterministically (same input ⇒ identical bytes)', () => {
      const a = encodeOscell(sampleCell());
      const b = encodeOscell(sampleCell());

      expect([...a]).toEqual([...b]);
    });
  });
});
