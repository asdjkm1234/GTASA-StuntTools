import { describe, expect, it } from 'vitest';

import { parseVehicleMods } from './vehicle-mods.parser';

describe('parseVehicleMods', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty or comment-only ledger', () => {
      // A stock install writes an EMPTY ledger, and a build predating the file has none at all: both mean
      // "no mod cars", and neither may be an error — video mode's preference simply has nothing to prefer.
      expect(parseVehicleMods('')).toEqual(new Set());
      expect(parseVehicleMods('# written by vehicle-installer\n\n')).toEqual(new Set());
    });

    it('drops a line that is only a comment or only whitespace', () => {
      expect(parseVehicleMods('previon\n   \n# infernus\n')).toEqual(new Set(['previon']));
    });
  });

  describe('positive cases', () => {
    it('reads one lowercased slot name per line, ignoring a trailing comment', () => {
      expect(parseVehicleMods('Previon\nINFERNUS  # a 1986 Starion in that slot\n')).toEqual(
        new Set(['infernus', 'previon']),
      );
    });

    it('reads several names on one line — the format is a list, not a column', () => {
      expect(parseVehicleMods('previon, infernus comet;sultan')).toEqual(
        new Set(['comet', 'infernus', 'previon', 'sultan']),
      );
    });
  });
});
