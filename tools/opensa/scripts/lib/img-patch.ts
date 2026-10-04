import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * In-place VER2 IMG entry patching for field A/B without a rebuild (open-issue `sa-lod-visibility-budget.md`,
 * rounds 8–10). A `set` APPENDS the new bytes past the end of the archive (sector-aligned) and repoints the
 * directory entry — the original bytes stay where they were, so a `restore` is just the directory record
 * written back. Never shrink or overwrite an entry in place: that is how `lodcuntw65` became a hole in
 * `build/bisect-nomods/sa` (the clean 21-sector version could no longer fit its 11-sector slot).
 *
 * The pristine directory record of every patched entry lives in `<img>.patches.json` beside the archive; a
 * second `set` on the same name keeps the FIRST record, so `restore` always goes back to the pre-patch bytes.
 */
const SECTOR = 2048;
const HEADER = 8;
const ENTRY = 32;

export interface DirRecord {
  readonly offsetSectors: number;
  readonly sizeInArchive: number;
  readonly streamingSize: number;
}

export type Ledger = Record<string, DirRecord>;

interface Directory {
  readonly count: number;
  readonly index: Map<string, number>;
  readonly view: DataView;
}

const ledgerPath = (imgPath: string): string => `${imgPath}.patches.json`;

/** The archives of a built game tree that carry `name`. Several may match (a mod archive shadowing stock) —
 *  the caller patches all of them, so the field sees the patched bytes whichever one SA registered last. */
export function findArchivesWithEntry(gameDir: string, name: string): string[] {
  return listGameArchives(gameDir).filter((path) => imgHasEntry(path, name));
}

/** Whether the archive's directory carries `name` (case-insensitive). */
export function imgHasEntry(imgPath: string, name: string): boolean {
  const fd = openSync(imgPath, 'r');
  try {
    return readDirectory(fd).index.has(name.toLowerCase());
  } finally {
    closeSync(fd);
  }
}

/** The model archives a built game tree registers: `models/gta3.img`, `models/gta_int.img` and every `IMG`
 *  line of `data/gta.dat` / `data/default.dat` that exists on disk. */
export function listGameArchives(gameDir: string): string[] {
  const candidates = new Set<string>([join(gameDir, 'models', 'gta3.img'), join(gameDir, 'models', 'gta_int.img')]);
  for (const dat of ['gta.dat', 'default.dat']) {
    const path = join(gameDir, 'data', dat);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!/^IMG\s/i.test(trimmed)) continue;
      candidates.add(join(gameDir, trimmed.slice(3).trim().replace(/\\/g, '/').toLowerCase()));
    }
  }

  return [...candidates].filter((path) => existsSync(path));
}

/** Names of the entries currently patched in this archive (from the ledger). */
export function patchedEntries(imgPath: string): Ledger {
  return readLedger(imgPath);
}

/** Append `data` past the end of the archive and repoint `name`'s directory entry at it. */
export function patchImgEntry(imgPath: string, name: string, data: Uint8Array): { appendedAt: number } {
  if (data.length > 0xffff * SECTOR) throw new Error(`${name}: ${data.length} B exceeds the VER2 entry ceiling`);
  const fd = openSync(imgPath, 'r+');
  try {
    const directory = readDirectory(fd);
    const i = directory.index.get(name.toLowerCase());
    if (i === undefined) throw new Error(`${name} is not in ${imgPath}`);
    const ledger = readLedger(imgPath);
    ledger[name.toLowerCase()] ??= readRecord(directory, i);
    const fileSize = fstatSync(fd).size;
    const offsetSectors = Math.ceil(fileSize / SECTOR);
    const sectors = Math.max(1, Math.ceil(data.length / SECTOR));
    const padded = new Uint8Array(sectors * SECTOR);
    padded.set(data);
    writeSync(fd, padded, 0, padded.length, offsetSectors * SECTOR);
    writeRecord(fd, i, { offsetSectors, sizeInArchive: 0, streamingSize: sectors });
    writeLedger(imgPath, ledger);

    return { appendedAt: offsetSectors * SECTOR };
  } finally {
    closeSync(fd);
  }
}

/** Current bytes of an entry (the padded sector range is trimmed to whole sectors, as SA reads it). */
export function readImgEntry(imgPath: string, name: string): Uint8Array {
  const fd = openSync(imgPath, 'r');
  try {
    const directory = readDirectory(fd);
    const i = directory.index.get(name.toLowerCase());
    if (i === undefined) throw new Error(`${name} is not in ${imgPath}`);
    const record = readRecord(directory, i);
    const sectors = record.streamingSize !== 0 ? record.streamingSize : record.sizeInArchive;
    const bytes = new Uint8Array(sectors * SECTOR);
    readSync(fd, bytes, 0, bytes.length, record.offsetSectors * SECTOR);

    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** Point `name` back at its pre-patch bytes; false when the entry was never patched. */
export function restoreImgEntry(imgPath: string, name: string): boolean {
  const ledger = readLedger(imgPath);
  const record = ledger[name.toLowerCase()];
  if (!record) return false;
  const fd = openSync(imgPath, 'r+');
  try {
    const directory = readDirectory(fd);
    const i = directory.index.get(name.toLowerCase());
    if (i === undefined) throw new Error(`${name} is not in ${imgPath}`);
    writeRecord(fd, i, record);
  } finally {
    closeSync(fd);
  }
  delete ledger[name.toLowerCase()];
  writeLedger(imgPath, ledger);

  return true;
}

function readDirectory(fd: number): Directory {
  const header = new Uint8Array(HEADER);
  readSync(fd, header, 0, HEADER, 0);
  if (new TextDecoder().decode(header.subarray(0, 4)) !== 'VER2') {
    throw new Error('not a VER2 archive');
  }
  const count = new DataView(header.buffer).getUint32(4, true);
  const bytes = new Uint8Array(HEADER + count * ENTRY);
  readSync(fd, bytes, 0, bytes.length, 0);
  const index = new Map<string, number>();
  const duplicates = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const base = HEADER + i * ENTRY + 8;
    let end = base;
    while (end < base + 24 && bytes[end] !== 0) end += 1;
    const name = new TextDecoder().decode(bytes.subarray(base, end)).toLowerCase();
    // FIRST wins, because that is the record SA reads: an archive can carry a name twice (an IMG editor
    // that ADDS where it should replace leaves exactly that), and a last-wins index made this instrument
    // patch the copy the game never opens — a `set` that reports success and changes nothing in the field.
    if (index.has(name)) {
      duplicates.add(name);
      continue;
    }
    index.set(name, i);
  }
  for (const name of duplicates) {
    console.warn(`  ! ${name} appears more than once in this archive — patching the FIRST record, the one SA reads`);
  }

  return { count, index, view: new DataView(bytes.buffer) };
}

function readLedger(imgPath: string): Ledger {
  const path = ledgerPath(imgPath);

  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Ledger) : {};
}

function readRecord(directory: Directory, i: number): DirRecord {
  const base = HEADER + i * ENTRY;

  return {
    offsetSectors: directory.view.getUint32(base, true),
    sizeInArchive: directory.view.getUint16(base + 6, true),
    streamingSize: directory.view.getUint16(base + 4, true),
  };
}

function writeLedger(imgPath: string, ledger: Ledger): void {
  writeFileSync(ledgerPath(imgPath), `${JSON.stringify(ledger, null, 2)}\n`);
}

function writeRecord(fd: number, i: number, record: DirRecord): void {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, record.offsetSectors, true);
  view.setUint16(4, record.streamingSize, true);
  view.setUint16(6, record.sizeInArchive, true);
  writeSync(fd, bytes, 0, 8, HEADER + i * ENTRY);
}
