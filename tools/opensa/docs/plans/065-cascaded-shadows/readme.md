# 065 — Cascaded shadows (buildings, vehicles, peds)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [064](../064-hybrid-world-lighting/readme.md) (the world shader that consumes the shadow term). Delivers the headline feature: **buildings cast real, moving sun shadows** — fast.

## Context

Today: one 2048² PCFSoft map, orthographic frustum `SHADOW_SIZE=45` following the view, texel-snapped, **dynamics-only casters** (sky.plugin.ts); the world receives via a manual 4-tap PCF injection (`worldShadowUniforms` in world-material.ts). 038 dropped static casters deliberately (unlit world + acne + perf). With 002's lit world the classic obstacles are addressed: smoothed normals exist (bias by slope works), and prelit-as-indirect means shadowed areas keep GI instead of going black.

Assets give us a unique lever: the LOD pipeline (opensa-lod-generator) already produces simplified per-cell meshes — ideal cheap **shadow proxies** for far cascades.

## Decisions

1. **CSM, 3 cascades** (near ~50 m dynamic-heavy, mid ~250 m, far ~1000 m), based on the three.js CSM addon but adapted to our manual world-shader injection (we don't use three's lighting plumbing for the map — the CSM split/fit/snap logic is reusable, the receive side is our own multi-cascade sampling term). Practical split to be tuned on benches.
2. **Static-caster caching**: far cascades contain almost only static geometry → re-render them only when the sun moves enough (game-time minutes) or the camera crosses a cell boundary, NOT every frame (extends the existing `shadow.autoUpdate` freeze pattern). Near cascade renders every frame (cars/peds).
3. **Shadow proxies for far cascades**: render LOD cell meshes (already in memory for the far world) instead of HD cells into mid/far cascades — big caster-count and vertex-cost win. HD casts only into the near cascade. Requires marking cell meshes with per-cascade layers.
4. **Filtering**: PCF 4–9 tap in the world shader (extend the existing manual term to cascade selection + blend bands). PCSS/contact-soft is an "ultra" tier experiment, not the default. Acne control: slope-scaled bias + normal offset (we control the shader fully).
5. **timecyc integration**: shadow strength follows the 038 fade rules (night → 0, overcast dims); dawn/dusk long shadows clamp the far cascade extent (mega-long shadows are the classic CSM budget killer — cap and fade instead).
6. **Peds/vehicles**: unchanged casters, now into the near cascade; their receive on the world comes free via the same term.
7. **Budget**: target ≤ 2.5 ms GPU total for shadows on the reference machine at 1080p (measured via 001 harness); if the far cascade breaks the budget, its resolution/update rate degrade first (quality-tier knobs from day one).

## Tasks

- [x] CSM core: **shipped** — pure math in `packages/game/src/shadows/csm-math.ts` (splitRanges uniform↔log λ,
      sliceSphere stable-fit, shadowDistanceFactor dawn/dusk clamp, needsRefresh cadence policy; 13 unit tests) +
      `CsmPlugin` (`packages/game/src/plugins/csm.plugin.ts`). **Design deviation (simpler than planned): the mid/far
      cascades are two intensity-0 `DirectionalLight`s** — three renders their maps with proper depth materials
      (alpha-tested foliage casts correctly, RGBA packing matches our receive), we only control WHEN via
      `autoUpdate=false` + `needsUpdate` on the schedule. Slot 0 = the SkyPlugin sun's own per-frame 45 m map.
- [x] World-shader receive: **shipped** — `worldCsmUniforms` + `csmShadow()` in `world-material.ts`: 3 cascade
      coords (vertex varyings) + view-depth select, 4-tap PCF per cascade, blend bands at 85 % of each split,
      far fade-out tail, slope-scaled bias via 064's `vSunNdl` (`uCsmBias + uCsmSlopeBias × (1−NdotL)`).
      Uniform-gated by `uCsmMix` — classic single-map term untouched at 0. `?shadowdebug` now tints per cascade
      (R/G/B). Normal-offset skipped v1 (slope bias first; add if calibration demands).
- [x] Caster management: **shipped, simpler than planned** — no layers needed: `csm-casters` system flips
      `castShadow` on streamed cell meshes in modern mode, and the streaming ring IS the proxy split (the far
      ring only holds LOD meshes → the far cascade renders LOD proxies automatically; the near ring is HD).
      Alpha-BLENDED materials excluded (beams, water — depth casters would blob). Static cadence: mid/far
      re-render on ~0.6° sun rotation or camera travel > ⅛ cascade radius (needsRefresh), near = every frame.
- [~] Dynamics receive (MeshStandard path): kept three's plumbing on the near sun only (v1) — cars/peds receive
      building shadows within 45 m via the near map (world HD now casts into it). Mid/far receive on dynamics =
      later, by measured need.
- [x] Config: `shadows.distance` (default 800) + debug slider (Graphics → CSM DISTANCE); quality tiers proper
      arrive in 072 (v1 = 3 cascades whenever pipeline is modern + shadows on).
- [~] Calibration: strength/bias per hour sweep; verify no acne on smoothed & flat roofs, no peter-panning at
      bases of buildings. **USER session next.**
- [~] Bench: record GPU ms per cascade, caster draw calls, on all bench scenes (esp. LV night = shadows off ⇒
      zero cost, and dusk long-shadows worst case). **After the first calibration.**

### How to try it (user)

Modern pipeline ON (F2 → Graphics) at a day hour → buildings cast real shadows out to ~800 m (CSM DISTANCE
slider in Graphics). `?shadowdebug=1` tints cascades red/green/blue. Watch for: acne on roofs/walls (raise
`uCsmBias`/slope via a follow-up knob if visible), peter-panning at building bases, the shadow POP when the
mid/far cascade refreshes after fast travel (cadence knobs), and stale shadows after teleports + time jumps
(the needsRefresh sun-angle trigger must catch them).

## Verification

- Visual: downtown LS at 08/12/17 h — building shadows sweep believably; cars/peds shadowed under buildings look coherent (indirect keeps them readable).
- Static-cache correctness: teleporting across the map and fast-forwarding game time never shows stale shadow directions (038's "yesterday's sunset" bug class — regression-test the trigger conditions).
- Budget: ≤ 2.5 ms @1080p reference, zero cost when off/night.

## Measurements

### First in-game run (2026-07-10) — three bugs found by the user, all fixed same day

- **Bench (BEFORE the fixes):** ls-noon modern+CSM 66.9 ms avg / GPU 46.7 / 10 984 draws — vs 53.7 / 39.5 /
  9 741 with 064 only. ~13 ms of CSM cost, dominated by the near map suddenly re-rendering thousands of HD
  casters EVERY frame. Unacceptable → architecture revised (below). **Re-bench pending.**
- **Bug 1 — shadows flicker/vanish on all objects while moving (jitter too):** the plugin mirrored shadow
  matrices with `.copy()` BEFORE the frame's shadow render, but three refreshes `shadow.matrix` DURING it →
  the receive sampled one-frame-stale coords; a refit near map put them outside [0,1] → `return 1.0` = no
  shadow. FIX: mirror matrices BY REFERENCE (the uniform reads the live matrix at draw time — exactly how the
  classic single-map mirror in canvas-host always worked).
- **Bug 2 — the +13 ms:** world HD casters were in the sun's own per-frame map. FIX: shadow-render **layers**
  — the near map renders ONLY `CSM_DYNAMIC_LAYER` (player/vehicles, tagged per frame from the entity root);
  static cells go ONLY into the cached cascades (`CSM_STATIC_LAYER`), which now cover the WHOLE range from the
  camera (cascade 1 = 0..mid, cascade 2 = ..far) and the dynamics map min()-overlays the first 45 m in the
  shader. Static maps render only on the refresh schedule → steady-state cost ≈ receive ALU + occasional
  refresh spikes. Also staggered: max ONE static-cascade re-render per frame.
- **Bug 3 — wind/tree conflict:** swaying vegetation cast STATIC shadows (three's depth pass doesn't run the
  sway chunk) that shimmer against the moving foliage. FIX v1 excluded `|sway` casters entirely — the user
  immediately missed the tree/wire shadows, so the PROPER fix landed same day: **`wind.mod` now builds a
  sway-matched `MeshDepthMaterial`** (same displacement chunk, shared wind clock, cutout alphaTest kept, in
  `material.userData.swayDepthMaterial`); the caster system attaches it as `mesh.customDepthMaterial` and
  puts sway meshes on BOTH shadow layers — within 45 m the per-frame dynamic map animates the swaying
  shadow, beyond that the cached static cascades keep a frozen-phase distant shadow.
- **Also fixed preemptively:** freshly streamed-in cells now invalidate the cached cascades (a
  `worldVersion` = streaming-root child count is part of the refresh state) — without it a new building
  would cast nothing until the next scheduled refresh.

### Second run (2026-07-10) — stable, but flyover artefacts → cadence fixes

- Bench after the first fix round: ls-noon 60.9 ms avg / GPU 47.0 / p95 **95.4** ms. Shadows became more
  stable (matrix-reference fix confirmed), but during the flyover shadows of big buildings drew IN
  PARTS. Root cause of both the p95 spikes and the partial shadows: the world-change invalidation fired on
  EVERY cell add/remove — during a flyover streaming churns constantly, so the "cached" cascades re-rendered
  nearly every frame (cache defeated), and each render caught a half-loaded world.
- FIXES: (1) **settle-gated invalidation** — the version reads -1 while streaming is in flight; one forced
  refresh when the world settles (movement/sun cadence still applies meanwhile); (2) **coverage margin**
  (fit radius × 1.2) so the leading edge stays inside the map between refreshes; (3) **velocity lookahead**
  (0.4 s, clamped into the margin) — fast travel renders shadows ahead of the view (plan-060's streaming
  lookahead idea). Re-bench pending; gameplay-speed movement should now hold the cache for seconds at a
  time.

### Third run (2026-07-10) — perf attribution → vertex-cost fix

- Bench after cadence fixes: 67.0 ms avg / GPU 48.5 / p95 99.2 — WORSE avg than run 2. Attribution: the
  receive computed THREE mat4 cascade projections per VERTEX (7 M-triangle scenes are vertex-bound → paid
  every frame, both pipelines), and mid-cascade refreshes in downtown submit thousands of casters in one
  frame (p95 spikes).
- FIXES: (1) cascade projection moved to the FRAGMENT stage — one vec3 world-pos varying, matrices applied
  only for the branch taken (1–2 mat4/fragment vs 3 mat4/vertex); (2) refresh cadence relaxed to ¼ radius
  (margin raised to ×1.3) — half the refresh spikes. Re-bench pending. Next levers if still over budget:
  per-cascade GPU labels (attribute exactly), far-cascade at 1024², LOD-proxy-only mid cascade (072 tiers).

- ms per cascade / total; caster draws per cascade: …
- chosen splits, resolutions, update cadences: …
