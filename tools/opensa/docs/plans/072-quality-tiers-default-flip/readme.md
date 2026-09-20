# 072 — Quality tiers, default flip, cleanup

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


**Prior status, kept for context — 🅿️ PARKED (2026-07-10, user's call), superseded by the CLOSED banner
above.** An INTERIM default flip is live instead: `graphics.pipeline`
defaults to `'modern'` and `sky.model` to `'pbr'` — the whole 064–071 chain on by default, EXCEPT volumetric
clouds (`clouds.volumetric` stays false — heavy). Every stage keeps its individual debug slider. The FORMAL
work this plan still owns — the low/medium/high/ultra ladder, the ≤16.6 ms budget contract, the GPU-string
auto-pick, and the classic-path cleanup — is deferred until after the user has lived with the modern default
for a while. Volumetric clouds + water-shore + SSR are the natural ultra-tier members when it resumes.

---

Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). The closing plan: depends on everything before it. The chain isn't "done" until the modern pipeline is the DEFAULT and the budgets hold on real hardware tiers.

## Context

Plans 002–009 each added `graphics.*` toggles and recorded per-feature costs. What's missing at this point: a coherent user-facing quality ladder, enforcement that the combined default fits the frame budget, and the 038-style cleanup decision (what happens to the classic path).

## Decisions

1. **Four tiers** mapping every chain toggle:
   - **low**: classic-equivalent (038 look) + new sky at cheapest model, no static shadow cascades, sky-only water reflection, light pool 8, no volumetrics;
   - **medium**: CSM 2 cascades, pool 16, shore water, no planar reflection;
   - **high** (default target): CSM 3, planar water, pool 32, full emissive night, Stage-A clouds;
   - **ultra**: PCSS/contact experiments, volumetric clouds (005 Stage B), SSR water, wet-look.
     Exact mapping finalized from the measured numbers in each plan's doc — tiers are DERIVED from data, not vibes.
2. **Frame budget contract**: high tier ≤ 16.6 ms p95 on the reference machine across ALL bench scenes (worst: dusk long-shadows + LV night). Any overshoot gets resolved by demoting features between tiers, not by shipping a slow default.
3. **Default flip**: `graphics.pipeline: 'modern'` + tier `high` become the defaults after a full sign-off sweep (all benches × key hours × weathers, side-by-side vs classic).
4. **Classic path fate — user decision point**: 038 deleted its old path after sign-off; propose the same here (classic survives only as the `low` tier's lighting model, the master `'classic'` switch dies). Defer the deletion until the modern pipeline has survived real use for a while.
5. **Docs & memory**: the living graphics plan (029) and night plans (032/033/034) get status updates pointing here; memories updated (`shadows-deferred` note about the T3 fork landing, headlight MVP note retired).

## Tasks

- [~] Tier definition table (from measured per-feature ms) + `graphics.quality: 'low'|'medium'|'high'|'ultra'` preset applier (presets set the individual toggles; individual overrides still respected — precedent: vehicle reflection presets).
- [~] Auto-pick heuristic at first launch (GPU renderer string + a 2-second self-bench) with manual override in settings UI.
- [~] Full bench sweep per tier; fix budget violations by re-tiering; record the final matrix (tier × scene → ms) here.
- [~] Sign-off sweep with the user (screenshot matrix tooling from 001); flip defaults.
- [~] Cleanup pass: dead classic-only branches inventory (deletion PR deferred — list them here), config defaults, debug overlay regrouping (one "Rendering" section).
- [~] Update docs/plans/029 (+032/033/034) statuses + memories; move this chain's docs from ideas/ to docs/plans/ numbering if the project convention prefers (decide with the user).

## Verification

- High tier holds ≤ 16.6 ms p95 on every bench scene on the reference machine; low tier runs on the weakest hardware we care about (define it here).
- New-user first launch lands on a sensible tier automatically.

## Measurements

_(record before closing the chain)_

- final tier × scene frame-ms matrix: …
- auto-pick decisions on tested GPUs: …

## Measurements — BEFORE (classic) → AFTER (modern) (2026-07-10, M3 Pro, "everything but volumetric")

**BEFORE** = the classic 063 baselines (pre-overhaul pipeline). **AFTER** = the interim modern default with the full
064–071 chain on, volumetric clouds off. Same machine, same 6 bench scenes. This is the data the tier ladder derives from.

| scene         | avg ms — BEFORE → AFTER | draws — BEFORE → AFTER | GPU ms — BEFORE → AFTER |
| ------------- | ----------------------- | ---------------------- | ----------------------- |
| ls-noon       | 53.5 → **90.4** (+69%)  | 10 394 → 14 454 (+39%) | 39.5 → 53.9             |
| sf-fog-dawn   | 33.2 → **71.2** (+114%) | 7 116 → 10 774 (+51%)  | 21.6 → 48.8             |
| lv-night      | 33.3 → **54.0** (+62%)  | 7 373 → 9 142 (+24%)   | 12.7 → 21.6             |
| country-dusk  | 23.0 → **37.8** (+64%)  | 3 978 → 5 696 (+43%)   | 14.8 → 19.0             |
| ocean-horizon | 12.8 → **33.5** (+162%) | 62 → 86 (≈0)           | 18.4 → 43.7             |
| ls-rain-night | 47.9 → **97.3** (+103%) | 10 445 → 15 165 (+45%) | 16.6 → 44.1             |

**Cost attribution (drives the tier ladder):**

1. **CSM shadows = the draw-call cost.** +35–50% draws everywhere with geometry (caster passes); worst at low sun
   (sf-fog-dawn +51%, rain-night +45%: long shadows → cascades pull more casters). This hits the draw-call-bound
   profile hardest. Tier levers: low=off, medium=2 cascades, high=3; far cascade 1024², mid LOD-proxy-only (065).
2. **HDR HalfFloat buffer = a uniform GPU tax.** ocean-horizon proves it: draws ≈unchanged (62→86) but GPU ×2.4
   (18→44) — pure fullscreen bandwidth across bloom/SSAO/god-rays/tonemap/SMAA. It's the price of night emissive
   bloom, paid by day too. Tier: HDR on high+, LDR buffer on low/medium.
3. **Water shore + water fragment.** ocean-horizon ×2.6 at flat draws → heavy water fragment (Gerstner normals, LUT
   reflect, GGX) + the shore DepthPass. Already opt-in (`water.shore`); tier = high/ultra, and reworked in 0.5.0.

**Note:** p95 reads exactly 100 ms on the three heaviest scenes — a frame-time clamp, not a real ceiling; use avg
for comparison. No scene holds the 16.6 ms high-tier contract yet — expected; the ladder + budget enforcement is
exactly this plan's job when it resumes.
