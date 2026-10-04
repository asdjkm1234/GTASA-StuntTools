/**
 * Opening a MAP SOURCE (plan 094): a folder of ORIGINAL SA files → the resolved map + its cell grid.
 *
 * Two ways in, both over the game's own {@link InstallSource} so what the viewer reads is what the game reads:
 * a user-picked folder (File System Access) or a served dir (`?src=`, the headless-drivable one).
 *
 * **Only the world files are ingested up front** — gta.dat, the IDEs and the IPLs, which is everything
 * `resolveMap` needs. Models and textures are pulled per cell by {@link AssetStore}: welding one cell wants a
 * couple of hundred DFFs, and reading the whole placed set (≈13 000 models over Range requests) would put
 * minutes between picking a folder and seeing it — the exact loop this tool exists to shorten.
 *
 * Every load carries a {@link LoadedMap.label} saying WHERE the bytes came from — a capture out of this tool
 * must never be silent about its source (the A/B rule in CLAUDE.md).
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
import { buildWorldGrid } from '@opensa/renderware';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { Vfs } from '@opensa/vfs';

import { AssetStore } from './asset-store';

/** A map source opened into memory. */
export interface LoadedMap {
  /** Per-cell model/texture ingest — the welder reads through `fs`, this is what fills it. */
  assets: AssetStore;
  defs: MapDefinitions;
  fs: AssetFileSystem;
  grid: WorldGrid;
  /** Human-readable origin of these bytes — shown on screen and in every capture. */
  label: string;
  /** Geometry format census of the install. `osm > dff` ⇒ an OpenSA-converted dir (see {@link isConverted}). */
  models: { dff: number; osm: number };
}

/** Where to read the game files from. */
export type MapSource =
  /** A statically served game dir (`?src=<url>`; `npm run serve:static` exposes `build/` and `game-src/`). */
  | { base: string; kind: 'http-dir' }
  /** A folder picked through the File System Access API (Chromium). */
  | { kind: 'folder' };

/** Cell-grid totals for the readout. */
export interface MapStats {
  cells: number;
  hd: number;
  instances: number;
  lod: number;
  models: number;
}

/** Per-tool "last folder" memory for the picker — deliberately not the game's remembered install. */
const PICKER_ID = 'opensa-map-viewer';

/**
 * Whether this dir is an OpenSA-CONVERTED game (its geometry is `.osm`, not `.dff`). This viewer welds from
 * RenderWare DFFs, so such a dir resolves its map and then welds nothing — and it does not need this tool
 * anyway: the OpenSA build has a map viewer already, in the in-game debugger. Say so rather than render
 * an empty screen.
 */
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

/** Count what was resolved — the panel readout (and the number an A/B compares first). */
export function mapStats(map: LoadedMap): MapStats {
  let hd = 0;
  let lod = 0;
  for (const cell of map.grid.values()) {
    hd += cell.hd.length;
    lod += cell.lod.length;
  }

  return { cells: map.grid.size, hd, instances: map.defs.instances.length, lod, models: map.defs.catalog.size };
}

/** The source named by the URL, or `null` when the app should show the picker. */
export function sourceFromQuery(search: string): MapSource | null {
  const base = new URLSearchParams(search).get('src');

  return base ? { base: base.replace(/\/$/, ''), kind: 'http-dir' } : null;
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
