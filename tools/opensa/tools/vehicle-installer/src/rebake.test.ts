import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebakeVehicles } from './rebake';

const DATA = join(process.cwd(), 'fixtures', 'original', 'data');
const DATA_FILES = ['carcols.dat', 'carmods.dat', 'handling.cfg', 'vehicles.ide'];
const CAR = join(process.cwd(), 'fixtures', 'original', 'vehicles');
const GENERIC = join(process.cwd(), 'fixtures', 'original', 'models', 'generic', 'vehicle.txd');
const hasFixtures =
  DATA_FILES.every((file) => existsSync(join(DATA, file))) && existsSync(join(CAR, 'zr350.dff')) && existsSync(GENERIC);

/** A handling row the stock table cannot already carry, so the merge is observable. */
const HANDLING =
  'ZR350 4321.0 3650.0 1.6 0.0 0.1 -0.2 70 0.70 0.80 0.5 4 180.0 14.0 10.0 R P 4.3 0.63 1 28.0 ' +
  '0.93 0.81 0.0 0.22 -0.15 0.5 0.0 0.26 0.44 10000 0 1400001 0 3 0';

let root: string;

/** A game dir in the state a pack run leaves it: converted `.osm` in the archive, no `.dff` beside it. */
function builtGame(osmEntry: null | string = 'zr350.osm'): string {
  const target = join(root, 'built');
  mkdirSync(join(target, 'data'), { recursive: true });
  for (const file of DATA_FILES) {
    cpSync(join(DATA, file), join(target, 'data', file));
  }
  mkdirSync(join(target, 'models', 'generic'), { recursive: true });
  cpSync(GENERIC, join(target, 'models', 'generic', 'vehicle.txd'));
  const img = createImg();
  if (osmEntry !== null) {
    img.set(osmEntry, Uint8Array.of(1, 2, 3)); // whatever the previous bake wrote
  }
  img.set('somethingelse.osm', Uint8Array.of(4));
  writeFileSync(join(target, 'models', 'gta3.img'), img.build());

  return target;
}

function entry(target: string, name: string): null | Uint8Array {
  const bytes = readFileSync(join(target, 'models', 'gta3.img'));
  const value = openImg(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).get(name);

  return value ?? null;
}

/** An archive entry's first `length` bytes — IMG pads every entry to a 2 KB sector, so a whole-block
 *  comparison would only ever be comparing zeroes. */
function head(target: string, name: string, length: number): number[] {
  return [...(entry(target, name) ?? new Uint8Array()).subarray(0, length)];
}

/** One mod folder: the real zr350 pair, a settings file and a feature declaration. */
function modFolder(): string {
  const inPath = join(root, 'mods');
  const folder = join(inPath, 'zr350 - 1993 Mazda RX-7');
  mkdirSync(folder, { recursive: true });
  cpSync(join(CAR, 'zr350.dff'), join(folder, 'zr350.dff'));
  cpSync(join(CAR, 'zr350.txd'), join(folder, 'zr350.txd'));
  writeFileSync(join(folder, 'zr350.settings.txt'), `${HANDLING}\n`);
  writeFileSync(join(folder, 'features.txt'), 'UP/DOWN_LIGHTS\n');

  return inPath;
}

/** A mod for a model the built game has never heard of — the real zr350 geometry under a new name. */
function newCarFolder(ideLine: null | string): string {
  const inPath = join(root, 'newmods');
  const folder = join(inPath, 'moonbeam2 - something nobody shipped');
  mkdirSync(folder, { recursive: true });
  cpSync(join(CAR, 'zr350.dff'), join(folder, 'moonbeam2.dff'));
  cpSync(join(CAR, 'zr350.txd'), join(folder, 'moonbeam2.txd'));
  writeFileSync(
    join(folder, 'moonbeam2.settings.txt'),
    `${HANDLING.replace('ZR350', 'MOONBEAM2')}\n${ideLine === null ? '' : `\n${ideLine}\n`}`,
  );

  return inPath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-rebake-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe.skipIf(!hasFixtures)('rebakeVehicles (real zr350 fixture)', () => {
  describe('negative cases', () => {
    it('refuses a target that is not a built game dir rather than writing into a hole', () => {
      const empty = join(root, 'nothing');
      mkdirSync(empty);

      expect(() => rebakeVehicles({ inPath: modFolder(), targetPath: empty })).toThrow(/not a built game dir/);
    });

    it('reports a car no archive holds instead of half-installing it — that needs a full build', () => {
      const target = builtGame(null); // the built game never had this model
      const report = rebakeVehicles({ inPath: modFolder(), targetPath: target });

      expect(report.unplaced).toEqual(['zr350.osm']);
      expect(report.rebaked).toEqual([]);
      // The data half still merged: a rebake is not a transaction, and the rows are what the next full
      // build would write anyway.
      expect(parseHandling(readFileSync(join(target, 'data', 'handling.cfg'), 'utf8')).get('ZR350')?.fields[0]).toBe(
        '4321.0',
      );
    });

    it('refuses a model the built game does not have when the mod declares no ide row', () => {
      const target = builtGame();
      const before = readFileSync(join(target, 'data', 'vehicles.ide'), 'utf8');

      const report = rebakeVehicles({ inPath: newCarFolder(null), targetPath: target });

      expect(report.refused.map((car) => car.model)).toEqual(['moonbeam2']);
      expect(report.refused[0].reason).toContain('declares no ide row');
      expect(report.added).toEqual([]);
      // Refused BEFORE anything of its own was written — the data files are untouched.
      expect(readFileSync(join(target, 'data', 'vehicles.ide'), 'utf8')).toBe(before);
      expect(entry(target, 'moonbeam2.osm')).toBeNull();
    });

    it('refuses an ide id another model already owns — two models on one id spawn the wrong car', () => {
      const target = builtGame();
      // 562 is the stock elegy's id — taking it would make a car generator spawn one car where the other stands.
      const report = rebakeVehicles({
        inPath: newCarFolder(
          '562, moonbeam2, moonbeam2, car, MOONBEAM2, MOONBEAM2, null, normal, 4, 0, 0, -1, 0.7, 0.7, 0',
        ),
        targetPath: target,
      });

      expect(report.refused).toEqual([
        { model: 'moonbeam2', reason: "vehicles.ide id 562 already belongs to 'elegy'" },
      ]);
      expect(entry(target, 'moonbeam2.osm')).toBeNull();
    });

    it('never puts the raw dff/txd back into a CONVERTED archive', () => {
      // The pack deleted the pair when it baked the car; re-adding them would leave entries the game does
      // not read and an archive nobody can tell from a half-converted one.
      const target = builtGame();

      rebakeVehicles({ inPath: modFolder(), targetPath: target });

      expect(entry(target, 'zr350.dff')).toBeNull();
      expect(entry(target, 'zr350.txd')).toBeNull();
    });

    it('does not truncate the mod ledger to the cars this run rebaked', () => {
      // The 096/06 risk: `--only zr350` knows about ONE slot, and a ledger rewritten from that would tell
      // video mode that every other mod car in the build is stock. What a partial rebake knows is an
      // ADDITION to the ledger, never the whole of it.
      const target = builtGame();
      writeFileSync(join(target, 'data', 'vehicle-mods.txt'), 'previon\ninfernus\n');

      rebakeVehicles({ inPath: modFolder(), only: ['zr350'], targetPath: target });

      expect(parseVehicleMods(readFileSync(join(target, 'data', 'vehicle-mods.txt'), 'utf8'))).toEqual(
        new Set(['infernus', 'previon', 'zr350']),
      );
    });

    it('leaves the models `--only` did not name exactly as they were', () => {
      const target = builtGame();
      const before = head(target, 'somethingelse.osm', 4);

      const report = rebakeVehicles({ inPath: modFolder(), only: ['nosuchcar'], targetPath: target });

      expect(report.rebaked).toEqual([]);
      expect(report.skipped).toHaveLength(1);
      expect(head(target, 'somethingelse.osm', 4)).toEqual(before);
      expect(head(target, 'zr350.osm', 3)).toEqual([1, 2, 3]);
    });
  });

  describe('positive cases', () => {
    it('replaces the model in place with a real `.osm` and merges its settings row', () => {
      const target = builtGame();

      const report = rebakeVehicles({ inPath: modFolder(), targetPath: target });

      expect(report.failed).toEqual([]);
      expect(report.rebaked.map((car) => car.model)).toEqual(['zr350']);
      // The archive entry is now something the game can read, and the untouched neighbour is still there.
      const built = readVehicleOsm('zr350', entry(target, 'zr350.osm')!);
      expect(built.rig.submeshes.length).toBeGreaterThan(0);
      expect(head(target, 'somethingelse.osm', 1)).toEqual([4]);
      expect(parseHandling(readFileSync(join(target, 'data', 'handling.cfg'), 'utf8')).get('ZR350')?.fields[0]).toBe(
        '4321.0',
      );
    });

    it("carries the mod's `features.txt` into the table the converter reads, and acts on it", () => {
      const target = builtGame();
      // A pre-existing line for ANOTHER car must survive rebaking one model.
      writeFileSync(join(target, 'data', 'vehicle-features.txt'), 'previon UP/DOWN_LIGHTS\n');

      rebakeVehicles({ inPath: modFolder(), only: ['zr350'], targetPath: target });

      const table = readFileSync(join(target, 'data', 'vehicle-features.txt'), 'utf8');
      expect(table).toContain('zr350 UP/DOWN_LIGHTS');
      expect(table).toContain('previon UP/DOWN_LIGHTS');
      // And the declaration reached the bake: the zr350's pod is its `misc_a`.
      const built = readVehicleOsm('zr350', entry(target, 'zr350.osm')!);
      expect(built.rig.parts[built.rig.popUpLights!.part].name).toBe('misc_a');
    });

    it('ADDS a car the built game never had, on the id the mod declares for itself', () => {
      const target = builtGame();
      const ide = '20001, moonbeam2, moonbeam2, car, MOONBEAM2, MOONBEAM2, null, normal, 4, 0, 0, -1, 0.7, 0.7, 0';

      const report = rebakeVehicles({ inPath: newCarFolder(ide), targetPath: target });

      expect(report.refused).toEqual([]);
      expect(report.added).toEqual(['moonbeam2']);
      expect(report.rebaked.map((car) => car.model)).toEqual(['moonbeam2']);
      // The roster the runtime parses at boot now names it, and the archive holds a model it can read.
      const defs = parseVehicleDefs(readFileSync(join(target, 'data', 'vehicles.ide'), 'utf8'));
      expect(defs.get('moonbeam2')?.id).toBe(20001);
      expect(readVehicleOsm('moonbeam2', entry(target, 'moonbeam2.osm')!).rig.submeshes.length).toBeGreaterThan(0);
      // And it says what an addition does NOT get, so silence is never mistaken for placement.
      expect(report.warnings.join('\n')).toContain('traffic');
    });

    it('is idempotent — a second run writes the same bytes', () => {
      const target = builtGame();
      const inPath = modFolder();

      rebakeVehicles({ inPath, targetPath: target });
      const first = head(target, 'zr350.osm', 4096);
      const handling = readFileSync(join(target, 'data', 'handling.cfg'), 'utf8');
      rebakeVehicles({ inPath, targetPath: target });

      expect(head(target, 'zr350.osm', 4096)).toEqual(first);
      expect(readFileSync(join(target, 'data', 'handling.cfg'), 'utf8')).toBe(handling);
    });
  });
});
