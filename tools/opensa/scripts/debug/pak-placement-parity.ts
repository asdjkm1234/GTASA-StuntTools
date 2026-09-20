import { decodeOscell } from '@opensa/engine-formats/oscell';
import { decodeOswire, OSWIRE_MAGIC, rebuildOscell } from '@opensa/engine-formats/oswire';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * Does the PAK carry every instance the GAME DIR placed, at the same coordinates?
 *
 * The two targets are the same world only if the convert is lossless: `sa/` reads the game dir directly while
 * `opensa/` reads the pak, so a placement dropped or moved by the pack is a divergence no cross-target verdict
 * would notice. Byte-comparing the two game dirs proves the INPUT is shared (pmb's target-split test pins
 * that); this checks the other half.
 *
 * Method: read the instances a layer placed — BOTH the binary IPL streams inside gta3.img and the text IPLs
 * under `data/maps`, whose names match `--streams` (default `plobj`, the procobj layer) — then look for each
 * one in the pak's cell placement tables: same model name, and the instance's position inside that
 * placement's AABB. Both halves matter and they carry different rows: a linked pair puts its HD in the
 * stream and its LOD in a permanent text row, so checking only one half leaves a quarter of the layer
 * unaudited. The pak stores an AABB per placement, not a transform, so containment is the strongest test
 * available; `--slack` widens it for models whose origin sits outside their own geometry.
 *
 * **Read the slack before reading the verdict.** Measured 2026-08-10 on the 91 092-object build: the whole
 * procobj layer (182 184 instances — 156 624 binary + 25 560 text) is covered at **0.05 u**, and 15.6 % of it
 * misses at slack 0. That gap is float32 rounding on the stored bounds, not displacement: an instance sitting
 * exactly on its box edge fails a strict comparison by ulp-scale amounts. So a few centimetres of slack is
 * the honest setting and a metre would hide a real move.
 *
 * **The instrument's own positive control:** point it at a pak built from DIFFERENT content and it must
 * report near-total misses — today's game dir against `NO_COMMIT/old_map/pak` (15 286 objects) reports
 * 98.3 % uncovered. Run that before believing a 100 %.
 *
 * Run: `npx tsx scripts/debug/pak-placement-parity.ts [gameDir] [pakDir] [--streams <prefix>] [--slack <u>]`
 * (defaults `build/original/opensa`, `<gameDir>/pak`, slack 0.5).
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);

  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const gameDir = positional[0] ?? 'build/original/opensa';
const pakDir = positional[1] ?? join(gameDir, 'pak');
const streamPrefix = (flag('streams') ?? 'plobj').toLowerCase();
const slack = Number(flag('slack') ?? 0.5);

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

interface Placed {
  model: string;
  position: readonly [number, number, number];
}

/** id -> model name, from every IDE `gta.dat` registers (binary IPL streams key by id alone). */
function loadCatalog(dir: string): Map<number, string> {
  const dat = parseGtaDat(readFileSync(join(dir, 'data', 'gta.dat'), 'utf8'));
  const catalog = new Map<number, string>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(dir, idePath);
    if (!existsSync(file)) {
      continue;
    }
    for (const def of parseIde(readFileSync(file, 'utf8'))) {
      catalog.set(def.id, def.modelName.toLowerCase());
    }
  }

  return catalog;
}

/** Every instance the layer placed: binary streams inside gta3.img PLUS the permanent text IPL rows. */
function loadLayerInstances(
  dir: string,
  catalog: Map<number, string>,
): { binary: number; skipped: number; text: number; wanted: Placed[] } {
  const buffer = readFileSync(join(dir, 'models', 'gta3.img'));
  const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  const wanted: Placed[] = [];
  let skipped = 0;
  for (const name of archive.names) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(streamPrefix) || !lower.endsWith('.ipl')) {
      continue;
    }
    const bytes = new Uint8Array(archive.get(name) ?? new ArrayBuffer(0));
    for (const inst of parseBinaryIpl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) {
      const model = catalog.get(inst.id);
      if (model === undefined) {
        skipped += 1; // an id no IDE defines — reported, never silently dropped
        continue;
      }
      wanted.push({ model, position: inst.position });
    }
  }
  const binary = wanted.length;
  const maps = join(dir, 'data', 'maps');
  for (const file of existsSync(maps) ? readdirSync(maps) : []) {
    const lower = file.toLowerCase();
    if (!lower.startsWith(streamPrefix) || !lower.endsWith('.ipl')) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(join(maps, file), 'utf8'))) {
      const model = (inst.modelName || catalog.get(inst.id)) ?? '';
      if (model === '') {
        skipped += 1;
        continue;
      }
      wanted.push({ model: model.toLowerCase(), position: inst.position });
    }
  }

  return { binary, skipped, text: wanted.length - binary, wanted };
}

/** Pak placements as GTA-space AABBs, bucketed by MODEL NAME — the only index the lookup needs, since an
 *  instance can only ever match a placement of its own model. */
function loadPakBoxes(dir: string): { boxes: Map<string, Box[]>; cells: number; total: number } {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    cells: Record<string, undefined | { enc?: string; length: number; offset: number }>;
  };
  const pak = readFileSync(join(dir, 'world.ospak'));
  const boxes = new Map<string, Box[]>();
  let cells = 0;
  let total = 0;
  for (const [, entry] of Object.entries(manifest.cells)) {
    if (!entry) {
      continue;
    }
    let bytes: Uint8Array = pak.subarray(entry.offset, entry.offset + entry.length);
    if (entry.enc === 'deflate-raw' || entry.enc === 'oswire-deflate-raw') {
      bytes = inflateRawSync(bytes);
    }
    if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === OSWIRE_MAGIC) {
      const parts = decodeOswire(bytes);
      const skip = (): void => undefined;
      bytes = rebuildOscell(parts, { decodeIndexBuffer: skip, decodeVertexBuffer: skip });
    }
    const cell = decodeOscell(bytes);
    cells += 1;
    // Engine cell-local -> GTA: gtaX = ox + lx, gtaZ = ly (height), gtaY = -(oz + lz).
    const [ox, , oz] = cell.origin;
    for (const p of cell.placements) {
      const b = p.bounds;
      const model = String(cell.names[p.nameRef]).toLowerCase();
      const list = boxes.get(model) ?? [];
      list.push({ x0: ox + b[0], x1: ox + b[3], y0: -(oz + b[5]), y1: -(oz + b[2]), z0: b[1], z1: b[4] });
      boxes.set(model, list);
      total += 1;
    }
  }

  return { boxes, cells, total };
}

const catalog = loadCatalog(gameDir);
const { binary, skipped, text, wanted } = loadLayerInstances(gameDir, catalog);
const { boxes, cells, total } = loadPakBoxes(pakDir);

let found = 0;
const missingByModel = new Map<string, number>();
const noModelInPak = new Map<string, number>();
for (const inst of wanted) {
  const candidates = boxes.get(inst.model);
  if (candidates === undefined) {
    noModelInPak.set(inst.model, (noModelInPak.get(inst.model) ?? 0) + 1);
    continue;
  }
  const [x, y, z] = inst.position;
  const hit = candidates.some(
    (b) =>
      x >= b.x0 - slack &&
      x <= b.x1 + slack &&
      y >= b.y0 - slack &&
      y <= b.y1 + slack &&
      z >= b.z0 - slack &&
      z <= b.z1 + slack,
  );
  if (hit) {
    found += 1;
  } else {
    missingByModel.set(inst.model, (missingByModel.get(inst.model) ?? 0) + 1);
  }
}

const missing = wanted.length - found;
console.log(`game dir ${gameDir} · pak ${pakDir}`);
// An EMPTY layer used to print `0 / 0` and `NOT covered: 0.000 %` — a perfect score for having measured nothing.
// It became reachable by default on 2026-08-10: plan 014 bakes the `plobj` clutter for the `sa` target ALONE, so
// pointing this at an `opensa` tree finds no such layer at all. A zero is only evidence if the counted thing
// could have happened.
if (wanted.length === 0) {
  console.error(
    `\nNOTHING MEASURED — no instances of layer "${streamPrefix}" in ${gameDir}. The percentage above is ` +
      'vacuous. Since plan 014 the `plobj` clutter is baked for the `sa` target only (OpenSA scatters it at ' +
      'runtime), so pass `--streams plotr` for the trees layer, or point --game at a `sa/` tree.',
  );
  process.exitCode = 1;
}
console.log(
  `layer "${streamPrefix}": ${wanted.length} instances — ${binary} in binary streams + ${text} in text IPLs` +
    `${skipped > 0 ? ` (+${skipped} with no IDE definition)` : ''}`,
);
console.log(`pak: ${cells} cells · ${total} placements · ${boxes.size} distinct model names`);
console.log(`covered by a placement of the same model (slack ${slack} u): ${found} / ${wanted.length}`);
console.log(`NOT covered: ${missing} (${((missing / Math.max(1, wanted.length)) * 100).toFixed(3)} %)`);
if (noModelInPak.size > 0) {
  console.log('\nmodels the pak has NO placement of at all:');
  for (const [model, n] of [...noModelInPak].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${model.padEnd(28)} ${n}`);
  }
}
if (missingByModel.size > 0) {
  console.log('\nuncovered instances by model:');
  for (const [model, n] of [...missingByModel].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${model.padEnd(28)} ${n}`);
  }
}
