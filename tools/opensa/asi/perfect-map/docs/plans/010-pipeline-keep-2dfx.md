# 010 — Pipeline: keep 2dfx on LODs + far-view budget

Part of the [perfect-map ASI chain](readme.md), Phase 2. Depends on [009](009-2dfx-emitter-patch.md) (the engine leak fixed) and Phase 1's [006](006-pipeline-integration.md) (the stock-vs-opensa-asi target mode). Delivers the open issue's **remaining goal**: distant factory smoke/fire visible at LOD range instead of stripped — without the emitter leak (009) OR the far-view overdraw.

## Context

Today ([lod-2dfx-particles.md](../../../../docs/open-issues/fixed/lod-2dfx-particles.md)) both LOD targets drop particle 2dfx:

- **sa** — `stripParticleEffects(bytes)` wrapped around every clone in `finalize.ts` + `fill-holes.ts` (keeps type-0 coronas/lights, removes type-1 particles).
- **opensa** — structurally immune (cell bake rebuilds from geometry; `build2dfxSection` re-adds only type-0 lights via `LIGHT_2DFX = new Set([0])`).

The issue flags TWO problems, of which 009 only solves the first:

1. **Emitter leak → crash** — fixed in-engine by 009.
2. **Far-view overdraw / lag** — every refinery/plant LOD has a large draw distance, so ALL of them emit simultaneously across the whole map: big translucent smoke sprites everywhere, tanking the frame. This is a DATA/rate problem the engine fix doesn't touch — verbatim HD emitter parameters are wrong at LOD range.

So keeping particles on LODs needs both: the asi (009) AND a LOD-tuned emitter budget so the far view isn't a smoke storm.

## Decisions

1. **Gate on target, like the limit budgets.** For the **opensa-asi target** (009 present), the LOD generators STOP stripping particle 2dfx and instead emit LOD-tuned emitters. For the **stock target**, keep stripping exactly as today (no engine fix → the strip is still mandatory). The strip is "a single call site per target" (issue note) — flip it by target flag.
2. **LOD emitters are RATE-REDUCED, not verbatim.** Distant smoke needs presence, not fidelity: cut emission rate / particle count / sprite budget hard for LOD-range emitters (candidate: a fraction of HD rate + a cap), so the whole-map sum stays cheap. Exact factors tuned in-game against the overdraw. Coronas/lights (type-0) policy unchanged — already kept.
3. **Distance-appropriate transform.** LOD emitters may need repositioned/simplified emission (the cell bake repositions coordinates already for type-0; extend that for type-1). One smoke plume per stack at range, not the HD multi-emitter rig.
4. **Reuse existing machinery.** `build2dfxSection` "already re-attaches arbitrary entries" (issue note) — widen the kept-type set to include rate-scaled type-1 for the opensa-asi target; `stripParticleEffects` gains a "scale instead of strip" sibling or a parameter. Minimal new surface.
5. **Budget honesty.** Even with reduced rates, cap the number of concurrently-emitting LOD stacks if the frame budget (the rendering chain's harness, plan 063) demands — and `log()` what was capped (no silent truncation, per repo convention). Tie into the rendering perf HUD (plan 063) to measure the far-view cost directly.
6. **Fallback safety.** If someone runs the opensa-asi-target build (particles kept) WITHOUT the asi, it crashes exactly as the original bug — so the installer's asi-presence check from 006 covers this content too; loud warning.

## Tasks

- [ ] sa-lod-generator: target-gated particle handling — strip (stock) vs rate-scaled keep (opensa-asi); add the "scale instead of strip" path beside `stripParticleEffects` in `@opensa/rw-codec/dff`; unit tests (type-1 kept + scaled for opensa-asi, stripped for stock, coronas untouched in both).
- [ ] opensa-lod-generator: extend the cell 2dfx re-add (`LIGHT_2DFX`/`collectCellLightEffects`) to optionally include rate-scaled type-1 for the opensa-asi target (byte-verbatim transplant + coordinate reposition + rate scale).
- [ ] Emitter rate/sprite-budget model: LOD-range scaling factors (rate, count, cap) as tunable config; sensible defaults, tuned in-game.
- [ ] pmb wiring: the target flag (stock vs opensa-asi) already selects limit budgets in 006 — extend it to select particle policy; one flag, both behaviours.
- [ ] In-game validation (Wine, opensa-asi target): distant refinery/plant smoke visible at LOD range, no new-game crash (009), and the far view holds frame budget (measure via the plan-063 perf HUD — before/after the rate scaling). Record factors + fps.
- [ ] Stock-target regression: particles still fully stripped, output still safe on stock 1.0 (today's verified behaviour unchanged).
- [ ] Docs/memory: update lod-2dfx-particles.md status (🟡 → ✅ for the opensa-asi target: leak fixed in-engine + overdraw budgeted; stock target still strips), the sa-lod strip plan 005 cross-ref, and the sa-lod memory ("standing goal — make particles WORK at LOD range" resolves for the asi target).

## Verification

- opensa-asi target: refinery/Vegas-plant/fountain/fire LODs emit at range, new-game boots clean, far-view frame cost within budget (measured, not eyeballed).
- stock target: byte-identical strip behaviour to today (regression).
- Without the asi on an opensa-asi build: the installer warns; the crash returns (fallback honesty).

## Measurements / notes

### Step 1 shipped (2026-07-09) — keep particles by default; problem #1 (crash) closed, #2 (overdraw) open

With 009's engine fix confirmed in-game, `sa-lod-generator` now **keeps particle 2dfx on the LOD clones by
default** (`LodConfig.keepParticles` default true; adapter fallback `?? true`; CLI inverted: opt-out
`--strip-particles` for a stock/no-asi target, replacing the old opt-in `--keep-particles`). Green: sa-lod tests
24/24, eslint, tsc. Distant factory smoke/fire now shows at LOD range without the `0x004AA3A1` crash.

**Load diagnosis (user reported "game loads slower / LODs feel heavier"):** confirmed it is NOT a geometry
regression — decimation still runs (`decimateBudget: 0.01`), so the clone meshes are byte-identical with or without
particles; keeping them only adds a few tiny 2dfx entries. The cost is the **fx-emitter runtime**: every
particle-bearing LOD instance spawns an `FxSystem` at stream-in (`CreateEntityFx` → heap alloc + a slot from the
1000-`FxEmitterPrt_c` pool) and emits + overdraws every frame. Because particle LODs have large draw distances,
they are all active map-wide = **exactly problem #2 (far-view overdraw)**, which 009 does not address. So the
slowdown is inherent to keeping verbatim HD emitters at LOD range — the open budget task below.

**Note on rate-scaling feasibility:** a type-1 2dfx entry only _names_ an `effects.fxp` blueprint (position + effect
name); emission rate/particle-count live in the blueprint, not inline. So "rate-reduce" (decision #2) can't be a
byte edit on the DFF — it needs either low-rate effect variants authored in `effects.fxp` (point the LOD entry at
the lighter name), or a build-time lever that doesn't touch effects.fxp (cap which/how-many LODs keep particles, or
shorten the particle-LOD draw distance so fewer emit at once). Direction is the pending user decision.

- LOD emitter scaling factors (rate/count/cap) shipped: **none — user decision (2026-07-09): accept the overdraw
  as-is for now.** The crash is fixed (009) and distant smoke is the desired look; the far-view frame cost is a known
  tradeoff, not a blocker. Overdraw budgeting deferred (the low-rate approach below is the recorded path when we pick
  it back up). No count/distance cap shipped.
- far-view frame cost before/after scaling (map-wide smokestacks in view): _not measured — deferred._
- models re-emitting at LOD range (of the 11 previously stripped): **all** (default keep).

## Future enhancement — low-rate `effects.fxp` variants (recorded 2026-07-09, user-flagged as interesting)

The clean way to keep distant smoke visible WITHOUT the map-wide overdraw, since a type-1 2dfx entry only _names_ an
`effects.fxp` blueprint (rate/particle-count/sprite budget live in the blueprint, not inline in the DFF):

1. **Author LOD variants in `effects.fxp`.** For each particle effect a LOD keeps (`smoke30m`, `smoke50lit`,
   `ws_factorysmoke`, `fire`, `water_fountain`, `vent`, …), add a sibling blueprint (e.g. `smoke30m_lod`) with
   emission rate / max-particles / sprite size scaled DOWN hard (candidate: ~10–25 % rate, fewer/larger sprites so a
   single soft plume reads at range instead of a dense column). Same visual identity, a fraction of the fill cost.
2. **Retarget the LOD's 2dfx entry to the `_lod` name.** In the sa-lod clone path (`finalize.ts`/`fill-holes.ts`),
   when keeping a type-1 entry, rewrite its effect-name string to the `_lod` variant (a byte-level name swap in the
   2dfx section — `build2dfxSection` already rewrites entries; add a name-remap param). HD keeps the full-rate name.
3. **Pack the augmented `effects.fxp`** into the drop-in build (the pipeline already ships data overrides). Since the
   blueprint pool is generous and `_lod` blueprints are cheaper, map-wide concurrent LOD plumes stay within budget.
4. **Tune in-game** against the rendering perf HUD (plan 063): dial the `_lod` rate until the whole-map far view holds frame
   budget while the plumes still read. Record factors + fps.

This keeps decision #2 ("rate-reduced, not verbatim") intact and needs NO engine change beyond 009 — purely data
(effects.fxp + a name-remap in the clone path). Bigger lift than a draw-distance cap, best fidelity/perf result.
Deferred until we choose to budget the overdraw.
