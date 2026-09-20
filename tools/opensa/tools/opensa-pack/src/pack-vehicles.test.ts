/**
 * `packVehicles`, and above all its TXD-DELETION guard (plan opensa-pack/003 phase 3).
 *
 * This is the code that decides what gets ERASED from the archives. A dictionary deleted while something
 * still needs it is a silent no-texture in game — the exact failure that is hardest to trace — so the guard
 * gets the tests, not just the happy path.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { packVehicles } from './pack-vehicles';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const quiet = (): void => undefined;

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** A `cars` section with the column layout the real parser expects. */
function ide(rows: readonly string[]): string {
  return ['cars', ...rows, 'end'].join('\n');
}

const ADMIRAL = '445, admiral, admiral, car, ADMIRAL, ADMIRAL, null, normal, 10, 0, 0, -1, 0.7, 0.7, 0';

function gameFs(vehiclesIde: string, extra = new Map<string, ArrayBuffer>()): AssetFileSystem {
  const files = new Map<string, ArrayBuffer>([
    ['admiral.dff', fileOf('vehicles/admiral.dff')],
    ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
    ...extra,
  ]);

  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: (name: string): null | string => (name === 'data/vehicles.ide' ? vehiclesIde : null),
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe('packVehicles', () => {
  describe('negative cases', () => {
    it('throws when vehicles.ide is absent — there is no roster to convert', () => {
      const fs = { ...gameFs(''), getText: (): null => null } as AssetFileSystem;

      expect(() => packVehicles(fs, createModelBundles(), quiet)).toThrow(/vehicles\.ide/);
    });

    it('reports a car whose DFF is missing instead of failing the whole run', () => {
      const missing = '446, ghostcar, ghosttex, car, GHOST, GHOST, null, normal, 10, 0, 0, -1, 0.7, 0.7, 0';

      const { report } = packVehicles(gameFs(ide([ADMIRAL, missing])), createModelBundles(), quiet);

      expect(report.models).toBe(1);
      expect(report.failed.map((failure) => failure.model)).toEqual(['ghostcar']);
    });

    it('KEEPS a TXD another, unconverted car still names', () => {
      // `ghostcar` shares `admiral`'s dictionary and cannot convert (no DFF) — so deleting `admiral.txd`
      // would strip the textures out from under it.
      const shared = '446, ghostcar, admiral, car, GHOST, GHOST, null, normal, 10, 0, 0, -1, 0.7, 0.7, 0';

      const { deletes, report } = packVehicles(gameFs(ide([ADMIRAL, shared])), createModelBundles(), quiet);

      expect(report.txdsKept).toContain('admiral');
      expect(deletes).not.toContain('admiral.txd');
      expect(deletes).toContain('admiral.dff'); // the model itself still goes
    });

    it('never deletes a SHARED dictionary, even when every car naming it converted', () => {
      const onVehicleTxd = '447, other, vehicle, car, OTHER, OTHER, null, normal, 10, 0, 0, -1, 0.7, 0.7, 0';
      const extra = new Map([['other.dff', fileOf('vehicles/admiral.dff')]]);

      const { deletes, report } = packVehicles(
        gameFs(ide([ADMIRAL, onVehicleTxd]), extra),
        createModelBundles(),
        quiet,
      );

      expect(report.models).toBe(2);
      expect(report.txdsKept).toContain('vehicle'); // the generic set other classes parse by name
      expect(deletes).not.toContain('vehicle.txd');
    });
  });

  describe('positive cases', () => {
    it('converts a car, bundles its sections and retires both stock entries', () => {
      const bundles = createModelBundles();

      const { deletes, report } = packVehicles(gameFs(ide([ADMIRAL])), bundles, quiet);

      expect(report.models).toBe(1);
      expect(report.failed).toEqual([]);
      expect(bundles.inserts().map((entry) => entry.name)).toEqual(['admiral.osm']);
      expect([...deletes].sort()).toEqual(['admiral.dff', 'admiral.txd']);
      expect(report.osmBytes).toBeGreaterThan(report.ostexBytes); // the dictionary rides INSIDE the .osm
    });
  });
});
