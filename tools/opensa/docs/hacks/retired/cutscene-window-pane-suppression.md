**RETIRED 2026-08-14.** Replaced by `asi/perfect-cutscene`'s entity-level deferral
([plan 001](../../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md) step 3, commit on the
`asi-perfect-cutscene` branch).

The honest version turned out to be one repointed call. Gameplay vehicles never render in the scan-order
pass at all: `CRenderer::RenderEverythingBarRoads` hands them to `CVisibilityPlugins::InsertEntityIntoSortedList`
and `RenderFadingInEntities` draws the list back-to-front after the whole pass, so their glass has nothing
left to erase. A `CCutsceneObject` is an OBJECT and misses that road entirely — so the ASI sends cutscene
cars down it too, and the draw-order roulette this hack was cut to survive stops existing. The hack cost
two of twenty-three slots their window tint; the fix costs none, and it covers the sixteen sweep scenes
that had not been run yet rather than growing a slot at a time.

How far off was the hack? Not wrong about the MECHANISM — its write-up named z-write and the sector-scan
order correctly — but wrong about the ceiling: it assumed no data-side or engine-side control over draw
order was available, and there was one, sitting in the engine's own vehicle path.

---

# Cutscene window-pane suppression (per slot, field-calibrated)

**What it is.** Converted cutscene vehicles on the slots listed in `PANE_SUPPRESSED_SLOTS`
(`tools/vehicle-cutscene/src/census.ts`; currently `csgreenwood`) drop their WINDOW-glass class
entirely: after the mixed-geometry split isolates windows into their own atomics, those atomics are
not emitted (`finalizeAtomics`, plan 004 round 17). Windscreen, side, rear-door and rear panes all go
together — the car rides "unglazed", exactly how R*'s own cutscene cars look. Lamp lenses, signal
glass, decals and every opaque surface stay untouched.

**What it stands in for.** Control over the scene's ENTITY DRAW ORDER, which the 2004 cutscene path
does not offer. Scene actors (peds) are separate cutscene objects; the renderer draws entities in
world-sector scan order — a per-scene accident of positions and camera that no model data reaches. A
rendered window pane z-writes, so it ERASES every actor drawn after the car; gameplay solves this
with `RenderDriverAndPassengers` + a deferred per-atomic alpha pass, but that choreography exists
only for `CVehicle` entities — a `CCutsceneObject` is not one. R*'s authored answer, measured across
the vanilla fleet, is that cutscene window glass effectively never renders (door glass absent, the
rest below the alpha-test band) — actors win over glass.

**What it was judged on.** The plan 004 round 17 field chain (RIOT_4B): with our correctly-placed
tint the greenwood's passengers vanished behind every pane and reappeared only in the door gaps;
the vanilla A/B showed both peds through every window; the r12 build "worked" only because its glass
stood misplaced (the round-15 rotation bug) and covered nothing. Scenes that WON the draw-order
roulette (PROLOG1's taxi driver, PROLOG3's cops, FINAL2B) keep glass over actors just fine — which is
why suppression is per-slot, not fleet-wide: the user chose to keep the better-than-vanilla tint
where the field proves it safe (option C, 2026-08-14).

**Why per SLOT is not a per-model hardcode.** The failing property belongs to the slot's SCENES
(their entity draw order), not to the installed mod: any mod dropped into the greenwood slot plays
the same scenes with the same order and needs the same treatment. The set is field-calibrated —
a slot enters it when a scene shows actors erased behind its glass.

**What would retire it.** Any control over the order or the z-write: an ASI hook ordering cutscene
entities (actors before vehicles), a patched cutscene render path with a deferred alpha pass, or
OpenSA's own cutscene player (which sorts transparency properly and never needs this). Then the set
empties and window glass returns fleet-wide. **The retirement is planned:
[`asi/perfect-cutscene` plan 001](../../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md)
defers cutscene-vehicle alpha atomics into the engine's sorted pass; its step 5 moves this file to
`retired/` and step 6 re-sweeps the whole plan-004 ledger.**

**Blast radius.** The listed slots' converted models lose all window tint in cutscenes (they look
vanilla-authentic instead of better-than-vanilla); their unreferenced pane geometries stay in the
DFF as a few KB of dead bytes (pruning would renumber every atomic). Scenes of unlisted slots keep
the roulette: a future scene may still erase actors behind an unlisted slot's glass — the field
sweep is the detector, and the fix is one slot name added to the set.
