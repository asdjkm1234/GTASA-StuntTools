import { createImg } from '@opensa/tool-kit/archive/img';
import { unzipSync } from 'fflate';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchPack, groupOf, sliceEntries } from './fetch-pack';

const noop = (): void => undefined;

/** The chunk files the manifest declares — what a deploy is supposed to consist of. */
function packedChunkFiles(outDir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as {
    chunks: Record<string, { file: string }[]>;
  };

  return Object.values(manifest.chunks)
    .flat()
    .map((chunk) => chunk.file);
}

/** Every VFS key the pack's chunks would deliver — the names the runtime can actually ask for. */
function packedNames(outDir: string): string[] {
  return packedChunkFiles(outDir).flatMap((file) => Object.keys(unzipSync(readFileSync(join(outDir, file)))));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fetch-pack-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('fetchPack', () => {
  describe('negative cases', () => {
    it('throws when the build has no opensa/ target', () => {
      expect(() => fetchPack({ buildDir: dir, log: noop })).toThrow(/no opensa\/ target/);
    });
  });

  describe('positive cases', () => {
    it('slices oversized entries into #index parts that reassemble to the original', () => {
      const bytes = new Uint8Array(10).map((_, i) => i);
      const sliced = sliceEntries([{ bytes, name: 'opensa/world.ospak' }], 4);

      expect(sliced.map((s) => s.name)).toEqual([
        'opensa/world.ospak#0',
        'opensa/world.ospak#1',
        'opensa/world.ospak#2',
      ]);
      expect([...sliced[0].bytes, ...sliced[1].bytes, ...sliced[2].bytes]).toEqual([...bytes]);
      // At or under the target: untouched.
      expect(sliceEntries([{ bytes, name: 'small' }], 10)).toEqual([{ bytes, name: 'small' }]);
    });

    it('maps game-dir paths onto the loader group vocabulary', () => {
      expect(groupOf('data/vehicles.ide')).toBe('data');
      expect(groupOf('text/american.gxt')).toBe('data');
      expect(groupOf('stream.ini')).toBe('data');
      expect(groupOf('models/gta3.img')).toBe('models');
      expect(groupOf('pak/world.ospak')).toBe('models');
      expect(groupOf('opensa/world.ospak')).toBe('models');
      expect(groupOf('opensa-pack/world.ospak')).toBe('models');
      expect(groupOf('anim/anim.img')).toBe('others');
    });

    it('expands the model archives into bare names, and ships no container or backup', () => {
      // The whole point of the expansion: the runtime asks `fs.get('bmycg.osm')`, and the fetch VFS serves
      // exactly the keys a chunk delivered. Packed as a file, `models/gta3.img` is one opaque key and the
      // player ped cannot be found — which is how it failed in the field.
      const game = join(dir, 'build', 'opensa');
      const pak = join(game, 'pak');
      mkdirSync(join(game, 'models'), { recursive: true });
      mkdirSync(pak, { recursive: true });
      writeFileSync(join(pak, 'manifest.json'), JSON.stringify({ appVersion: '1.0.0', game: 'exp' }));
      const archive = createImg();
      archive.set('bmycg.osm', new TextEncoder().encode('player'));
      archive.set('la.col', new TextEncoder().encode('collision'));
      writeFileSync(join(game, 'models', 'gta3.img'), archive.build());
      writeFileSync(join(game, 'models', 'gta3.img.bak'), new Uint8Array(4096).fill(9));
      writeFileSync(join(game, 'models', '.DS_Store'), new Uint8Array(64).fill(1));

      const result = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });
      const packed = packedNames(result.outDir);

      expect(packed).toContain('bmycg.osm');
      expect(packed).toContain('la.col');
      expect(packed.filter((name) => name.startsWith('models/gta3.img'))).toEqual([]);
      expect(packed.filter((name) => name.includes('.bak') || name.includes('.DS_Store'))).toEqual([]);
    });

    it('packs a mixed-case data path under its lowercased name (a TC names its files as it likes)', () => {
      // The local loader lowercases every loose path and the runtime looks a data file up by the lowercased
      // path `gta.dat` names. gostown ships `data/maps/Gostown6/Gp_City.IPL`; packed as-is it was invisible.
      const game = join(dir, 'build', 'opensa');
      const pak = join(game, 'pak');
      mkdirSync(join(game, 'data', 'maps', 'Gostown6'), { recursive: true });
      mkdirSync(pak, { recursive: true });
      writeFileSync(join(pak, 'manifest.json'), JSON.stringify({ appVersion: '1.0.0', game: 'case' }));
      writeFileSync(join(game, 'data', 'maps', 'Gostown6', 'Gp_City.IPL'), 'inst\nend\n');

      const packed = packedNames(
        fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') }).outDir,
      );

      expect(packed).toContain('data/maps/gostown6/gp_city.ipl');
      expect(packed).not.toContain('data/maps/Gostown6/Gp_City.IPL');
    });

    it('removes the chunks a re-pack replaced, so the deploy dir is only ever the current set', () => {
      // Chunk names carry a content hash, so a re-pack writes NEW files and never overwrites the old ones.
      // Whatever is left in the dir is what gets uploaded.
      const game = join(dir, 'build', 'opensa');
      const pak = join(game, 'pak');
      mkdirSync(join(game, 'data'), { recursive: true });
      mkdirSync(pak, { recursive: true });
      writeFileSync(join(pak, 'manifest.json'), JSON.stringify({ appVersion: '1.0.0', game: 'prune' }));
      writeFileSync(join(game, 'data', 'vehicles.ide'), 'cars\nend\n');

      const first = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });
      const before = readdirSync(first.outDir).filter((file) => file.endsWith('.zip'));
      writeFileSync(join(game, 'data', 'vehicles.ide'), 'cars\nchanged\nend\n');
      const second = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });
      const after = readdirSync(second.outDir).filter((file) => file.endsWith('.zip'));

      expect(before).not.toEqual(after); // the data chunk's hash moved — otherwise this proves nothing
      expect(after.sort()).toEqual(packedChunkFiles(second.outDir).sort());
    });

    it('packs a build into chunks + a manifest keyed by the in-game-dir pak identity (086 phase 8)', () => {
      const game = join(dir, 'build', 'opensa');
      const pak = join(game, 'pak');
      mkdirSync(join(game, 'data'), { recursive: true });
      mkdirSync(pak, { recursive: true });
      writeFileSync(join(pak, 'world.ospak'), new Uint8Array(64).fill(7));
      writeFileSync(join(pak, 'manifest.json'), JSON.stringify({ appVersion: '9.9.9', game: 'testgame' }));
      writeFileSync(join(game, 'data', 'vehicles.ide'), 'cars\nend\n');
      writeFileSync(join(game, 'stream.ini'), 'memory 512\n');

      const result = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });

      expect(result.game).toBe('testgame');
      expect(result.version).toBe('9.9.9');
      expect(result.outDir.endsWith('testgame-9.9.9')).toBe(true);
      const manifest = JSON.parse(readFileSync(join(result.outDir, 'manifest.json'), 'utf8')) as {
        chunks: Record<string, { bytes: number; entries: number; file: string }[]>;
        game: string;
      };
      expect(manifest.game).toBe('testgame');
      expect(Object.keys(manifest.chunks).sort()).toEqual(['data', 'models', 'others', 'textures']);
      expect(manifest.chunks.textures).toEqual([]); // pak textures live inside world.ospak
      // The game dir's pak/ ships in the models group (as `pak/<name>` VFS entries).
      expect(manifest.chunks.models.reduce((sum, c) => sum + c.entries, 0)).toBe(2);
      for (const info of manifest.chunks.models) {
        expect(readFileSync(join(result.outDir, info.file)).length).toBe(info.bytes);
      }
    });

    it('still packs a legacy build with the pak nested inside the game dir', () => {
      const game = join(dir, 'build', 'opensa');
      mkdirSync(join(game, 'opensa'), { recursive: true });
      writeFileSync(join(game, 'opensa', 'world.ospak'), new Uint8Array(8).fill(7));
      writeFileSync(join(game, 'opensa', 'manifest.json'), JSON.stringify({ appVersion: '1.2.3', game: 'legacy' }));

      const result = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out') });

      expect(result.game).toBe('legacy');
      expect(result.version).toBe('1.2.3');
    });

    it('reads the phase-7 sibling identity and defaults the output to <build>/opensa-pack', () => {
      const game = join(dir, 'build', 'opensa');
      const sibling = join(dir, 'build', 'opensa-pack');
      mkdirSync(game, { recursive: true });
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(game, 'stream.ini'), 'memory 512\n');
      writeFileSync(join(sibling, 'manifest.json'), JSON.stringify({ appVersion: '2.0.0', game: 'sib' }));

      const result = fetchPack({ buildDir: join(dir, 'build'), log: noop }); // no outRoot — the default

      expect(result.game).toBe('sib');
      expect(result.outDir).toBe(join(dir, 'build', 'opensa-pack', 'sib-2.0.0'));
      expect(readFileSync(join(result.outDir, 'manifest.json'), 'utf8')).toContain('"game": "sib"');
    });

    it('keeps untouched chunks byte-identical when one file changes (the cache promise)', () => {
      const game = join(dir, 'build', 'opensa');
      const pak = join(game, 'pak');
      mkdirSync(join(game, 'data'), { recursive: true });
      mkdirSync(pak, { recursive: true });
      writeFileSync(join(pak, 'manifest.json'), JSON.stringify({ appVersion: '1.0.0', game: 'stab' }));
      writeFileSync(join(game, 'data', 'vehicles.ide'), 'cars\nend\n');
      writeFileSync(join(pak, 'world.ospak'), new Uint8Array(64).fill(7));

      const readChunks = (outDir: string): Record<string, { file: string; hash: string }[]> =>
        (
          JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as {
            chunks: Record<string, { file: string; hash: string }[]>;
          }
        ).chunks;

      const first = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out1') });
      writeFileSync(join(pak, 'world.ospak'), new Uint8Array(64).fill(8)); // same size, new bytes
      const second = fetchPack({ buildDir: join(dir, 'build'), log: noop, outRoot: join(dir, 'out2') });

      const before = readChunks(first.outDir);
      const after = readChunks(second.outDir);
      // The untouched data group: same hash → same filename → the browser cache survives.
      expect(after.data).toEqual(before.data);
      expect(readFileSync(join(second.outDir, after.data[0].file))).toEqual(
        readFileSync(join(first.outDir, before.data[0].file)),
      );
      // The changed file's own chunk re-hashes.
      expect(after.models[0].hash).not.toBe(before.models[0].hash);
    });
  });
});
