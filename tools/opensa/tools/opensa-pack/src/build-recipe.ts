/**
 * What a pak was built FROM, recorded into its own `report.json` (`build`).
 *
 * A pak is expensive on a phone — minutes to hours — so it is built once and reused for many runs. That only
 * works if the folder can answer what it is: `manifest.json` says which GAME and WHEN, but nothing said which
 * rect, which flags, or which model subset, and those are exactly the knobs a run is judged on. Two paks one
 * flag apart are the collision A/B, and a district is the pinned area a benchmark row cites — an anonymous
 * folder makes both unfalsifiable.
 *
 * `null` never means "off" here. It means the option named no subset and the convert took EVERYTHING —
 * `vehicles: null` is the full roster, `rect: null` is auto-fit to every cell with content. Off is `false`.
 */
import { execFileSync } from 'node:child_process';

import type { PackOptions, TextureTarget } from './pack';

import { resolveTextureTarget } from './pack';

export interface PakBuildRecipe {
  /** Ambient-occlusion bake — the slowest stage, and the first thing a field run drops. */
  readonly ao: boolean;
  /** Repo version that built it, or null when built from outside the repo. */
  readonly appVersion: null | string;
  /** Build time, same clock and format as `manifest.buildTime`. */
  readonly at: string;
  /** `--bake-collision`: the pak carries each cell's collision instead of the browser parsing COL. The one
   *  flag the A/B in 200/3-01 turns, so a run that does not record it cannot be attributed. */
  readonly bakeCollision: boolean;
  /** Short commit that built it, or null outside a git checkout / with git unavailable. */
  readonly commit: null | string;
  /** Game id the pak was built from (`game-src/<id>`). */
  readonly game: string;
  /** `--lod-only`: the baked 3D city map (201/6-01), whose world is the cell LOD tier and nothing else. A
   *  pak that carries one tier and a pak that carries two are not the same build, and the difference is
   *  invisible in a folder listing — which is what makes it a recipe field rather than a note. */
  readonly lodOnly: boolean;
  /** Only the models the rect PLACES were converted, not every model the IDEs name. Changes what the pak's
   *  archives carry, so two paks differing only in this are not the same build. */
  readonly mapObjectsInRect: boolean;
  /** Largest texture edge, 0 = uncapped. */
  readonly maxTexture: number;
  /** Whether the per-model half (vehicles, peds) was converted at all. */
  readonly models: boolean;
  /** Ped subset, or null for every ped. */
  readonly peds: null | readonly string[];
  /** GPU families the build CLAIMED, or null when it claimed none. */
  readonly platforms: null | readonly string[];
  /** Inclusive GTA cell rect, or null when auto-fit. */
  readonly rect: null | readonly [number, number, number, number];
  /** `--rgba8`: every texture decoded, which is what makes the pak openable without BC. KEPT beside
   *  {@link textures} because it is the only field paks built before 2026-08-08 carry, and reading one of
   *  those back must not silently answer `bc`. */
  readonly rgba8: boolean;
  /** The texture format the build WROTE (`--textures`), resolved the same way the pack resolves it. Two paks
   *  that differ only in this are the format A/B, and until it was recorded they were indistinguishable in
   *  `report.json` — `rgba8` alone reads FALSE for an ASTC build and for a BC one alike. */
  readonly textures: TextureTarget;
  /** Vehicle subset, or null for the whole roster. */
  readonly vehicles: null | readonly string[];
}

export function buildRecipe(
  options: PackOptions,
  meta: {
    readonly appVersion: null | string;
    readonly at: string;
    readonly commit: null | string;
    readonly game: string;
  },
): PakBuildRecipe {
  const subset = (names: readonly string[] | undefined): null | readonly string[] =>
    names === undefined || names.length === 0 ? null : names;

  return {
    ao: options.ao ?? true,
    appVersion: meta.appVersion,
    at: meta.at,
    bakeCollision: options.bakeCollision ?? false,
    commit: meta.commit,
    game: meta.game,
    lodOnly: options.lodOnly ?? false,
    mapObjectsInRect: options.mapObjectsInRect ?? false,
    maxTexture: options.maxTextureSize ?? 0,
    models: options.models ?? true,
    peds: subset(options.peds),
    platforms: subset(options.platforms),
    rect: options.rect ?? null,
    rgba8: options.forceRgba8 ?? false,
    // The same resolver `packGameDir` runs, never a second copy of the rule: a recipe that disagreed with
    // the build it describes is worse than one that is absent.
    textures: resolveTextureTarget(options),
    vehicles: subset(options.vehicles),
  };
}

/** The commit that built the pak — provenance a benchmark row cites. Never fails the pack: a pak built from
 *  a tarball, or with no git on the device, is still a valid pak, it just cannot name a commit. */
export function readGitCommit(cwd: string): null | string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
