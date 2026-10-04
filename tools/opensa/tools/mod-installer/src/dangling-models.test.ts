import { createImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkDanglingModels, findDanglingModels } from './dangling-models';

/**
 * The relation under test spans four files (gta.dat → IDE → IPL → archive), so the tree is built explicitly
 * rather than from a fixture. The numbers it stands for came off the real pair of installs the field case was
 * bisected with: 0 dangling in the working build, 5 in the one carrying mod 60 — 10 of those placements in a
 * binary stream and 11 in text IPLs, which is why both placement paths are exercised here.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dangling-'));
});

/** A minimal `bnry` stream: 76-byte header (`numInst` @0x04, `instOffset` @0x1C) + one 40-byte INST each. */
function binaryIpl(ids: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(76 + ids.length * 40);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('bnry'), 0);
  view.setUint32(0x04, ids.length, true);
  view.setUint32(0x1c, 76, true);
  ids.forEach((id, index) => {
    // 40-byte record: position (12) + rotation (16), then id @28, interior @32, lod @36.
    view.setInt32(76 + index * 40 + 28, id, true);
    view.setInt32(76 + index * 40 + 36, -1, true);
  });

  return bytes;
}

/** A tree with one IDE (`objs`) + one text IPL + `gta3.img`, wired through gta.dat. */
function tree(options: {
  /** `id, model` rows the IDE declares. */
  declared: readonly [number, string][];
  /** `.dff` entries the archive carries. */
  dffs: readonly string[];
  /** ids the text IPL places. */
  placed: readonly number[];
  /** ids a binary stream inside the archive places. */
  streamed?: readonly number[];
}): string {
  write('data/gta.dat', 'IDE DATA\\MAPS\\test.IDE\nIPL DATA\\MAPS\\test.IPL\n');
  const objs = options.declared.map(([id, model]) => `${id}, ${model}, ${model}_txd, 299, 0`).join('\n');
  write('data/maps/test.IDE', `objs\n${objs}\nend\n`);
  const inst = options.placed.map((id) => `${id}, model${id}, 0, 0, 0, 0, 0, 0, 0, 1, -1`).join('\n');
  write('data/maps/test.IPL', `inst\n${inst}\nend\n`);

  const img = createImg();
  for (const name of options.dffs) {
    img.set(name, Uint8Array.of(1));
  }
  if (options.streamed !== undefined) {
    img.set('test_stream0.ipl', binaryIpl(options.streamed));
  }
  write('models/gta3.img', img.build());

  return dir;
}

function write(relative: string, contents: string | Uint8Array): void {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

describe('findDanglingModels', () => {
  describe('negative cases', () => {
    it('reports a placed model whose .dff is in no archive, with its placement count', () => {
      const game = tree({
        declared: [
          [100, 'kept'],
          [200, 'retired'],
        ],
        dffs: ['kept.dff'],
        placed: [100, 200, 200],
      });

      expect(findDanglingModels(game)).toEqual([
        { id: 200, ide: 'DATA\\MAPS\\test.IDE', modelName: 'retired', placements: 2 },
      ]);
    });

    it('counts placements from a binary stream inside the archive, not only from text IPLs', () => {
      const game = tree({ declared: [[200, 'retired']], dffs: [], placed: [], streamed: [200, 200, 200] });

      expect(findDanglingModels(game)).toEqual([
        { id: 200, ide: 'DATA\\MAPS\\test.IDE', modelName: 'retired', placements: 3 },
      ]);
    });

    it('throws naming every offender — the build must not produce a world that cannot stream', () => {
      const game = tree({ declared: [[200, 'retired']], dffs: [], placed: [200] });

      expect(() => checkDanglingModels(game)).toThrow(/retired \(id 200, 1 placement/);
    });
  });

  describe('positive cases', () => {
    it('stays silent for a declared model nothing places (stock ships one: carupg_int_rays)', () => {
      const game = tree({
        declared: [
          [100, 'kept'],
          [200, 'unplaced'],
        ],
        dffs: ['kept.dff'],
        placed: [100],
      });

      expect(findDanglingModels(game)).toEqual([]);
      expect(() => checkDanglingModels(game)).not.toThrow();
    });

    it('accepts a retired model whose entry carries a stub instead of being deleted', () => {
      const game = tree({ declared: [[200, 'retired']], dffs: ['kept.dff', 'retired.dff'], placed: [200] });

      expect(findDanglingModels(game)).toEqual([]);
    });

    it('accepts a .dff that sits loose on disk rather than inside an archive', () => {
      const game = tree({ declared: [[200, 'retired']], dffs: [], placed: [200] });
      write('models/RETIRED.DFF', Uint8Array.of(1));

      expect(findDanglingModels(game)).toEqual([]);
    });
  });
});
