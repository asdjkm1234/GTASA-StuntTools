/**
 * sa-lod-generator CLI. Takes `--game <path>` (a game-data dir: `data/` + `models/`), resolves the map's HD↔LOD
 * links and prints a sizing report — stock LODs vs full HD clones (plan 002, Phase 1). With `--out <path>` it bakes
 * the drop-in build: every per-object LOD becomes a verbatim HD clone with a `--tex-scale` (default 0.5) TXD. Usage:
 * `tsx sa-lod-generator/src/cli.ts --game <path> [--out <path>] [--tex-scale 0.5] [--strip-particles]`.
 * By default the clones KEEP their type-1 particle emitters (smoke/fire) so distant factory smoke shows at LOD
 * range — this REQUIRES perfect-map.asi (its 2dfx fix, plan 009); without it the game crashes at `0x004AA3A1`.
 * `--strip-particles` restores the old strip behaviour for a STOCK target with no asi. Paths are relative to the
 * current working directory (absolute paths pass through).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import { createSaLodAdapter } from './adapters/gta-sa';
import { printReport } from './core';
import { config } from './lod.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error('usage: tsx sa-lod-generator/src/cli.ts --game <path> [--out <path>] [--tex-scale 0.5]');
  }
  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }

  const label = basename(gameDir);
  const texScale = Number(argValue('--tex-scale') ?? config.texScale);
  // Particles ride the LOD clones by default (plan 010) — needs perfect-map.asi's 2dfx fix (plan 009). Pass
  // --strip-particles for a stock target with no asi (the pre-009 behaviour: type-1 emitters removed, coronas kept).
  const keepParticles = !process.argv.includes('--strip-particles');
  // Per-game hole-fill list (plan 086 phase 5) — pmb reads mods-src/<id>/lod-holes.json; standalone: --holes.
  const holesArg = argValue('--holes');
  const holeFillModels = holesArg
    ? (JSON.parse(readFileSync(fromCwd(holesArg), 'utf8')) as string[]).map((name) => name.toLowerCase())
    : config.holeFillModels;
  const adapter = createSaLodAdapter(label, gameDir, { ...config, holeFillModels, keepParticles, texScale });
  const resolved = adapter.resolvePairs();
  printReport(label, adapter.report(resolved));
  console.log(
    `  excluded ${resolved.excludedDualRole} dual-role + ${resolved.excludedVegetation} vegetation + ` +
      `${resolved.excludedGenerated} sibling-generated + ${resolved.excludedTiny} sub-pixel + ` +
      `${resolved.excludedTimed} timed-mismatch LODs (kept stock)`,
  );

  const outArg = argValue('--out');
  if (outArg !== undefined) {
    const outDir = fromCwd(outArg);
    const stats = adapter.finalize(outDir, resolved);
    console.log(
      `  baked ${stats.clonedLods} LOD clones (${stats.decimatedLods} decimated, ${stats.mergedLods} merged multi-atomic, rest verbatim) + ` +
        `${stats.generatedTxds} TXDs @ ${texScale}× (shared ${stats.skippedShared}, missing HD ${stats.missingHd}, missing TXD ${stats.missingTxd})`,
    );
    console.log(
      `  txdp parent: ${stats.parentTextures} shared textures → ${stats.parentTextures > 0 ? 'salodpar.txd + salod-txdp.ide' : 'not emitted'}`,
    );
    console.log(`  retargeted ${stats.retransformedLods} LOD instances to their HD transform`);
    console.log(
      `  filled ${stats.filledHoles} missing-LOD holes (${stats.filledInstances} instances, ${stats.skippedHoles} skipped)`,
    );
    console.log(`→ ${outDir}`);
  }
}

main();
