import { TIMER_A } from '@opensa/cleo/vm/thread';
import { describe, expect, it } from 'vitest';

import { LvarAllocator, LvarError } from './lvars';

describe('LvarAllocator', () => {
  describe('negative cases', () => {
    it('throws on a duplicate name', () => {
      const lvars = new LvarAllocator();
      lvars.alloc('x', 'int');
      expect(() => lvars.alloc('x', 'float')).toThrow(LvarError);
    });

    it('throws on a name that was never allocated', () => {
      expect(() => new LvarAllocator().slotOf('ghost')).toThrow('not allocated');
    });

    it('never hands out the timer slots', () => {
      const lvars = new LvarAllocator();
      for (let index = 0; index < TIMER_A; index += 1) {
        lvars.alloc(`v${index}`, 'int');
      }
      expect(() => lvars.alloc('one-too-many', 'int')).toThrow('slots 0-31 are full');
    });

    it('rejects a long string that would overlap the timers', () => {
      const lvars = new LvarAllocator();
      for (let index = 0; index < TIMER_A - 2; index += 1) {
        lvars.alloc(`v${index}`, 'int');
      }
      expect(() => lvars.alloc('s', 'string16')).toThrow(LvarError);
    });
  });

  describe('positive cases', () => {
    it('allocates in declaration order', () => {
      const lvars = new LvarAllocator();
      expect(lvars.alloc('a', 'int')).toBe(0);
      expect(lvars.alloc('b', 'float')).toBe(1);
      expect(lvars.slotOf('a')).toBe(0);
    });

    it('gives long strings their consecutive slots (string8 = 2, string16 = 4)', () => {
      const lvars = new LvarAllocator();
      expect(lvars.alloc('s8', 'string8')).toBe(0);
      expect(lvars.alloc('s16', 'string16')).toBe(2);
      expect(lvars.alloc('next', 'int')).toBe(6);
    });
  });
});
