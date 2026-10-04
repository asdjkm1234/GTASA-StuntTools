import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { assertVer2EntrySize, buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * An **editable** GTA IMG (VER2) archive: open, read, add-with-replace, delete, then rebuild a fresh `.img`.
 * Wraps the engine's read (`openArchive`) + write (`buildVer2Buffer`) primitives (read-only reuse) with the
 * mutation surface the offline tools need — map-optimizer (swap optimized entries) and opensa-lod-generator (emit
 * cell-LOD DFFs/atlas TXDs, strip old LODs). Edits are tracked lazily: untouched entries are read straight from
 * the source on rebuild, so opening a large archive is cheap. Entry names are case-insensitive (GTA convention).
 */
export interface EditableImg {
  /** Rebuild a VER2 `.img` buffer from the current entries (originals minus deletes, plus adds/replaces). */
  build(): Uint8Array;
  /** Remove an entry; returns false if it wasn't present. */
  delete(name: string): boolean;
  /** Entry bytes, or null if absent / deleted. */
  get(name: string): null | Uint8Array;
  /** Whether an entry is currently present. */
  has(name: string): boolean;
  /** Current entry names, in archive order (deletes removed, adds appended). */
  names(): string[];
  /** Add a new entry or replace an existing one. */
  set(name: string, data: Uint8Array): void;
  /**
   * Add or replace an entry whose bytes stay ON DISK until something asks for them — the same contract as
   * {@link set}, minus the memory. Staging N files costs N paths; only {@link writeImgFile} pulling them one
   * at a time ever holds one.
   *
   * This is what lets an installer stage a whole mod set before writing: vehicle-installer used to read and
   * rewrite the entire archive once PER CAR (212 times over a growing multi-GB file), and the obvious fix —
   * stage everything, write once — would otherwise have traded that I/O for 3 GB of resident buffers.
   */
  setFile(name: string, path: string): void;
  /**
   * An entry's byte length WITHOUT materialising it — `stat` for a staged file, the buffer's length for one
   * held in memory. `0` for an absent or deleted entry.
   *
   * This exists so {@link writeImgFamily} can decide where the cap falls before writing anything: planning
   * through `get` would read the whole staged mod set into memory, which is the cost {@link setFile} was
   * added to avoid.
   */
  size(name: string): number;
}

/** A fresh, empty {@link EditableImg} to populate with `set` and `build` (e.g. a new LOD archive). */
export function createImg(): EditableImg {
  return openImg(buildVer2Buffer([]));
}

/** Wrap an already-opened engine archive as an {@link EditableImg} (no re-read of the source bytes). */
export function editArchive(archive: ImgArchive): EditableImg {
  const order = [...archive.names];
  const overrides = new Map<string, Uint8Array>();
  /** Staged entries whose bytes are still on disk — read on demand, never held (see {@link EditableImg.setFile}). */
  const staged = new Map<string, string>();
  const deleted = new Set<string>();
  const key = (name: string): string => name.toLowerCase();
  const readOriginal = (name: string): null | Uint8Array => {
    const buffer = archive.get(name);

    return buffer ? new Uint8Array(buffer) : null;
  };
  /** Un-delete a name and give it a slot in archive order if it is new — shared by both write paths. */
  const place = (name: string): void => {
    deleted.delete(key(name));
    if (!order.some((existing) => key(existing) === key(name))) {
      order.push(name);
    }
  };

  const img: EditableImg = {
    build(): Uint8Array {
      return buildVer2Buffer(img.names().map((name) => ({ data: img.get(name) ?? new Uint8Array(0), name })));
    },
    delete(name: string): boolean {
      if (!img.has(name)) {
        return false;
      }
      deleted.add(key(name));
      overrides.delete(key(name));
      staged.delete(key(name));

      return true;
    },
    get(name: string): null | Uint8Array {
      if (deleted.has(key(name))) {
        return null;
      }
      const file = staged.get(key(name));

      return overrides.get(key(name)) ?? (file ? new Uint8Array(readFileSync(file)) : readOriginal(name));
    },
    has(name: string): boolean {
      return img.get(name) !== null;
    },
    names(): string[] {
      return order.filter((name) => !deleted.has(key(name)));
    },
    set(name: string, data: Uint8Array): void {
      // Refused HERE, before any rebuild starts: `writeImgFile` streams over the target in place, so an
      // oversized entry discovered mid-write would leave a destroyed archive behind its error.
      assertVer2EntrySize(name, data.length);
      place(name);
      staged.delete(key(name));
      overrides.set(key(name), data);
    },
    setFile(name: string, path: string): void {
      // Same refusal as `set`, on the file's size — the point of staging is that nothing is read yet, so the
      // ceiling has to be checked against `stat` rather than against bytes we deliberately do not hold.
      assertVer2EntrySize(name, statSync(path).size);
      place(name);
      overrides.delete(key(name));
      staged.set(key(name), path);
    },
    size(name: string): number {
      if (deleted.has(key(name))) {
        return 0;
      }
      const file = staged.get(key(name));
      if (file !== undefined) {
        return statSync(file).size;
      }

      return overrides.get(key(name))?.length ?? readOriginal(name)?.length ?? 0;
    },
  };

  return img;
}

/** Open IMG bytes as an {@link EditableImg}. */
export function openImg(bytes: Uint8Array): EditableImg {
  return editArchive(openArchive(bytes));
}

const SECTOR = 2048;

/**
 * The most one archive FILE may hold, and the reason is the host rather than the game or the format.
 *
 * `readFileSync` throws `ERR_FS_FILE_TOO_LARGE` past 2 GiB while the positional write path has no ceiling at
 * all, so a stage can emit an archive that every stage after it fails to open — measured, with the build that
 * hit it, in `docs/edge-cases/converter-pipeline.md`. VER2 itself addresses entries in uint32 sectors and has
 * room for terabytes.
 *
 * 1.75 GiB leaves ~200 MB under the wall: enough for a directory, for whole-sector padding on every entry,
 * and for the next mod somebody installs without re-deciding this number.
 */
export const ARCHIVE_CAP_BYTES = 1.75 * 1024 ** 3;

/** One file of an archive FAMILY — `vehicles.img`, `vehicles2.img`, … */
export interface ArchiveFamilyMember {
  bytes: number;
  entries: number;
  path: string;
}

/**
 * The members of an archive family that exist on disk — `<stem>.img`, `<stem>2.img`, … up to the first gap.
 * Empty when even the base file is missing.
 */
export function imgFamilyMembers(basePath: string): string[] {
  const members: string[] = [];
  for (let index = 0; existsSync(familyPath(basePath, index)); index += 1) {
    members.push(familyPath(basePath, index));
  }

  return members;
}

/**
 * Open a whole archive FAMILY as ONE {@link EditableImg} — the read half of {@link writeImgFamily}, so a
 * tool that edits a family a build already spilled (`vehicles.img` + `vehicles2.img`) stages against every
 * entry the family holds and never adds a duplicate of a name a sibling carries. Entry order is member order;
 * a name a later member repeats resolves to the later one, as the game's last-registered-wins lookup does.
 *
 * Every member is read INTO MEMORY (each is under {@link ARCHIVE_CAP_BYTES} by construction), which is what
 * makes writing the family back over the same paths safe: the writer truncates each file it rewrites, and a
 * reader still holding a file handle on it would be reading a hole. Throws when the base member is missing.
 */
export function openImgFamily(basePath: string): EditableImg {
  const members = imgFamilyMembers(basePath);
  if (members.length === 0) {
    throw new Error(`no archive family at ${basePath}`);
  }
  const archives = members.map((path) => {
    const bytes = readFileSync(path);

    return openArchive(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
  const owner = new Map<string, ImgArchive>();
  const order: string[] = [];
  for (const archive of archives) {
    for (const name of archive.names) {
      const key = name.toLowerCase();
      if (!owner.has(key)) {
        order.push(name);
      }
      owner.set(key, archive);
    }
  }

  return editArchive({
    get(name: string): ArrayBuffer | null {
      return owner.get(name.toLowerCase())?.get(name) ?? null;
    },
    names: order,
  });
}

/**
 * Write an {@link EditableImg} as a FAMILY of archives, none of them over {@link ARCHIVE_CAP_BYTES}:
 * `<stem>.img`, then `<stem>2.img`, `<stem>3.img` as the cap is reached.
 *
 * **The cap belongs to the writer, not to whoever decided the layout.** An archive crosses the ceiling while
 * an installer is adding its 212th car, not while the buckets are being chosen — so the only place that can
 * bound it is the code doing the growing. Splitting a bucket in two is safe because the game resolves an
 * entry by NAME across every registered archive; what it costs is one slot in `CStreaming::ms_files`, which
 * is why callers still have to budget for the count (`img-splitter`'s `assertArchiveSlots`).
 *
 * Entries are placed greedily in `names()` order, so a family is stable for a given input and no entry is
 * ever moved for its own sake. **Stale siblings from an earlier, longer run are deleted**: leaving
 * `<stem>3.img` behind would keep a `gta.dat` line pointing at an archive holding superseded entries.
 */
export function writeImgFamily(
  img: EditableImg,
  basePath: string,
  cap = ARCHIVE_CAP_BYTES,
  /**
   * What must not be split across siblings — entry name → a key its neighbours share, or null for "on its
   * own". A car's files answer with the car's slot, so a `.dff` and its `.txd` never end up in different
   * archives (they did for **148 of 201 cars**, 2026-08-20). Nothing about the game requires this — it
   * resolves an entry by name across every registered archive — it is so that "where does this car live"
   * has one answer while something is being diagnosed (plan 103, the user's call).
   */
  keyOf: (name: string) => null | string = () => null,
): ArchiveFamilyMember[] {
  // Cohesive entries first, in the order their key first appears, so the family stays stable for an input.
  const order: string[][] = [];
  const byKey = new Map<string, string[]>();
  for (const name of img.names()) {
    const key = keyOf(name);
    if (key === null) {
      order.push([name]);
      continue;
    }
    const held = byKey.get(key);
    if (held === undefined) {
      const fresh = [name];
      byKey.set(key, fresh);
      order.push(fresh);
    } else {
      held.push(name);
    }
  }
  // What an entry costs the FILE: whole sectors of data plus its 32-byte directory row.
  const cost = (name: string): number => Math.max(1, Math.ceil(img.size(name) / SECTOR)) * SECTOR + 32;
  const groups: string[][] = [[]];
  let used = SECTOR; // the leading directory sector every file starts with
  for (const cohort of order) {
    const total = cohort.reduce((sum, name) => sum + cost(name), 0);
    const current = groups[groups.length - 1];
    if (current.length > 0 && used + total > cap) {
      groups.push([]);
      used = SECTOR;
    }
    // A cohort bigger than a whole archive still has to split — it says so rather than writing a file past
    // the cap, which is the one thing this may not do.
    if (total + SECTOR > cap) {
      console.warn(
        `writeImgFamily: ${cohort.length} entries keyed together are ${total} B, past the ${cap} B cap — ` +
          `split across siblings (${cohort.slice(0, 3).join(', ')}…)`,
      );
    }
    for (const name of cohort) {
      const entry = cost(name);
      if (groups[groups.length - 1].length > 0 && used + entry > cap) {
        groups.push([]);
        used = SECTOR;
      }
      groups[groups.length - 1].push(name);
      used += entry;
    }
  }

  const written = groups.map((names, index) => {
    const path = familyPath(basePath, index);
    writeImgFile({ ...img, names: () => names }, path);

    return { bytes: statSync(path).size, entries: names.length, path };
  });
  for (let index = written.length; existsSync(familyPath(basePath, index)); index += 1) {
    rmSync(familyPath(basePath, index));
  }

  return written;
}

/**
 * Stream an {@link EditableImg} to a VER2 `.img` **file** — the low-memory sibling of `build()`: entries are
 * pulled and written one at a time (peak extra memory = the largest single entry, not the whole archive), the
 * directory lands in its reserved leading sectors afterwards. Byte-identical to
 * `buildVer2Buffer(img.names().map(…))`. For the ~1 GB game archives `build()` alone doubles the run's peak
 * RSS; this keeps the rebuild flat (map-optimizer plan 011 finalize).
 *
 * **Refuses to write past {@link ARCHIVE_CAP_BYTES}** — every archive writer in the repo goes through here,
 * so this is the one place that can guarantee no stage emits a file the next stage cannot open. The check
 * rides the write cursor rather than a pre-pass, because sizing every entry up front would materialise them
 * all; when it trips, the partial file is REMOVED, since a truncated archive that looks finished is worse
 * than none. A caller that legitimately outgrows one file uses {@link writeImgFamily}, which plans its
 * members under the cap and therefore never trips this.
 */
export function writeImgFile(img: EditableImg, path: string, cap = ARCHIVE_CAP_BYTES): void {
  const names = img.names();
  const dirSectors = Math.ceil((8 + names.length * 32) / SECTOR);
  const directory = new Uint8Array(dirSectors * SECTOR);
  const view = new DataView(directory.buffer);
  directory.set(new TextEncoder().encode('VER2'), 0);
  view.setUint32(4, names.length, true);

  // The dir, because a seeded archive can be the first file in its tree — the buffered helpers this
  // replaced created it, and losing that silently turned a fresh install into ENOENT.
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'w');
  let failed = false;
  try {
    let cursor = dirSectors;
    names.forEach((name, i) => {
      const encoded = new TextEncoder().encode(name);
      if (encoded.length > 24) {
        throw new Error(`VER2 name too long (max 24 bytes): ${name}`);
      }
      const data = img.get(name) ?? new Uint8Array(0);
      assertVer2EntrySize(name, data.length);
      const sectors = Math.max(1, Math.ceil(data.length / SECTOR));
      if ((cursor + sectors) * SECTOR > cap) {
        throw new Error(
          `${basename(path)} would pass the ${(cap / 1024 ** 3).toFixed(2)} GiB archive cap at entry '${name}' ` +
            `(${i + 1} of ${names.length}) — past 2 GiB no reader in the repo can open it (readFileSync throws ` +
            'ERR_FS_FILE_TOO_LARGE). Move content into another bucket, or write this one as a family.',
        );
      }
      const base = 8 + i * 32;
      view.setUint32(base, cursor, true);
      view.setUint16(base + 4, sectors, true); // streamingSize (sectors); sizeInArchive stays 0
      directory.set(encoded, base + 8);
      writeSync(fd, data, 0, data.length, cursor * SECTOR);
      cursor += sectors;
    });
    ftruncateSync(fd, cursor * SECTOR); // zero-fill the last entry's sector padding
    writeSync(fd, directory, 0, directory.length, 0);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    closeSync(fd);
    if (failed) {
      rmSync(path, { force: true }); // a half-written archive reads as a finished one — do not leave it
    }
  }
}

/** `…/vehicles.img` + 0 → `…/vehicles.img`; + 1 → `…/vehicles2.img`. */
function familyPath(basePath: string, index: number): string {
  return index === 0 ? basePath : basePath.replace(/\.img$/i, `${index + 1}.img`);
}
