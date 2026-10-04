import { existsSync, readdirSync } from 'node:fs';

import { BUILD_TARGETS, type BuildTarget } from './target';

/**
 * The two shapes a `--in` source folder may have — mods (mod-installer plan 011), vehicles and peds
 * (vehicle-installer plan 010, ped-installer plan 005) alike; ONE planner, so every installer reads a
 * layered folder the same way.
 *
 * **Flat** — every immediate subfolder is an item (a mod, a car, a ped), and all of them apply.
 *
 * **Layered** — the immediate subfolders are the LAYERS `common/`, `sa/` and `opensa/` (all optional),
 * each holding items; `common` applies first, then the layer of the target being built. The layer order
 * dominates the numeric one: `common/50. X` applies before `sa/0. Y`, because the target layer has to be
 * the last writer for the split to mean anything.
 *
 * The layer names are the build targets plus `common`, taken from `BUILD_TARGETS` rather than restated,
 * so a third target would bring its layer with it.
 */
export const COMMON_LAYER = 'common';

/** Every reserved top-level folder name, in apply order (`common` first). */
export const MOD_LAYERS: readonly string[] = [COMMON_LAYER, ...BUILD_TARGETS];

export interface LayerPlan {
  /** The layers to walk, in apply order. A flat tree yields exactly one, rooted at `--in` itself. */
  readonly layers: readonly PlannedLayer[];
  /** Layer folders that exist and are NOT applied (the other target's) — logged, never dropped silently. */
  readonly skipped: readonly string[];
  readonly strategy: 'flat' | 'layered';
}

export interface PlannedLayer {
  /** The canonical layer name (`common` / a build target), or `flat` for an unlayered tree. */
  readonly name: string;
  /** The folder under `--in` holding this layer's mods; absent means `--in` itself. */
  readonly subdir?: string;
}

/**
 * Does this `--in` carry layer folders? Read by the builder BEFORE any stage runs, to refuse a run that
 * would build both targets out of one shared chain. A missing path is not layered.
 */
export function isLayeredTree(inPath: string): boolean {
  if (!existsSync(inPath)) {
    return false;
  }

  return subdirectories(inPath).some((name) => MOD_LAYERS.includes(name.toLowerCase()));
}

/**
 * Decide which mod folders apply, and in what order, from the immediate subfolders of `--in`.
 *
 * Three things are refused rather than guessed, because each of them would otherwise install a mod set
 * nobody asked for and say nothing about it:
 *
 * - **a MIXED tree** (layer folders beside a plain mod folder) — that mod has no honest position relative
 *   to the layers. This is also what catches a MISSPELLED layer (`commons/`, `open-sa/`): in a layered
 *   tree it is a stray mod, and it fails loudly instead of quietly applying to both targets;
 * - **a layered tree with no target** — there is no layer to pick;
 * - **two folders that fold to the same layer** (`sa/` and `SA/` on a case-sensitive filesystem) — the
 *   names are matched case-folded because they are ONE folder on Windows and macOS, so a case variant
 *   must not become a second layer, and it must not silently lose to the other either.
 */
export function planLayers(
  entries: readonly string[],
  target: BuildTarget | undefined,
  /** What one folder is called in the errors — `mod`, `car`, `ped`. */
  noun = 'mod',
): LayerPlan {
  const layerFolders = new Map<string, string[]>();
  const mods: string[] = [];
  for (const entry of entries) {
    const folded = entry.toLowerCase();
    if (MOD_LAYERS.includes(folded)) {
      layerFolders.set(folded, [...(layerFolders.get(folded) ?? []), entry]);
    } else {
      mods.push(entry);
    }
  }

  if (layerFolders.size === 0) {
    return { layers: [{ name: 'flat' }], skipped: [], strategy: 'flat' };
  }
  const found = MOD_LAYERS.filter((name) => layerFolders.has(name));
  if (mods.length > 0) {
    throw new Error(
      `--in mixes layers (${found.join(', ')}) with plain ${noun} folder(s): ${mods.join(', ')}. ` +
        `A layered ${noun}s folder holds ONLY \`common\`, \`sa\` and \`opensa\`; move those folders into a ` +
        'layer (a misspelled layer name lands here too)',
    );
  }
  const duplicated = found.filter((name) => (layerFolders.get(name) ?? []).length > 1);
  if (duplicated.length > 0) {
    const shown = duplicated.map((name) => (layerFolders.get(name) ?? []).join(' / ')).join('; ');
    throw new Error(`--in carries the same layer twice, differing only in case: ${shown}`);
  }
  if (target === undefined) {
    throw new Error(
      `--in is a layered ${noun}s folder (${found.join(', ')}) and needs a target to pick a layer: ` +
        `pass --target <${BUILD_TARGETS.join(' | ')}>`,
    );
  }

  const applied = [COMMON_LAYER, target].filter((name) => layerFolders.has(name));

  return {
    layers: applied.map((name) => ({ name, subdir: (layerFolders.get(name) ?? [])[0] })),
    skipped: found.filter((name) => !applied.includes(name)),
    strategy: 'layered',
  };
}

/** The immediate subfolder names of a directory. */
export function subdirectories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
