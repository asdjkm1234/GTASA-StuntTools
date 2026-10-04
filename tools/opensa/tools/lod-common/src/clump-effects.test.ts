import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { collectClumpEffects } from './clump-effects';
import { encodeLodDff } from './encode-dff';

/** A one-triangle mesh encoded into a real DFF carrying the light entry above. */
function dffWithLight(): Uint8Array {
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'a' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, 'model', { effects: build2dfxSection([{ bytes: lightEntry(), position: [1, 2, 3] }])! });
}

/** A one-triangle mesh encoded into a real DFF carrying the roadsign entry above. */
function dffWithRoadsign(): Uint8Array {
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'a' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, 'model', { effects: build2dfxSection([{ bytes: roadsignEntry(), position: [1, 2, 3] }])! });
}

/** A raw 2dfx light entry (type 0) at position (1, 2, 3) with the parser-known 49-byte payload. */
function lightEntry(): Uint8Array {
  const bytes = new Uint8Array(20 + 49);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, 1, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setUint32(12, 0, true); // type — light
  view.setUint32(16, 49, true);
  bytes.set([255, 0, 0, 255], 20);

  return bytes;
}

/** A raw 2dfx roadsign entry (type 7) at position (1, 2, 3) — the one WORLD-space type. */
function roadsignEntry(): Uint8Array {
  const bytes = new Uint8Array(20 + 88);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, 1, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setUint32(12, 7, true); // type — roadsign
  view.setUint32(16, 88, true);

  return bytes;
}

describe('collectClumpEffects', () => {
  describe('negative cases', () => {
    it('returns nothing for a model without a 2dfx section', () => {
      const plain = encodeLodDff(
        {
          colors: new Uint8Array(12).fill(255),
          groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'a' }],
          normals: new Float32Array(9),
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          uvs: new Float32Array(6),
        },
        'model',
      );

      expect(collectClumpEffects(plain, parseDff(toArrayBuffer(plain)))).toEqual([]);
    });

    it('filters entry types not in keepTypes', () => {
      const bytes = dffWithLight();

      expect(collectClumpEffects(bytes, parseDff(toArrayBuffer(bytes)), new Set([7]))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lifts a light entry with the identity frame applied (encoded clumps use one root frame)', () => {
      const bytes = dffWithLight();
      const effects = collectClumpEffects(bytes, parseDff(toArrayBuffer(bytes)));

      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe(0);
      expect(effects[0].position).toEqual([1, 2, 3]);
    });

    it('applies a non-identity geometry frame to the entry position', () => {
      const bytes = dffWithLight();
      const clump = parseDff(toArrayBuffer(bytes)) as { atomics: RWClump['atomics']; frames: RWClump['frames'] };
      clump.frames[clump.atomics[0].frameIndex].position = [10, 20, 30];
      const effects = collectClumpEffects(bytes, clump as RWClump);

      expect(effects[0].position).toEqual([11, 22, 33]);
    });

    it('leaves a WORLD-space entry where it was authored, whatever the frame says', () => {
      // The mirror of the test above, and the reason `spaceOf` is consulted here at all: a roadsign's
      // position is already a city coordinate, so nothing model-side may move it. Stock never notices — all
      // 207 roadsign-carrying atomics hang off an identity frame — which is exactly why it needs a test.
      const bytes = dffWithRoadsign();
      const clump = parseDff(toArrayBuffer(bytes)) as { atomics: RWClump['atomics']; frames: RWClump['frames'] };
      clump.frames[clump.atomics[0].frameIndex].position = [10, 20, 30];

      const effects = collectClumpEffects(bytes, clump as RWClump, new Set([7]));

      expect(effects).toHaveLength(1);
      expect(effects[0].position).toEqual([1, 2, 3]);
    });
  });
});
