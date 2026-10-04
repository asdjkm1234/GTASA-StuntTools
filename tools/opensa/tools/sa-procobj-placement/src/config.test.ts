import { PROC_OBJ_DRAW_DISTANCE } from '@opensa/map-placement/procobj';
import { describe, expect, it } from 'vitest';

import { config } from './config';

describe('config.drawDistance', () => {
  describe('negative cases', () => {
    it('stays BELOW 300 — at or above it these defs take SA’s big-building path', () => {
      // In-game bisection 2026-07-06: drawDistance 300 reproduces the ghost-barriers corruption (mass text-IPL
      // instances of a big-building def), 250 is clean. The layer now ships 91 092 such instances.
      expect(config.drawDistance).toBeLessThan(300);
    });

    it('is not left at the pre-014 value, which the stream gate made meaningless anyway', () => {
      // 290 was the LOD def's distance; a streamed row is only resident within 190 units of the player, so the
      // layer drew to ~190 whatever it said. Permanent rows made the column real, so the value matters now.
      expect(config.drawDistance).not.toBe(290);
    });
  });

  describe('positive cases', () => {
    it('matches the emitter default, so the two cannot drift apart', () => {
      expect(config.drawDistance).toBe(PROC_OBJ_DRAW_DISTANCE);
    });

    it('is ProperFixes’ 299 — the value their 57 583-row layer is measured running', () => {
      expect(config.drawDistance).toBe(299);
    });
  });
});
