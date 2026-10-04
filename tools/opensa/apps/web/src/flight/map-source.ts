/**
 * Opening a MAP SOURCE for the flight replay (adapted from sa-map-viewer). A folder of ORIGINAL SA files →
 * the resolved map + its cell grid. Only the world files are ingested up front; models/textures are pulled
 * per cell by {@link AssetStore}. No game asset is ever uploaded: the http-dir path reads the bytes the
 * local server exposes from the user's own install.
 */
import type { InstallPlan, InstallSource } from '@opensa/loaders';
import type { AssetFileSystem, MapDefinitions, WorldGrid } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { looseGroup } from '@opensa/game-build/partition';
import {
  browserInstallSource,
  fetchDirIndex,
  fetchInstallSource,
  readEntry,
  selectInstallEntries,
} from '@opensa/loaders';
import { buildWorldGrid } from '@opensa/renderware/map/world-grid';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { Vfs } from '@opensa/vfs';

import { AssetStore } from './asset-store';

/** A map source opened into memory. */
export interface LoadedMap {
  assets: AssetStore;
  defs: MapDefinitions;
  fs: AssetFileSystem;
  grid: WorldGrid;
  label: string;
  models: { dff: number; osm: number };
}

/** Where to read the game files from. */
export type MapSource = { base: string; kind: 'http-dir' } | { kind: 'folder' };

/** Cell-grid totals for the readout. */
export interface MapStats {
  cells: number;
  hd: number;
  instances: number;
  lod: number;
  models: number;
}

const PICKER_ID = 'gtasa-flight-replay';

/** Whether this dir is an OpenSA-CONVERTED game (its geometry is `.osm`, not `.dff`). */
export function isConverted(map: LoadedMap): boolean {
  return map.models.osm > map.models.dff;
}

/** Open a source and resolve its whole map: parse gta.dat/IDE/IPL, then bucket the instances into cells. */
export async function loadMapSource(source: MapSource): Promise<LoadedMap> {
  const { install, label } = await openInstall(source);
  const plan = await selectInstallEntries(install);
  const fs = new Vfs();
  await ingestWorldFiles(fs, install, plan);
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });

  return {
    assets: new AssetStore(install, plan, fs, defs),
    defs,
    fs,
    grid: buildWorldGrid(defs, CELL_SIZE),
    label,
    models: {
      dff: plan.models.filter((entry) => entry.name.endsWith('.dff')).length,
      osm: plan.models.filter((entry) => entry.name.endsWith('.osm')).length,
    },
  };
}

/** Count what was resolved — the panel readout. */
export function mapStats(map: LoadedMap): MapStats {
  let hd = 0;
  let lod = 0;
  for (const cell of map.grid.values()) {
    hd += cell.hd.length;
    lod += cell.lod.length;
  }

  return { cells: map.grid.size, hd, instances: map.defs.instances.length, lod, models: map.defs.catalog.size };
}

/** gta.dat + every IDE/IPL: the loose `data/**` files plus the archives' placement entries. */
async function ingestWorldFiles(fs: Vfs, install: InstallSource, plan: InstallPlan): Promise<void> {
  const entries: [string, Uint8Array][] = [];
  for (const path of plan.loose) {
    if (looseGroup(path) === 'data' || looseGroup(path) === 'others') {
      entries.push([path, await install.readLoose(path)]);
    }
  }
  for (const entry of plan.others) {
    entries.push([entry.name, await readEntry(install, entry)]);
  }
  fs.addFiles('world', entries);
}

/** For a folder the picker is the FIRST await, so the click's user activation survives. */
async function openInstall(source: MapSource): Promise<{ install: InstallSource; label: string }> {
  if (source.kind === 'http-dir') {
    const index = await fetchDirIndex(source.base);

    return { install: await fetchInstallSource(source.base, index), label: source.base };
  }

  const dir = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });

  return { install: await browserInstallSource(dir), label: `folder: ${dir.name}` };
}
