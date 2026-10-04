import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { emptyTxd, textureNames, unresolvedTextures } from './txd';

const BOBCAT_DFF = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.dff'));
const BOBCAT_TXD = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.txd'));
const VEHICLE_TXD = new Uint8Array(readFileSync('fixtures/original/models/generic/vehicle.txd'));

describe('txd', () => {
  describe('negative cases', () => {
    it('lists every unresolvable texture when nothing is available', () => {
      const missing = unresolvedTextures(BOBCAT_DFF, new Set());
      expect(missing.length).toBeGreaterThan(0);
      expect(missing).toContain('bobcat92interior128');
      expect(missing).toContain('vehiclegeneric256');
      // The runtime-generated plate textures never count as missing.
      expect(missing).not.toContain('carplate');
      expect(missing).not.toContain('carpback');
    });

    it('reads no names from bytes that are not a dictionary', () => {
      expect(textureNames(new Uint8Array([9, 9, 9, 9]))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('emits a valid empty dictionary a reader sees zero textures in', () => {
      const txd = emptyTxd();
      expect(txd.byteLength).toBeLessThan(64);
      expect(textureNames(txd)).toEqual([]);
    });

    it('reads the parent + generic names, and together they close the stock bobcat', () => {
      const parent = textureNames(BOBCAT_TXD);
      const generic = textureNames(VEHICLE_TXD);
      expect(parent).toContain('bobcat92interior128');
      expect(generic).toContain('vehiclegeneric256');
      expect(unresolvedTextures(BOBCAT_DFF, new Set([...parent, ...generic]))).toEqual([]);
    });
  });
});
