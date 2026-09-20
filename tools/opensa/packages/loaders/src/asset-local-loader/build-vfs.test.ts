import { describe, expect, it } from 'vitest';

import type { InstallSource } from './build-vfs';
import type { LazyImgArchive } from './img-reader';

import { readEntry, selectInstallEntries } from './build-vfs';

const IDE = ['objs', '100, cj, cjtxd, 100, 0', '200, tree, treetxd, 80, 0', 'end'].join('\n');
// Only id 100 is placed in the exterior map → tree (200) must be dropped from the selection.
const IPL = ['inst', '100, cj, 0, 0, 0, 0, 0, 0, 0, 1, 0', 'end'].join('\n');

/** A fake archive over an in-memory name→bytes map (no .ipl entries → binary-IPL path is skipped). */
function fakeArchive(files: Record<string, Uint8Array>): LazyImgArchive {
  return {
    has: (name) => name.toLowerCase() in files,
    names: Object.keys(files),
    read: (name) => Promise.resolve(files[name.toLowerCase()] ?? null),
  };
}

function source(overrides: Partial<InstallSource> = {}): InstallSource {
  const loose: Record<string, string> = { 'data/gta.dat': '', 'data/maps/test.ide': IDE, 'data/maps/test.ipl': IPL };
  const gta3 = fakeArchive({
    'cj.dff': new Uint8Array([1, 2, 3]),
    'cjtxd.txd': new Uint8Array([4, 5]),
    'la.col': new Uint8Array([6]),
    'tree.dff': new Uint8Array([7]),
  });

  return {
    gta3,
    gtaInt: null,
    looseFiles: () => Promise.resolve(Object.keys(loose)),
    openLoose: () => Promise.resolve(null),
    readLoose: (path) => Promise.resolve(new TextEncoder().encode(loose[path])),
    readLooseText: (path) => Promise.resolve(loose[path] ?? ''),
    ...overrides,
  };
}

/** A source whose one placed model (`cj`) uses `cjtxd`, with the `txdp` links the test wants. */
function txdpSource(txdp: readonly string[]): InstallSource {
  const loose: Record<string, string> = {
    'data/maps/test.ide': ['objs', '100, cj, cjtxd, 100, 0', 'end', 'txdp', ...txdp, 'end'].join('\n'),
    'data/maps/test.ipl': IPL,
  };

  return source({
    gta3: fakeArchive({
      'cj.dff': new Uint8Array([1]),
      'cjtxd.txd': new Uint8Array([1]),
      'midtxd.txd': new Uint8Array([1]),
      'orphanparent.txd': new Uint8Array([1]),
      'roottxd.txd': new Uint8Array([1]),
    }),
    looseFiles: () => Promise.resolve(Object.keys(loose)),
    readLooseText: (path) => Promise.resolve(loose[path] ?? ''),
  });
}

describe('selectInstallEntries', () => {
  describe('negative cases', () => {
    it('drops models that are referenced but not placed in the exterior map', async () => {
      const plan = await selectInstallEntries(source());

      expect(plan.models.map((e) => e.name)).not.toContain('tree.dff');
    });

    it('does not pull a txdp parent whose CHILD dictionary nothing on this map references', async () => {
      // Parents are followed from the wanted set outwards, not read wholesale: a stock `txdp` section links
      // hundreds of dictionaries, and pulling every parent would drag in ones this map never asks for.
      const plan = await selectInstallEntries(txdpSource(['unplaced, orphanparent']));

      expect(plan.textures.map((e) => e.name)).not.toContain('orphanparent.txd');
    });

    it('does not hang on a txdp CYCLE', async () => {
      const plan = await selectInstallEntries(txdpSource(['cjtxd, midtxd', 'midtxd, cjtxd']));

      expect(plan.textures.map((e) => e.name).sort()).toEqual(['cjtxd.txd', 'midtxd.txd']);
    });
  });

  describe('positive cases', () => {
    it('selects the placed model + its txd + col into models, and no other world files', async () => {
      const plan = await selectInstallEntries(source());

      expect(plan.models).toEqual([
        { name: 'cj.dff', source: 'gta3' },
        { name: 'la.col', source: 'gta3' },
      ]);
      expect(plan.textures).toEqual([{ name: 'cjtxd.txd', source: 'gta3' }]);
      expect(plan.others).toEqual([]);
      expect(plan.loose).toEqual(['data/gta.dat', 'data/maps/test.ide', 'data/maps/test.ipl']);
    });

    it('pulls in EVERY ped (peds.ide) + EVERY vehicle (vehicles.ide), even when none are map-placed', async () => {
      const loose: Record<string, string> = {
        'data/peds.ide': 'peds\n66, bmypol1, bmypol1, CIVMALE\n9, cesar, cesar, CIVMALE\nend',
        'data/vehicles.ide': [
          'cars',
          '400, admiral, admtxd, car, ADMIRAL, gm, null, normal, 10, 7, 0, 100, 1.0, 1.0, 0',
          '402, buffalo, buftxd, car, BUFFALO, gm, null, normal, 10, 7, 0, 100, 1.0, 1.0, 0',
          'end',
        ].join('\n'),
      };
      const gta3 = fakeArchive({
        'admiral.dff': new Uint8Array([1]),
        'admtxd.txd': new Uint8Array([1]),
        'bmypol1.dff': new Uint8Array([1]),
        'bmypol1.txd': new Uint8Array([1]),
        'buffalo.dff': new Uint8Array([1]),
        'buftxd.txd': new Uint8Array([1]),
        'cesar.dff': new Uint8Array([1]),
        'cesar.txd': new Uint8Array([1]),
      });
      const plan = await selectInstallEntries(
        source({
          gta3,
          looseFiles: () => Promise.resolve(Object.keys(loose)),
          readLooseText: (p) => Promise.resolve(loose[p] ?? ''),
        }),
      );

      // Every ped (bmypol1 + cesar) + every vehicle (admiral + buffalo) — the whole roster, from the IDEs.
      expect(plan.models.map((e) => e.name).sort()).toEqual(['admiral.dff', 'bmypol1.dff', 'buffalo.dff', 'cesar.dff']);
      expect(plan.textures.map((e) => e.name).sort()).toEqual(['admtxd.txd', 'bmypol1.txd', 'buftxd.txd', 'cesar.txd']);
    });

    it('pulls in procobj clutter models (procobj.dat) + their txd, even when none are map-placed', async () => {
      const loose: Record<string, string> = {
        'data/maps/veg.ide': ['objs', '300, rockbrkq, gta_rockcuntry, 100, 0', 'end'].join('\n'),
        // Space-separated: surface model spacing minDist minRot maxRot minScl maxScl minSclZ maxSclZ zOffMin zOffMax align useGrid
        'data/procobj.dat': 'grnd rockbrkq 1 1 0 0 1 1 1 1 0 0 0 1',
      };
      const gta3 = fakeArchive({
        'gta_rockcuntry.txd': new Uint8Array([1]),
        'rockbrkq.dff': new Uint8Array([1]),
      });
      const plan = await selectInstallEntries(
        source({
          gta3,
          looseFiles: () => Promise.resolve(Object.keys(loose)),
          readLooseText: (p) => Promise.resolve(loose[p] ?? ''),
        }),
      );

      // rockbrkq is scattered from procobj.dat, never IPL-placed — its DFF+TXD must still be selected.
      expect(plan.models.map((e) => e.name)).toContain('rockbrkq.dff');
      expect(plan.textures.map((e) => e.name)).toContain('gta_rockcuntry.txd');
    });

    it('pulls in CLEO-scripted models (cleo/*.cs), by literal id and by name, even when unplaced', async () => {
      // A real-encoded script: REQUEST_MODEL 200 (tree — in the IDE but NOT placed), then
      // GET_MODEL_BY_NAME 'bush' out 3@, then TERMINATE_THIS_CUSTOM_SCRIPT.
      const script = new Uint8Array([
        0x47, 0x02, 0x01, 0xc8, 0x00, 0x00, 0x00, 0x9c, 0x0e, 0x0e, 0x04, 0x62, 0x75, 0x73, 0x68, 0x03, 0x03, 0x00,
        0x93, 0x0a,
      ]);
      const loose: Record<string, string> = {
        'data/maps/test.ide': ['objs', '200, tree, treetxd, 80, 0', '300, bush, bushtxd, 80, 0', 'end'].join('\n'),
      };
      const gta3 = fakeArchive({
        'bush.dff': new Uint8Array([1]),
        'bushtxd.txd': new Uint8Array([1]),
        'tree.dff': new Uint8Array([1]),
        'treetxd.txd': new Uint8Array([1]),
      });
      const plan = await selectInstallEntries(
        source({
          gta3,
          looseFiles: () => Promise.resolve([...Object.keys(loose), 'cleo/spawner.cs']),
          readLoose: (path) => Promise.resolve(path === 'cleo/spawner.cs' ? script : new Uint8Array(0)),
          readLooseText: (p) => Promise.resolve(loose[p] ?? ''),
        }),
      );

      // Neither model is IPL-placed; both are script-referenced — the spike's measured boundary.
      expect(plan.models.map((e) => e.name)).toContain('tree.dff');
      expect(plan.models.map((e) => e.name)).toContain('bush.dff');
      expect(plan.textures.map((e) => e.name)).toContain('treetxd.txd');
      expect(plan.textures.map((e) => e.name)).toContain('bushtxd.txd');
      // The script itself rides the loose bucket into the VFS.
      expect(plan.loose).toContain('cleo/spawner.cs');
    });

    it('skips a CLEO script that fails to decode without losing the selection', async () => {
      const plan = await selectInstallEntries(
        source({
          looseFiles: () =>
            Promise.resolve(['data/gta.dat', 'data/maps/test.ide', 'data/maps/test.ipl', 'cleo/broken.cs']),
          readLoose: () => Promise.resolve(new Uint8Array([0xff, 0x7f, 0x01])),
        }),
      );

      expect(plan.models.map((e) => e.name)).toContain('cj.dff');
    });

    it('pulls the whole txdp PARENT chain of a referenced dictionary', async () => {
      // A parent is named by no IDE row — it exists only as another dictionary's ancestor — so a selection
      // built from IDE rows alone leaves it out, and every texture that lives ONLY in it renders as the
      // material's flat colour. Measured: `salodpar.txd` is the parent of 995 `salod*` LOD dictionaries.
      const plan = await selectInstallEntries(txdpSource(['cjtxd, midtxd', 'midtxd, roottxd']));

      expect(plan.textures.map((e) => e.name).sort()).toEqual(['cjtxd.txd', 'midtxd.txd', 'roottxd.txd']);
    });
  });
});

describe('readEntry', () => {
  describe('negative cases', () => {
    it('throws when the entry is missing from its archive', async () => {
      await expect(readEntry(source(), { name: 'gone.dff', source: 'gta3' })).rejects.toThrow(/missing archive entry/);
    });

    it('throws when the entry resolves to gta_int but there is none', async () => {
      await expect(readEntry(source(), { name: 'x.dff', source: 'gta_int' })).rejects.toThrow(/missing archive entry/);
    });
  });

  describe('positive cases', () => {
    it('reads an entry from gta3 by name', async () => {
      expect(Array.from(await readEntry(source(), { name: 'cj.dff', source: 'gta3' }))).toEqual([1, 2, 3]);
    });
  });
});
