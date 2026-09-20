# 077 — Unit coverage back to 85–90 % (the device-independent seam)

Fallout from [074/13](../074-opensa-engine/13-cleanup.md): deleting the three-WebGL renderer removed a large,
heavily unit-tested body of code, and `packages/engine` — the WebGPU renderer that replaced it — arrived
essentially untested because it needs a GPU device. Coverage fell **88.9 % → 72.3 %** statements and the
enforced floors (85 / 77) have been red since. [13 phase 6.6](../074-opensa-engine/13-cleanup.md) left the
fix as an explicit decision rather than lowering the floors silently. **This plan is that decision,
executed.**

**Target: 85 % statements minimum, 90 % preferred, with the floors re-armed at the achieved number.**

**STATUS: DONE 2026-07-18 — 72.29 % → 88.18 % statements · 78.57 % branches · 90.72 % functions ·
88.12 % lines** (the plan itself closed at 88.16 %; fixing the four defects it found added two regression
tests, see the last ledger row). Floors re-armed at 86/86/88/77. Phase 4 (extraction) was NEVER NEEDED: the fake device
reached everything, so `packages/engine` sources were not touched at all. Suite 300 files / 2 100 tests,
verified identical across consecutive runs.

## The measured gap (2026-07-18, baseline)

Total **8 847 statements, 6 396 covered = 72.29 %**. To reach 85 % needs **+1 124 covered statements**;
90 % needs **+1 566**.

| Area                      | Uncovered / total | %        | Notes                                                      |
| ------------------------- | ----------------- | -------- | ---------------------------------------------------------- |
| `packages/engine/src`     | **1 480 / 2 002** | **26.1** | the whole problem; `engine.ts` alone is 910 at **0 %**     |
| `packages/game/src`       | 311 / 2 058       | 84.9     | `gta-sa-world.adapter` 108, `physics-world` 96             |
| `packages/renderware`     | 233 / 3 000       | 92.2     | `glyph-quads` 46, `build-ped-model` 30, `prepare-clump` 30 |
| `packages/math/src`       | **203 / 628**     | 67.7     | **pure code, no excuse** — `vector4`/`vector2` at 0 %      |
| `packages/loaders/src`    | 201 / 426         | 52.8     | `asset-fetch-loader` 102 at 0 %, `install-source` 38       |
| `packages/engine-formats` | 18 / 428          | 95.8     | fine                                                       |
| everything else           | ~5                | ~99      | fine                                                       |

**Arithmetic that decides the plan: covering every non-engine gap perfectly yields ~84 %.** The engine is
not optional — it must contribute ~150 statements for 85 % and ~700 for 90 %.

## The approach — USER DECISION 2026-07-18

**A fake `GPUDevice` first, targeted extraction only where the fake cannot reach.** Rejected
alternatives, recorded so they are not re-argued:

- **Extracting the frame logic out of `engine.ts` as the primary move** — it is a refactor of a
  field-validated hot path days after the flip, and a regression there is invisible to unit tests
  (only a field ride or the bench catches it). Extraction stays available, but it is the second tool,
  not the first.
- **Excluding `packages/engine` and re-arming the floors on the narrowed scope** — honest bookkeeping,
  but it declares the renderer permanently untestable and caps real coverage at ~84 %.

The fake device is **test-only code**: `engine.ts` is not touched. It records the calls made against it
(`createBuffer`, `createBindGroup`, `beginRenderPass` → `setPipeline`/`setBindGroup`/`draw`/`drawIndexed`,
`queue.writeBuffer`, `createRenderBundleEncoder`, …) so a test asserts **what the engine decided to
draw**, not that it called an API. That is the seam: WebGPU's own interface.

**What must be asserted through it — behaviour, not call shapes:**

- hour gating (`timedActive`): night-window objects appear at 22:00 and not at 14:00
- cell selection: the LOD ring, the fog cap, the cell-rect visibility test (074/21)
- draw order: opaque → sky → blend, and blend sorted back-to-front by cell distance
- translucent submesh sort (the wheel-through-windscreen fix)
- vehicle-texture LRU: claim-before-evict, the 256 MB trim floor
- residency ledger arithmetic
- uniform/buffer PACKING — byte offsets and strides, where silent corruption lives

**Anti-goal, stated up front:** a test that only proves `createBuffer` was called is coverage theatre.
If a test cannot fail for a reason a user would care about, it does not go in.

> **Post-hoc correction (2026-07-18, from the close-out audit).** Three of the seven bullets above were
> written before checking WHERE the behaviour lives, and two of them are not reachable from this plan's
> scope at all:
>
> - **The vehicle-texture LRU is not in `packages/engine`** — it lives in
>   `apps/web/src/ui/engine-vehicles.ts`, inside the `apps/web/src/ui/**` exclusion (DOM glue → the e2e
>   lane). Testing it means moving it or widening the exclusion, which is a different plan.
> - **The translucent submesh sort** is in `engine.ts`'s per-frame vehicle path, which needs a built
>   vehicle model; the fake reaches it, but no test was written. **Unmet, named here so it is not
>   mistaken for done.**
> - **Uniform/buffer PACKING was delivered** — `world/cells.test.ts` asserts the cell uniform's origin,
>   channel flag bits and identity uvAnim, and the aligned-erase byte window.
>
> The bullets are left as written above rather than quietly edited, because the gap between what a plan
> promises and what it delivers is the thing worth being able to see later.

## Phases

Each phase ends green with a measured coverage delta in the ledger. Phases 1–2 carry zero risk to
product code; phase 4 is the only one that touches `packages/engine` sources.

### Phase 1 — `@opensa/math` to ~95 % (+~180)

Pure functions, zero dependencies, and **it is our replacement for three** — the one package where thin
coverage is indefensible. `vector2`/`vector4` sit at 0 %, `matrix4` has 46 uncovered. The
[three-parity fixtures](../../../packages/math/src/three-fixtures.json) already pin the semantics; this is
extending that suite to the untested surface.

### Phase 2 — loaders + the non-engine remainder (+~600)

- `asset-fetch-loader` (102, 0 %) — fetch + Cache Storage, mockable; the existing `asset-loader.ts`
  exclusion covers the _orchestration_, not this.
- `install-source` (38), `dir-handle-store` (35) — File System Access handles, fakeable.
- `gta-sa-world.adapter` (108) + `physics-world` (96) + `engine-vehicle-handle` (30).
- `glyph-quads` (46) — flagged as untested during the 074/13 docs sweep.
- `build-ped-model` (30), `prepare-clump` (30).

### Phase 3 — the fake device + engine behaviour tests (+~500–700)

The plan's centre. Build `packages/engine/src/test/fake-device.ts` (test-only, excluded from coverage
itself), then cover in this order — highest behavioural value first, not highest line count:
`world/cells.ts` (96) · `engine.ts` `frame()` (the bulk of the 910) · `render/pipelines.ts` (77) ·
`world/textures.ts` (34, the LRU) · `stream/setup.ts` (46) · `render/probe.ts` (73) ·
`debug/gpu-timers.ts` (54).

### Phase 4 — targeted extraction — **NOT NEEDED, and that is the plan's main result**

The evidence from phase 3 said the fake reaches everything that matters: `world/cells.ts` went to
**100 % statements and 100 % branches** through it, and `engine.ts` to 43.8 % without a single source
edit. Nothing justified refactoring a field-validated hot path days after the flip. **No engine source
was modified by this plan** — the whole recovery is test-only code, so there is no bench ritual or field
ride to owe.

The `engine.ts` remainder (~56 %) is genuinely device-bound work — resource creation and pass encoding —
whose behaviour the bench, soak and e2e lanes already cover. Chasing it with a mock would be the
coverage theatre this plan's anti-goal names.

### Phase 5 — re-arm the floors + close out

Set `coverage.thresholds` to a small buffer below the achieved numbers (the repo's existing convention),
update [test-coverage.md](../../development/test-coverage.md), and record the final disposition.

## Measurement ledger

| Date       | Phase                                   | Statements               | Branches    | Functions   | Lines       | Note                                                                                                                        |
| ---------- | --------------------------------------- | ------------------------ | ----------- | ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | baseline (post-teardown)                | 72.29 %                  | 67.11 %     | 71.86 %     | 72.13 %     | 6 396 / 8 847 statements                                                                                                    |
| 2026-07-18 | phase 1 — `@opensa/math`                | **74.40 %**              | 69.09 %     | 77.74 %     | 74.22 %     | math 67.7 → ~98 %; suite 295 files / 1 900 tests                                                                            |
| 2026-07-18 | phase 3 — the fake device (engine only) | engine **26.1 → 62.9 %** | —           | —           | —           | `engine.ts` 0 → 43.8 %, `pipelines` 4.9 → 98.8 %, `core/math` 59.7 → 100 %, `sky-lut` 98.8 % — the seam works               |
| 2026-07-18 | phase 3 — `ifp-sampler` + `world/cells` | **88.16 %**              | **78.52 %** | 90.65 %     | 88.10 %     | `ifp-sampler` 72.2 → 99.2 % stmts / 45.7 → 91.4 % br; `cells` 65.6 → **100 / 100 %**; fake device now records written BYTES |
| 2026-07-18 | phase 5 — floors re-armed + close-out   | **88.16 %**              | **78.52 %** | **90.65 %** | **88.10 %** | thresholds 86/86/88/77; suite 300 files / 2 098 tests, identical across runs; `test-coverage.md` rewritten                  |

## Findings — bugs the coverage work surfaced ✅ ALL FIXED

Writing tests against untested code found three defects and one piece of dead code. **They were recorded
here unpatched first** — a coverage plan that also changes behaviour cannot tell you which change broke
something — **and then all four were fixed the same session in their own commit.** Full record, including
why the fixes are shaped as they are:
[open-issues/fixed/physics-collider-defects.md](../../open-issues/fixed/physics-collider-defects.md).
The findings below are left in their ORIGINAL wording (the diagnosis is the valuable part); the
resolution of each is appended in bold.

1. **`PhysicsWorld.createFalling`'s box fallback is unreachable** (`physics-world.ts:254-257`).
   `ColliderDesc.convexHull()` returns a non-null but INVALID descriptor for degenerate input — the
   neighbouring `addConvexChassis` knows this and guards with try/catch, but `createFalling` relies on
   `??`, so `createCollider` throws. A prop whose mesh cannot be hulled **crashes the topple instead of
   falling back to its box**. This is a real B7·a destruction path.
   → **FIXED:** mirrors `addConvexChassis` (`length >= 12` pre-check + try/catch). Two regression tests
   assert the fallback body LANDS, not merely that nothing threw.
2. **`PhysicsWorld.setColliderEnabled` does not work, and is dead.** `setEnabled(false)` reports
   `isEnabled() === false` while the collider keeps blocking solidly. No callers — the working path is
   `setColliderSensor`. Delete it or fix it before someone reaches for it.
   → **FIXED: deleted** (user decision). A method that reports success and does nothing is worse than a
   missing one — it passes review and fails in the field.
3. **`roadsignGlyphIndex` does an unguarded prototype lookup** — `'toString'` returns a Function, not
   `null | number`. Unreachable from `roadsignGlyphQuads` (it only passes single characters), but the
   signature is a lie. `Object.hasOwn` or a `Map` closes it.
   → **FIXED: it is a `Map`** — which kills the class rather than guarding one instance. (`Object.hasOwn`
   needs an ES2022 lib this repo does not target.) Regression covers `toString`/`constructor`/`__proto__`.
4. **`mat4Multiply` cannot alias `out` with `a`** — it writes `out` column-by-column while still reading
   `a`, so `mat4Multiply(m, m, b)` silently corrupts. No current caller does this; worth a doc comment.
   → **RESOLVED as a doc comment, deliberately not guarded.** Both callers are per-frame hot path (the
   view-projection matrix) and neither aliases; a 16-element guard copy every frame was not worth it.

Also removed as a direct consequence: **`GtaSaWorldAdapter.preparseCellModels` + the whole `DffParser` /
`dff-parse.worker` chain** — plan-060 off-thread parsing for the THREE renderer's cell builds, orphaned by
[074/13](../074-opensa-engine/13-cleanup.md) phase 5 and missed there because the method is private and
reachable only through a config option nobody sets. ~31 unreachable statements.

## What is deliberately still uncovered

Named so the next reader does not mistake it for an oversight:

- **`engine.ts`'s remaining ~56 %** — resource creation and pass encoding, i.e. the genuinely
  device-bound half. Covered by the bench, soak and e2e lanes; a mock would prove only that the engine
  called the API it obviously calls.
- **`stream/pak-worker.ts` and `stream/setup.ts` (both 0 %)** — Worker entry glue (`self.onmessage`) and
  its wiring. NOTE: they are **counted, not excluded**, so they drag the totals down honestly rather than
  being hidden. (An earlier draft of this line appealed to "the existing worker exclusions" — there are
  none; the only one, `dff-parse.worker.ts`, was deleted by this plan.)
- **`render/probe.ts` 57.5 %, `debug/gpu-timers.ts` 70.4 %, `world/textures.ts` 76.5 %** — named as phase-3
  targets and only partly reached. Their remainders are device-bound (cube-face render, timestamp
  resolve/readback, texture array upload); the probe in particular is judged by an on/off A/B in the
  bench, never by a unit test.
- **Two unreachable defensive branches in `ifp-sampler`** — a `!positions` guard the caller already
  gates, and `|| 1` zero-span fallbacks that ascending keyframe times can never trigger. Untestable
  rather than untested.

---

## Close-out addendum (2026-07-18, after the plan's own defects were fixed)

The four defects above were fixed the same session, in their own commit —
[open-issues/fixed/physics-collider-defects.md](../../open-issues/fixed/physics-collider-defects.md) is the
record. Two regression tests came with them (the `createFalling` box fallback, asserted by BEHAVIOUR: the
prop lands, not merely "no throw"), which is why the final numbers sit two tests above the phase-5 row:

| Date       | What                                | Statements  | Branches    | Functions   | Lines       | Note                                      |
| ---------- | ----------------------------------- | ----------- | ----------- | ----------- | ----------- | ----------------------------------------- |
| 2026-07-18 | the four defect fixes + regressions | **88.18 %** | **78.57 %** | **90.72 %** | **88.12 %** | suite 300 files / **2 100** tests, e2e 24 |

**What this plan is worth remembering for**, beyond the number:

1. **The seam beat the refactor.** The plan's own phase 4 (extract logic out of `engine.ts`) was written
   as the fallback and turned out to be unnecessary — a recording device stand-in reached everything that
   mattered, with zero product-source changes to a renderer that had shipped days earlier.
2. **Recording defects unpatched, then fixing them separately, worked.** Four were found; had they been
   patched inside the coverage commits, a failure afterwards would have been un-attributable.
3. **Writing tests for untested code is a defect-finding technique, not just a coverage exercise.** The
   `createFalling` crash had no field report against it — nobody was looking.
