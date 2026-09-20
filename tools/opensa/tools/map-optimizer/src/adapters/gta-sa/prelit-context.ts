import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import type { Placement } from './resolve';

/** Day-level correction: additive luma shift; when darkening, it fades to 0 across [protectFrom, protectTo]. */
export interface LevelVerdict {
  protectFrom: number;
  protectTo: number;
  shift: number;
}

/** Night correction: scale an existing set (with the same darkening tail guard), cap its bright tail, or
 *  synthesize a missing one. */
export type NightVerdict =
  | { kind: 'cap'; max: number }
  | { kind: 'repair'; protectFrom: number; protectTo: number; scale: number }
  | { kind: 'synthesize'; ratio: number };

/**
 * One only-mode entry: a bare name = forced auto-verdict (hood statistics, skip-guards bypassed); an object =
 * **explicit manual correction** applied verbatim and UNGUARDED. `nightMax` caps every night vertex's luma at
 * the ceiling (hue kept) — dims ONLY the glow, leaves dark walls alone (the newvic1 lesson: a uniform scale
 * blackens the walls before the windows come down). `nightScale` multiplies the whole night set (a night-less
 * model gets a synthesized set at `day × nightScale`); `dayShift` adds to day RGB. `nightMax` wins over
 * `nightScale` when both are given. The human dials the numbers in-game.
 */
export type OnlyEntry = string | { dayShift?: number; model: string; nightMax?: number; nightScale?: number };

export interface PrelitContextOptions {
  /** Relative deviation of the model's day median from the hood median that triggers a day fix. Default 0.4. */
  dayTolerance?: number;
  /** Model names to never correct (curated via the review report); they still count as hood context. */
  exclude?: readonly string[];
  /** Day spread at or below this = "flat" (broken export — no AO). Default 8. */
  flatSpread?: number;
  /** **Force list** (runs ON TOP of the normal statistical pass, unlike {@link only}): the listed models are
   *  treated as human-confirmed broken — bare names bypass the statistical skip-guards, object entries apply
   *  their explicit corrections verbatim — while every other model still gets the regular verdicts. This is
   *  what perfect-map-builder's `broken-prelight.json` feeds. Ignored when `only` is set. */
  force?: readonly OnlyEntry[];
  /** Cap on the night/day ratio a synthesized night set may target — a brightly-lit hood (streetlights on the
   *  ground sheets) must not make a night-less building glow. Default 0.35 (vanilla night sets sit ~0.2–0.35). */
  maxSynthRatio?: number;
  /** Fewest neighbouring prelit models required to trust the hood stats. Default 5. */
  minHoodModels?: number;
  /** Skip night synthesis for models whose (corrected) day median is at or below this. Default 32. */
  minSynthLuma?: number;
  /** **Only-mode** (user decision after in-game review): when set, verdicts are computed ONLY for these
   *  models — the rest of the map passes through byte-identical (but still feeds the hood stats). Bare names
   *  are treated as human-confirmed broken: the statistical skip-guards (day tolerance/lift-only, night
   *  day-evidence, ratio tolerance, fullbright-flat) are bypassed while the within-model protections (tail
   *  guard, darken-only night, synth cap) still apply. Object entries carry {@link OnlyEntry explicit manual
   *  corrections} applied verbatim and unguarded. */
  only?: readonly OnlyEntry[];
  /** Neighbourhood radius (world units) around each placement. Default 100. */
  radius?: number;
  /** How far ABOVE the hood night/day ratio a model's ratio must sit to trigger a night repair. Repairs only
   *  ever DARKEN (in-game finding: dark-at-night is design — houses with the lights off; a "too dark" repair
   *  lit whole Idlewood blocks, incl. a ×42 explosion on a black night set). Default 0.25. */
  ratioTolerance?: number;
}

export interface PrelitContextResult {
  stats: {
    excluded: number;
    flat: number;
    liftDay: number;
    lowerDay: number;
    noContext: number;
    ok: number;
    repairNight: number;
    synthesizeNight: number;
  };
  verdicts: Map<string, PrelitVerdict>;
  /** Curation problems worth surfacing (e.g. an only/exclude name that matches no placed prelit model — a
   *  likely typo that would otherwise fail silently). */
  warnings: string[];
}

/**
 * World-context prelight (plan 019, replaces the blind plans 012/013): fingerprint every placed model's
 * prelit/night, compare each model against the **neighbourhood** of its placements, and emit correction
 * verdicts — day level (lift/lower/flat), night repair (existing set off the local night/day ratio) and night
 * synthesis (missing set, targeting the local ratio instead of a global scale). Pure — the adapter feeds
 * fingerprints from its parse sweep; `plugins/apply-prelit-level.ts` and `plugins/conform-night.ts` apply the
 * verdicts.
 *
 * Aggressiveness is **hard** (user decision): an outlier's median is pulled fully to the neighbourhood median.
 * Legit night lighting survives via the **tail guard**: corrections that darken fade to zero across the
 * model's own bright percentiles (lit windows / signs / floodlights live in the p75+ tail — measured:
 * `laepetrol1a` night p90 69 vs median 21), so medians move and highlights stay.
 */
export interface PrelitFingerprint {
  /** Any prelit alpha < 255 (wind sway / floodlight cones — see build-clump) — night synthesis skips these. */
  alphaOverloaded: boolean;
  dayMean: number;
  dayP50: number;
  dayP75: number;
  dayP90: number;
  dayP95: number;
  /** max − min day luma; ~0 = flat broken export (no baked AO at all). */
  daySpread: number;
  hasNight: boolean;
  nightP50: number;
  nightP75: number;
  nightP95: number;
  vertexCount: number;
}

export interface PrelitVerdict {
  /** Marked for the vertex-AO rebake (plan 019 Phase 4): flat prelit = no baked shading at all. */
  flat: boolean;
  level?: LevelVerdict;
  night?: NightVerdict;
}

/**
 * Validate a user-supplied only-list (the `--prelit-only` JSON) into {@link OnlyEntry}s. Throws with a precise
 * message on shape errors — an unknown key (e.g. the `"nigthMax"` typo) or a missing `model` would otherwise
 * be silently ignored and cost an in-game round to notice.
 */
export function parseOnlyList(json: unknown): OnlyEntry[] {
  if (!Array.isArray(json)) {
    throw new Error('prelit-only list must be a JSON array');
  }

  return json.map((entry, index) => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`prelit-only entry #${index} must be a model name or an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.model !== 'string' || record.model.length === 0) {
      throw new Error(`prelit-only entry #${index} needs a non-empty string "model"`);
    }
    for (const key of Object.keys(record)) {
      if (key !== 'model' && key !== 'nightMax' && key !== 'nightScale' && key !== 'dayShift') {
        throw new Error(
          `prelit-only entry "${record.model}": unknown key "${key}" (model|nightMax|nightScale|dayShift)`,
        );
      }
      if (key !== 'model' && typeof record[key] !== 'number') {
        throw new Error(`prelit-only entry "${record.model}": "${key}" must be a number`);
      }
    }

    return record as Exclude<OnlyEntry, string>;
  });
}

/** `only`/`force` have no defaults — their absence IS the mode switch (normal statistical run). */
const DEFAULTS: Required<Omit<PrelitContextOptions, 'force' | 'only'>> = {
  dayTolerance: 0.4,
  exclude: [],
  flatSpread: 8,
  maxSynthRatio: 0.35,
  minHoodModels: 5,
  minSynthLuma: 32,
  radius: 100,
  ratioTolerance: 0.25,
};

type NeighbourQuery = (placement: Placement) => Placement[];

/**
 * Compute the correction verdicts. For every model: the hood day median / night ratio is the **median over all
 * its placements' neighbourhoods** (prelit is baked per model — a model in a dark alley and on a bright street
 * gets one verdict). Models with too few prelit neighbours are left alone (`noContext`).
 */
export function computePrelitContext(
  fingerprints: ReadonlyMap<string, PrelitFingerprint>,
  placements: readonly Placement[],
  options: PrelitContextOptions = {},
): PrelitContextResult {
  const opts = { ...DEFAULTS, ...options };
  const stats = {
    excluded: 0,
    flat: 0,
    liftDay: 0,
    lowerDay: 0,
    noContext: 0,
    ok: 0,
    repairNight: 0,
    synthesizeNight: 0,
  };
  const verdicts = new Map<string, PrelitVerdict>();

  // `?? []` guards callers spreading an explicitly-undefined option over the default.
  const excluded = new Set((opts.exclude ?? []).map((name) => name.toLowerCase()));
  const entryMap = (entries: readonly OnlyEntry[]): Map<string, Exclude<OnlyEntry, string> | null> =>
    new Map(
      entries.map((entry) =>
        typeof entry === 'string' ? [entry.toLowerCase(), null] : [entry.model.toLowerCase(), entry],
      ),
    );
  const only = opts.only ? entryMap(opts.only) : null;
  const force = !only && opts.force ? entryMap(opts.force) : null;
  const warnings = curationWarnings(fingerprints, [...(only?.keys() ?? []), ...(force?.keys() ?? []), ...excluded]);
  const neighboursOf = buildNeighbourQuery(fingerprints, placements, opts.radius);
  const byModel = groupByModel(fingerprints, placements);

  for (const [model, fingerprint] of fingerprints) {
    if (excluded.has(model) || (only && !only.has(model))) {
      stats.excluded += 1; // never corrected — but its placements above still feed the hood stats
      continue;
    }
    // Explicit manual correction (only-mode entry or a force-list entry): applied verbatim, unguarded, no
    // hood needed (protect bounds 256 disarm the tail guard in the appliers — "windows too bright at night"
    // IS the tail).
    const manual = only?.get(model) ?? force?.get(model);
    if (manual) {
      const verdict = manualVerdict(manual, fingerprint, stats);
      if (verdict) {
        verdicts.set(model, verdict);
      }
      continue;
    }
    const hood = computeHood(byModel.get(model) ?? [], neighboursOf, fingerprints, opts.minHoodModels);
    if (!hood) {
      stats.noContext += 1;
      continue;
    }

    // Only-mode (every surviving model) or a bare-name force entry: the human confirmed this model broken —
    // bypass the statistical skip-guards (the within-model protections in the appliers still hold).
    const forced = only !== null || force?.has(model) === true;
    // Saturated-white flats (gang tags, emissive decals) are fullbright by design — not broken exports.
    const verdict: PrelitVerdict = {
      flat: fingerprint.daySpread <= opts.flatSpread && (forced || fingerprint.dayP50 < 250),
    };
    verdict.level = judgeDay(fingerprint, hood.day, verdict.flat, forced, opts, stats);
    // Night repair needs corroborating DAY evidence (a level fix or the flat flag): a healthy-day model that
    // glows at night is lighting design — street lamps, lanterns, signs (in-game finding: the ratio test alone
    // dimmed San Fierro's lamps). Synthesis (night-less models) is unaffected.
    const dayEvidence = forced || verdict.flat || verdict.level !== undefined;
    verdict.night = judgeNight(fingerprint, verdict.level?.shift ?? 0, hood.ratio, dayEvidence, forced, opts, stats);

    if (verdict.level || verdict.night) {
      verdicts.set(model, verdict);
    } else {
      stats.ok += 1;
    }
  }

  return { stats, verdicts, warnings };
}

/** Fingerprint a parsed clump's prelit, or null when it carries none (nothing to condition). */
export function fingerprintClump(clump: RWClump): null | PrelitFingerprint {
  const day: Uint8Array[] = [];
  const night: Uint8Array[] = [];
  let alphaOverloaded = false;
  for (const geometry of clump.geometries) {
    if (geometry.prelitColors) {
      day.push(geometry.prelitColors);
      for (let i = 3; i < geometry.prelitColors.length; i += 4) {
        if (geometry.prelitColors[i] < 255) {
          alphaOverloaded = true;
          break;
        }
      }
      if (geometry.nightColors) {
        night.push(geometry.nightColors);
      }
    }
  }
  if (day.length === 0) {
    return null;
  }
  const dayAll = concat(day);
  const dayStats = lumaPercentiles(dayAll);
  const nightStats = night.length > 0 ? lumaPercentiles(concat(night)) : null;

  return {
    alphaOverloaded,
    dayMean: dayStats.mean,
    dayP50: dayStats.p50,
    dayP75: dayStats.p75,
    dayP90: dayStats.p90,
    dayP95: dayStats.p95,
    daySpread: dayStats.spread,
    hasNight: nightStats !== null,
    nightP50: nightStats?.p50 ?? 0,
    nightP75: nightStats?.p75 ?? 0,
    nightP95: nightStats?.p95 ?? 0,
    vertexCount: dayAll.length / 4,
  };
}

/** Spatial hash over the prelit placements (cell = radius) exposed as a radius query. */
function buildNeighbourQuery(
  fingerprints: ReadonlyMap<string, PrelitFingerprint>,
  placements: readonly Placement[],
  radius: number,
): NeighbourQuery {
  const buckets = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (!fingerprints.has(placement.modelName)) {
      continue; // no prelit — can't contribute to a hood
    }
    const key = `${Math.floor(placement.position[0] / radius)},${Math.floor(placement.position[1] / radius)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(placement);
  }

  return (placement) => {
    const cx = Math.floor(placement.position[0] / radius);
    const cy = Math.floor(placement.position[1] / radius);
    const out: Placement[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (
            other.modelName !== placement.modelName &&
            Math.hypot(other.position[0] - placement.position[0], other.position[1] - placement.position[1]) <= radius
          ) {
            out.push(other);
          }
        }
      }
    }

    return out;
  };
}

/** Hood day median + night/day ratio for a model, or null when no placement has enough prelit neighbours. */
function computeHood(
  own: readonly Placement[],
  neighboursOf: NeighbourQuery,
  fingerprints: ReadonlyMap<string, PrelitFingerprint>,
  minHoodModels: number,
): null | { day: number; ratio: null | number } {
  const dayMedians: number[] = [];
  const ratioMedians: number[] = [];
  for (const placement of own) {
    const days: number[] = [];
    const ratios: number[] = [];
    for (const neighbour of neighboursOf(placement)) {
      const nf = fingerprints.get(neighbour.modelName)!;
      days.push(nf.dayP50);
      if (nf.hasNight) {
        ratios.push(nf.nightP50 / Math.max(1, nf.dayP50));
      }
    }
    if (days.length >= minHoodModels) {
      dayMedians.push(median(days));
    }
    if (ratios.length >= minHoodModels) {
      ratioMedians.push(median(ratios));
    }
  }
  if (dayMedians.length === 0) {
    return null;
  }

  return { day: median(dayMedians), ratio: ratioMedians.length > 0 ? median(ratioMedians) : null };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** A curated name that matches no placed prelit model is almost certainly a typo — fail loudly, not silently. */
function curationWarnings(fingerprints: ReadonlyMap<string, PrelitFingerprint>, names: readonly string[]): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    if (!fingerprints.has(name)) {
      warnings.push(`curated model not found among placed prelit models (typo?): ${name}`);
    }
  }

  return warnings;
}

/** Placements per model (verdicts are model-level; hood = median over the model's placements). */
function groupByModel(
  fingerprints: ReadonlyMap<string, PrelitFingerprint>,
  placements: readonly Placement[],
): Map<string, Placement[]> {
  const byModel = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (fingerprints.has(placement.modelName)) {
      let list = byModel.get(placement.modelName);
      if (!list) {
        list = [];
        byModel.set(placement.modelName, list);
      }
      list.push(placement);
    }
  }

  return byModel;
}

/**
 * Day level — LIFT-ONLY for structured models (in-game finding, the day mirror of the night rule): a
 * structured model brighter than the hood is baked sunlight (`lae2_roads*` sit 40–60 above their mixed hood —
 * lowering them turned Ganton streets dusk-dark at noon), so only too-dark structured models are corrected
 * (the clubgate case). Flat models still level BOTH ways (the broken-export class, `project2lae2`);
 * saturated-white flats never get the flat flag at all (see `computePrelitContext` — gang tags / emissive
 * decals are fullbright by design, `tag_01` went 255 → 67 before that guard) and land here as structured,
 * where lift-only leaves them alone.
 */
function judgeDay(
  fingerprint: PrelitFingerprint,
  hoodDay: number,
  flat: boolean,
  forced: boolean,
  opts: Required<Omit<PrelitContextOptions, 'force' | 'only'>>,
  stats: PrelitContextResult['stats'],
): LevelVerdict | undefined {
  const deviation = fingerprint.dayP50 / Math.max(1, hoodDay);
  if (!forced && !flat && deviation >= 1 - opts.dayTolerance) {
    return undefined; // structured and not too dark — brighter-than-hood is baked sunlight, never lower
  }
  const level: LevelVerdict = {
    protectFrom: fingerprint.dayP75,
    protectTo: fingerprint.dayP95,
    shift: Math.round(hoodDay - fingerprint.dayP50),
  };
  if (flat) {
    stats.flat += 1;
  } else if (level.shift > 0) {
    stats.liftDay += 1;
  } else {
    stats.lowerDay += 1;
  }

  return level;
}

/**
 * Night: repair an existing set that GLOWS above the hood ratio (darken-only — a night set darker than the
 * hood is design, not damage: houses with the lights off; brightening lit whole Idlewood blocks) and only
 * with corroborating day evidence (`dayEvidence` — glowing props with a healthy day are lamps/signs, not
 * bugs), or synthesize a missing one at the hood ratio capped by `maxSynthRatio`.
 */
function judgeNight(
  fingerprint: PrelitFingerprint,
  dayShift: number,
  hoodRatio: null | number,
  dayEvidence: boolean,
  forced: boolean,
  opts: Required<Omit<PrelitContextOptions, 'force' | 'only'>>,
  stats: PrelitContextResult['stats'],
): NightVerdict | undefined {
  if (hoodRatio === null) {
    return undefined;
  }
  const correctedDay = fingerprint.dayP50 + dayShift;
  if (fingerprint.hasNight) {
    if (!dayEvidence) {
      return undefined; // healthy day + glowing night = lighting design (street lamps, lanterns, lit signs)
    }
    const ratio = fingerprint.nightP50 / Math.max(1, correctedDay);
    // Only-mode drops the tolerance but keeps the direction: repairs NEVER brighten (the ×42 lesson).
    if (ratio - hoodRatio <= (forced ? 0 : opts.ratioTolerance)) {
      return undefined; // at or below the hood (+ tolerance) — dark-at-night is intentional, never brighten
    }
    stats.repairNight += 1;

    return {
      kind: 'repair',
      protectFrom: fingerprint.nightP75,
      protectTo: fingerprint.nightP95,
      // ratio > hoodRatio here, so the scale is always < 1 — a darkening repair by construction.
      scale: (hoodRatio * Math.max(1, correctedDay)) / Math.max(1, fingerprint.nightP50),
    };
  }
  if (fingerprint.alphaOverloaded || correctedDay <= opts.minSynthLuma) {
    return undefined;
  }
  stats.synthesizeNight += 1;

  return { kind: 'synthesize', ratio: Math.min(hoodRatio, opts.maxSynthRatio) };
}

/** Luma percentiles of an RGBA buffer's RGB (0–255). */
function lumaPercentiles(rgba: Uint8Array): {
  mean: number;
  spread: number;
} & { p50: number; p75: number; p90: number; p95: number } {
  const count = rgba.length / 4;
  const lumas = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const luma = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    lumas[i] = luma;
    sum += luma;
  }
  lumas.sort();
  const at = (q: number): number => lumas[Math.min(count - 1, Math.floor(count * q))];

  return {
    mean: sum / Math.max(1, count),
    p50: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    p95: at(0.95),
    spread: count === 0 ? 0 : lumas[count - 1] - lumas[0],
  };
}

/** Build the verdict for an explicit only-mode entry: protect bounds 256 keep the appliers' guards inert. */
function manualVerdict(
  entry: Exclude<OnlyEntry, string>,
  fingerprint: PrelitFingerprint,
  stats: PrelitContextResult['stats'],
): null | PrelitVerdict {
  const verdict: PrelitVerdict = { flat: false };
  if (entry.dayShift !== undefined && entry.dayShift !== 0) {
    verdict.level = { protectFrom: 256, protectTo: 256, shift: Math.round(entry.dayShift) };
    if (entry.dayShift > 0) {
      stats.liftDay += 1;
    } else {
      stats.lowerDay += 1;
    }
  }
  if (entry.nightMax !== undefined && fingerprint.hasNight) {
    verdict.night = { kind: 'cap', max: entry.nightMax };
    stats.repairNight += 1;
  } else if (entry.nightScale !== undefined) {
    if (fingerprint.hasNight) {
      verdict.night = { kind: 'repair', protectFrom: 256, protectTo: 256, scale: entry.nightScale };
      stats.repairNight += 1;
    } else {
      // No night set: synthesize one as day × nightScale (the requested night look, capped at the day level).
      verdict.night = { kind: 'synthesize', ratio: Math.min(1, entry.nightScale) };
      stats.synthesizeNight += 1;
    }
  }

  return verdict.level || verdict.night ? verdict : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[sorted.length >> 1];
}
