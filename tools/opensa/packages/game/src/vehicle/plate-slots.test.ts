import { describe, expect, it } from 'vitest';

import { BLANK_PLATE_SLOT, PlateSlots } from './plate-slots';

/** A sink that records what was uploaded where. */
function sink(): { slots: PlateSlots; uploads: number[] } {
  const uploads: number[] = [];
  const slots = new PlateSlots({ uploadPlateText: (slot: number): void => void uploads.push(slot) }, 4);

  return { slots, uploads };
}

const raster = (): Uint8Array => new Uint8Array(64 * 16 * 4);

describe('PlateSlots', () => {
  describe('negative cases', () => {
    it('never hands out the reserved blank layer', () => {
      const { slots } = sink();

      expect(slots.claim('AA11 1AA', raster)).not.toBe(BLANK_PLATE_SLOT);
    });

    it('falls back to the blank plate when every layer is still being worn', () => {
      const { slots } = sink(); // capacity 4 → 3 usable layers
      slots.claim('a', raster);
      slots.claim('b', raster);
      slots.claim('c', raster);

      // Stealing a layer off a car still on screen would silently change ITS plate.
      expect(slots.claim('d', raster)).toBe(BLANK_PLATE_SLOT);
    });

    it('does not evict a layer whose refcount is merely back to one', () => {
      const { slots } = sink();
      const shared = slots.claim('a', raster);
      slots.claim('a', raster); // a second car wears the same text
      slots.claim('b', raster);
      slots.claim('c', raster);
      slots.release(shared); // one of the two leaves

      expect(slots.claim('d', raster)).toBe(BLANK_PLATE_SLOT);
    });

    it('ignores a release on a layer that was never claimed', () => {
      const { slots } = sink();

      expect(() => slots.release(3)).not.toThrow();
      expect(slots.used).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('composes and uploads once per distinct text', () => {
      const { slots, uploads } = sink();

      const first = slots.claim('AA11 1AA', raster);
      const again = slots.claim('AA11 1AA', raster);

      expect(again).toBe(first);
      expect(uploads).toEqual([first]); // the second car costs a map lookup, not a compose
      expect(slots.used).toBe(1);
    });

    it('does not call compose on a hit', () => {
      const { slots } = sink();
      let composed = 0;
      const counting = (): Uint8Array => {
        composed += 1;

        return raster();
      };
      slots.claim('a', counting);
      slots.claim('a', counting);

      expect(composed).toBe(1);
    });

    it('gives each distinct text its own layer', () => {
      const { slots } = sink();

      expect(new Set([slots.claim('a', raster), slots.claim('b', raster), slots.claim('c', raster)]).size).toBe(3);
    });

    it('reuses a released layer for a new plate, oldest first', () => {
      const { slots } = sink();
      const a = slots.claim('a', raster);
      const b = slots.claim('b', raster);
      slots.claim('c', raster);
      slots.release(a);
      slots.release(b);

      // `a` was released first AND used first — the least recently used of the two free layers.
      expect(slots.claim('d', raster)).toBe(a);
      expect(slots.claim('e', raster)).toBe(b);
    });

    it('keeps a released plate resident until its layer is actually needed', () => {
      const { slots, uploads } = sink();
      const a = slots.claim('a', raster);
      slots.release(a);

      // A despawned parked car is exactly the plate most likely to be asked for again.
      expect(slots.claim('a', raster)).toBe(a);
      expect(uploads).toEqual([a]);
    });

    it('drops the evicted text so it composes afresh next time', () => {
      const { slots, uploads } = sink();
      const a = slots.claim('a', raster);
      slots.release(a);
      slots.claim('b', raster);
      slots.claim('c', raster);
      const d = slots.claim('d', raster); // takes a's layer

      expect(d).toBe(a);
      expect(slots.claim('a', raster)).toBe(BLANK_PLATE_SLOT); // 'a' is gone, and nothing is free
      expect(uploads).toEqual([a, expect.any(Number), expect.any(Number), d]);
    });
  });
});
