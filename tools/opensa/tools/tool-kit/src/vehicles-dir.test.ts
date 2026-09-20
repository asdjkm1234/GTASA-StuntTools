import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseVehicleBases, parseVehicleSlot, planVehicleLayers, resolveVehicleSources } from './vehicles-dir';

/** Build a `vehicles` tree from `<subpath>: [folder, …]` and return its root. */
function tree(layout: Record<string, readonly string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'vehicles-dir-'));
  for (const [subpath, folders] of Object.entries(layout)) {
    mkdirSync(join(root, subpath), { recursive: true });
    for (const folder of folders) {
      mkdirSync(join(root, subpath, folder), { recursive: true });
    }
  }

  return root;
}

describe('parseVehicleSlot', () => {
  describe('negative cases', () => {
    it('takes the whole name as the slot when the separator is missing', () => {
      expect(parseVehicleSlot('admiral')).toBe('admiral');
    });

    it('does not split on a hyphen that is not the field separator', () => {
      expect(parseVehicleSlot('bf400 - 1984 Suzuki GSX-R750 - funky')).toBe('bf400');
    });
  });

  describe('positive cases', () => {
    it('reads the slot out of the three-field contract', () => {
      expect(parseVehicleSlot('admiral - 1976 Mercedes-Benz 230 - k1real24')).toBe('admiral');
    });

    it('folds case and trims, so a slot matches across layers', () => {
      expect(parseVehicleSlot(' Admiral  - 1994 Dodge Stealth RT 1.1 - mad_driver')).toBe('admiral');
    });
  });
});

// The names alone, so the case rule is testable on a case-INSENSITIVE filesystem too (macOS folds `New/`
// and `new/` into one folder — the refusal exists for the case-sensitive one, and must still be covered).
describe('parseVehicleBases', () => {
  describe('negative cases', () => {
    it('is empty for a folder name with no suffix — every car of the vehicles root', () => {
      expect(parseVehicleBases('admiral - 1976 Mercedes-Benz 230 - k1real24')).toEqual([]);
    });

    it('is empty for parentheses that are not at the end', () => {
      expect(parseVehicleBases('bus - 1969 GM TDH-5303 (city) - carface')).toEqual([]);
    });

    it('is empty for an empty suffix', () => {
      expect(parseVehicleBases('001veh - a car - someone ()')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads the one base of the added-cars convention', () => {
      expect(parseVehicleBases('001veh - 1971 Chevrolet Vega - alfamodding (manana)')).toEqual(['manana']);
    });

    it('reads a comma-separated list, folded and trimmed', () => {
      expect(parseVehicleBases('205veh - a trailer - someone ( Freibox , FREIGHT )')).toEqual(['freibox', 'freight']);
    });
  });
});

describe('planVehicleLayers', () => {
  describe('negative cases', () => {
    it('refuses a stray folder beside the reserved ones', () => {
      expect(() => planVehicleLayers(['models', 'new', 'comet - 911 - funky'])).toThrow(
        /plain car folder\(s\): comet - 911 - funky/,
      );
    });

    it('refuses two reserved folders differing only in case', () => {
      expect(() => planVehicleLayers(['models', 'new', 'New'])).toThrow(/differing only in case: new \/ New/);
    });
  });

  describe('positive cases', () => {
    it('reads a flat tree as unlayered', () => {
      expect(planVehicleLayers(['comet - 911 - funky', 'admiral - 230 - k1real24'])).toBeUndefined();
    });

    it('maps each reserved name to the folder as it is spelled on disk', () => {
      expect(planVehicleLayers(['Models', 'new', 'screenshots'])).toEqual(
        new Map([
          ['models', 'Models'],
          ['new', 'new'],
          ['screenshots', 'screenshots'],
        ]),
      );
    });
  });
});

describe('resolveVehicleSources', () => {
  describe('negative cases', () => {
    it('refuses a car folder left beside the reserved ones — that is a misspelled layer too', () => {
      const root = tree({ '': ['admiral - 1976 Mercedes-Benz 230 - k1real24'], models: ['comet - 911 - funky'] });

      expect(() => resolveVehicleSources(root)).toThrow(/plain car folder\(s\): admiral/);
    });

    it('refuses two cars claiming one slot in the same layer', () => {
      const root = tree({ models: ['comet - 911 - funky', 'comet - 911 GT2 - mad_driver'] });

      expect(() => resolveVehicleSources(root)).toThrow(/two cars for the slot 'comet'/);
    });
  });

  describe('positive cases', () => {
    it('installs every subfolder of a flat tree, unchanged', () => {
      const root = tree({ '': ['comet - 911 - funky', 'admiral - 230 - k1real24'] });
      const plan = resolveVehicleSources(root);

      expect(plan.strategy).toBe('flat');
      expect(plan.layers).toEqual([{ name: 'flat' }]);
      expect(plan.sources.map((source) => source.name)).toEqual(['admiral - 230 - k1real24', 'comet - 911 - funky']);
      expect(plan.sources.every((source) => source.origin === 'flat')).toBe(true);
    });

    it('ignores a file at the top level of a flat tree', () => {
      const root = tree({ '': ['comet - 911 - funky'] });
      writeFileSync(join(root, 'readme.txt'), 'notes');

      expect(resolveVehicleSources(root).sources).toHaveLength(1);
    });

    it('takes the new car for a slot models also holds, and reports the override', () => {
      const root = tree({
        models: ['admiral - 1976 Mercedes-Benz 230 - k1real24', 'comet - 911 - funky'],
        new: ['admiral - 1994 Dodge Stealth RT 1.1 - mad_driver'],
      });
      const plan = resolveVehicleSources(root);

      expect(plan.strategy).toBe('structured');
      expect(plan.sources.map((source) => `${source.origin}/${source.name}`)).toEqual([
        'new/admiral - 1994 Dodge Stealth RT 1.1 - mad_driver',
        'models/comet - 911 - funky',
      ]);
      expect(plan.overrides).toEqual([
        {
          by: 'new/admiral - 1994 Dodge Stealth RT 1.1 - mad_driver',
          replaced: 'models/admiral - 1976 Mercedes-Benz 230 - k1real24',
          slot: 'admiral',
        },
      ]);
    });

    it('installs a new car whose slot models does not hold, without calling it an override', () => {
      const root = tree({ models: ['comet - 911 - funky'], new: ['admiral - 230 - k1real24'] });
      const plan = resolveVehicleSources(root);

      expect(plan.sources.map((source) => source.slot)).toEqual(['admiral', 'comet']);
      expect(plan.overrides).toEqual([]);
    });

    it('never installs the screenshots folder', () => {
      const root = tree({ models: ['comet - 911 - funky'], screenshots: [] });
      writeFileSync(join(root, 'screenshots', 'comet - 911 - funky.png'), '');
      const plan = resolveVehicleSources(root);

      expect(plan.sources.map((source) => source.name)).toEqual(['comet - 911 - funky']);
    });

    it("never installs the reserved folder — the author's shelf, not a stray", () => {
      const root = tree({ models: ['comet - 911 - funky'], reserved: ['cabbie - taxi - 533'] });
      const plan = resolveVehicleSources(root);

      expect(plan.sources.map((source) => source.name)).toEqual(['comet - 911 - funky']);
    });

    it('carries the (base) suffix of each car', () => {
      const root = tree({ models: ['001veh - vega - alfamodding (manana)', 'comet - 911 - funky'] });
      const plan = resolveVehicleSources(root);

      expect(plan.sources.map((source) => source.bases)).toEqual([['manana'], []]);
    });

    it('hands back the folder path each car is installed from', () => {
      const root = tree({ models: ['comet - 911 - funky'], new: ['admiral - 230 - k1real24'] });
      const plan = resolveVehicleSources(root);

      expect(plan.sources.map((source) => source.folder)).toEqual([
        join(root, 'new', 'admiral - 230 - k1real24'),
        join(root, 'models', 'comet - 911 - funky'),
      ]);
    });

    it('accepts a tree that has only new/ — nothing is ambiguous about it', () => {
      const root = tree({ new: ['admiral - 230 - k1real24'] });
      const plan = resolveVehicleSources(root);

      expect(plan.strategy).toBe('structured');
      expect(plan.sources.map((source) => source.origin)).toEqual(['new']);
    });
  });
});

describe('resolveVehicleSources — layered (plan 010)', () => {
  describe('negative cases', () => {
    it('refuses a layered tree read without a target', () => {
      const root = tree({ common: ['admiral - a - x'], sa: ['comet - b - y'] });

      expect(() => resolveVehicleSources(root)).toThrow(/needs a target/);
    });

    it('refuses a car folder beside the layers — a misspelled layer lands there', () => {
      const root = tree({ common: ['admiral - a - x'], 'open-sa': ['comet - b - y'] });

      expect(() => resolveVehicleSources(root, 'sa')).toThrow(/plain car folder\(s\): open-sa/);
    });
  });

  describe('positive cases', () => {
    it('applies common then the target layer, the target winning the slot, and names both in the override', () => {
      const root = tree({
        common: ['admiral - a - x', 'comet - c - z'],
        opensa: ['comet - only for opensa - q'],
        sa: ['comet - b - y'],
      });

      const plan = resolveVehicleSources(root, 'sa');

      expect(plan.strategy).toBe('layered');
      expect(plan.layers).toEqual([
        { name: 'common', subdir: 'common' },
        { name: 'sa', subdir: 'sa' },
      ]);
      expect(plan.layersSkipped).toEqual(['opensa']);
      expect(plan.sources.map((source) => [source.slot, source.layer, source.name])).toEqual([
        ['admiral', 'common', 'admiral - a - x'],
        ['comet', 'sa', 'comet - b - y'],
      ]);
      expect(plan.overrides).toEqual([{ by: 'sa/comet - b - y', replaced: 'common/comet - c - z', slot: 'comet' }]);
    });

    it('lets each layer be structured — new/ beats models/ inside a layer, the target layer beats common', () => {
      const root = tree({
        'common/models': ['admiral - a - x', 'comet - c - z'],
        'common/new': ['admiral - candidate - w'],
        'sa/models': ['comet - b - y'],
      });

      const plan = resolveVehicleSources(root, 'sa');

      expect(plan.sources.map((source) => `${source.layer}/${source.origin}/${source.slot}`)).toEqual([
        'common/new/admiral',
        'sa/models/comet',
      ]);
      expect(plan.overrides.map((o) => `${o.by} > ${o.replaced}`)).toEqual([
        'common/new/admiral - candidate - w > common/models/admiral - a - x',
        'sa/models/comet - b - y > common/models/comet - c - z',
      ]);
    });

    it('reads a flat or structured tree exactly as before, whatever target is passed', () => {
      const root = tree({ '': ['admiral - a - x'] });

      expect(resolveVehicleSources(root, 'opensa').sources.map((s) => s.slot)).toEqual(['admiral']);
      expect(resolveVehicleSources(root).strategy).toBe('flat');
    });
  });
});
