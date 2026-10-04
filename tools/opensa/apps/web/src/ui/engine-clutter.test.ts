import { describe, expect, it } from 'vitest';

import { clutterRingRadius } from './engine-clutter';

const settings = (
  entries: Record<string, { drawDistance: number; enabled?: boolean }>,
): Record<string, { drawDistance: number; enabled: boolean }> =>
  Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      { drawDistance: value.drawDistance, enabled: value.enabled ?? true },
    ]),
  );

describe('clutterRingRadius', () => {
  describe('negative cases', () => {
    it('is zero when every category is disabled — nothing is streamed for a layer nobody draws', () => {
      expect(clutterRingRadius(settings({ grass: { drawDistance: 100, enabled: false } }))).toBe(0);
    });

    it('ignores a disabled category that is the widest — a dead knob may not widen the ring', () => {
      expect(
        clutterRingRadius(settings({ grass: { drawDistance: 100 }, trees: { drawDistance: 300, enabled: false } })),
      ).toBe(100);
    });
  });

  describe('positive cases', () => {
    it('is the WIDEST enabled range, not the narrowest — a category cannot draw past its cell', () => {
      expect(
        clutterRingRadius(
          settings({ grass: { drawDistance: 100 }, rocks: { drawDistance: 200 }, trees: { drawDistance: 300 } }),
        ),
      ).toBe(300);
    });
  });
});
