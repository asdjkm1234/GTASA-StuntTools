/**
 * Which layer of the engine's plate atlas each distinct plate text lives at (plan 082/03).
 *
 * The atlas is a fixed array — its view is baked into every vehicle bind group, so it cannot grow. This
 * recycles it: identical text shares one layer (a street of taxis with the same plate costs one slot), and
 * a layer is reclaimed only once NO live car is wearing it. That refcount is the whole point — evicting a
 * slot still on screen would silently change a parked car's plate, and the LRU order alone cannot see that.
 */

/** Where a composed plate raster goes — the engine, or a fake in tests. */
export interface PlateSlotSink {
  uploadPlateText(slot: number, rgba: Uint8Array): void;
}

interface SlotEntry {
  lastUsed: number;
  refs: number;
  slot: number;
  text: string;
}

/**
 * Layer 0 is RESERVED and never handed out: a car whose plate has not been assigned reads it, so it holds a
 * blank plate rather than whatever text was allocated first.
 */
export const BLANK_PLATE_SLOT = 0;

export class PlateSlots {
  /** How many layers are currently occupied — the ledger number a full-map drive is measured by. */
  get used(): number {
    return this.byText.size;
  }
  private readonly bySlot: (null | SlotEntry)[];
  private readonly byText = new Map<string, SlotEntry>();
  /** A monotonic counter, not a clock: the recency order must not depend on wall time (tests, replays). */
  private clock = 0;

  private readonly sink: PlateSlotSink;

  constructor(sink: PlateSlotSink, capacity: number) {
    this.sink = sink;
    this.bySlot = new Array<null | SlotEntry>(Math.max(1, capacity)).fill(null);
  }

  /**
   * The layer `text` sits at, composing and uploading it on first use. `compose` is only called on a MISS,
   * so a respawning parked car re-requests its plate for the price of a map lookup.
   *
   * Returns {@link BLANK_PLATE_SLOT} when the atlas is full of plates that are all still being worn — a
   * blank plate on one car beats stealing a plate off another.
   */
  claim(text: string, compose: () => Uint8Array): number {
    const existing = this.byText.get(text);
    if (existing) {
      existing.refs += 1;
      existing.lastUsed = this.nextTick();

      return existing.slot;
    }
    const slot = this.freeSlot() ?? this.evictableSlot();
    if (slot === null) {
      return BLANK_PLATE_SLOT;
    }
    const previous = this.bySlot[slot];
    if (previous) {
      this.byText.delete(previous.text);
    }
    const entry: SlotEntry = { lastUsed: this.nextTick(), refs: 1, slot, text };
    this.bySlot[slot] = entry;
    this.byText.set(text, entry);
    this.sink.uploadPlateText(slot, compose());

    return slot;
  }

  /**
   * One fewer car wearing this layer. The raster STAYS resident at zero refs — a plate whose car despawned
   * is exactly the plate most likely to be asked for again when it respawns; it is merely evictable now.
   */
  release(slot: number): void {
    const entry = this.bySlot[slot];
    if (entry && entry.refs > 0) {
      entry.refs -= 1;
    }
  }

  /** The least recently used layer nobody is wearing, or null when every plate is on a live car. */
  private evictableSlot(): null | number {
    let oldest: null | SlotEntry = null;
    for (const entry of this.bySlot) {
      if (entry && entry.refs === 0 && (!oldest || entry.lastUsed < oldest.lastUsed)) {
        oldest = entry;
      }
    }

    return oldest ? oldest.slot : null;
  }

  private freeSlot(): null | number {
    for (let slot = BLANK_PLATE_SLOT + 1; slot < this.bySlot.length; slot += 1) {
      if (!this.bySlot[slot]) {
        return slot;
      }
    }

    return null;
  }

  private nextTick(): number {
    this.clock += 1;

    return this.clock;
  }
}
