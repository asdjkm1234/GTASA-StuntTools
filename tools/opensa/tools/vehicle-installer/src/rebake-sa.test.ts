import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';
import { createImg, imgFamilyMembers, openImgFamily, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebakeVehicles } from './rebake';
import { rebakeVehiclesSa } from './rebake-sa';
import { SPECIAL_FEATURES_DAT, writeModelSpecialFeatures } from './special-features';

const DATA = join(process.cwd(), 'fixtures', 'original', 'data');
const DATA_FILES = ['carcols.dat', 'carmods.dat', 'handling.cfg', 'vehicles.ide'];
const CAR = join(process.cwd(), 'fixtures', 'original', 'vehicles');
const hasFixtures = DATA_FILES.every((file) => existsSync(join(DATA, file))) && existsSync(join(CAR, 'zr350.dff'));

/** A handling row the stock table cannot already carry, so the merge is observable. */
const HANDLING =
  'ZR350 4321.0 3650.0 1.6 0.0 0.1 -0.2 70 0.70 0.80 0.5 4 180.0 14.0 10.0 R P 4.3 0.63 1 28.0 ' +
  '0.93 0.81 0.0 0.22 -0.15 0.5 0.0 0.26 0.44 10000 0 1400001 0 3 0';

/** The adjuster mod's two halves, as the `sa` layer installs them into a built tree (plan 011). */
const FLA_DAT = ['# Author: fastman92', '#new_hydra hydra'].join('\r\n');
const FLA_INI = '[SPECIAL]\r\nEnable model special feature loader = 1\r\n';

/** A family cap that holds about two of the fixture's entries per member, so the tree is SPILLED like the real one. */
const SMALL_CAP = 2048 + 2 * (2 * 2048 + 32);

let root: string;

/**
 * A REAL-SA game dir as the split + install leave it: the car's stale `.dff`/`.txd` in `models/vehicles.img`,
 * a paint-job dictionary spilled into `vehicles2.img`, `gta.dat` registering both.
 */
function builtGame(options: { osm?: boolean; split?: boolean } = {}): string {
  const target = join(root, 'built');
  mkdirSync(join(target, 'data'), { recursive: true });
  for (const file of DATA_FILES) {
    cpSync(join(DATA, file), join(target, 'data', file));
  }
  writeFileSync(join(target, 'data', 'gta.dat'), 'IMG MODELS\\VEHICLES.IMG\nIMG MODELS\\VEHICLES2.IMG\n');
  mkdirSync(join(target, 'models'), { recursive: true });
  const stale = new Uint8Array(3000).fill(7);
  if (options.osm) {
    const converted = createImg();
    converted.set('zr350.osm', Uint8Array.of(1, 2, 3));
    writeFileSync(join(target, 'models', 'gta3.img'), converted.build());

    return target;
  }
  const img = createImg();
  img.set('zr350.dff', stale);
  img.set('zr350.txd', stale);
  img.set('zr3501.txd', stale); // the paint job — third entry, so it lands in the sibling
  img.set('bystander.dff', new Uint8Array(3000).fill(9));
  writeImgFamily(img, join(target, 'models', options.split === false ? 'gta3.img' : 'vehicles.img'), SMALL_CAP);

  return target;
}

function family(target: string, base = 'vehicles.img'): ReturnType<typeof openImgFamily> {
  return openImgFamily(join(target, 'models', base));
}

/** One mod folder: the real zr350 pair, a paint job, a settings file and a feature declaration. */
function modFolder(): string {
  const inPath = join(root, 'mods');
  const folder = join(inPath, 'zr350 - 1993 Mazda RX-7');
  mkdirSync(folder, { recursive: true });
  cpSync(join(CAR, 'zr350.dff'), join(folder, 'zr350.dff'));
  cpSync(join(CAR, 'zr350.txd'), join(folder, 'zr350.txd'));
  cpSync(join(CAR, 'zr350.txd'), join(folder, 'zr3501.txd'));
  writeFileSync(join(folder, 'zr350.settings.txt'), `${HANDLING}\n`);
  writeFileSync(join(folder, 'features.txt'), 'UP/DOWN_LIGHTS\n');

  return inPath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-rebake-sa-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe.skipIf(!hasFixtures)('rebakeVehiclesSa (real zr350 fixture)', () => {
  describe('negative cases', () => {
    it('refuses a target that is not a built game dir rather than writing into a hole', () => {
      const empty = join(root, 'nothing');
      mkdirSync(empty);

      expect(() => rebakeVehiclesSa({ inPath: modFolder(), targetPath: empty })).toThrow(/not a built game dir/);
    });

    it('refuses a CONVERTED tree and names the flag that edits one', () => {
      const target = builtGame({ osm: true });
      const before = readFileSync(join(target, 'data', 'handling.cfg'), 'utf8');

      const report = rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });

      expect(report.rebaked).toEqual([]);
      expect(report.refused).toEqual([{ model: 'zr350', reason: expect.stringContaining('--kind opensa') as string }]);
      // Refused BEFORE anything of its own was written.
      expect(readFileSync(join(target, 'data', 'handling.cfg'), 'utf8')).toBe(before);
    });

    it('is refused by the OpenSA rebake in turn — a `.dff` in the tree means the wrong --kind', () => {
      const target = builtGame();

      const report = rebakeVehicles({ inPath: modFolder(), targetPath: target });

      expect(report.rebaked).toEqual([]);
      expect(report.refused).toEqual([{ model: 'zr350', reason: expect.stringContaining('--kind sa') as string }]);
      expect(family(target).get('zr350.dff')?.[0]).toBe(7);
    });

    it('does not truncate the mod ledger to the cars this run rebaked', () => {
      const target = builtGame();
      writeFileSync(join(target, 'data', 'vehicle-mods.txt'), 'previon\ninfernus\n');

      rebakeVehiclesSa({ inPath: modFolder(), only: ['zr350'], targetPath: target });

      expect(parseVehicleMods(readFileSync(join(target, 'data', 'vehicle-mods.txt'), 'utf8'))).toEqual(
        new Set(['infernus', 'previon', 'zr350']),
      );
    });

    it('leaves the models `--only` did not name exactly as they were', () => {
      const target = builtGame();

      const report = rebakeVehiclesSa({ inPath: modFolder(), only: ['nosuchcar'], targetPath: target });

      expect(report.rebaked).toEqual([]);
      expect(report.skipped).toHaveLength(1);
      expect(family(target).get('zr350.dff')?.[0]).toBe(7);
      expect(family(target).get('bystander.dff')?.[0]).toBe(9);
    });
  });

  describe('positive cases', () => {
    it('replaces the dff, the txd AND the spilled paint job by name — no duplicate across the family', () => {
      const target = builtGame();
      expect(imgFamilyMembers(join(target, 'models', 'vehicles.img'))).toHaveLength(2);

      const report = rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });

      expect(report.failed).toEqual([]);
      expect(report.refused).toEqual([]);
      expect(report.rebaked.map((car) => car.model)).toEqual(['zr350']);
      const img = family(target);
      const real = readFileSync(join(CAR, 'zr350.dff'));
      expect(img.names().filter((name) => name.toLowerCase().startsWith('zr350'))).toHaveLength(3);
      expect(img.get('zr350.dff')?.subarray(0, 16)).toEqual(new Uint8Array(real.subarray(0, 16)));
      expect(img.get('zr3501.txd')?.[0]).not.toBe(7);
      expect(img.get('bystander.dff')?.[0]).toBe(9);
      expect(parseHandling(readFileSync(join(target, 'data', 'handling.cfg'), 'utf8')).get('ZR350')?.fields[0]).toBe(
        '4321.0',
      );
      expect(readFileSync(join(target, 'data', 'vehicle-features.txt'), 'utf8')).toContain('zr350');
    });

    it('registers a sibling the bigger car spills into, and restates the layout manifest', () => {
      const target = builtGame();

      rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });

      const members = imgFamilyMembers(join(target, 'models', 'vehicles.img'));
      const dat = readFileSync(join(target, 'data', 'gta.dat'), 'latin1');
      for (const member of members.slice(1)) {
        expect(dat.toUpperCase()).toContain(`IMG MODELS\\${member.split('/').pop()!.toUpperCase()}`);
      }
      const manifest = JSON.parse(readFileSync(join(target, 'data', 'img-layout.json'), 'utf8')) as {
        archives: { name: string }[];
      };
      expect(manifest.archives.map((archive) => archive.name)).toEqual(
        members.map((member) => member.split('/').pop()),
      );
    });

    it('edits gta3.img on an unsplit tree — the archive is read off the tree, not configured', () => {
      const target = builtGame({ split: false });

      const report = rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });

      expect(report.rebaked.map((car) => car.model)).toEqual(['zr350']);
      expect(family(target, 'gta3.img').get('zr350.dff')?.[0]).not.toBe(7);
    });

    it("keeps the rest of the fleet's special-feature mappings and drops its own stale one (plan 011)", () => {
      const target = builtGame();
      writeFileSync(join(target, SPECIAL_FEATURES_DAT), FLA_DAT);
      writeFileSync(join(target, 'fastman92limitAdjuster_GTASA.ini'), FLA_INI);
      // The state a full install left: another car mapped, and a stale line for this one.
      writeModelSpecialFeatures(
        target,
        new Map([
          ['feltzer', ['UP/DOWN_LIGHTS']],
          ['zr350', ['ADV_HYDRALICS']],
        ]),
      );

      rebakeVehiclesSa({ inPath: modFolder(), only: ['zr350'], target: 'sa', targetPath: target });

      // The rebaked car declares UP/DOWN_LIGHTS, which its own slot carries natively — so no line, and the
      // stale one goes. `feltzer` was not rebaked, so its mapping is none of this run's business.
      const mapped = readFileSync(join(target, SPECIAL_FEATURES_DAT), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
      expect(mapped).toEqual(['feltzer zr350']);
    });

    it('is idempotent — a second run changes nothing the first did not', () => {
      const target = builtGame();
      rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });
      const once = DATA_FILES.map((file) => readFileSync(join(target, 'data', file), 'utf8'));
      const onceImg = family(target).names();

      rebakeVehiclesSa({ inPath: modFolder(), targetPath: target });

      expect(DATA_FILES.map((file) => readFileSync(join(target, 'data', file), 'utf8'))).toEqual(once);
      expect(family(target).names()).toEqual(onceImg);
    });
  });
});
