import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyVehicle } from './apply-vehicle';

const IDE = '535, slamvan, slamvan, car, SLAMVAN, SLAMVAN, null, richfamily, 5, 0, 0, -1, 0.74, 0.74, 2';

let root: string;
let folder: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-apply-'));
  folder = join(root, 'slamvan - 1968 GMC Pickup Hammered - alfamodding');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'data'), { recursive: true });
  writeFileSync(join(out, 'data', 'vehicles.ide'), 'cars\n535, slamvan, slamvan, car, SLAMVAN\nend\n');
  writeFileSync(join(folder, 'slamvan.dff'), Uint8Array.of(1));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const CARMODS = ['mods', 'admiral, nto_b_l', 'slamvan, bnt_b_sc_l, nto_b_l', 'end', ''].join('\n');

describe('applyVehicle and the stock tuning line (plan 015)', () => {
  beforeEach(() => {
    writeFileSync(join(out, 'data', 'carmods.dat'), CARMODS);
  });

  describe('negative cases', () => {
    it("leaves another car's line alone", () => {
      applyVehicle(folder, out, { target: 'sa' });

      expect(readFileSync(join(out, 'data', 'carmods.dat'), 'latin1')).toContain('admiral, nto_b_l');
    });
  });

  describe('positive cases', () => {
    it('REMOVES the stock line when the car declares none — it was never adapted to that kit', () => {
      // The field crash this closes: a replaced model without the `ug_*` dummies kept being offered the stock
      // car's hood scoops, and installing one dies at 0x007F0BF7.
      writeFileSync(join(folder, 'slamvan.settings.txt'), [IDE, ''].join('\n'));

      applyVehicle(folder, out, { target: 'sa' });

      const text = readFileSync(join(out, 'data', 'carmods.dat'), 'latin1');
      expect(text).not.toContain('slamvan');
      expect(text).toContain('admiral, nto_b_l');
    });

    it('keeps the line the car DOES declare', () => {
      writeFileSync(join(folder, 'slamvan.settings.txt'), [IDE, '', 'slamvan, exh_b_l', ''].join('\n'));

      applyVehicle(folder, out, { target: 'sa' });

      const text = readFileSync(join(out, 'data', 'carmods.dat'), 'latin1');
      expect(text).toContain('slamvan, exh_b_l');
      expect(text).not.toContain('bnt_b_sc_l');
    });
  });
});

describe('applyVehicle (the settings-file fallback)', () => {
  describe('negative cases', () => {
    it('does not read a known file kind as the settings file when the folder ships none', () => {
      writeFileSync(join(folder, 'text.txt'), 'SLASH Slamin Hood\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings).toEqual([]);
      expect(applied.handlingId).toBeUndefined();
      expect(existsSync(join(out, 'cleo', 'cleo_text', 'slamvan.fxt'))).toBe(true);
    });

    it('still falls back to an unknown `.txt` — the pre-suffix mods have no other name', () => {
      writeFileSync(join(folder, 'readme.txt'), 'nothing a parser recognises\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings.join('\n')).toMatch(/readme\.txt: dropped an unrecognised block/);
      expect(applied.warnings.join('\n')).toMatch(/nothing recognised/);
    });
  });

  describe('positive cases', () => {
    it('reads the settings file and the two extra kinds in one pass', () => {
      writeFileSync(join(folder, 'slamvan.settings.txt'), IDE);
      writeFileSync(join(folder, 'text.txt'), 'SLASH Slamin Hood\n');

      const applied = applyVehicle(folder, out, { target: 'opensa' });

      expect(applied.warnings).toEqual([]);
      expect(applied.handlingId).toBe('SLAMVAN');
      expect(readFileSync(join(out, 'data', 'vehicles.ide'), 'latin1')).toContain('richfamily');
      expect(readFileSync(join(out, 'cleo', 'cleo_text', 'slamvan.fxt'), 'latin1')).toBe('SLASH\tSlamin Hood\r\n');
    });
  });
});

describe('applyVehicle (redirectRows)', () => {
  describe('negative cases', () => {
    it('does not merge the ide row into data/ when the caller takes it', () => {
      writeFileSync(join(folder, 'slamvan.settings.txt'), IDE);
      applyVehicle(folder, out, { redirectRows: () => undefined, target: 'opensa' });

      expect(readFileSync(join(out, 'data', 'vehicles.ide'), 'latin1')).not.toContain('richfamily');
    });
  });

  describe('positive cases', () => {
    it('hands the ide and handling lines to the caller instead', () => {
      const handling =
        'SLAMVAN 1950.0 4712.5 4.0 0.0 0.1 0.0 70 0.65 0.90 0.50 5 160.0 40.0 10.0 R P 10.0 0.50 0 28.0 1.6 0.12 0.0 0.35 -0.14 0.5 0.3 0.36 0.42 19000 40002000 2010000 0 0 0';
      writeFileSync(join(folder, 'slamvan.settings.txt'), `${IDE}\n\n${handling}`);
      const taken: { handlingLine?: string; ideLine?: string }[] = [];
      applyVehicle(folder, out, { redirectRows: (rows) => taken.push(rows), target: 'opensa' });

      expect(taken).toHaveLength(1);
      expect(taken[0].ideLine).toContain('richfamily');
      expect(taken[0].handlingLine).toContain('SLAMVAN');
    });

    it('still merges the blocks that stay baked', () => {
      writeFileSync(join(folder, 'slamvan.settings.txt'), `${IDE}\n\nslamvan, 3,3, 28,36`);
      mkdirSync(join(out, 'data'), { recursive: true });
      writeFileSync(join(out, 'data', 'carcols.dat'), 'car\nslamvan, 1,1\nend\n');
      applyVehicle(folder, out, { redirectRows: () => undefined, target: 'opensa' });

      expect(readFileSync(join(out, 'data', 'carcols.dat'), 'latin1')).toContain('28,36');
    });
  });
});
