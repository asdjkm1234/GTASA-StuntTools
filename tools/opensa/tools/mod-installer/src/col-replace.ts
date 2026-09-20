import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';

/**
 * What a `.col` replacement DELETES.
 *
 * A `.col` is not a file, it is a LIBRARY of named collision models, and the IMG contract replaces an entry
 * whole (`docs/contracts/mods.md`). So a mod shipping `laxref.col` to change one bench silently removes the
 * collision of every other model that archive held — the game then places those objects with nothing to
 * stand on, which is invisible until something reports it. Field-found 2026-08-10: mod 60 dropped
 * `ferseat01_LAx` + `lodseat01_LAx`, and the only reason anyone noticed was FLA's optional error box in the
 * real game ("model ID 3752 does not have loaded collision"), months after the install.
 *
 * This does not change the contract — the replacement still wins. It makes the loss speakable.
 */
export function droppedCollisionModels(previous: Uint8Array, next: Uint8Array): string[] {
  const kept = new Set(names(next));

  return names(previous).filter((name) => !kept.has(name));
}

/**
 * Warn when replacing `entryName` loses collision models. Silent for a non-`.col` entry, for a new entry
 * (nothing to lose) and for a replacement that keeps everything.
 *
 * COL1 blocks are invisible to {@link parseColLibrary} and would read as dropped; SA ships none, so the
 * check is left simple rather than guarded against a case this pipeline cannot meet.
 */
export function warnDroppedCollisions(entryName: string, previous: Uint8Array | undefined, next: Uint8Array): void {
  if (previous === undefined || !entryName.toLowerCase().endsWith('.col')) {
    return;
  }
  const dropped = droppedCollisionModels(previous, next);
  if (dropped.length === 0) {
    return;
  }
  const shown = dropped.slice(0, 8).join(', ');
  console.warn(
    `mod-installer: ${entryName} replaced — ${dropped.length} collision model(s) LOST: ` +
      `${shown}${dropped.length > 8 ? `, +${dropped.length - 8} more` : ''}. ` +
      'Objects using them will be placed with no collision (the mod ships a partial library).',
  );
}

function names(bytes: Uint8Array): string[] {
  // `.slice` on a Uint8Array's buffer is typed `ArrayBuffer | SharedArrayBuffer`; a file read is never shared.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return parseColLibrary(buffer).map((model) => model.name.toLowerCase());
}
