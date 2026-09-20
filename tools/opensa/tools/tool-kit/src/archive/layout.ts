import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { parseVer2Directory, ver2DirectoryLength, ver2EntryCount } from '@opensa/renderware/archive/img-archive';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the manifest lands in a built game tree. A REPORT, never the authority — see {@link openArchiveIndex}. */
export const ARCHIVE_MANIFEST = join('data', 'img-layout.json');

/** A read-only view over every `models/*.img` in a tree, resolving an entry to the archive that holds it. */
export interface ArchiveIndex {
  /** Which archive file holds `name`, or null. Case-insensitive, like the game's own lookup. */
  archiveOf(name: string): null | string;
  /** Every archive that was indexed, in load order. */
  archives: string[];
  /** The entry's bytes, read from whichever archive holds it. Same shape as {@link ImgArchive.get}, so an
   *  index is a drop-in for the single archive a tool used to open. */
  get(name: string): ArrayBuffer | null;
  /** Every entry across every archive, lowercased and deduped — the other half of the {@link ImgArchive}
   *  shape, so a caller that used to scan one archive's `names` can scan the whole tree instead. */
  names: string[];
}

/** What the manifest states about one archive. */
export interface ArchiveManifestEntry {
  bytes: number;
  entries: number;
  name: string;
}

/**
 * Index every `models/*.img` in a game tree by entry name.
 *
 * **This is the authority on where a file lives, and it cannot go stale** — it is built by reading each
 * archive's DIRECTORY (which sits at the head of the file, so nothing large is read) at the moment it is
 * asked. A written manifest could disagree with the tree after an installer added a car or spilled a
 * sibling, and the symptom would be the one the split's first pipeline run produced: a tool looking in
 * `gta3.img` for a texture the split had moved, reporting it as missing.
 *
 * Later archives win a name collision, matching the game's own last-registered-wins order for `gta.dat`
 * entries. The layout is designed so a collision cannot happen; this only decides what to do if one does.
 */
export function openArchiveIndex(gameDir: string): ArchiveIndex {
  const modelsDir = join(gameDir, 'models');
  const archives = existsSync(modelsDir)
    ? readdirSync(modelsDir)
        .filter((file) => file.toLowerCase().endsWith('.img'))
        .sort()
    : [];
  const readers = new Map<string, ImgArchive>();
  const owner = new Map<string, string>();
  for (const archive of archives) {
    const reader = openLazyVer2(join(modelsDir, archive));
    if (!reader) {
      continue;
    }
    readers.set(archive, reader);
    for (const name of reader.names) {
      owner.set(name.toLowerCase(), archive);
    }
  }

  return {
    archiveOf(name: string): null | string {
      return owner.get(name.toLowerCase()) ?? null;
    },
    archives: [...readers.keys()],
    get(name: string): ArrayBuffer | null {
      const archive = owner.get(name.toLowerCase());

      return (archive ? readers.get(archive)?.get(name) : null) ?? null;
    },
    names: [...owner.keys()],
  };
}

/**
 * A VER2 archive read through a FILE HANDLE: the directory up front, each entry sliced on demand.
 *
 * Buffering the whole `.img` is what the browser VFS already refuses to do, and Node cannot do it at all
 * past 2 GB — `readFileSync` throws `ERR_FS_FILE_TOO_LARGE`, which is how the converter came to be unable
 * to read its OWN output once the per-model files went in. It also keeps ~1.3 GB per archive out of a run's
 * RSS. Returns null for anything that is not VER2 — our own WIMG archives stay on the buffered path.
 *
 * (Promoted out of `opensa-pack` in 2026-08-15's split work: it was the one fd-backed reader in the repo,
 * and the archive index needs exactly it.)
 */
export function openLazyVer2(path: string): ImgArchive | null {
  const fd = openSync(path, 'r');
  const header = Buffer.alloc(8);
  readSync(fd, header, 0, 8, 0);
  if (header.toString('latin1', 0, 4) !== 'VER2') {
    closeSync(fd);

    return null;
  }
  const directory = Buffer.alloc(ver2DirectoryLength(ver2EntryCount(new Uint8Array(header))));
  readSync(fd, directory, 0, directory.length, 0);
  const files = parseVer2Directory(new Uint8Array(directory));

  return {
    get(name: string): ArrayBuffer | null {
      const entry = files.get(name.toLowerCase());
      if (!entry) {
        return null;
      }
      const [offset, size] = entry;
      const bytes = Buffer.alloc(size);
      readSync(fd, bytes, 0, size, offset);

      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    names: [...files.keys()],
  };
}

/**
 * Write `data/img-layout.json` — what the tree's archives are and what each one carries.
 *
 * **A report for readers outside the pipeline** (the standalone app, a debug script, a person), not a source
 * of truth: anything inside the build asks {@link openArchiveIndex}, which reads the tree itself and
 * therefore cannot disagree with it. Stating that here is the point — a manifest treated as authoritative is
 * a stale-by-construction lookup whose failure mode is silent.
 *
 * **Whoever finishes a tree calls this again**, and the first pipeline run is why: the split wrote it, six
 * stages then grew `gta3.img` by 750 MB and added a spill sibling, and the copy that shipped still described
 * the tree as it had been at stage one. Fields other than `archives` are carried over from an existing
 * manifest, so a refresh keeps what an earlier stage knew and only restates what it can see.
 */
export function writeArchiveManifest(gameDir: string, extra: Record<string, unknown> = {}): ArchiveManifestEntry[] {
  const manifestPath = join(gameDir, ARCHIVE_MANIFEST);
  // A tree with no `data/` is not one a manifest belongs in — the same tolerance `registerImgArchives` shows
  // a missing `gta.dat`, and it keeps this from inventing a folder in somebody's fixture.
  if (!existsSync(join(gameDir, 'data'))) {
    return [];
  }
  const previous = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>)
    : {};
  delete previous.archives;
  delete previous.note;
  const index = openArchiveIndex(gameDir);
  const archives = index.archives.map((name) => {
    const path = join(gameDir, 'models', name);
    const reader = openLazyVer2(path);

    return { bytes: statSync(path).size, entries: reader?.names.length ?? 0, name };
  });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        archives,
        note: 'A REPORT. The build resolves an entry with openArchiveIndex, which reads the tree.',
        // What an earlier stage knew and this one cannot see — the classifier's contested/unclaimed lists.
        ...previous,
        ...extra,
      },
      null,
      2,
    ),
  );

  return archives;
}
