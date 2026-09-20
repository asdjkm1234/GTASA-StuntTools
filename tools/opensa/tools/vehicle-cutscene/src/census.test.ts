import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCensus, type CutsceneSlot, matchMods } from './census';

/** Real data files (regenerated fixtures — `npm run test:fixtures`). */
const VEHICLES_IDE = readFileSync('fixtures/original/data/vehicles.ide', 'utf8');
const TXDCUT_IDE = readFileSync('fixtures/original/data/txdcut.ide', 'utf8');

/** Entry map builder: every name gets a `.dff` (size 1) and, unless excluded, a `.txd` (size given). */
function entries(names: string[], txdBytes: Record<string, number> = {}): Map<string, number> {
  const map = new Map<string, number>();
  for (const name of names) {
    map.set(`${name}.dff`, 1);
    map.set(`${name}.txd`, txdBytes[name] ?? 2048);
  }

  return map;
}

function slot(census: { slots: CutsceneSlot[] }, csName: string): CutsceneSlot | undefined {
  return census.slots.find((entry) => entry.csName === csName);
}

describe('buildCensus', () => {
  describe('negative cases', () => {
    it('excludes a cs entry that is a ped, even when its stem prefixes vehicle models', () => {
      // csho is the ped "Ho"; its stem `ho` prefixes hotknife/hotring — exact matching must not bite.
      const census = buildCensus({
        cutsceneEntries: entries(['csho']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(census.slots).toEqual([]);
    });

    it('excludes cs prop entries with no IDE match', () => {
      const census = buildCensus({
        cutsceneEntries: entries(['csbarrel', 'csjetpack']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(census.slots).toEqual([]);
    });

    it('reports txdcut rows whose model is in no archive as dead', () => {
      // Stock ships two: the `csopcarla` typo and the cut-content `csandrom92`.
      const census = buildCensus({
        cutsceneEntries: entries(['csbobcat92']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(census.deadTxdcutRows).toContain('csopcarla');
      expect(census.deadTxdcutRows).toContain('csandrom92');
    });

    it('ignores non-cs and non-dff entries', () => {
      const census = buildCensus({
        cutsceneEntries: new Map([
          ['bobcat.dff', 1],
          ['csbobcat92.txd', 2048],
        ]),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(census.slots).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('matches via the txdcut row, surviving the 8-char IDE truncations', () => {
      // `csremington92` → `remingtn` and `cswashington` → `washing` match NO prefix rule — only the
      // txdcut parent can link them.
      const census = buildCensus({
        cutsceneEntries: entries(['csremington92', 'cswashington']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(slot(census, 'csremington92')?.model).toBe('remingtn');
      expect(slot(census, 'cswashington')?.model).toBe('washing');
    });

    it('resolves the firela suffix trap through txdcut, not by stripping la', () => {
      const census = buildCensus({
        cutsceneEntries: entries(['csfirela']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(slot(census, 'csfirela')?.model).toBe('firela');
    });

    it('falls back to an exact stem match for the models txdcut leaves out', () => {
      // `cscopcarla` is typo'd in txdcut, `cscopcarsf` and `csdinghy` have no row at all.
      const census = buildCensus({
        cutsceneEntries: entries(['cscopcarla', 'cscopcarsf', 'csdinghy']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(slot(census, 'cscopcarla')).toMatchObject({ hasTxdcutRow: false, model: 'copcarla' });
      expect(slot(census, 'cscopcarsf')).toMatchObject({ hasTxdcutRow: false, model: 'copcarsf' });
      expect(slot(census, 'csdinghy')).toMatchObject({ hasTxdcutRow: false, model: 'dinghy' });
    });

    it('assigns the bike and boat branches from the IDE type, boats surviving their short rows', () => {
      const census = buildCensus({
        cutsceneEntries: entries(['csdinghy', 'csmtbike92', 'csmonster']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(slot(census, 'csdinghy')?.branch).toBe('boat');
      expect(slot(census, 'csmtbike92')?.branch).toBe('bike');
      expect(slot(census, 'csmonster')?.branch).toBe('car'); // mtruck rides the car branch
    });

    it('maps csmothership onto the camper slot and reports own-TXD sizes', () => {
      const census = buildCensus({
        cutsceneEntries: entries(['csmothership'], { csmothership: 114_688 }),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(slot(census, 'csmothership')).toMatchObject({ csTxdBytes: 114_688, model: 'camper' });
    });

    it('keeps both models of a shared donor slot', () => {
      const census = buildCensus({
        cutsceneEntries: entries(['cszr350', 'cszr350b']),
        txdcutText: TXDCUT_IDE,
        vehiclesIdeText: VEHICLES_IDE,
      });
      expect(census.slots.map((entry) => entry.csName)).toEqual(['cszr350', 'cszr350b']);
      expect(census.slots.every((entry) => entry.model === 'zr350')).toBe(true);
    });
  });
});

describe('matchMods', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vehicle-cutscene-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  function bobcatSlot(): CutsceneSlot {
    return {
      branch: 'car',
      csName: 'csbobcat92',
      csTxdBytes: 2048,
      hasTxdcutRow: true,
      ideType: 'car',
      model: 'bobcat',
      txd: 'bobcat',
    };
  }

  function modFolder(name: string, files: string[]): void {
    mkdirSync(join(dir, name));
    for (const file of files) {
      writeFileSync(join(dir, name, file), 'x');
    }
  }

  describe('negative cases', () => {
    it('reports no mod when no folder ships the donor model', () => {
      modFolder('taxi - some cab - author', ['taxi.dff', 'taxi.txd']);
      expect(matchMods([bobcatSlot()], dir)).toEqual([{ slot: bobcatSlot(), status: 'no mod' }]);
    });

    it('reports mod incomplete when the dff ships without its txd', () => {
      modFolder('bobcat - truck - author', ['bobcat.dff']);
      expect(matchMods([bobcatSlot()], dir)).toEqual([
        { folder: 'bobcat - truck - author', slot: bobcatSlot(), status: 'mod incomplete' },
      ]);
    });
  });

  describe('positive cases', () => {
    it('reports ready with the shipping folder, matching by dff basename not folder name', () => {
      modFolder('some renamed folder', ['bobcat.dff', 'bobcat.txd', 'bobcat.settings.txt']);
      expect(matchMods([bobcatSlot()], dir)).toEqual([
        { folder: 'some renamed folder', slot: bobcatSlot(), status: 'ready' },
      ]);
    });

    it('lets the alphabetically last folder win a duplicated model, like the installer', () => {
      modFolder('a - first - author', ['bobcat.dff', 'bobcat.txd']);
      modFolder('b - second - author', ['bobcat.dff', 'bobcat.txd']);
      expect(matchMods([bobcatSlot()], dir)[0].folder).toBe('b - second - author');
    });
  });
});
