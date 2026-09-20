import { describe, expect, it } from 'vitest';

import { isNativeToken, tokenOffset, TokenTable } from './native-tokens';
import { VarSpace } from './var-space';

describe('native tokens', () => {
  describe('negative cases', () => {
    it('rejects raw SA addresses and stdlib tokens', () => {
      expect(isNativeToken(0xb74494)).toBe(false);
      expect(isNativeToken(0x40000001)).toBe(false); // stdlib buffer
      expect(isNativeToken(0x4c000001)).toBe(false); // stdlib list
      expect(isNativeToken(0)).toBe(false);
      expect(isNativeToken(-1)).toBe(false);
    });

    it('resolve returns null for a token-shaped number never minted', () => {
      const table = new TokenTable();
      expect(table.resolve(0x50000000 | (999 << 12))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('mint → resolve round-trips the target', () => {
      const table = new TokenTable();
      const token = table.mint({ car: 257, kind: 'vehicle' });
      expect(isNativeToken(token)).toBe(true);
      expect(table.resolve(token)).toEqual({ offset: 0, target: { car: 257, kind: 'vehicle' } });
    });

    it('survives PLAIN integer arithmetic — the corpus adds offsets with 000A, not only INT_ADD', () => {
      const table = new TokenTable();
      const frame = table.mint({ car: 1, kind: 'frame', part: 7 });
      const matrix = frame + 16; // firela: ADD_VAL_TO_INT_LVAR 12@ 16
      const posY = frame + 68; // vandoor: INT_ADD 6@ 68
      expect(table.resolve(matrix)).toEqual({ offset: 16, target: { car: 1, kind: 'frame', part: 7 } });
      expect(table.resolve(posY)).toEqual({ offset: 68, target: { car: 1, kind: 'frame', part: 7 } });
      expect(tokenOffset(matrix - 56 + 48)).toBe(8); // rhino's -= 56 then += 48 dance stays decodable
    });

    it('round-trips through a 32-bit script var slot', () => {
      const table = new TokenTable();
      const token = table.mint({ kind: 'pool' });
      const vars = new VarSpace(2);
      vars.setInt(0, token + 4);
      expect(table.resolve(vars.int(0))).toEqual({ offset: 4, target: { kind: 'pool' } });
    });

    it('identical targets share one token (pointer equality works like SA)', () => {
      const table = new TokenTable();
      expect(table.mint({ car: 3, kind: 'clump' })).toBe(table.mint({ car: 3, kind: 'clump' }));
    });
  });
});
