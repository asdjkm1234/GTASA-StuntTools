import type { GroupName } from '@opensa/game-build/partition';

import { looseGroup } from '@opensa/game-build/partition';
import { openImg } from '@opensa/tool-kit/archive/img';

/**
 * Model archives are EXPANDED into the pack, never shipped as containers.
 *
 * The runtime resolves an asset by its BARE name — `fs.get('bmycg.osm')`, `la.col`, `infernus.osm` — and the
 * VFS is a flat map of exactly the keys a chunk delivered. The folder/http-dir loaders satisfy that by reading
 * the archive directory and ingesting each entry under its own name (`install-source-loader.ts`'s
 * `filesForGroup`). The fetch loader has no such step: it pushes chunk bytes into the VFS verbatim. So an
 * archive packed as one file lands as one opaque key (`models/gta3.img`, sliced) and every name inside it is
 * unreachable — the player ped, the vehicles, the collision libraries.
 *
 * That is the whole of this module: do at pack time what the local loader does at load time, so the same game
 * dir serves identically through either loader. It stays within fetch-pack's "knows NOTHING about the game's
 * content" rule — an IMG directory is a container index, not content; nothing here parses an IDE or an IPL.
 *
 * The pack ships EVERY entry, where the local loader ships only the IDE/IPL-referenced selection. A superset
 * is the safe direction (a name the game asks for is present) and it costs nothing in bytes: the container
 * form already shipped exactly these bytes.
 *
 * An entry keeps the archive's 2 KiB SECTOR PADDING — a VER2 directory records a size in sectors and the exact
 * byte length is not in it, so there is nothing to trim to. The local loader delivers the same padded bytes;
 * every parser downstream already tolerates the tail, because it has always been there.
 */

/** `models/<name>.img`. `anim/anim.img` is deliberately NOT one — nothing resolves its contents by name. */
const MODEL_IMG = /^models\/[^/]+\.img$/i;
const GTA3 = 'models/gta3.img';
const GTA_INT = 'models/gta_int.img';

/** One archive entry, ready to pack: the bare lowercased name the runtime will ask for. */
export interface ArchiveEntry {
  readonly bytes: Uint8Array;
  readonly group: GroupName;
  readonly name: string;
}

/**
 * The order archives are consulted in, which is what decides who wins a duplicated entry name: `gta3.img`
 * first, then `gta_int.img`, then the rest alphabetically.
 *
 * This is the LOCAL loader's precedence, not a choice made here — `install-source-core.ts` sorts the override
 * archives exactly this way and `resolveSource` lets `gta3` win over all of them. The two loaders MUST resolve
 * a name to the same bytes; a game that renders differently depending on how it was served is the kind of
 * defect that only shows up in production, on a machine nobody can attach a debugger to.
 */
export function archiveOrder(paths: readonly string[]): string[] {
  // Compared lowercased: the paths arrive with their on-disk spelling (a TC names its archives as it likes)
  // and the order decides who wins a name, so it may not depend on how the filesystem happened to spell it.
  return paths
    .filter(isModelArchive)
    .sort((a, b) => rank(a) - rank(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
}

/**
 * Every model archive's entries under their bare lowercased names, first archive owning a name winning.
 *
 * Archives are opened one at a time and entries are returned as VIEWS into the archive bytes (no copy), so the
 * peak cost is what the file walk already paid to read the same archives — `original`'s `gta3.img` alone is
 * 1.4 GB and this must not double it.
 */
export function expandModelArchives(read: (path: string) => Uint8Array, paths: readonly string[]): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  const seen = new Set<string>();
  for (const path of archiveOrder(paths)) {
    const img = openImg(read(path));
    for (const entry of img.names()) {
      const name = entry.toLowerCase();
      if (seen.has(name)) {
        continue;
      }
      const bytes = img.get(entry);
      if (!bytes) {
        continue;
      }
      seen.add(name);
      out.push({ bytes, group: archiveGroup(name), name });
    }
  }

  return out;
}

/** Is this game-dir path a model archive — one {@link expandModelArchives} takes over from the file walk? */
export function isModelArchive(path: string): boolean {
  return MODEL_IMG.test(path);
}

/**
 * The group an archive entry ships in — {@link looseGroup}'s extension rules with one deliberate difference:
 * collision goes with the geometry.
 *
 * `looseGroup` answers for a loose PATH, where a stray `.col` is a leftover; the local loader's partition puts
 * archive-borne `.col` in `models` (`MODEL_WORLD_EXTENSIONS`), and matching it matters because the group
 * decides whether the chunk is cacheable — collision in the uncached `data` group would re-download the
 * world's physics on every boot.
 */
function archiveGroup(name: string): GroupName {
  return name.endsWith('.col') ? 'models' : looseGroup(name);
}

function rank(path: string): number {
  const lower = path.toLowerCase();

  return lower === GTA3 ? 0 : lower === GTA_INT ? 1 : 2;
}
