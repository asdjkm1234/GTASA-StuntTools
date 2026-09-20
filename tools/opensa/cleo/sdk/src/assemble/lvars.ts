/**
 * Deterministic local-variable allocation (plan cleo-sdk/002 decision 4), pinned to the VM's slot
 * layout: 32-bit slots, long strings occupying consecutive slots, TIMERA/TIMERB reserved — the
 * constants come from `@opensa/cleo`, never copied.
 */
import { TIMER_A } from '@opensa/cleo/vm/thread';

export type LvarKind = 'float' | 'int' | 'string8' | 'string16';

/** Slots per kind — the `VarSpace` layout (string8 = 2 slots, string16 = 4). */
const SLOTS: Readonly<Record<LvarKind, number>> = { float: 1, int: 1, string8: 2, string16: 4 };

/** Declaration-ordered slot allocator over the thread's locals; timers are never handed out. */
export class LvarAllocator {
  private readonly byName = new Map<string, number>();
  private next = 0;

  /** Allocate `name` and return its first slot. */
  alloc(name: string, kind: LvarKind): number {
    if (this.byName.has(name)) {
      throw new LvarError(`local "${name}" already allocated`);
    }
    const slot = this.next;
    if (slot + SLOTS[kind] > TIMER_A) {
      throw new LvarError(`local "${name}" (${kind}) does not fit: slots 0-${TIMER_A - 1} are full`);
    }
    this.byName.set(name, slot);
    this.next = slot + SLOTS[kind];

    return slot;
  }

  /** The slot of an allocated local. */
  slotOf(name: string): number {
    const slot = this.byName.get(name);
    if (slot === undefined) {
      throw new LvarError(`local "${name}" is not allocated`);
    }

    return slot;
  }
}

export class LvarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LvarError';
  }
}
