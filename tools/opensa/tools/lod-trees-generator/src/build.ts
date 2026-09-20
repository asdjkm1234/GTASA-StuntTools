/**
 * Programmatic entry for lod-trees-generator (used by the CLI and `perfect-map-builder`). Bakes tree impostors and
 * attaches them as far-LODs. In non-modloader mode the output is a **complete** game dir (full input mirror — see
 * `docs/plans/009-node-api-and-full-mirror.md`); `--modloader` mode emits only the `lod/` + `hd/` mods.
 */
import type { PrelightInfo } from '@opensa/lod-common/prelight';

import { mkdirSync } from 'node:fs';

import type { TreeLodConfig } from './core/types';

import { createGtaSaTreeLodAdapter } from './adapters/gta-sa';
import { config as defaultConfig } from './config';
import { run } from './core';

export interface BuildTreeLodsOptions {
  /** Overrides on top of the default {@link TreeLodConfig} (textureSize, cards, drawDistance, aspectThreshold). */
  config?: Partial<TreeLodConfig>;
  debugPng?: boolean;
  gamePath: string;
  /** Optional HD tree folder (`<model>.dff` + `.txd`); omit to bake the built-in SA roster from `gta3.img`. */
  inPath?: string;
  /** Emit two Modloader mods instead of a full-mirror drop-in. Default false. */
  modloader?: boolean;
  outPath: string;
  prelight?: boolean;
  prelightInfo?: PrelightInfo;
  strip?: boolean;
}

export function buildTreeLods(options: BuildTreeLodsOptions): void {
  mkdirSync(options.outPath, { recursive: true });
  const config = { ...defaultConfig, ...options.config };
  run(
    createGtaSaTreeLodAdapter({
      config,
      debugPng: options.debugPng ?? false,
      gamePath: options.gamePath,
      inPath: options.inPath,
      modloader: options.modloader ?? false,
      outPath: options.outPath,
      prelight: options.prelight ?? false,
      prelightInfo: options.prelightInfo,
      strip: options.strip ?? false,
    }),
    config,
  );
}
