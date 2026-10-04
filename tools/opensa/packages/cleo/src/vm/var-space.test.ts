import { describe, expect, it } from 'vitest';

import { VarSpace } from './var-space';

describe('VarSpace', () => {
  describe('negative cases', () => {
    it('throws on an out-of-range slot', () => {
      const space = new VarSpace(4);
      expect(() => space.int(4)).toThrow();
    });
  });

  describe('positive cases', () => {
    it('reinterprets the same 32-bit slot as int and float (SCM typing is per opcode)', () => {
      const space = new VarSpace(4);
      space.setFloat(1, 90);
      expect(space.int(1)).toBe(0x42b40000);
      space.setInt(1, 0x42b40000);
      expect(space.float(1)).toBe(90);
    });

    it('stores strings across consecutive slots with NUL padding', () => {
      const space = new VarSpace(8);
      space.setString(2, 'windmill', 16);
      expect(space.string(2, 16)).toBe('windmill');
      // The 16-byte string occupies slots 2-5; slot 6 is untouched.
      expect(space.int(6)).toBe(0);
    });

    it('truncates a string to its field width', () => {
      const space = new VarSpace(4);
      space.setString(0, 'much-longer-than-eight', 8);
      expect(space.string(0, 8)).toBe('much-lon');
    });

    it('snapshot/restore round-trips the whole space (CLEO_CALL frames)', () => {
      const space = new VarSpace(4);
      space.setInt(0, 42);
      const saved = space.snapshot();
      space.setInt(0, 7);
      space.restore(saved);
      expect(space.int(0)).toBe(42);
    });
  });
});
