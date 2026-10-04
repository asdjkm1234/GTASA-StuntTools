import type { TextureSource } from '@opensa/lod-common/texture-source';

import { encodeLodTxd } from '@opensa/lod-common/encode-txd';
import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { placeMap } from './place-map';

/**
 * Integration test for `--modloader` stage 2: drive the real `placeMap` over a synthetic game-dir (one binary
 * stream placing an HD tree + its companion text IPL + an IDE defining it) and assert the two-mod output — `lod/`
 * (the far-LOD attachment) + `hd/` (the swapped HD via a `txdp` IDE) — with **no stock IDE** anywhere.
 */
const WASHER_DFF = 'fixtures/original/dff/building/washer.dff'; // textures: junk_tv2, junk_washer1
const SOURCE = 'mytree';
const STOCK_TXD = 'mytreetxd';
const HD_ID = 700;

/** A minimal binary ("bnry") IPL with one INST per record — enough for `parseBinaryIpl` (id@28, lod@36). */
function binaryIpl(records: readonly { id: number; lod: number }[]): Uint8Array {
  const HEADER = 0x4c;
  const SIZE = 40;
  const buffer = new Uint8Array(HEADER + records.length * SIZE);
  const view = new DataView(buffer.buffer);
  buffer.set(new TextEncoder().encode('bnry'), 0);
  view.setUint32(0x04, records.length, true); // numInst
  view.setUint32(0x1c, HEADER, true); // instOffset
  records.forEach((record, i) => {
    const offset = HEADER + i * SIZE;
    view.setFloat32(offset + 8, 5, true); // z (a token position)
    view.setFloat32(offset + 24, 1, true); // rotation w
    view.setUint32(offset + 28, record.id, true);
    view.setInt32(offset + 36, record.lod, true);
  });

  return buffer;
}

/** A minimal valid TXD holding one named texture (the custom parent the stock TXD inherits from via `txdp`). */
function mintTxd(texture: string): Uint8Array {
  const source: TextureSource = {
    get: (name) =>
      name === texture ? { hasAlpha: false, height: 4, rgba: new Uint8Array(4 * 4 * 4), width: 4 } : null,
  };

  return encodeLodTxd([texture], source, 64, 'gamma');
}

/** Lay down a synthetic game-dir: gta.dat + stock IDE + companion text IPL + a gta3.img with one binary stream.
 *  `hdFlags` is the flags cell of the HD row — the LOD row inherits its vegetation bits (plan 013 step 02). */
function writeGame(game: string, hdFlags = 0): void {
  mkdirSync(join(game, 'data', 'maps'), { recursive: true });
  mkdirSync(join(game, 'models'), { recursive: true });
  writeFileSync(join(game, 'data', 'gta.dat'), 'IDE data/maps/stock.ide\nIPL data/maps/marea.ipl\n');
  writeFileSync(
    join(game, 'data', 'maps', 'stock.ide'),
    `objs\n${HD_ID}, ${SOURCE}, ${STOCK_TXD}, 299, ${hdFlags}\nend\n`,
  );
  writeFileSync(join(game, 'data', 'maps', 'marea.ipl'), 'inst\nend\n');
  writeFileSync(join(game, 'data', 'procobj.dat'), ''); // no procobj species
  const img = buildVer2Buffer([{ data: binaryIpl([{ id: HD_ID, lod: -1 }]), name: 'marea_stream0.ipl' }]);
  writeFileSync(join(game, 'models', 'gta3.img'), img);
}

/** The `--in` HD folder + the stage-1 baked intermediates `placeMap` reads from `<out>`. */
function writeInputsAndBaked(inDir: string, out: string): void {
  mkdirSync(inDir, { recursive: true });
  writeFileSync(join(inDir, `${SOURCE}.dff`), readFileSync(WASHER_DFF)); // a real, parseable swapped HD
  writeFileSync(join(inDir, 'custom.txd'), mintTxd('junk_tv2'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'lodmytree.dff'), Uint8Array.from([1, 2, 3])); // baked impostor (opaque to placeMap)
  writeFileSync(join(out, 'lodtrees.txd'), Uint8Array.from([4, 5, 6]));
  writeFileSync(join(out, 'lodtrees.col'), Uint8Array.from([7, 8, 9]));
}

describe('placeMap --modloader (two-mod output)', () => {
  let dir: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-trees-place-'));
    out = join(dir, 'out');
    writeGame(join(dir, 'game'));
    writeInputsAndBaked(join(dir, 'in'), out);
    placeMap({
      drawDistance: 1500,
      foliageTextures: new Set(),
      gamePath: join(dir, 'game'),
      impostors: [{ name: 'lodmytree', source: SOURCE }],
      inPath: join(dir, 'in'),
      modloader: true,
      outPath: out,
      prelight: false,
    });
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('rewrites no stock IDE — the only IDEs are our own lod/ + hd/ defs', () => {
      const ides = [...findFiles(out)].filter((f) => f.toLowerCase().endsWith('.ide')).sort();

      expect(ides).toEqual(['hd/data/maps/lodtrees_hd.ide', 'lod/data/maps/lodtrees.ide']);
    });

    it('patches no gta.dat and emits no standalone lodtrees.ipl', () => {
      expect(existsSync(join(out, 'data', 'gta.dat'))).toBe(false);
      expect(existsSync(join(out, 'lod', 'data', 'maps', 'lodtrees.ipl'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('emits exactly two mod folders, lod/ + hd/ (baked intermediates are cleaned by the adapter, post-placeMap)', () => {
      const dirs = readdirSync(out, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      expect(dirs).toEqual(['hd', 'lod']);
    });

    it('lod/: the modified stock IPL override + assets in gta3img/ + a one-line loader.txt', () => {
      expect(readFileSync(join(out, 'lod', 'loader.txt'), 'utf8')).toBe('IDE data/maps/lodtrees.ide\n');
      expect(existsSync(join(out, 'lod', 'data', 'maps', 'lodtrees.ide'))).toBe(true);
      expect(existsSync(join(out, 'lod', 'data', 'maps', 'marea.ipl'))).toBe(true); // stock text IPL override
      expect(existsSync(join(out, 'lod', 'gta3img', 'marea_stream0.ipl'))).toBe(true); // repointed binary stream
      expect(existsSync(join(out, 'lod', 'gta3img', 'lodtrees.txd'))).toBe(true);
      expect(existsSync(join(out, 'lod', 'gta3img', 'lodtrees.col'))).toBe(true);
    });

    it('hd/: the swapped HD DFF + custom parent TXD + a txdp IDE parenting the stock TXD', () => {
      expect(readFileSync(join(out, 'hd', 'loader.txt'), 'utf8')).toBe('IDE data/maps/lodtrees_hd.ide\n');
      expect(readFileSync(join(out, 'hd', 'data', 'maps', 'lodtrees_hd.ide'), 'utf8')).toBe(
        `txdp\n${STOCK_TXD}, custom\nend\n`,
      );
      expect(existsSync(join(out, 'hd', 'gta3img', `${SOURCE}.dff`))).toBe(true);
      expect(existsSync(join(out, 'hd', 'gta3img', 'custom.txd'))).toBe(true);
    });
  });
});

describe('placeMap vegetation flags on the impostor row (plan 013 step 02)', () => {
  let dir: string;

  /** Place one impostor over an HD row carrying `hdFlags`, and return its emitted `lodtrees.ide` row. */
  const lodRow = (hdFlags: number): string => {
    const out = join(dir, `out-${hdFlags}`);
    const game = join(dir, `game-${hdFlags}`);
    writeGame(game, hdFlags);
    writeInputsAndBaked(join(dir, `in-${hdFlags}`), out);
    placeMap({
      drawDistance: 1500,
      foliageTextures: new Set(),
      gamePath: game,
      impostors: [{ name: 'lodmytree', source: SOURCE }],
      inPath: join(dir, `in-${hdFlags}`),
      modloader: true,
      outPath: out,
      prelight: false,
    });

    return readFileSync(join(out, 'lod', 'data', 'maps', 'lodtrees.ide'), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.includes('lodmytree')) as string;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-trees-flags-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('inherits nothing when the HD row carries no vegetation bit', () => {
      expect(lodRow(0).endsWith(', 2097284')).toBe(true); // DEFAULT_FLAGS, unchanged
    });

    it('inherits ONLY the vegetation bits — the other flags of an HD row stay on the HD', () => {
      // 0x200048 = double-sided + additive + draw-last, no IS_TREE/IS_PALM.
      expect(lodRow(0x200048).endsWith(', 2097284')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('inherits IS_TREE from the HD row it replaces', () => {
      expect(lodRow(0x202084).endsWith(', 2105476')).toBe(true); // 0x200084 | IS_TREE
    });

    it('inherits IS_PALM the same way', () => {
      expect(lodRow(0x204084).endsWith(', 2113668')).toBe(true); // 0x200084 | IS_PALM
    });
  });
});

describe('placeMap per-area row budget (overflow migration)', () => {
  let dir: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-trees-budget-'));
    out = join(dir, 'out');
    const game = join(dir, 'game');
    writeGame(game);
    // Three HD trees in the stream + an empty text IPL: 0 text + 3 binary rows. With each tree gaining an
    // appended impostor the area would boot 6 rows; cap 4 forces ⌈(6−4)/2⌉ = 1 pair to migrate to plotr0.
    const img = buildVer2Buffer([
      {
        data: binaryIpl([
          { id: HD_ID, lod: -1 },
          { id: HD_ID, lod: -1 },
          { id: HD_ID, lod: -1 },
        ]),
        name: 'marea_stream0.ipl',
      },
    ]);
    writeFileSync(join(game, 'models', 'gta3.img'), img);
    writeInputsAndBaked(join(dir, 'in'), out);
    placeMap({
      areaRowCap: 4,
      drawDistance: 1500,
      foliageTextures: new Set(),
      gamePath: game,
      impostors: [{ name: 'lodmytree', source: SOURCE }],
      inPath: join(dir, 'in'),
      modloader: true,
      outPath: out,
      prelight: false,
    });
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('keeps the stock area at or under the cap', () => {
      const text = readFileSync(join(out, 'lod', 'data', 'maps', 'marea.ipl'), 'utf8');
      const textRows = text.split(/\r?\n/).filter((l) => l.trim() && /^\d/.test(l.trim())).length;
      const stream = readFileSync(join(out, 'lod', 'gta3img', 'marea_stream0.ipl'));
      const binRows = new DataView(stream.buffer, stream.byteOffset).getUint32(0x04, true);

      expect(textRows + binRows).toBeLessThanOrEqual(4);
      expect(binRows).toBe(2); // one HD migrated out of the stock stream
    });
  });

  describe('positive cases', () => {
    it('re-emits the migrated tree as a linked pair in the plotr0 overflow area', () => {
      const text = readFileSync(join(out, 'lod', 'data', 'maps', 'plotr0.ipl'), 'utf8');
      const rows = text.split(/\r?\n/).filter((l) => l.trim() && /^\d/.test(l.trim()));
      expect(rows).toHaveLength(1); // the impostor LOD row
      expect(rows[0]).toMatch(/, lodmytree, /);

      const stream = readFileSync(join(out, 'lod', 'gta3img', 'plotr0_stream0.ipl'));
      const view = new DataView(stream.buffer, stream.byteOffset);
      expect(view.getUint32(0x04, true)).toBe(1); // the migrated HD instance
      const instOffset = view.getUint32(0x1c, true);
      expect(view.getUint32(instOffset + 28, true)).toBe(HD_ID);
      expect(view.getInt32(instOffset + 36, true)).toBe(0); // lod → row 0 of plotr0.ipl
    });

    it('registers the overflow area in loader.txt after the IDE line', () => {
      const loader = readFileSync(join(out, 'lod', 'loader.txt'), 'utf8')
        .trim()
        .split('\n');

      expect(loader[0]).toBe('IDE data/maps/lodtrees.ide');
      expect(loader).toContain('IPL data/maps/plotr0.IPL');
    });
  });
});

/** Every file under `root`, as `/`-joined paths relative to it. */
function findFiles(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...findFiles(root, rel));
    } else {
      out.push(rel);
    }
  }

  return out;
}
