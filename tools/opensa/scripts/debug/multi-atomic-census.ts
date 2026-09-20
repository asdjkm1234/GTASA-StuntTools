import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { openLazyVer2 } from '@opensa/tool-kit/archive/layout';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLodLinks } from '../../tools/sa-lod-generator/src/adapters/gta-sa/resolve';
import { perObjectLinks } from '../../tools/sa-lod-generator/src/core/report';

/**
 * Every DFF behind an IDE `objs`/`tobj`/`anim` row that carries MORE THAN ONE atomic (`_dam` twins excluded), with
 * the section it is declared in and each atomic's frame, frame offset and triangle count. SA's atomic model info
 * keeps exactly one atomic of a clump it reads (`docs/gta-sa-original/atomic-model-one-atomic.md`), so a
 * multi-atomic DFF behind an `objs` row — a LOD slot in particular — draws one part of itself at the origin. Stock:
 * 34 models, all `anim` rows, 0 `objs`. This is the census that found the Burger Shot's absent LOD (open issue
 * `sa-lod-visibility-budget.md`, round 15).
 *
 * With `--tree <built game dir>` it also prints, for each such HD, the LOD the built tree links it to and how many
 * atomics THAT file carries — a verbatim multi-atomic clone shows up as `lodAtomics > 1`.
 *
 * Run:
 *   npx tsx scripts/debug/multi-atomic-census.ts --game game-src/original [--tree build/original/sa]
 */
interface IdeRow {
  readonly file: string;
  readonly id: number;
  readonly section: string;
}

const SECTION = /^(?:objs|tobj|anim|end|path|txdp|cars|peds|weap|hier|2dfx)$/i;

function main(): void {
  const game = fromCwd(argValue('--game') ?? 'game-src/original');
  const treeArg = argValue('--tree');
  const rows = readIdeRows(join(game, 'data'));
  const img = openLazyVer2(join(game, 'models', 'gta3.img'));
  if (!img) {
    throw new Error(`${game}/models/gta3.img is not a VER2 archive`);
  }

  const multi: string[] = [];
  for (const name of img.names) {
    if (!name.toLowerCase().endsWith('.dff')) {
      continue;
    }
    const model = name.slice(0, -4).toLowerCase();
    const row = rows.get(model);
    if (!row) {
      continue;
    }
    let clump;
    try {
      clump = parseDff(img.get(name)!);
    } catch {
      continue;
    }
    const live = clump.atomics.filter((atomic) => !/_dam$/i.test(clump.frames[atomic.frameIndex]?.name ?? ''));
    if (live.length <= 1) {
      continue;
    }
    multi.push(model);
    const parts = clump.atomics.map((atomic, index) => {
      const geometry = clump.geometries[atomic.geometryIndex];
      const frame = clump.frames[atomic.frameIndex];
      const at = frame.position.map((v) => v.toFixed(1)).join(',');

      return `#${index}[frame "${frame.name}" @(${at}) tris ${geometry.triangles.length}]`;
    });
    console.log(
      `${model} id ${row.id} ${row.section} (${row.file}) atomics ${clump.atomics.length}: ${parts.join(' ')}`,
    );
  }
  console.log(`multi-atomic models behind IDE rows: ${multi.length}`);

  if (treeArg === undefined) {
    return;
  }
  const tree = fromCwd(treeArg);
  const treeImg = openLazyVer2(join(tree, 'models', 'gta3.img'));
  if (!treeImg) {
    throw new Error(`${tree}/models/gta3.img is not a VER2 archive`);
  }
  const resolved = resolveLodLinks(join(tree, 'data'), treeImg);
  const perObject = new Set(perObjectLinks(resolved.links).map((link) => link.lodModel));
  console.log(`\nLODs of those HDs in ${tree}:`);
  for (const hd of multi) {
    const links = resolved.links.filter((link) => link.hdModel.toLowerCase() === hd);
    if (links.length === 0) {
      console.log(`  ${hd}: no LOD link`);
      continue;
    }
    for (const link of links) {
      const bytes = treeImg.get(`${link.lodModel}.dff`);
      const clump = bytes ? parseDff(bytes) : null;
      const tris = clump?.geometries.reduce((sum, geometry) => sum + geometry.triangles.length, 0);
      console.log(
        `  ${hd} → ${link.lodModel} (txd ${link.lodTxd}, perObject ${perObject.has(link.lodModel)}): ` +
          `lodAtomics ${clump?.atomics.length ?? '?'}, ${bytes?.byteLength ?? '?'} B, ${tris ?? '?'} tris`,
      );
    }
  }
}

function parseIde(path: string, rows: Map<string, IdeRow>): void {
  let section = '';
  for (const raw of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (SECTION.test(line)) {
      section = line.toLowerCase();
      continue;
    }
    if (section !== 'objs' && section !== 'tobj' && section !== 'anim') {
      continue;
    }
    const columns = line.split(',').map((column) => column.trim());
    if (columns.length < 4) {
      continue;
    }
    rows.set(columns[1].toLowerCase(), { file: path.split('/').slice(-1)[0], id: Number(columns[0]), section });
  }
}

function readIdeRows(dataDir: string): Map<string, IdeRow> {
  const rows = new Map<string, IdeRow>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.ide$/i.test(entry.name)) {
        parseIde(path, rows);
      }
    }
  };
  walk(dataDir);

  return rows;
}

main();
