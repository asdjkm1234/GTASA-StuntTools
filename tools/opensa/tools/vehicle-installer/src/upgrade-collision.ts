/**
 * Collision for the tuning parts WE add — `models/coll/opensa-parts.col`, registered in `default.dat`.
 *
 * A part is created through the ordinary `CObject` constructor by anything that spawns it on its own (a
 * trainer, a debug tool), and that constructor dereferences `CBaseModelInfo::m_pColModel` with no null check
 * (`0x59F8B4`, `reading location 0x00000029`). The stock parts get theirs from ONE file,
 * `gta3.img : veh_mods.col` — exactly 194 entries, the whole stock block, ids 1000–1193. A part any tool
 * adds has none and kills the game the moment something spawns it.
 *
 * **The IDE flags have nothing to do with it, and this file used to claim they did.** The reading was that a
 * part with no entry survives when its flags carry `0x200000`, which every derived part inherited from the
 * stock part it was cloned from. The field disproved it on 2026-08-20 in two crash logs: `1194 spl_b_lr_bl`
 * and `19051 exh_lr_rem1_059`, both carrying the flag, both dying at that address with `EDI = 0`. What the 46
 * derived parts had in common was not the flag — it was that nothing had ever spawned one: the mod SHOP
 * mounts a part onto a car rather than creating it, and that path never reads `m_pColModel`.
 * `docs/gta-sa-original/veh-mods-col-and-the-upgrade-object.md`.
 *
 * So every part we add gets a **bounds-only COL3 model** of its own, the shape SA's own LOD vegetation ships
 * and the one `lod-common`'s encoder writes. It goes in a file of ours rather than into `veh_mods.col`,
 * because that entry lives inside `gta3.img` and a 1.6 GB archive rewrite is a poor price for 112 bytes per
 * part — `default.dat` registers a `COLFILE` in one line, which is how `weapons.col` gets loaded.
 */
import type { Bounds } from '@opensa/lod-common/encode-col';

import { encodeColLibrary } from '@opensa/lod-common/encode-col';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { VEH_MODS_IDE } from './tuning-parts';

/** Where our own part collision goes, and the `COLFILE` line that loads it. */
export const PARTS_COL = join('models', 'coll', 'opensa-parts.col');
const PARTS_COL_LINE = 'COLFILE 0 MODELS\\COLL\\OPENSA-PARTS.COL';
const DEFAULT_DAT = join('data', 'default.dat');

/** The archive entry the stock game keeps every upgrade part's collision in. */
export const VEH_MODS_COL = 'veh_mods.col';

/** One part that needs collision: the name the game binds by, and the `.dff` its bounds come from. */
export interface UpgradePart {
  /** Path of the model file this part ships as — the bounds are read from it. */
  readonly dff: string;
  /** The name the part is INSTALLED under (the derived one, when it was renamed). */
  readonly name: string;
}

/**
 * Refuse a built tree whose `veh_mods.ide` names a part nothing gives collision — after
 * {@link writeUpgradeCollision} there should be none, which is what makes this a gate rather than a report.
 */
export function assertUpgradeCollision(gameDir: string): string[] {
  const path = join(gameDir, VEH_MODS_IDE);
  if (!existsSync(path)) {
    return [];
  }
  const stock = upgradeCollisionNames(gameDir);
  if (stock === null) {
    return [`${VEH_MODS_COL} is not in the archive — the parts' collision could not be checked`];
  }
  const ours = new Set(readPartsCol(gameDir).map((model) => model.name));
  const missing: string[] = [];
  let section = '';
  for (const raw of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const cells = line.split(',').map((cell) => cell.trim());
    if (line === '') {
      continue;
    }
    if (!/^\d+$/.test(cells[0])) {
      section = line.toLowerCase();
    } else if (section === 'objs' && !stock.has(cells[1].toLowerCase()) && !ours.has(cells[1].toLowerCase())) {
      missing.push(`${cells[1]} (id ${cells[0]})`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} tuning part(s) have no collision model — neither a ${VEH_MODS_COL} entry nor one in ` +
        `${PARTS_COL}. The mod shop mounts them, but anything that SPAWNS one as an object dies at ` +
        `0x59F8B4 reading a null m_pColModel:\n  ${missing.join('\n  ')}`,
    );
  }

  return [];
}

/**
 * The model names `veh_mods.col` carries collision for, lowercased. Null when no archive of the tree holds
 * it. Read through the archive INDEX, which slices the one entry off a file handle — the archives it looks
 * through are gigabytes and none of that is buffered.
 */
export function upgradeCollisionNames(gameDir: string): null | Set<string> {
  const entry = openArchiveIndex(gameDir).get(VEH_MODS_COL);

  return entry === null ? null : new Set(parseColLibraryNames(entry));
}

/**
 * Give every part in `parts` a bounds-only collision model, MERGED over whatever the file already holds (a
 * rebake re-runs this, and a part installed by an earlier run must keep its entry). Returns the names
 * written. Registers the file in `default.dat` once.
 */
export function writeUpgradeCollision(gameDir: string, parts: readonly UpgradePart[]): string[] {
  const held = new Map<string, Bounds>(readPartsCol(gameDir).map((model) => [model.name, model.bounds]));
  for (const part of parts) {
    held.set(part.name.toLowerCase(), dffBounds(part.dff));
  }
  if (held.size === 0) {
    return [];
  }
  const names = [...held.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  const path = join(gameDir, PARTS_COL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    encodeColLibrary(
      names.map((name) => held.get(name)!),
      names,
    ),
  );
  registerColFile(gameDir);

  return names;
}

/** A model's bounds, from its own geometry. An unreadable or empty model gets a zero box rather than a throw. */
function dffBounds(path: string): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  try {
    const bytes = readFileSync(path);
    for (const geometry of parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      .geometries) {
      for (let index = 0; index < geometry.positions.length; index += 3) {
        seen = true;
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], geometry.positions[index + axis]);
          max[axis] = Math.max(max[axis], geometry.positions[index + axis]);
        }
      }
    }
  } catch {
    seen = false;
  }

  return seen ? { max, min } : { max: [0, 0, 0], min: [0, 0, 0] };
}

/** COL3 model names + bounds, read back out of our own file — the shape {@link encodeColLibrary} writes. */
function parseColLibrary(bytes: Uint8Array): { bounds: Bounds; name: string }[] {
  const models: { bounds: Bounds; name: string }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const BODY = 112;
  for (let at = 0; at + 8 + BODY <= bytes.length; at += 8 + BODY) {
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== 'COL3') {
      break; // not our file's shape — leave what we cannot read alone
    }
    const body = at + 8;
    const name = String.fromCharCode(...bytes.subarray(body, body + 22))
      .replace(/\0.*$/, '')
      .toLowerCase();
    const at3 = (offset: number): [number, number, number] => [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    models.push({ bounds: { max: at3(body + 36), min: at3(body + 24) }, name });
  }

  return models;
}

/** Just the names of a stock `.col` library — enough to answer "does this part have collision?". */
function parseColLibraryNames(entry: ArrayBuffer): string[] {
  const bytes = new Uint8Array(entry);
  const names: string[] = [];
  let at = 0;
  while (at + 32 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (!/^COL[123L]$/.test(fourcc)) {
      break;
    }
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at + 4, true);
    names.push(
      String.fromCharCode(...bytes.subarray(at + 8, at + 30))
        .replace(/\0.*$/, '')
        .toLowerCase(),
    );
    at += 8 + size;
  }

  return names;
}

/** Our `.col` as it stands in the tree — empty when the file is absent or unreadable. */
function readPartsCol(gameDir: string): { bounds: Bounds; name: string }[] {
  const path = join(gameDir, PARTS_COL);

  return existsSync(path) ? parseColLibrary(new Uint8Array(readFileSync(path))) : [];
}

/** One `COLFILE` line in `default.dat`, written once — the same way `weapons.col` is loaded. */
function registerColFile(gameDir: string): void {
  const path = join(gameDir, DEFAULT_DAT);
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, 'latin1');
  if (text.toUpperCase().includes(PARTS_COL_LINE)) {
    return;
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const last = lines.reduce((at, line, index) => (/^\s*COLFILE\b/i.test(line) ? index : at), -1);
  lines.splice(last + 1, 0, PARTS_COL_LINE);
  writeFileSync(path, lines.join(newline), 'latin1');
}
