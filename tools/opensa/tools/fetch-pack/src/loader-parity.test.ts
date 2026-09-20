import type { InstallIo } from '@opensa/loaders';

import { assembleInstallSource, selectInstallEntries } from '@opensa/loaders';
import { createImg } from '@opensa/tool-kit/archive/img';
import { unzipSync } from 'fflate';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchPack } from './fetch-pack';

/**
 * **The two loaders must fill the VFS with the same KEYS.**
 *
 * The runtime resolves everything by name out of one flat map, and which loader filled it is meant to be
 * invisible. It was not, twice in one day (plan 086's field find): the fetch pack shipped `models/*.img` as
 * opaque files, so the player ped and every collision library were unreachable; and it kept the on-disk
 * spelling of loose paths, so 32 of gostown's 67 files were invisible and the map lost 90 % of its
 * placements while still RENDERING off the pak. Both were silent — the game boots and only throws when
 * something happens to ask for a missing name.
 *
 * Nothing compared the two key spaces. This does. The invariant is CONTAINMENT, not equality: the local
 * loader ingests the IDE/IPL-referenced selection, the pack ships every archive entry, and a superset is the
 * safe direction. What may never happen is a key the local loader would have served going missing from the
 * pack.
 *
 * The fixture is deliberately awkward in the ways a real total conversion is — a mixed-case map folder, an
 * override archive, a model that only the override carries — because those are the cases that broke.
 */

/** Every VFS key the local loader would ingest for the same build. */
async function localKeys(root: string): Promise<Set<string>> {
  const plan = await selectInstallEntries(await assembleInstallSource(nodeInstallIo(root)));

  return new Set([
    ...plan.loose,
    ...[...plan.models, ...plan.textures, ...plan.others].map((entry) => entry.name.toLowerCase()),
  ]);
}

/** An {@link InstallIo} over a real directory: the Node backing, beside the FSA and HTTP ones. */
function nodeInstallIo(root: string): InstallIo {
  const paths = [...walk(root)].map((file) => relative(root, file).split(sep).join('/').toLowerCase());
  const real = new Map(
    [...walk(root)].map((file) => [relative(root, file).split(sep).join('/').toLowerCase(), file] as const),
  );
  const read = (path: string): Uint8Array => new Uint8Array(readFileSync(real.get(path) ?? path));

  return {
    archiveSource: (path): Promise<{ size: number; slice: (a: number, b: number) => Promise<Uint8Array> }> => {
      const bytes = read(path);

      return Promise.resolve({
        size: bytes.byteLength,
        slice: (a: number, b: number): Promise<Uint8Array> => Promise.resolve(bytes.subarray(a, b)),
      });
    },
    openLoose: (path) => Promise.resolve(new Blob([read(path) as unknown as BlobPart])),
    paths,
    readLoose: (path) => Promise.resolve(read(path)),
  };
}

/** Every VFS key the pack's chunks deliver. */
function packedKeys(outDir: string): Set<string> {
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as {
    chunks: Record<string, { file: string }[]>;
  };
  const keys = Object.values(manifest.chunks)
    .flat()
    .flatMap((chunk) => Object.keys(unzipSync(readFileSync(join(outDir, chunk.file)))));

  // A sliced entry rides as `<name>#0..#N`; the VFS reassembles it, so the KEY the runtime sees is the stem.
  return new Set(keys.map((key) => key.replace(/#\d+$/, '')));
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && statSync(path).size > 0) {
      yield path;
    }
  }
}

const IDE = ['objs', '100, gp_road, gp_roadtxd, 300, 0', '200, gp_tower, gp_towertxd, 300, 0', 'end'].join('\n');
const IPL = ['inst', '100, gp_road, 0, 0, 0, 0, 0, 0, 0, 1, 0', '200, gp_tower, 0, 5, 5, 0, 0, 0, 0, 1, 0', 'end'].join(
  '\n',
);

function img(entries: Record<string, string>): Uint8Array {
  const archive = createImg();
  for (const [name, text] of Object.entries(entries)) {
    archive.set(name, new TextEncoder().encode(text));
  }

  return archive.build();
}

/**
 * A build shaped like a total conversion: the map data under a MIXED-CASE folder, one model in `gta3.img`
 * and the other only in a mod archive, collision in the mod archive too.
 */
function writeBuild(root: string): void {
  const game = join(root, 'opensa');
  mkdirSync(join(game, 'data', 'maps', 'GosTown6'), { recursive: true });
  mkdirSync(join(game, 'models'), { recursive: true });
  mkdirSync(join(game, 'pak'), { recursive: true });
  writeFileSync(join(game, 'pak', 'manifest.json'), JSON.stringify({ appVersion: '1.0.0', game: 'parity' }));
  writeFileSync(
    join(game, 'data', 'gta.dat'),
    'IDE data/maps/GosTown6/Gp_City.IDE\nIPL data/maps/GosTown6/Gp_City.IPL\n',
  );
  writeFileSync(join(game, 'data', 'maps', 'GosTown6', 'Gp_City.IDE'), IDE);
  writeFileSync(join(game, 'data', 'maps', 'GosTown6', 'Gp_City.IPL'), IPL);
  writeFileSync(join(game, 'models', 'gta3.img'), img({ 'gp_road.dff': 'road', 'gp_roadtxd.txd': 'road-txd' }));
  writeFileSync(
    join(game, 'models', 'GosTown6.img'),
    img({ 'gp_city.col': 'collision', 'gp_tower.dff': 'tower', 'gp_towertxd.txd': 'tower-txd' }),
  );
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loader-parity-'));
  writeBuild(dir);
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('fetch pack / local loader key parity', () => {
  describe('negative cases', () => {
    it('leaves no key the local loader would serve missing from the pack', async () => {
      const packed = packedKeys(fetchPack({ buildDir: dir, log: noop, outRoot: join(dir, 'out') }).outDir);
      const missing = [...(await localKeys(join(dir, 'opensa')))].filter((key) => !packed.has(key)).sort();

      expect(missing).toEqual([]);
    });

    it('packs no key in a spelling the runtime will never ask for', () => {
      // The runtime lowercases what it looks up, so an uppercase key is unreachable by construction — the
      // exact shape of the gostown miss, where the pack LOOKED complete and 32 of 67 files were dead.
      const packed = packedKeys(fetchPack({ buildDir: dir, log: noop, outRoot: join(dir, 'out') }).outDir);

      expect([...packed].filter((key) => key !== key.toLowerCase())).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('serves the mixed-case map data and the override archive’s contents under the same keys', async () => {
      const packed = packedKeys(fetchPack({ buildDir: dir, log: noop, outRoot: join(dir, 'out') }).outDir);
      const local = await localKeys(join(dir, 'opensa'));

      for (const key of ['data/maps/gostown6/gp_city.ide', 'gp_city.col', 'gp_tower.dff', 'gp_towertxd.txd']) {
        expect(local, `local loader serves ${key}`).toContain(key);
        expect(packed, `pack serves ${key}`).toContain(key);
      }
    });
  });
});

const noop = (): void => undefined;
