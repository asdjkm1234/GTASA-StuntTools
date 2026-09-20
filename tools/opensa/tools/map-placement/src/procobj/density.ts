import type { ProcObjCategoryName } from '@opensa/renderware/map/procobj-categories';

/**
 * The build-time density profile (lod-procobj plan 010 decision 1): what the scatter's lottery cutoff is, per
 * CATEGORY and — more specifically — per category on one SURFACE. **1.0 is the authored density**, above it
 * keeps more of the candidates the scatter generated, below it thins.
 *
 * Three things this shape deliberately does NOT do:
 *
 * - **It is not keyed by target** (decision 2, the user's call 2026-08-09): `sa` and `opensa` render the same
 *   world at the same density, or they are not the same game. The target picks caps and reporting, not content.
 * - **It cannot exceed the candidate ceiling.** A cutoff above the headroom has nothing left to keep — the
 *   scatter never generated it — so it is refused at config time rather than silently doing nothing.
 *   {@link ProcObjDensityConfig.maxDensity} raises the headroom, deliberately and at a price.
 * - **It is only LOCAL below the global cap.** Every survivor feeds one lowest-lottery slice to `procObjMax`.
 *   **Plan 010 decision 8 states what happens then wrongly**, and the tests pin the real behaviour: the slice
 *   keeps the globally lowest lotteries, and raising a cutoff only adds placements ABOVE the old one — so from
 *   a UNIFORM base a boost past a binding cap is simply TRUNCATED and takes nothing from anyone. Displacement
 *   needs another category sitting ABOVE the boosted one (rocks at 2.5 while bushes go 1 → 2): only then do
 *   the added placements undercut somebody else's. Either way the per-category breakdown is what shows it.
 */
export interface ProcObjDensityConfig {
  /** The cutoff for any category with no entry of its own. Default 1 — the authored density. */
  base?: number;
  /** Per category. Wins over {@link base}. */
  byCategory?: Partial<Record<ProcObjCategoryName, number>>;
  /** Per category ON one surface (surfinfo names, e.g. `p_mountain`). The most specific key wins. */
  bySurface?: Partial<Record<ProcObjCategoryName, Record<string, number>>>;
  /**
   * The candidate headroom the scatter generates against, and so the highest cutoff this profile may use.
   * Default `PROC_OBJ_MAX_DENSITY` (3). **Raise it EXPLICITLY, never as a side effect of a cutoff** — it is
   * not free and it is not local:
   *
   * - candidates (and scatter time) scale with it, map-wide, for every species;
   * - each face consumes draws in proportion to its candidate count, so raising it shifts where every LATER
   *   face starts in the seeded sequence. **The scatter moves from the second face on**, including for
   *   categories left at 1.0 — two builds with different headroom compare only statistically.
   *
   * What it does NOT change is what a cutoff MEANS: `d` is `d ×` the authored density at any headroom.
   */
  maxDensity?: number;
}

/** A plain number is the whole-profile shorthand — what `--procobj-density` has always meant. */
export type ProcObjDensityInput = number | ProcObjDensityConfig;

/** The headroom this profile scatters against — its own {@link ProcObjDensityConfig.maxDensity}, or the default. */
export function densityCeiling(config: ProcObjDensityConfig, fallback: number): number {
  return config.maxDensity ?? fallback;
}

/**
 * Every cutoff in the profile, with the key it came from — the validation list, and what a build prints so a
 * capture states its own configuration rather than being identified by memory.
 */
export function densityEntries(config: ProcObjDensityConfig): { key: string; value: number }[] {
  const entries = [{ key: 'base', value: config.base ?? 1 }];
  for (const [category, value] of Object.entries(config.byCategory ?? {})) {
    entries.push({ key: category, value });
  }
  for (const [category, bySurface] of Object.entries(config.bySurface ?? {})) {
    for (const [surface, value] of Object.entries(bySurface)) {
      entries.push({ key: `${category}/${surface}`, value });
    }
  }

  return entries;
}

/** The cutoff for one batch: category×surface beats category beats base beats vanilla. */
export function densityFor(config: ProcObjDensityConfig, category: ProcObjCategoryName, surface: string): number {
  return config.bySurface?.[category]?.[surface] ?? config.byCategory?.[category] ?? config.base ?? 1;
}

/**
 * How a build NAMES the density it ran at (the self-describing-capture rule). A plain number prints as the
 * number it has always printed; a profile prints every key, because "density 1" would be a lie about a build
 * that doubled the rocks.
 */
export function densityLabel(input: ProcObjDensityInput = 1): string {
  if (typeof input === 'number') {
    return String(input);
  }
  const entries = densityEntries(input).map(({ key, value }) => `${key}=${value}`);
  // Headroom belongs in the label even though it is not a cutoff: it re-rolls the whole scatter, so two
  // captures with the same cutoffs and different headroom are different runs.
  if (input.maxDensity !== undefined) {
    entries.push(`maxDensity=${input.maxDensity}`);
  }

  return entries.join(' ');
}

/** Normalise the shorthand, so callers downstream only ever see the full shape. */
export function densityProfile(input: ProcObjDensityInput = 1): ProcObjDensityConfig {
  return typeof input === 'number' ? { base: input } : input;
}

/**
 * Refuse a profile the scatter cannot serve, naming the offending KEY — a profile is written by hand, and
 * "density 4 on rocks" fails by quietly keeping every candidate rather than by looking wrong.
 *
 * NaN is the dangerous one and it passes both comparisons (`NaN <= 0` and `NaN > 3` are each false), after
 * which every `lottery < NaN` is false too — a silently EMPTY clutter layer from one mistyped entry.
 */
export function validateDensityProfile(config: ProcObjDensityConfig, defaultMaxDensity: number): void {
  const ceiling = densityCeiling(config, defaultMaxDensity);
  // Below 1 the scatter cannot even reach the authored density, so `base: 1` would silently thin the map.
  if (!Number.isFinite(ceiling) || ceiling < 1) {
    throw new Error(`procobj maxDensity must be a finite number >= 1 (the authored density): got ${ceiling}.`);
  }
  for (const { key, value } of densityEntries(config)) {
    if (!Number.isFinite(value) || value <= 0 || value > ceiling) {
      throw new Error(
        `procobj density '${key}' must be in (0, ${ceiling}]: got ${value}. The scatter only GENERATES ` +
          `${ceiling}× the vanilla candidate count, so a higher cutoff has nothing left to keep — raise the ` +
          "profile's `maxDensity` first, which re-rolls the WHOLE scatter (every species, not just this one).",
      );
    }
  }
}
