import {
  decodeOscell,
  decodeOswire,
  encodeOscell,
  encodeOswire,
  type Oscell,
  OSCELL_VERTEX_STRIDE,
  oscellSections,
  rebuildOscell,
} from '@opensa/engine-formats';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';

/** Triangle list normalized so each triangle starts at its smallest index (cyclic rotation only). */
function normalizedTriangles(cell: Oscell): string[] {
  const view = cell.index16
    ? new Uint16Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount)
    : new Uint32Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount);
  const out: string[] = [];
  for (let tri = 0; tri < view.length; tri += 3) {
    const corners = [view[tri], view[tri + 1], view[tri + 2]];
    let start = 0;
    for (let corner = 1; corner < 3; corner += 1) {
      if (corners[corner] < corners[start]) {
        start = corner;
      }
    }
    out.push(`${corners[start]},${corners[(start + 1) % 3]},${corners[(start + 2) % 3]}`);
  }

  return out;
}

function sampleCell(index16: boolean): Oscell {
  const vertexCount = 64;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  for (let index = 0; index < vertexData.length; index += 1) {
    vertexData[index] = (index * 31 + (index >> 5) * 7) % 253;
  }
  const triangles: number[] = [];
  for (let tri = 0; tri < 40; tri += 1) {
    triangles.push(tri % 62, (tri + 1) % 62, (tri + 2) % 62);
  }

  return {
    bounds: [0, 0, 0, 100],
    breakables: [],
    channelMask: 0,
    groups: [
      { bounds: [0, 0, 0, 50], indexCount: 60, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 },
      { bounds: [0, 0, 0, 50], indexCount: 60, indexOffset: 60, pipelineClass: 1, side: 1, textureArrayRef: 3 },
    ],
    index16,
    indexCount: triangles.length,
    indexData: index16
      ? new Uint8Array(new Uint16Array(triangles).buffer)
      : new Uint8Array(new Uint32Array(triangles).buffer),
    lights: [],
    names: [],
    objects: [],
    origin: [0, 0, 0],
    particles: [],
    placements: [],
    roadsignQuads: 0,
    vertexCount,
    vertexData,
  };
}

/** The real wire chain (074/14 A1 stage 2) minus deflate: meshopt encode → container → meshopt decode. */
function wireRoundTrip(raw: Uint8Array): Uint8Array {
  const sections = oscellSections(raw);
  const vertexBlock = MeshoptEncoder.encodeVertexBuffer(
    raw.subarray(sections.vertexOffset, sections.vertexOffset + sections.vertexCount * OSCELL_VERTEX_STRIDE),
    sections.vertexCount,
    OSCELL_VERTEX_STRIDE,
  );
  const indexBlock = MeshoptEncoder.encodeIndexBuffer(
    raw.subarray(sections.indexOffset, sections.tailOffset),
    sections.indexCount,
    sections.indexElemSize,
  );

  return rebuildOscell(decodeOswire(encodeOswire(raw, vertexBlock, indexBlock)), MeshoptDecoder);
}

beforeAll(async () => {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
});

describe('meshopt wire round trip', () => {
  describe('negative cases', () => {
    it('rejects rebuilding from a non-container payload', () => {
      const raw = encodeOscell(sampleCell(false));

      expect(() => decodeOswire(raw)).toThrow(/not an .oswire/);
    });
  });

  describe('positive cases', () => {
    for (const index16 of [false, true]) {
      it(`reproduces a ${index16 ? 'uint16' : 'uint32'}-index cell (vertices exact, triangles winding-stable)`, () => {
        const cell = sampleCell(index16);
        const raw = encodeOscell(cell);

        const rebuilt = wireRoundTrip(raw);
        const decoded = decodeOscell(rebuilt);

        // Vertex payload, header, groups and tables must be byte-identical.
        expect(rebuilt.byteLength).toBe(raw.byteLength);
        expect([...decoded.vertexData]).toEqual([...cell.vertexData]);
        expect(decoded.groups).toEqual(cell.groups);
        expect(decoded.channelMask).toBe(cell.channelMask);
        // The meshopt index codec canonicalizes each triangle's cyclic rotation — triangle ORDER and
        // WINDING must survive (flat-interpolated layer is per-material-uniform, so rotation is safe).
        expect(normalizedTriangles(decoded)).toEqual(normalizedTriangles(cell));
      });
    }

    it('the wire form is smaller than the raw payload on repetitive data', () => {
      const raw = encodeOscell(sampleCell(false));
      const sections = oscellSections(raw);
      const vertexBlock = MeshoptEncoder.encodeVertexBuffer(
        raw.subarray(sections.vertexOffset, sections.vertexOffset + sections.vertexCount * OSCELL_VERTEX_STRIDE),
        sections.vertexCount,
        OSCELL_VERTEX_STRIDE,
      );
      const indexBlock = MeshoptEncoder.encodeIndexBuffer(
        raw.subarray(sections.indexOffset, sections.tailOffset),
        sections.indexCount,
        sections.indexElemSize,
      );

      expect(vertexBlock.byteLength + indexBlock.byteLength).toBeLessThan(sections.tailOffset - sections.vertexOffset);
    });
  });
});
