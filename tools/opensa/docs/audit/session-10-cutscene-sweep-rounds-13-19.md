# Session 10 (2026-08-14): plan-004 sweep rows 11–17 — seven rounds, two runtime laws, the ASI fork

**What closed:** seven ledger rows — FINAL2B, GARAG3A, HEIST8A, RIOT_4B, RIOT4E1, SMOKE1B, SWEET2B
(plan 004 now 17/35 ✅) — through fix rounds 13–17, plus rounds 18–19 measured to root cause and
deferred, with the user's decision, into a NEW project: the
[`asi/perfect-cutscene`](../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md)
engine patch. Rows 20–35 are deferred to the post-ASI final sweep (every model already field-shown
at least once); the plan carries a standing addendum that the ASI re-opens every ✅ row.

## What it cost

Seven fix rounds, ~8 fleet rebuilds, ~10 bottle installs, one five-run field bisect (the invisible
passengers: r15 → vanilla → r12 → r13-14 → no-split diagnostic), two shallow-source dives into
gta-reversed, one diagnostic env-flag build (never committed). One instrument false trail: three
offline "runtime models" were self-consistent and wrong before the law-replay simulator reproduced
the field pixel-for-pixel — the session's biggest time sink and its best new tool
(`scripts/debug/cutscene-anim-replay.ts`).

## What it bought — two RUNTIME laws of the original engine (both from gta-reversed + field)

1. **The rotation law (round 15, `docs/gta-sa-original/cutscenes.md`):** on an animated cutscene
   clump the runtime rewrites EVERY frame's local rotation each tick — bound frames get the summed
   anim quaternion, unbound frames a zero quat that `Normalise` turns into IDENTITY; only the
   position snapshot survives. A rotation in a `_pv`/`_ad` frame is silently erased while every
   offline view shows it. Emit model v4: un-animated frames carry TRANSLATION ONLY; the rotation
   residual bakes into vertices (`emitTargetedAtomic`, reviving the gate-4 bake). 22/23 DFFs changed
   — steering wheels and exhausts had rendered un-tilted all along. Fixed HEIST8A's securica
   standing on its tail (the one vanilla rig with rotated bones); the user's field bonus: specular
   improved fleet-wide (the bakes fixed normals too).
2. **The entity-order roulette (rounds 17–18, `docs/hacks/retired/cutscene-window-pane-suppression.md`):**
   scene actors are separate cutscene objects drawn in world-sector scan order; a rendered window
   pane z-writes and ERASES actors drawn after the car. Gameplay's driver-then-body-then-sorted-alpha
   choreography exists only for CVehicle entities. Field-proven both ways: PROLOG1/PROLOG3/FINAL2B
   win the order, RIOT_4B/SYND_3A lose it. R*'s authored answer: vanilla cutscene window glass
   effectively never renders. Every past "glass + actors" success of ours was an accident (the
   blessed-six pipe dropping glass, or the pre-round-15 rotation bug holding glass off the windows).

Plus the supporting recoveries: the entity alpha-test ref 140 (`0x553AA0`), the six force-piped
cutscene vehicles (`0x8D0F68`: csvoodoo, csfirela, csmothership, csbravura, cscopcarsf,
cscopcarla92 — read out of the exe's static data), and the wheel-stash hide (round 19: SYND_4A
animates every wheel+axis channel to ~zero and lets the vanilla body + ground conceal the wheels —
unfixable in static data because one shim must serve two anim poses).

## The fix rounds

- **13 — f_wheel precedence (FINAL2B):** a `f_wheel_*` container wins over the dummy-child mesh (the
  stock fallback VehFuncs replaces; the bravura's was a bare brake disc whose radius sank the whole
  body 0.19 through groundShift — "peds sitting above the cabin"). Displaced fallbacks DROP.
- **14 — mixed-translucency split (FINAL2B):** a geometry carrying opaque + translucent triangles
  splits into an opaque copy (vehicle pipe, normal slot) and a translucent twin (default pipe, pane
  order) — the sabre's in-door glass had cost the whole painted door its shine. Byte-narrow surgery:
  full vertex arrays kept, BinMesh filtered by whole per-material entries (winding preserved), ADC
  never split.
- **15 — the rotation law** (above).
- **16 — wheel corners from the scene anim pose (SMOKE1B):** R*'s csglendale92 binds its LEFT wheels
  crossed front-to-rear versus what every scene animates; corners/locals now come from the anim's
  frame-0 pose (`anim-poses.ts` reads `anim/cuts.img`), bind as fallback, poses only trusted when
  they yield four distinct corners.
- **17 — per-slot window-pane suppression (RIOT_4B):** the user's option C — field-losing slots drop
  their whole window class (csgreenwood; round 18 added cswashington), lenses untouched, slot-keyed
  and mod-agnostic. Recorded as a HACK with its retirement path = the ASI.
- **18–19 — measured, deferred:** SYND_3A (eraser persists — raced install or lens-class glass) and
  SYND_4A (the wheel stash) are the ASI plan's repro scenes #2 and #3.

## The fork taken

The user weighed "no window glass anywhere, like R*" against "keep the better-than-vanilla tint and
lose actors in order-losing scenes" and chose the field-calibrated hybrid now, with the real fix as
an engine patch next: `asi/perfect-cutscene` (second consumer of `asi/sdk`) defers cutscene-vehicle
translucent atomics into the engine's sorted alpha pass and conceals stashed wheels — retiring the
suppression hack, returning tint fleet-wide (blessed six included), and re-opening all 35 ledger
rows for the final acceptance sweep. Plan 001 is written with three standing repro scenes
(RIOT_4B, SYND_3A, SYND_4A) and ends with pmb packaging.

## Addendum (same day): round 20 — the wheel stash sank in scene data

The user pushed back on routing the SYND_4A wheel stash into the ASI — rightly. The second look
found the stash signal clean (only `wheel*` channels go to the origin; the `Axis_*` hubs hold the
corners, the authored bare-hub look) and a fleet scan found exactly ONE stash site in all 148
scenes. Round 20 fixed it in DATA: the installer ships a surgically sunk `anim/cuts.img`
(`stash-patch.ts`, wheel-stash channels to z −0.6, corner-bind guarded so driving scenes never
match). The ASI plan dropped its wheel payload and stays alpha-only; delivery grew by
`anim/cuts.img` (+ `.vanilla` for the A/B). Round 19's "no static fix exists" is recorded as
superseded — the model data cannot fix it, the scene data can. Suite 91/91. Field re-check PASSED
the same day ("wheels gone — excellent, no bugs"): SYND_4A ✅, the sweep stands at 18/35 with
SYND_3A the one ASI-deferred row before the final acceptance re-sweep.

## State at close

Suite 88/88 (four new tests this session: securica law golden, glendale anim-pose golden, split
suite, suppression golden); fleet 23/23, verify green (317 DFFs, 0 duplicate channels); bottle runs
the round-18 build; canonical `NO_COMMIT/cs-mods-plates`, rotation aside
(`-presplit/-prerotlaw/-prewheelpose/-prepanedrop/-prewashpane` + the uncommitted `cs-diag-nosplit`).
New real fixtures: cssecurica92/securica DFFs, smoke1b.ifp. New kept instrument:
`cutscene-anim-replay.ts` (the runtime-law pose simulator — calibrate on vanilla first).
