import { type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A model an IDE declares and an IPL places, whose `.dff` is in no archive — the game cannot stream it. */
export interface DanglingModel {
  id: number;
  /** The `gta.dat` IDE path that declares it. */
  ide: string;
  modelName: string;
  /** How many inst rows (text IPLs + binary streams) reference the id. */
  placements: number;
}

/** Throw when the built tree places a model it cannot stream — see {@link findDanglingModels}. */
export function checkDanglingModels(gameDir: string): void {
  const dangling = findDanglingModels(gameDir);
  if (dangling.length === 0) {
    return;
  }
  const lines = dangling.map(
    ({ id, ide, modelName, placements }) => `  ${modelName} (id ${id}, ${placements} placement(s)) — ${ide}`,
  );
  throw new Error(
    `${dangling.length} model(s) are declared and placed but have no .dff in any archive:\n${lines.join('\n')}\n` +
      'The streaming request for these can never complete — the field symptom is the whole world rendering as ' +
      'LODs with permanent hitching, not a missing object. Ship the model, or remove its IDE row and inst rows.',
  );
}

/**
 * Every model the built tree DECLARES and PLACES but cannot load: an IDE row + ≥ 1 inst row + no `.dff` entry in
 * any archive (nor loose on disk).
 *
 * Why this is a gate and not a report: the streaming entry does not exist, so the request can never complete, and
 * the field symptom is not the missing object — it is the whole world rendering as LODs with permanent hitching
 * (`docs/open-issues/fixed/sa-world-loads-only-lods.md`, 2026-08-10). One mod's five retired models cost a day of
 * bisection because nothing in the build could see them.
 *
 * A model declared-but-NOT-placed is fine and is not reported — stock ships one (`carupg_int_rays`), which is why
 * the placement count is part of the test rather than a nicety. The check errs DOWNWARD: a section
 * {@link parseIde}/{@link parseTimedObjects} does not read is not checked, so a clean result is "none found in
 * objs/tobj/anim", never "none exist".
 */
export function findDanglingModels(gameDir: string): DanglingModel[] {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return [];
  }
  const dat = parseGtaDat(readFileSync(datPath, 'utf8'));
  const declared = declaredModels(gameDir, dat.ide);
  const { available, placements } = scanArchives(gameDir);
  countTextPlacements(gameDir, dat.ipl, placements);

  const dangling: DanglingModel[] = [];
  for (const [id, { ide, modelName }] of declared) {
    const placed = placements.get(id) ?? 0;
    if (placed > 0 && !available.has(modelName)) {
      dangling.push({ id, ide, modelName, placements: placed });
    }
  }

  return dangling.sort((a, b) => b.placements - a.placements || a.id - b.id);
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);

  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/** Add the inst rows of every text IPL `gta.dat` registers into `placements`. */
function countTextPlacements(gameDir: string, iplPaths: readonly string[], placements: Map<number, number>): void {
  for (const iplPath of iplPaths) {
    const file = datChildUrl(gameDir, iplPath);
    if (!existsSync(file)) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
      placements.set(inst.id, (placements.get(inst.id) ?? 0) + 1);
    }
  }
}

/** id → declaring IDE + lowercased model name, over every IDE `gta.dat` registers. */
function declaredModels(gameDir: string, idePaths: readonly string[]): Map<number, { ide: string; modelName: string }> {
  const declared = new Map<number, { ide: string; modelName: string }>();
  for (const idePath of idePaths) {
    const file = datChildUrl(gameDir, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      declared.set(def.id, { ide: idePath, modelName: def.modelName.toLowerCase() });
    }
  }

  return declared;
}

/** One pass over every archive in the tree: `.dff` names available, plus the inst rows of binary streams. */
function scanArchives(gameDir: string): { available: Set<string>; placements: Map<number, number> } {
  const available = new Set<string>();
  const placements = new Map<number, number>();
  for (const archivePath of walkFiles(gameDir, /\.img$/i)) {
    const bytes = readFileSync(archivePath);
    const archive: ImgArchive = openArchive(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    for (const name of archive.names) {
      const lower = name.toLowerCase();
      if (lower.endsWith('.dff')) {
        available.add(lower.slice(0, -'.dff'.length));
        continue;
      }
      if (!lower.endsWith('.ipl')) {
        continue;
      }
      const entry = archive.get(name);
      for (const inst of entry ? parseBinaryIpl(entry) : []) {
        placements.set(inst.id, (placements.get(inst.id) ?? 0) + 1);
      }
    }
  }
  for (const loose of walkFiles(gameDir, /\.dff$/i)) {
    available.add(baseName(loose).slice(0, -'.dff'.length));
  }

  return { available, placements };
}

function walkFiles(dir: string, match: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(path, match));
    } else if (entry.isFile() && match.test(entry.name)) {
      found.push(path);
    }
  }

  return found;
}
