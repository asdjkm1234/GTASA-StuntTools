import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SPECIAL_FEATURES_DAT, writeModelSpecialFeatures } from './special-features';

/** The adjuster's own file as the mod ships it: CRLF, comments, one commented example, no trailing newline. */
const SHIPPED = ['# Author: fastman92', '# CustomModelName StandardModelName', '#new_hydra hydra'].join('\r\n');
const INI = 'fastman92limitAdjuster_GTASA.ini';
const LOADER_ON = '[SPECIAL]\r\nEnable model special feature loader = 1\r\n';
const LOADER_OFF = '[SPECIAL]\r\n#Enable model special feature loader = 0\r\n';

let root: string;

/** A built game dir; `dat`/`ini` absent means the adjuster mod did not install that half. */
function builtGame(options: { dat?: string; ini?: string } = {}): string {
  const target = join(root, 'built');
  mkdirSync(join(target, 'data'), { recursive: true });
  if (options.dat !== undefined) {
    writeFileSync(join(target, SPECIAL_FEATURES_DAT), options.dat);
  }
  if (options.ini !== undefined) {
    writeFileSync(join(target, INI), options.ini);
  }

  return target;
}

function datOf(target: string): string {
  return readFileSync(join(target, SPECIAL_FEATURES_DAT), 'utf8');
}

/** The pairs our block holds, in file order — the comment lines are noise for most assertions. */
function mappings(target: string): string[] {
  return datOf(target)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-special-features-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('writeModelSpecialFeatures', () => {
  describe('negative cases', () => {
    it('writes nothing when the adjuster file is absent, and says the declarations reach nothing', () => {
      const target = builtGame();

      const report = writeModelSpecialFeatures(target, new Map([['feltzer', ['UP/DOWN_LIGHTS']]]));

      expect(report.written).toBe(false);
      expect(existsSync(join(target, SPECIAL_FEATURES_DAT))).toBe(false);
      expect(report.warnings.join('\n')).toMatch(/limit adjuster is not installed/);
    });

    it('stays quiet about an absent adjuster file when no mod declared anything', () => {
      const report = writeModelSpecialFeatures(builtGame(), new Map());

      expect(report).toEqual({ lines: [], warnings: [], written: false });
    });

    it('warns when the ini does not enable the loader — a file the game reads is not the same as a mapping', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_OFF });

      const report = writeModelSpecialFeatures(target, new Map([['feltzer', ['UP/DOWN_LIGHTS']]]));

      expect(report.lines).toEqual(['feltzer zr350']);
      expect(report.warnings.join('\n')).toMatch(/does not enable the loader/);
    });

    it('warns when no adjuster ini sits in the target at all', () => {
      const target = builtGame({ dat: SHIPPED });

      const report = writeModelSpecialFeatures(target, new Map([['feltzer', ['UP/DOWN_LIGHTS']]]));

      expect(report.warnings.join('\n')).toMatch(/no fastman92limitAdjuster\*\.ini/);
    });

    it('maps nothing for a declaration of tokens outside the vocabulary, and names them', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(target, new Map([['admiral', ['UP_DOWN_LIGTHS']]]));

      expect(mappings(target)).toEqual([]);
      expect(report.warnings.join('\n')).toMatch(/UP_DOWN_LIGTHS — no token of the feature vocabulary/);
    });

    it('writes no line for a slot that natively carries what it declares, and says nothing about it', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(
        target,
        new Map([
          ['bandito', ['ADV_HYDRALICS']],
          ['zr350', ['UP/DOWN_LIGHTS']],
        ]),
      );

      expect(report).toEqual({ lines: [], warnings: [], written: true });
    });
  });

  describe('positive cases', () => {
    it('maps each model onto a stock carrier and keeps every line the adjuster mod shipped', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(
        target,
        new Map([
          ['bullet', ['ADV_HYDRALICS']],
          ['feltzer', ['UP/DOWN_LIGHTS']],
        ]),
      );

      expect(report.warnings).toEqual([]);
      // Sorted by model, so the file a rebuild writes is the same file.
      expect(report.lines).toEqual(['bullet hotknife', 'feltzer zr350']);
      expect(mappings(target)).toEqual(['bullet hotknife', 'feltzer zr350']);
      expect(datOf(target)).toContain('# Author: fastman92');
      expect(datOf(target)).toContain('#new_hydra hydra');
      // The adjuster reads a CRLF file; rewriting it in LF would be a change nobody asked for.
      expect(datOf(target).includes('\n') && !datOf(target).includes('\r\n')).toBe(false);
    });

    it('rebuilds byte-identically — the second install neither duplicates the block nor grows the file', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });
      const features = new Map([['feltzer', ['UP/DOWN_LIGHTS']]]);

      writeModelSpecialFeatures(target, features);
      const first = readFileSync(join(target, SPECIAL_FEATURES_DAT));
      writeModelSpecialFeatures(target, features);

      expect(readFileSync(join(target, SPECIAL_FEATURES_DAT))).toEqual(first);
    });

    it('rewrites the whole block when it speaks for every model — a dropped features.txt loses its line', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });
      writeModelSpecialFeatures(target, new Map([['feltzer', ['UP/DOWN_LIGHTS']]]));

      writeModelSpecialFeatures(target, new Map([['bullet', ['ADV_HYDRALICS']]]));

      expect(mappings(target)).toEqual(['bullet hotknife']);
    });

    it('merges when it speaks for some models only — a rebake may not disarm the rest of the fleet', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });
      writeModelSpecialFeatures(
        target,
        new Map([
          ['bullet', ['ADV_HYDRALICS']],
          ['feltzer', ['UP/DOWN_LIGHTS']],
        ]),
      );

      // A rebake of two cars: one declares something else now, the other no longer declares anything.
      writeModelSpecialFeatures(target, new Map([['bullet', ['BF_ENGINE&HYDRALICS']]]), new Set(['bullet', 'oceanic']));

      expect(mappings(target)).toEqual(['bullet bfinject', 'feltzer zr350']);
    });

    it('picks the one carrier covering several abilities at once', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(target, new Map([['barracks', ['TURRETS_1', 'WATER_JETS']]]));

      expect(report.lines).toEqual(['barracks swatvan']);
      expect(report.warnings).toEqual([]);
    });

    it('says which ability it had to drop when no single carrier has them all', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(target, new Map([['admiral', ['ADV_HYDRALICS', 'UP/DOWN_LIGHTS']]]));

      expect(report.lines).toEqual(['admiral hotknife']);
      expect(report.warnings.join('\n')).toMatch(/dropping UP\/DOWN_LIGHTS/);
    });

    it('says what a remapped stock slot loses — the abilities it had and did not declare', () => {
      const target = builtGame({ dat: SHIPPED, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(target, new Map([['firetruk', ['UP/DOWN_LIGHTS']]]));

      expect(report.lines).toEqual(['firetruk zr350']);
      expect(report.warnings.join('\n')).toMatch(/natively carries TURRETs_2 WATER_JETs and does not declare it/);
    });

    it('names a model the adjuster file already maps outside our block — only one of the two lines wins', () => {
      const target = builtGame({ dat: `${SHIPPED}\r\nfeltzer hydra`, ini: LOADER_ON });

      const report = writeModelSpecialFeatures(target, new Map([['feltzer', ['UP/DOWN_LIGHTS']]]));

      expect(datOf(target)).toContain('feltzer hydra');
      expect(report.warnings.join('\n')).toMatch(/already maps it outside our block/);
    });
  });
});
