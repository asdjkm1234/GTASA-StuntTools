import type { InstallPlan, InstallSource } from '@opensa/loaders';
import type { IdeObjectDef, MapDefinitions } from '@opensa/renderware';

import { Vfs } from '@opensa/vfs';
import { describe, expect, it } from 'vitest';

import { AssetStore } from './asset-store';

type Entry = InstallPlan['models'][number];

function def(id: number, modelName: string, txdName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName };
}

function defs(rows: readonly IdeObjectDef[], txdParents?: Map<string, string>): MapDefinitions {
  return {
    catalog: new Map(rows.map((row) => [row.id, row])),
    imgDirs: [],
    instances: [],
    ...(txdParents ? { txdParents } : {}),
  };
}

/** An install whose archive answers one byte per entry and COUNTS what was read. */
function fakeInstall(reads: string[]): InstallSource {
  const archive = {
    names: [],
    read: (name: string): Promise<null | Uint8Array> => {
      reads.push(name);

      return Promise.resolve(new Uint8Array([1]));
    },
  };

  return { gta3: archive, gtaInt: null } as unknown as InstallSource;
}

function plan(names: readonly string[]): InstallPlan {
  const entries = names.map((name): Entry => ({ name, source: 'gta3' }));

  return {
    loose: [],
    models: entries.filter((entry) => entry.name.endsWith('.dff') || entry.name.endsWith('.osm')),
    others: [],
    textures: entries.filter((entry) => entry.name.endsWith('.txd') || entry.name.endsWith('.ostex')),
  };
}

describe('AssetStore.ensure', () => {
  describe('negative cases', () => {
    it('skips a model the install does not carry instead of throwing', async () => {
      const reads: string[] = [];
      const store = new AssetStore(fakeInstall(reads), plan([]), new Vfs(), defs([def(1, 'ghost', 'txd')]));
      expect(await store.ensure(['ghost'])).toBe(0);
      expect(reads).toEqual([]);
    });

    it('does not loop forever on a txdp CYCLE', async () => {
      // A cyclic parent chain in the data must not hang the browser tab.
      const reads: string[] = [];
      const cycle = new Map([
        ['a', 'b'],
        ['b', 'a'],
      ]);
      const store = new AssetStore(
        fakeInstall(reads),
        plan(['house.dff', 'a.txd', 'b.txd']),
        new Vfs(),
        defs([def(1, 'house', 'a')], cycle),
      );
      await store.ensure(['house']);
      expect([...reads].sort()).toEqual(['a.txd', 'b.txd', 'house.dff']);
    });

    it('reads nothing on a second call for the same model', async () => {
      const reads: string[] = [];
      const store = new AssetStore(
        fakeInstall(reads),
        plan(['house.dff', 'txd.txd']),
        new Vfs(),
        defs([def(1, 'house', 'txd')]),
      );
      await store.ensure(['house']);
      const first = reads.length;
      expect(await store.ensure(['house'])).toBe(0);
      expect(reads).toHaveLength(first);
    });
  });

  describe('positive cases', () => {
    it('pulls the model, its dictionary and the whole txdp parent chain', async () => {
      const reads: string[] = [];
      const parents = new Map([
        ['child', 'mid'],
        ['mid', 'root'],
      ]);
      const store = new AssetStore(
        fakeInstall(reads),
        plan(['house.dff', 'child.txd', 'mid.txd', 'root.txd']),
        new Vfs(),
        defs([def(1, 'house', 'child')], parents),
      );
      await store.ensure(['house']);
      expect([...reads].sort()).toEqual(['child.txd', 'house.dff', 'mid.txd', 'root.txd']);
    });

    it('prefers the raw .dff over a converted .osm of the same model', async () => {
      // The welder reads RenderWare geometry; an .osm entry is the converter's output and cannot be welded.
      const reads: string[] = [];
      const store = new AssetStore(
        fakeInstall(reads),
        plan(['house.dff', 'house.osm']),
        new Vfs(),
        defs([def(1, 'house', 'missing')]),
      );
      await store.ensure(['house']);
      expect(reads).toEqual(['house.dff']);
    });

    it('lands the bytes in the VFS under the entry name the welder looks up', async () => {
      const fs = new Vfs();
      const store = new AssetStore(fakeInstall([]), plan(['house.dff', 'txd.txd']), fs, defs([def(1, 'house', 'txd')]));
      expect(await store.ensure(['HOUSE'])).toBe(2); // one byte each; the lookup is case-insensitive
      expect(fs.has('house.dff')).toBe(true);
      expect(fs.has('txd.txd')).toBe(true);
    });
  });
});
