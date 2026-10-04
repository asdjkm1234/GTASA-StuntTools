/**
 * Delete-and-insert inside `<out>/models/*.img` (plan opensa-pack/003 phase 3).
 *
 * The rule from the plan: **full replacement, own extension, same basename** — `landstal.dff` becomes
 * `landstal.osm` and the original is DELETED, so no entry lies about what it holds. An insert names the
 * entry it lands `near`, which keeps `models/*.img` meaning what it meant before (gta3 vs gta_int) instead
 * of collapsing every converted asset into the first archive.
 *
 * Rebuilds stream through `writeImgFamily` — `build()` on a ~1 GB archive would double the run's peak RSS
 * (the same reason map-optimizer streams, `adapters/gta-sa/build.ts`); the family is opened into memory
 * (each member under the cap), which is what makes writing back over the same paths safe.
 */
import { imgFamilyMembers, openImgFamily, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { registerImgArchives, unregisterImgArchives } from '@opensa/tool-kit/game-dir';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface ArchiveEdit {
  /** Entries to remove from whichever archive holds them. */
  readonly deletes: readonly string[];
  /** Entries to add, each into the archive that holds `near` — normally the original it replaces. */
  readonly inserts: readonly ArchiveInsert[];
}

export interface ArchiveInsert {
  readonly bytes: Uint8Array;
  readonly name: string;
  /** An existing entry whose archive receives this one. */
  readonly near: string;
}

export interface ArchiveRewriteReport {
  /** Per rebuilt archive: entries inserted, entries deleted, and the size it ended at. */
  readonly archives: readonly ArchiveRewriteStat[];
  /** Deletes no archive held — already absent, or a loose file. Harmless, reported for honesty. */
  readonly missingDeletes: readonly string[];
  /** Inserts whose `near` no archive held, so they were NOT written. A silent drop otherwise. */
  readonly unplaced: readonly string[];
}

export interface ArchiveRewriteStat {
  readonly bytes: number;
  readonly deleted: number;
  readonly file: string;
  readonly inserted: number;
}

/**
 * Apply `edit` to every archive FAMILY under `<outDir>/models/` (`gta3.img`; `vehicles.img` + the
 * `vehicles2.img` the install spilled into, opened and rewritten as ONE — 2026-08-17: the `.osm` a car becomes
 * carries its private dictionary and is fatter than the `.dff`+`.txd` it replaces, and a per-file rewrite of
 * `vehicles.img` crossed the 1.75 GiB cap at the 152nd of 406 entries; the family re-plans under the cap and a
 * new sibling is registered in `gta.dat`, a vanished one unregistered). Families with nothing to change are
 * left untouched on disk — no pointless 1 GB rewrite.
 */
export function rewriteModelArchives(outDir: string, edit: ArchiveEdit): ArchiveRewriteReport {
  const modelsDir = join(outDir, 'models');
  const bases = familyBases(modelsDir);

  const inserts = new Map(edit.inserts.map((insert) => [insert.name.toLowerCase(), insert]));
  const deletes = new Set(edit.deletes.map((name) => name.toLowerCase()));
  const archives: ArchiveRewriteStat[] = [];

  for (const base of bases) {
    if (inserts.size === 0 && deletes.size === 0) {
      break;
    }
    const basePath = join(modelsDir, base);
    const before = imgFamilyMembers(basePath).map((path) => basename(path));
    const img = openImgFamily(basePath);

    // Inserts first: `near` is resolved while the original it replaces is still present.
    let inserted = 0;
    for (const [key, insert] of inserts) {
      if (!img.has(insert.near)) {
        continue;
      }
      img.set(insert.name, insert.bytes);
      inserts.delete(key);
      inserted += 1;
    }
    let deleted = 0;
    for (const name of deletes) {
      if (img.delete(name)) {
        deletes.delete(name);
        deleted += 1;
      }
    }
    if (inserted === 0 && deleted === 0) {
      continue;
    }
    const written = writeImgFamily(img, basePath);
    const after = written.map((member) => basename(member.path));
    // Whoever writes an archive registers it (`registerImgArchives`' rule) — and un-registers one it no
    // longer writes, or the game opens a file that is not there.
    registerImgArchives(
      outDir,
      after.slice(1).filter((name) => !before.includes(name)),
    );
    unregisterImgArchives(
      outDir,
      before.filter((name) => !after.includes(name)),
    );
    written.forEach((member, index) => {
      archives.push({
        bytes: member.bytes,
        deleted: index === 0 ? deleted : 0,
        file: basename(member.path),
        inserted: index === 0 ? inserted : 0,
      });
    });
  }

  return { archives, missingDeletes: [...deletes], unplaced: [...inserts.keys()] };
}

/**
 * The family BASES under `models/`: every `.img` that is not the numbered sibling (`<stem>2.img`, …) of
 * another archive present beside it. `gta3.img` is a base (its siblings would be `gta32.img`); `vehicles2.img`
 * is a member of `vehicles.img`'s family, not a base of its own.
 */
function familyBases(modelsDir: string): string[] {
  const files = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort();
  const lower = new Set(files.map((file) => file.toLowerCase()));

  return files.filter((file) => {
    const stem = file.slice(0, -'.img'.length);
    let cut = stem.length;
    while (cut > 0 && stem.charCodeAt(cut - 1) >= 48 && stem.charCodeAt(cut - 1) <= 57) {
      cut -= 1;
    }
    const index = Number(stem.slice(cut));
    if (cut === stem.length || cut === 0 || index < 2) {
      return true;
    }

    return !lower.has(`${stem.slice(0, cut).toLowerCase()}.img`);
  });
}
