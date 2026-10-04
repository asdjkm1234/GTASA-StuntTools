import { describe, expect, it } from 'vitest';

import { encodeOscell, type Oscell, OSCELL_VERTEX_STRIDE, OscellChannel } from './oscell';
import { decodeOswire, encodeOswire, oscellSections, type OswireDecoder, rebuildOscell } from './oswire';

function sampleCellBytes(index16 = false): Uint8Array {
  const vertexCount = 7;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  for (let index = 0; index < vertexData.length; index += 1) {
    vertexData[index] = (index * 7 + 3) % 251;
  }
  const indices = [0, 1, 2, 2, 3, 4, 4, 5, 6];
  const cell: Oscell = {
    bounds: [1, 2, 3, 40],
    breakables: [],
    channelMask: OscellChannel.NIGHT_PRELIT,
    groups: [{ bounds: [1, 2, 3, 10], indexCount: 9, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 2 }],
    index16,
    indexCount: indices.length,
    indexData: index16
      ? new Uint8Array(new Uint16Array(indices).buffer)
      : new Uint8Array(new Uint32Array(indices).buffer),
    lights: [{ color: [255, 200, 100, 255], farClip: 120, owner: 3913926212, position: [10, 20, 30], size: 1.5 }],
    names: [],
    objects: [],
    origin: [2500, -1600, 0],
    particles: [],
    placements: [],
    roadsignQuads: 0,
    vertexCount,
    vertexData,
  };

  return encodeOscell(cell);
}

/** Test stand-in for meshopt: "blocks" are the raw payloads, decode = copy. */
const copyDecoder: OswireDecoder = {
  decodeIndexBuffer: (target, _count, _size, source) => target.set(source),
  decodeVertexBuffer: (target, _count, _size, source) => target.set(source),
};

describe('oswire container', () => {
  describe('negative cases', () => {
    it('oscellSections rejects a non-oscell payload', () => {
      expect(() => oscellSections(new Uint8Array(128))).toThrow(/not an .oscell/);
    });

    it('decodeOswire rejects a wrong magic', () => {
      expect(() => decodeOswire(sampleCellBytes())).toThrow(/not an .oswire/);
    });
  });

  describe('positive cases', () => {
    it('oscellSections finds the payload split points of an encoded cell', () => {
      const raw = sampleCellBytes();

      const sections = oscellSections(raw);

      expect(sections.vertexCount).toBe(7);
      expect(sections.indexCount).toBe(9);
      expect(sections.indexElemSize).toBe(4);
      expect(sections.rawLength).toBe(raw.byteLength);
      expect(sections.indexOffset).toBe(sections.vertexOffset + 7 * OSCELL_VERTEX_STRIDE);
      expect(sections.tailOffset).toBe(sections.indexOffset + 9 * 4);
      expect(sections.tailOffset).toBeLessThan(raw.byteLength);
    });

    it('reports elemSize 2 for uint16-index cells', () => {
      expect(oscellSections(sampleCellBytes(true)).indexElemSize).toBe(2);
    });

    it('encode → decode → rebuild reproduces the raw cell byte-exactly (copy decoder)', () => {
      const raw = sampleCellBytes();
      const sections = oscellSections(raw);
      const vertexPayload = raw.subarray(sections.vertexOffset, sections.indexOffset);
      const indexPayload = raw.subarray(sections.indexOffset, sections.tailOffset);

      const container = encodeOswire(raw, vertexPayload, indexPayload);
      const rebuilt = rebuildOscell(decodeOswire(container), copyDecoder);

      expect(rebuilt.byteLength).toBe(raw.byteLength);
      expect([...rebuilt]).toEqual([...raw]);
    });

    it('decodeOswire returns views carrying the section metadata', () => {
      const raw = sampleCellBytes(true);
      const sections = oscellSections(raw);

      const parts = decodeOswire(encodeOswire(raw, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])));

      expect(parts.sections).toEqual(sections);
      expect([...parts.vertexBlock]).toEqual([1, 2, 3]);
      expect([...parts.indexBlock]).toEqual([4, 5]);
    });
  });
});
