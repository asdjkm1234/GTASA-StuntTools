import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { config as lodDefaults } from '@opensa/opensa-lod-generator/lod.config';
import { config as procobjDefaults } from '@opensa/sa-procobj-placement/config';
import { describe, expect, it } from 'vitest';

import { config, PACK_RECTS } from './config';

describe('builder config invariants (plan 087)', () => {
  describe('negative cases', () => {
    it('never lets the cell-LOD bake grid diverge from the render grid (the split-slot regression)', () => {
      // Field-proven on gostown: a 256 bake vs the 250 pak put the bridge span's HD in slot 5,−7 and its
      // LOD in 5,−6 — at spawn NEITHER level loaded. Equal sizes make both sides bucket every instance by
      // the same floor(pivot / cell), so an object's HD and LOD always share a streaming slot.
      expect(config.lodCellSize).toBe(CELL_SIZE);
      expect(lodDefaults.cellSize).toBe(CELL_SIZE);
    });

    it('never ships a procobj density other than vanilla by accident (07/04)', () => {
      // The knob exists for measurement sweeps. A default other than 1 would change what EVERY build
      // scatters, silently and map-wide — the shipped density is a decision 07/02 has to make explicitly.
      expect(config.procobjDensity).toBe(1);
      expect(procobjDefaults.density).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('keeps every PACK_RECTS rect normalized (x0 ≤ x1, y0 ≤ y1) with a full rect per pinned game', () => {
      for (const [game, rects] of Object.entries(PACK_RECTS)) {
        expect(rects.full, `${game} needs a full rect`).toBeDefined();
        for (const [name, [x0, y0, x1, y1]] of Object.entries(rects)) {
          expect(x0, `${game}.${name}`).toBeLessThanOrEqual(x1);
          expect(y0, `${game}.${name}`).toBeLessThanOrEqual(y1);
        }
      }
    });

    it('keeps the original full rect at the historical ±12 (byte-identical reruns of existing paks)', () => {
      expect(PACK_RECTS.original.full).toEqual([-12, -12, 12, 12]);
    });
  });
});
