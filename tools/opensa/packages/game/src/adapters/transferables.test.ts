import { describe, expect, it } from 'vitest';

import { collectTransferables } from './transferables';

describe('collectTransferables', () => {
  describe('negative cases', () => {
    it('returns nothing for values without buffers', () => {
      expect(collectTransferables(null)).toEqual([]);
      expect(collectTransferables({ name: 'a', nested: { count: 1 } })).toEqual([]);
    });

    it('survives circular references', () => {
      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      expect(collectTransferables(cycle)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('collects buffers from nested typed arrays and dedupes shared ones', () => {
      const shared = new ArrayBuffer(24);
      const value = {
        models: [
          { positions: new Float32Array(shared, 0, 3), uv: new Float32Array(shared, 12, 3) },
          { index: new Uint16Array([1, 2, 3]) },
        ],
        raw: new ArrayBuffer(8),
      };
      const buffers = collectTransferables(value);
      expect(buffers).toHaveLength(3); // shared counted once + index buffer + raw
      expect(buffers).toContain(shared);
      expect(buffers).toContain(value.raw);
    });
  });
});
