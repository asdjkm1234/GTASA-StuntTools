import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { Vec3 } from './mesh';

import { collectClumpEffects } from './clump-effects';
import { keepTypesFor, LOD_2DFX_POLICY, spaceOf, verdictFor } from './two-dfx-policy';

// A real refinery chimney: three light coronas beside a smoke emitter — the corona baseline every richer
// carried type is built on (`npm run test:fixtures`).
const CHIMNEY_DFF = 'fixtures/original/dff/particle/refchimny01.dff';

/** Every type the stock corpus actually carries (`scripts/debug/two-dfx-census.ts`, 14 865 models). */
const STOCK_TYPES = [0, 1, 3, 6, 7, 8, 9, 10];

/**
 * The world position of a light, computed independently of `collectClumpEffects`: the runtime parser's typed
 * light entry, mapped through its atomic's frame by hand. Two different readers of the same bytes.
 */
function parsedLightPositions(clump: RWClump): Vec3[] {
  return clump.atomics.flatMap((atomic) => {
    const frame = clump.frames[atomic.frameIndex];
    const r = frame.rotation;
    const t = frame.position;

    return clump.geometries[atomic.geometryIndex].lights.map(
      ({ position: [x, y, z] }): Vec3 => [
        r[0] * x + r[3] * y + r[6] * z + t[0],
        r[1] * x + r[4] * y + r[7] * z + t[1],
        r[2] * x + r[5] * y + r[8] * z + t[2],
      ],
    );
  });
}

describe('LOD 2dfx policy', () => {
  describe('negative cases', () => {
    it('drops a type with no row of its own, on every target', () => {
      expect(verdictFor(4, 'cell')).toBe('drop'); // sun glare — absent from the stock corpus
      expect(verdictFor(4, 'clone')).toBe('drop');
      expect(keepTypesFor('clone').has(4)).toBe(false);
    });

    it('keeps escalators off cells — our engine has no code that moves a step, at any range', () => {
      expect(verdictFor(10, 'cell')).toBe('drop');
      expect(keepTypesFor('cell').has(10)).toBe(false);
    });

    it('assumes model space for a type with no row, rather than re-basing an unknown entry', () => {
      expect(spaceOf(4)).toBe('model'); // sun glare — absent from the stock corpus
    });
  });

  describe('positive cases', () => {
    it('resolves to the cell set: the three types our engine consumes', () => {
      expect([...keepTypesFor('cell')].sort((a, b) => a - b)).toEqual([0, 1, 7]);
    });

    it('marks the roadsign as the one world-space type, and every other carried type as model-local', () => {
      expect(spaceOf(7)).toBe('world');
      for (const type of [...keepTypesFor('cell'), ...keepTypesFor('clone')]) {
        expect(spaceOf(type)).toBe(type === 7 ? 'world' : 'model');
      }
    });

    it('resolves to the clone set in force today: every type the stock corpus carries', () => {
      expect([...keepTypesFor('clone')].sort((a, b) => a - b)).toEqual(STOCK_TYPES);
    });

    it('keeps a rate-scaled type in the keep set — the scaling is on the payload, not on the ride', () => {
      expect(verdictFor(1, 'clone')).toBe('carry-rate-scaled');
      expect(keepTypesFor('clone').has(1)).toBe(true);
    });

    it('states a reason for every row', () => {
      for (const rule of LOD_2DFX_POLICY) {
        expect(rule.why.length).toBeGreaterThan(20);
      }
    });
  });
});

describe('carried coronas (decimate path)', () => {
  describe('positive cases', () => {
    it('lands every chimney corona where the runtime parser reads it', () => {
      const bytes = new Uint8Array(readFileSync(CHIMNEY_DFF));
      const clump = parseDff(toArrayBuffer(bytes));
      const expected = parsedLightPositions(clump);
      expect(expected).toHaveLength(3); // fixture sanity: the coronas exist to be carried

      const carried = collectClumpEffects(bytes, clump, keepTypesFor('cell')).filter((effect) => effect.type === 0);

      expect(carried).toHaveLength(3);
      carried.forEach((effect, index) => {
        effect.position.forEach((axis, component) => {
          expect(axis).toBeCloseTo(expected[index][component], 4);
        });
      });
    });

    it('carries the chimney smoke emitter too, now that a cell keeps type 1', () => {
      const bytes = new Uint8Array(readFileSync(CHIMNEY_DFF));
      const clump = parseDff(toArrayBuffer(bytes));

      const carried = collectClumpEffects(bytes, clump, keepTypesFor('cell'));

      expect(carried.filter((effect) => effect.type === 1)).toHaveLength(1);
    });
  });
});
