/**
 * The game-dir file system, over a REAL `.img` (plan opensa-pack/003 phase 1).
 *
 * The archive is read through a FILE HANDLE — the directory up front, each entry sliced on demand — because
 * buffering the whole thing is what Node refuses past 2 GB, and the converter hit exactly that on its own
 * output once the per-model files went in. The fixture is a real VER2 archive holding `admiral.dff`, so the
 * directory parse, the sector offsets and the loose/basename fallbacks are all exercised on shipped bytes.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openGameDir } from './game-fs';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opensa-game-fs-'));
  mkdirSync(join(root, 'models', 'generic'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  copyFileSync(join(FIXTURES, 'img', 'admiral.img'), join(root, 'models', 'gta3.img'));
  copyFileSync(join(FIXTURES, 'vehicles', 'admiral.txd'), join(root, 'models', 'generic', 'vehicle.txd'));
  writeFileSync(join(root, 'data', 'water.dat'), 'processed\n');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('openGameDir', () => {
  describe('negative cases', () => {
    it('returns null for a name no archive and no loose file carries', () => {
      const fs = openGameDir(root);

      expect(fs.get('nothing_here.dff')).toBeNull();
      expect(fs.has('nothing_here.dff')).toBe(false);
    });

    it('does not serve the archive itself as a loose file', () => {
      const fs = openGameDir(root);

      // `.img` files are the archives, not members — indexing them as loose entries would hand a whole
      // 1 GB archive to a DFF parser.
      expect(fs.get('gta3.img')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('reads an archive MEMBER by bare name, sliced from the file rather than buffered', () => {
      const fs = openGameDir(root);
      const dff = fs.get('admiral.dff');

      expect(dff).not.toBeNull();
      expect(dff!.byteLength).toBeGreaterThan(1000);
      // RenderWare clumps start with a CLUMP chunk (0x10) — proof the offset maths landed on the entry.
      expect(new DataView(dff!).getUint32(0, true)).toBe(0x10);
      expect(fs.has('admiral.dff')).toBe(true);
      expect(fs.names).toContain('admiral.dff');
    });

    it('resolves a loose file by PATH and by bare basename, the way the runtime VFS does', () => {
      const fs = openGameDir(root);

      expect(fs.getText('data/water.dat')).toBe('processed\n');
      // `models/generic/vehicle.txd` is asked for as `vehicle.txd` by the vehicle builder.
      expect(fs.get('models/generic/vehicle.txd')).not.toBeNull();
      expect(fs.get('vehicle.txd')).not.toBeNull();
    });

    it('lets an overlay dir shadow an archive member', () => {
      const overlay = join(root, 'overlay');
      mkdirSync(overlay, { recursive: true });
      writeFileSync(join(overlay, 'admiral.dff'), 'overlaid');
      const fs = openGameDir(root, [overlay]);

      expect(new TextDecoder().decode(fs.get('admiral.dff')!)).toBe('overlaid');
    });
  });
});
