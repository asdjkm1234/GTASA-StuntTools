/**
 * cutscene-fleet-verify — structural verification of a vehicle-cutscene build against the vanilla
 * cutscene.img (plan 002 step 10's gate, kept for step 11 and every future rebuild).
 *
 * Checks the honest invariants, and ONLY those:
 *   - every DFF in the built archive parses; every skeleton is consistent (hierarchy size = boned
 *     frames);
 *   - per converted slot, the frame carrying a vanilla name carries the vanilla bone id, and NO
 *     emitted frame duplicates a vanilla name — anim binding is NOT first-match-only: a duplicate
 *     still binds and double-transforms (DESERT9 door glass, plan 004 round 1; the first draft of
 *     this script called duplicates "bind-safe" and the field falsified it). The emit renames
 *     adopted collisions with `_ad`;
 *   - hierarchy ids unique, node indexes contiguous. Vanilla-id ORDER is deliberately NOT checked
 *     ("ids bind the anims, order is free" — the glendale golden test).
 *
 * Also prints the per-slot DFF/TXD entry-size table (IMG VER2 sector-padded).
 *
 * Run: `npx tsx scripts/debug/cutscene-fleet-verify.ts <built-game-dir> [--game <game>]`
 *      `npx tsx scripts/debug/cutscene-fleet-verify.ts NO_COMMIT/cs-mods-step9`
 */
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCensus } from '../../tools/vehicle-cutscene/src/census';
import { readClump } from '../../tools/vehicle-cutscene/src/rig/clump-io';
import { gameArg, gameDir, positionalArgs } from '../lib/game';

const [builtDir] = positionalArgs();
if (!builtDir) {
  throw new Error('usage: tsx scripts/debug/cutscene-fleet-verify.ts <built-game-dir> [--game <game>]');
}
const game = gameArg();
const vanillaImg = openArchive(new Uint8Array(readFileSync(gameDir(game, 'models', 'cutscene.img'))));
const builtImg = openArchive(new Uint8Array(readFileSync(join(builtDir, 'models', 'cutscene.img'))));
const slots = loadCensus(gameDir(game)).slots.map((slot) => slot.csName);

console.log('slot            vanillaDff    builtDff   builtTxd');
let inTotal = 0;
let outTotal = 0;
let txdTotal = 0;
for (const slot of slots) {
  const vd = vanillaImg.get(`${slot}.dff`)?.byteLength ?? 0;
  const bd = builtImg.get(`${slot}.dff`)?.byteLength ?? 0;
  const bt = builtImg.get(`${slot}.txd`)?.byteLength ?? 0;
  inTotal += vd;
  outTotal += bd;
  txdTotal += bt;
  console.log(`${slot.padEnd(15)} ${String(vd).padStart(10)} ${String(bd).padStart(11)} ${String(bt).padStart(10)}`);
}
console.log(
  `TOTALS          ${String(inTotal).padStart(10)} ${String(outTotal).padStart(11)} ${String(txdTotal).padStart(10)}`,
);

let dffs = 0;
let skeletons = 0;
let failures = 0;
for (const name of builtImg.names) {
  if (!name.toLowerCase().endsWith('.dff')) {
    continue;
  }
  dffs += 1;
  try {
    const model = readClump(new Uint8Array(builtImg.get(name)!));
    const boned = model.frames.filter((frame) => frame.boneId !== undefined).length;
    const hierarchy = model.frames.find((frame) => frame.hierarchy)?.hierarchy;
    if (hierarchy) {
      skeletons += 1;
      if (hierarchy.length !== boned) {
        failures += 1;
        console.log(`SKELETON MISMATCH ${name}: hierarchy ${hierarchy.length} vs boned ${boned}`);
      }
    }
  } catch (error) {
    failures += 1;
    console.log(`PARSE FAIL ${name}: ${(error as Error).message}`);
  }
}
console.log(`archive: ${dffs} DFFs parse-checked, ${skeletons} skeletons, ${failures} failure(s)`);

let diffFailures = 0;
let duplicateNames = 0;
for (const slot of slots) {
  const vanillaBytes = vanillaImg.get(`${slot}.dff`);
  const builtBytes = builtImg.get(`${slot}.dff`);
  if (!vanillaBytes || !builtBytes) {
    diffFailures += 1;
    console.log(`MISSING ENTRY ${slot}`);
    continue;
  }
  const vanilla = readClump(new Uint8Array(vanillaBytes));
  const built = readClump(new Uint8Array(builtBytes));
  const vanillaBones = new Map(vanilla.frames.filter((frame) => frame.name).map((frame) => [frame.name, frame.boneId]));
  const firstByName = new Map<string, number | undefined>();
  for (const frame of built.frames) {
    if (!frame.name || !vanillaBones.has(frame.name)) {
      continue;
    }
    if (!firstByName.has(frame.name)) {
      firstByName.set(frame.name, frame.boneId);
    } else {
      duplicateNames += 1;
      diffFailures += 1;
      console.log(`DUPLICATE CHANNEL NAME ${slot}/${frame.name}: a second frame would bind the anim too`);
    }
  }
  for (const [name, boneId] of firstByName) {
    if (boneId !== vanillaBones.get(name)) {
      diffFailures += 1;
      console.log(`BONE MISMATCH ${slot}/${name}: first frame ${boneId} vs vanilla ${vanillaBones.get(name)}`);
    }
  }
  const hierarchy = built.frames.find((frame) => frame.hierarchy)?.hierarchy;
  if (!hierarchy) {
    diffFailures += 1;
    console.log(`NO HIERARCHY ${slot}`);
    continue;
  }
  if (new Set(hierarchy.map((node) => node.id)).size !== hierarchy.length) {
    diffFailures += 1;
    console.log(`DUPLICATE IDS ${slot}`);
  }
  if (hierarchy.some((node, at) => node.index !== at)) {
    diffFailures += 1;
    console.log(`NON-CONTIGUOUS INDEXES ${slot}`);
  }
}
console.log(
  `structural diff vs vanilla: ${slots.length} slots, ${diffFailures} failure(s), ` +
    `${duplicateNames} duplicate channel name(s) (must be 0 — a duplicate binds and double-transforms)`,
);
process.exitCode = failures + diffFailures > 0 ? 1 : 0;
