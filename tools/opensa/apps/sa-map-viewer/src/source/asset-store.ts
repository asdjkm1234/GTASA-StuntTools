/**
 * Per-cell model + texture ingest (plan 094, phase 1). The welder reads through a synchronous
 * {@link AssetFileSystem}, so the bytes a cell needs have to be in the VFS BEFORE it welds — but only those
 * bytes. This resolves a cell's model names to their archive entries (the same partition the game's install
 * loaders use), reads the ones not yet resident, and drops them into the VFS.
 *
 * A model contributes two things: its geometry (`<model>.dff`, or `<model>.osm` in a converted game dir) and
 * its dictionary (`<txd>.txd` from the IDE row) **plus every `txdp` parent of that dictionary** — the planner
 * walks the chain, and a missing parent silently costs textures rather than failing.
 */
import type { InstallPlan, InstallSource } from '@opensa/loaders';
import type { IdeObjectDef, MapDefinitions } from '@opensa/renderware';
import type { Vfs } from '@opensa/vfs';

import { readEntry } from '@opensa/loaders';

type Entry = InstallPlan['models'][number];

export class AssetStore {
  private readonly byName = new Map<string, Entry>();
  private readonly defsByModel = new Map<string, IdeObjectDef>();
  private readonly requested = new Set<string>();
  private readonly txdParents: ReadonlyMap<string, string>;

  constructor(
    private readonly install: InstallSource,
    plan: InstallPlan,
    private readonly fs: Vfs,
    defs: MapDefinitions,
  ) {
    for (const entry of [...plan.models, ...plan.textures]) {
      this.byName.set(entry.name.toLowerCase(), entry);
    }
    for (const catalog of [defs.catalog, defs.timedCatalog]) {
      for (const def of catalog?.values() ?? []) {
        this.defsByModel.set(def.modelName.toLowerCase(), def);
      }
    }
    this.txdParents = defs.txdParents ?? new Map<string, string>();
  }

  /** Read whatever these models still need into the VFS. Returns the bytes ingested by this call. */
  async ensure(modelNames: Iterable<string>): Promise<number> {
    const wanted = new Set<string>();
    for (const model of modelNames) {
      const name = model.toLowerCase();
      addCandidate(wanted, this.byName, `${name}.dff`, `${name}.osm`);
      const def = this.defsByModel.get(name);
      for (const txd of this.txdChain(def?.txdName)) {
        addCandidate(wanted, this.byName, `${txd}.txd`, `${txd}.ostex`);
      }
    }

    let bytes = 0;
    const entries: [string, Uint8Array][] = [];
    for (const name of wanted) {
      if (this.requested.has(name)) {
        continue;
      }
      this.requested.add(name);
      const entry = this.byName.get(name);
      if (!entry) {
        continue;
      }
      const data = await readEntry(this.install, entry).catch(() => null);
      if (data) {
        entries.push([entry.name, data]);
        bytes += data.byteLength;
      }
    }
    if (entries.length > 0) {
      this.fs.addFiles(`cell-${this.requested.size}`, entries);
    }

    return bytes;
  }

  /** A dictionary and its `txdp` ancestors, lowercased (cycle-safe). */
  private txdChain(txdName: string | undefined): string[] {
    const chain: string[] = [];
    let current = txdName?.toLowerCase();
    while (current && !chain.includes(current)) {
      chain.push(current);
      current = this.txdParents.get(current);
    }

    return chain;
  }
}

/** Note the first candidate name the install actually carries (`.dff` before the converted `.osm`). */
function addCandidate(wanted: Set<string>, byName: ReadonlyMap<string, Entry>, ...names: string[]): void {
  for (const name of names) {
    if (byName.has(name)) {
      wanted.add(name);

      return;
    }
  }
}
