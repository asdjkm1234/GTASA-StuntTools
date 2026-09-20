/**
 * Game-agnostic types for the sa-lod-generator (per-object HD-clone LODs for the real game — see
 * `docs/plans/001-architecture.md`). The core only knows about resolved **HD↔LOD links** and the run config; the
 * RenderWare/GTA-SA specifics (parsing IPL `lod` fields, DFFs) live in `adapters/gta-sa`.
 */

/** Run configuration (the "what/where" knobs). */
export interface LodConfig {
  /**
   * Budget-checked QEM decimation for the clones (plan 003, Phase 5): per model, the most aggressive triangle
   * target whose own render stays within this mean pixel-diff budget wins; models that can't decimate cleanly
   * stay verbatim byte-copies. 0/absent = pure verbatim clones.
   */
  decimateBudget?: number;
  /**
   * Model names (lowercased, HD **and** LOD) owned by sibling generators — lod-trees/lod-procobj in the
   * perfect-map pipeline. sa-lod skips cloning/hole-filling any link touching these so it never re-processes
   * another tool's finished LODs (which double the far-view geometry). See the pipeline's `collectGeneratedModels`.
   */
  excludeItems?: readonly string[];
  /** Curated HD models (lowercased) that have no LOD and hole the far view — a far-LOD is generated for each (plan 003). */
  holeFillModels?: readonly string[];
  /** Draw distance for the generated hole-fill LODs (covers the far view once the HD unloads). */
  holeLodDraw?: number;
  /**
   * KEEP particle 2dfx (type-1 emitters: factory smoke, fire, fountains) on the far-LOD clones so distant smoke
   * shows at LOD range (plan 010). Default true — but this REQUIRES perfect-map.asi's 2dfx fix (plan 009): without
   * it the cloned-LOD emitters trigger the use-after-free crash at 0x004AA3A1 (see lod-2dfx-particles.md). Set
   * false (`--strip-particles`) for a stock target with no asi — the pre-009 behaviour (type-1 stripped, coronas
   * kept). NOTE: keeping them reintroduces the far-view emitter overdraw (plan 010's open budget task).
   */
  keepParticles?: boolean;
  /**
   * Screen-size skip (plan 003, Track 1): a LOD whose HD model's bounding diameter covers fewer pixels than
   * this at the HD's own draw distance (where the HD unloads and the LOD appears) is not worth cloning — the
   * stock LOD stays. Default 2.
   */
  minLodPixels?: number;
  /** Output directory for the drop-in build (the CLI passes `--out <path>`); absent → report only. */
  out?: string;
  /**
   * Give every clone dictionary EVERY texture its models name, with no `txdp` parent. **Default false** — the
   * partitioned `salodpar` scheme of plan 006 stands.
   *
   * It was flipped to true on 2026-08-16 on the theory that the game does not resolve the `txdp` chain, and
   * the FIELD said otherwise: self-contained dictionaries changed nothing about the missing/untextured LODs,
   * while costing 45.9 MiB against the partition's 10.4 MB. The parent is neither proven guilty nor cleared —
   * it simply is not the defect being chased, so the cheaper shape stays until something proves it wrong.
   */
  selfContainedTxd?: boolean;
  /** Texture downscale factor for the clone LODs (0.5 = half each side = quarter the pixels). */
  texScale: number;
}

/** One resolved HD→LOD relationship, aggregated over the instances that share it. */
export interface LodLink {
  /**
   * The HD def's IDE draw distance — the closest distance the LOD is ever seen from (the HD unloads there).
   * 0 when the HD has no def; consumers fall back to a sane default.
   */
  hdDrawDistance: number;
  /** The HD model whose far-view stand-in is `lodModel`. */
  hdModel: string;
  /** The HD model's IDE `txd` — the source atlas the 50 % clone TXD is downscaled from. */
  hdTxd: string;
  /** How many placed HD instances link `hdModel` → `lodModel`. */
  instanceCount: number;
  /** The LOD model's object id (from its IDE def) — reused on the clone (drop-in, no new id). */
  lodId: number;
  /** The stock LOD model — the entry the clone replaces in place. */
  lodModel: string;
  /** The LOD model's IDE `txd` (retargeted to the 50 % clone TXD when baking). */
  lodTxd: string;
}

/** Result of resolving the map's LOD links: the aggregated links + counts of the LODs left out. */
export interface ResolveResult {
  /** LOD models skipped because they also have a standalone (non-target) placement — cloning would corrupt it. */
  excludedDualRole: number;
  /** LOD models skipped because they belong to a sibling generator (lod-trees/lod-procobj) — already final. */
  excludedGenerated: number;
  /**
   * LOD models skipped because their HD is a timed (`tobj`) object while the LOD is an untimed neutral stand-in
   * — cloning would bake the lit appearance into an always-on model (Luxor lights at noon). Timed→timed pairs
   * still clone (the game hour-gates them by their own IDE windows).
   */
  excludedTimed: number;
  /** LOD models skipped because the HD is sub-pixel at its draw distance — not worth cloning (stock kept). */
  excludedTiny: number;
  /** LOD models skipped because the HD or LOD is vegetation (trees get impostors, not HD clones). */
  excludedVegetation: number;
  links: LodLink[];
  /** Links whose LOD target had no IDE def (can't clone). */
  unresolved: number;
}
