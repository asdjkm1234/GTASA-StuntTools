import {
  assertRebuildSafe,
  type BinaryIplInstance,
  encodeBinaryIpl,
  extractRawCars,
} from '@opensa/map-placement/ipl-binary-write';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { type MergeDirective, parseMergeFile } from './ide-merge';

/**
 * Binary-stream side of the IPL merge convention (plan 008).
 *
 * - {@link patchAreaStreams}: after a text-IPL merge deletes inst rows, every `<area>_streamN.ipl` entry in
 *   the install's `gta3.img` is lod-rebased the same way — byte-in-place (40-byte INST records only), so CARS
 *   and everything else stay byte-identical.
 * - {@link applyStreamMerge}: a `gta3_img/<name>.ipl.merge` EDITS the existing stream entry instead of
 *   replacing it. Same directive grammar as data merges; rows are the binary INST fields in text form —
 *   `id, interior, x, y, z, rx, ry, rz, rw, lod` — matched canonically (6 significant digits), so float
 *   formatting can't break a match. `add` appends, `remove` deletes (stream rows are never index-referenced,
 *   so deletion is safe), `replace` swaps. The entry is rebuilt via `encodeBinaryIpl` with its CARS block
 *   carried over; a stream using any other section refuses loudly.
 */

const INST_SIZE = 40;

/** Apply a stream `.merge` to the entry bytes; returns the rebuilt stream + non-fatal warnings. */
export function applyStreamMerge(
  entry: Uint8Array,
  mergeText: string,
  label: string,
): { bytes: Uint8Array; warnings: string[] } {
  const buffer = entry.buffer.slice(entry.byteOffset, entry.byteOffset + entry.byteLength) as ArrayBuffer;
  assertRebuildSafe(buffer, label);
  const instances = [...parseBinaryIpl(buffer)];
  const cars = extractRawCars(buffer);
  const warnings: string[] = [];

  for (const directive of parseMergeFile(mergeText)) {
    if (directive.section !== 'inst') {
      warnings.push(`${label}: stream merges support only "inst" — skipped "${directive.section}"`);
      continue;
    }
    applyStreamDirective(instances, directive, label, warnings);
  }

  return { bytes: encodeBinaryIpl(instances, cars), warnings };
}

/** Canonical identity of an instance — every numeric field at 6 significant digits. */
export function canonicalInstance(inst: BinaryIplInstance): string {
  return [inst.id, inst.interior, ...inst.position, ...inst.rotation, inst.lod]
    .map((value) => Number(value).toPrecision(6))
    .join(',');
}

/** Render an instance as a merge row (the exact inverse of {@link parseInstanceRow}). */
export function formatInstanceRow(inst: BinaryIplInstance): string {
  return [inst.id, inst.interior, ...inst.position, ...inst.rotation, inst.lod].join(', ');
}

/** Whether this IMG-folder file is a stream merge (applied to the entry) rather than a plain entry. */
export function isStreamMerge(fileName: string): boolean {
  return /\.ipl\.merge$/i.test(fileName);
}

/** Parse a merge row — `id, interior, x, y, z, rx, ry, rz, rw, lod` — into a binary instance. */
export function parseInstanceRow(row: string, label: string): BinaryIplInstance {
  const cells = row.split(',').map((cell) => Number(cell.trim()));
  if (cells.length !== 10 || cells.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label}: expected 'id, interior, x, y, z, rx, ry, rz, rw, lod' — got: ${row}`);
  }

  return {
    id: cells[0],
    interior: cells[1],
    lod: cells[9],
    position: [cells[2], cells[3], cells[4]],
    rotation: [cells[5], cells[6], cells[7], cells[8]],
  };
}

/**
 * Mirror text-IPL inst deletions into the area's binary streams: for every `<base>_streamN.ipl` in
 * `<out>/models/gta3.img`, each instance's `lod` above a removed index shifts down; a lod pointing AT a
 * removed row is an error. `removed` is in the ORIGINAL text index space (ascending), exactly as
 * `applyIdeMerge` reports it. No-op when the img or the area has no streams.
 */
export function patchAreaStreams(outPath: string, textIplPath: string, removed: readonly number[]): void {
  const imgPath = join(outPath, 'models', 'gta3.img');
  if (!existsSync(imgPath)) {
    return;
  }
  const base = basename(textIplPath)
    .replace(/\.ipl$/i, '')
    .toLowerCase();
  const img = openImg(readBytes(imgPath));
  const streams = img
    .names()
    .filter((name) => name.toLowerCase().startsWith(`${base}_stream`) && name.toLowerCase().endsWith('.ipl'));
  if (streams.length === 0) {
    return;
  }
  for (const name of streams) {
    const { bytes, warnings } = patchStreamLods(img.get(name)!, removed, name);
    for (const warning of warnings) {
      console.warn(`mod-installer: ${warning}`);
    }
    img.set(name, bytes);
  }
  writeFileSync(imgPath, img.build());
}

/**
 * Rebase one stream's instance lods past the removed text rows — byte-in-place on a copy (40-byte INST
 * records only; CARS and everything else stay byte-identical). An instance still linking AT a removed row is
 * UNLINKED (`lod -1`) with a warning — a later stream merge usually deletes or re-points it (the author's
 * pack removes those instances itself); an error here would block that legitimate composition.
 */
export function patchStreamLods(
  entry: Uint8Array,
  removed: readonly number[],
  label: string,
): { bytes: Uint8Array; warnings: string[] } {
  const bytes = entry.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numInst = view.getUint32(0x04, true);
  const instOffset = view.getUint32(0x1c, true);
  const warnings: string[] = [];
  for (let i = 0; i < numInst; i += 1) {
    const at = instOffset + i * INST_SIZE + 36;
    const lod = view.getInt32(at, true);
    if (lod < 0) {
      continue;
    }
    if (removed.includes(lod)) {
      warnings.push(`${label}: instance ${i} linked to removed text row ${lod} — unlinked (lod -1)`);
      view.setInt32(at, -1, true);
      continue;
    }
    let shift = 0;
    for (const gone of removed) {
      if (gone < lod) {
        shift += 1;
      }
    }
    if (shift > 0) {
      view.setInt32(at, lod - shift, true);
    }
  }

  return { bytes, warnings };
}

function applyStreamDirective(
  instances: BinaryIplInstance[],
  directive: MergeDirective,
  label: string,
  warnings: string[],
): void {
  if (directive.action === 'replace') {
    for (const pair of directive.pairs ?? []) {
      const at = findInstance(instances, pair.from);
      if (at < 0) {
        warnings.push(`${label}: replace — instance not found, skipped: ${pair.from}`);
        continue;
      }
      instances[at] = parseInstanceRow(pair.to, label);
    }

    return;
  }
  for (const entry of directive.entries) {
    if (directive.action === 'add') {
      instances.push(parseInstanceRow(entry, label));
      continue;
    }
    const at = findInstance(instances, entry);
    if (at < 0) {
      warnings.push(`${label}: remove — instance not found, skipped: ${entry}`);
      continue;
    }
    instances.splice(at, 1);
  }
}

/** First instance matching the row canonically (6 significant digits per numeric field), or -1. */
function findInstance(instances: readonly BinaryIplInstance[], row: string): number {
  const wanted = canonicalInstance(parseInstanceRow(row, 'match'));

  return instances.findIndex((inst) => canonicalInstance(inst) === wanted);
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
