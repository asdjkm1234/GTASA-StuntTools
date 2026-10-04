import { parseBuildTarget } from '@opensa/tool-kit/target';
/**
 * vehicle-cutscene CLI. Converts installed GTA-SA vehicle mods into their cutscene counterparts. Usage:
 *   tsx tools/vehicle-cutscene/src/cli.ts --game <path> --in <vehicles-dir> --out <path> [--only <model,…>] [--inspect]
 *     --game     base game tree (data/vehicles.ide + data/txdcut.ide + models/cutscene.img)
 *     --in       folder of vehicle mods (immediate subfolders: <model>.dff + <model>.txd; a `.settings.txt`
 *                beside them is vehicle-installer's input and is NOT read here) —
 *                the same folder vehicle-installer consumes
 *     --out      output game tree (base copied, models/cutscene.img rebuilt, data/txdcut.ide patched)
 *     --no-base-copy  do NOT copy the --game tree into --out; emit only the three files this tool writes
 *                (models/cutscene.img, data/txdcut.ide, anim/cuts.img). --out is not wiped (plan 006)
 *     --only     restrict to specific donor models (comma-separated) while iterating
 *     --inspect  print the census + per-slot readiness, write nothing (no --out needed)
 *     --self-contained-txd  on a texture-closure miss, copy the txdp parent TXD into the cs TXD
 *                instead of erroring (the documented escape hatch; plan 002 step 6)
 *     --plate <text>        plate-text override for all slots (default: deterministic per slot; plan 003)
 *     --plate-town <ls|sf|lv>  which town background the baked plates wear (default ls)
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { type Census, loadCensus, matchMods, type SlotReadiness } from './census';
import { type CutsceneInstallSummary, installCutscene } from './install';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertDirectory(path: string, flag: string): void {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${flag} must be a directory: ${path}`);
  }
}

function filterOnly(readiness: SlotReadiness[], only: string | undefined): SlotReadiness[] {
  if (!only) {
    return readiness;
  }
  const keep = new Set(only.split(',').map((model) => model.trim().toLowerCase()));

  return readiness.filter((entry) => keep.has(entry.slot.model) || keep.has(entry.slot.csName));
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const inspect = process.argv.includes('--inspect');

  if (!gameArg || !inArg) {
    throw new Error(
      'usage: tsx tools/vehicle-cutscene/src/cli.ts --game <path> --in <vehicles-dir> --out <path> [--only <model,…>] [--inspect]',
    );
  }
  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  assertDirectory(gamePath, '--game');
  assertDirectory(inPath, '--in');

  const census = loadCensus(gamePath);
  const only = argValue('--only');
  const readiness = filterOnly(matchMods(census.slots, inPath, parseBuildTarget(argValue('--target'))), only);

  printCensus(census, readiness);

  if (inspect) {
    return;
  }
  const outArg = argValue('--out');
  if (!outArg) {
    throw new Error('--out is required (or pass --inspect for the report alone)');
  }

  const plate = argValue('--plate');
  const plateTown = argValue('--plate-town');
  const summary = installCutscene({
    gamePath,
    inPath,
    noBaseCopy: process.argv.includes('--no-base-copy'),
    only: only ? new Set(only.split(',').map((model) => model.trim().toLowerCase())) : undefined,
    outPath: fromCwd(outArg),
    ...(plate !== undefined ? { plate } : {}),
    ...(plateTown !== undefined ? { plateTown } : {}),
    selfContainedTxd: process.argv.includes('--self-contained-txd'),
  });
  printSummary(summary);
  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

function printCensus(census: Census, readiness: SlotReadiness[]): void {
  const slotCount = new Set(readiness.map((entry) => entry.slot.model)).size;
  console.log(`vehicle-cutscene census — ${readiness.length} cutscene model(s), ${slotCount} donor slot(s)`);
  for (const { folder, slot, status } of readiness) {
    console.log(
      `  ${slot.csName.padEnd(14)} ${slot.model.padEnd(9)} ${slot.branch.padEnd(5)}` +
        ` ${(slot.hasTxdcutRow ? 'txdcut yes' : 'txdcut MISSING').padEnd(15)}` +
        ` ${status.padEnd(15)}${folder ? ` ${folder}` : ''}`,
    );
  }
  for (const dead of census.deadTxdcutRows) {
    console.log(`  dead txdcut.ide row: ${dead} (no model in cutscene.img)`);
  }
  const notReady = readiness.filter((entry) => entry.status !== 'ready');
  console.log(
    notReady.length === 0
      ? `  all ${readiness.length} model(s) ready`
      : `  NOT ready: ${notReady.map((entry) => `${entry.slot.csName} (${entry.status})`).join(', ')}`,
  );
}

function printSummary(summary: CutsceneInstallSummary): void {
  const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const paintedMaterials = summary.painted.reduce((sum, entry) => sum + entry.materials, 0);
  console.log(
    `vehicle-cutscene: ${summary.converted.length} converted, ${summary.skipped.length} skipped,` +
      ` ${summary.errors.length} error(s), ${paintedMaterials} paint material(s) baked on ${summary.painted.length} model(s),` +
      ` ${summary.plates.length} plate(s) baked, ${summary.txdBytes} B of cs TXDs;` +
      ` cutscene.img ${megabytes(summary.imgBytesBefore)} → ${megabytes(summary.imgBytesAfter)}`,
  );
  for (const { csName, reason } of summary.skipped) {
    console.log(`  skipped ${csName}: ${reason}`);
  }
  // The two `anim/cuts.img` passes: both edit scene VALUES no model data can reach, so what they
  // touched is worth stating rather than leaving to a byte diff.
  for (const row of summary.wheelStashesSunk ?? []) {
    console.log(`  wheel stash sunk: ${row}`);
  }
  for (const row of summary.actorsSeated ?? []) {
    console.log(`  actor seated on the donor's own seat: ${row}`);
  }
  for (const { csName, message } of summary.warnings) {
    console.log(`  warning ${csName}: ${message}`);
  }
  for (const { csName, message } of summary.errors) {
    console.log(`  ERROR ${csName}: ${message}`);
  }
}

main();
