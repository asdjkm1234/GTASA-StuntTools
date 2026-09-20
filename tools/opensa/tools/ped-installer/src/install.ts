import type { BuildTarget } from '@opensa/tool-kit/target';

import { copyGameDir, guardOut } from '@opensa/tool-kit/game-dir';
import { planLayers, subdirectories } from '@opensa/tool-kit/layers';
import { join, resolve } from 'node:path';

import { applyPed } from './apply-ped';
import { stripOutput } from './strip';

/** The player / main-character ped (`GAME_CONFIG.mainCharacter`) — always kept when stripping. */
export const DEFAULT_PLAYER = 'BMYPOL1';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** The player ped model to always keep when stripping (default {@link DEFAULT_PLAYER}). */
  player?: string;
  /** Reduce the output to ONLY the installed peds (gta3.img + peds.ide), plus the player ped. Default off. */
  strip?: boolean;
  /** Which layer of a LAYERED `--in` (common/sa/opensa) applies after `common` (plan 005). */
  target?: BuildTarget;
}

/**
 * Build the install: wipe `--out`, copy the `--game` base in, then install every ped folder under `--in`
 * (alphabetical — order only matters when two peds touch the same stock model; last wins). Each ped's dff/txd land
 * in `gta3.img`, and a new ped's settings line merges into `peds.ide`.
 *
 * `--strip` (plan 003) wires into the collected keys below in a later phase.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  copyGameDir(gamePath, outPath);

  // A flat `--in` is one layer rooted at itself; a LAYERED one (plan 005 — the same `common`/`sa`/`opensa`
  // as mod-installer, ONE planner) applies `common` then the target's layer, so a later layer's ped of the
  // same model is the last writer. Planned and logged before anything is applied.
  const plan = planLayers(subdirectories(inPath), options.target, 'ped');
  if (plan.strategy === 'layered') {
    const unused = plan.skipped.length > 0 ? `; ${plan.skipped.join(', ')} not for this target` : '';
    console.log(
      `ped-installer: layered peds for target ${options.target} — ${plan.layers.map((l) => l.name).join(' → ')}${unused}`,
    );
  }
  const peds = plan.layers.flatMap((layer) => {
    const root = layer.subdir === undefined ? inPath : join(inPath, layer.subdir);

    return subdirectories(root)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))
      .map((name) => join(root, name));
  });
  const imgNames = new Set<string>();
  const models = new Set<string>();
  for (const ped of peds) {
    const applied = applyPed(ped, outPath);
    applied.imgNames.forEach((name) => imgNames.add(name));
    if (applied.model) {
      models.add(applied.model);
    }
  }

  if (options.strip) {
    const player = (options.player ?? DEFAULT_PLAYER).toLowerCase();
    stripOutput(outPath, { imgNames, models, player });
  }

  console.log(
    `ped-installer: ${peds.length} ped(s) → ${outPath} (${imgNames.size} img entries)` +
      (options.strip ? ' [stripped to installed + player]' : ''),
  );
}
