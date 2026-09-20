# SCRASH2 — a model of the LOCATION is missing

**Status: 🔴 open, reported 2026-08-15, not investigated.** Deliberately shelved: it surfaced during
the plan-004 cutscene sweep, and it is NOT a `vehicle-cutscene` defect — the car in that scene passed
its row ("excellent"). What is wrong is the world the scene plays in: a model of the location is not
there. Suspected to be mod-introduced.

## The symptom

Running `SCRASH2` through the cutscene-override instrument, part of the scenery is missing. The
vehicle, its paint, its glass and its lamps are all correct — this is the map, not the fleet.

## What is already known (measured, before anyone starts)

- **The site is the Doherty garage, San Fierro** — `SCRASH2` warps to `(−2057.07, 150.74, 27.838)`,
  and **twelve scenes share that exact site**: `GARAG1B`, `GARAG1C`, `GARAG3A`, `SCRASH1`, `SCRASH2`,
  `STEAL_1`, `STEAL_2`, `STEAL_4`, `STEAL_5`, `SYND_2A`, `SYND_4A`, `SYND_7`.
- **Five of those twelve PASSED on the same build, the same day** — `GARAG3A`, `STEAL_2`, `STEAL_4`,
  `STEAL_5`, `SYND_4A` — so "the Doherty location is broken" is already ruled out as stated. Whatever
  is missing is either something only SCRASH2's camera looks at, or something that depends on how the
  scene is entered.
- **The interior AREA differs across them and splits the passing set**: `SCRASH2` and `GARAG3A` play
  in area **0** (outside), while `STEAL_2/4/5` and `SYND_4A` play in area **1** (the garage interior).
  GARAG3A is therefore the important control — same site, same area, passed. Compare what the two
  cameras actually frame before assuming a missing model at all.
- The build under test was the accepted cutscene fleet (round 23 + plan 005) with
  `perfect-cutscene.asi`. None of that touches map models.

## How to investigate (the user's method, written down so it is not re-derived)

1. **The instrument is the CLEO cutscene override**, not story progression: write
   `scene = SCRASH2` into the `[cutscene]` block of the bottle's `CLEO/cutscene-override.ini` and
   start a new game (or load a save) — ~15 s to a verdict, no story progression needed.
   Its generator is `scripts/debug/cutscene-override-ini.ts`; the `[areas]` and `[sitex/y/z]` tables
   in that ini are what warp the player so the world streams around the scene.
2. **Run it BEFORE and AFTER the mods**, which is the whole A/B: a game built with no map mods against
   the current install. If the model is present without mods, a mod removed or replaced it.
3. **Then bisect the mods to the one that changes that location.** The user's recollection is that the
   suspect is named something like *Doherty* — unconfirmed, and no mod folder in
   `mods-src/original/mods` currently carries that word, so treat the name as a hint and not a lead.

## The trap this investigation WILL walk into

**A mod bisection without a negative control finds culprits that are not culprits.** It already
happened once on this project — see the `sa-world-loads-only-lods` row in
[README.md](README.md), where a bisection "found" a mod that a one-file mod then reproduced. Whatever
the bisect points at, re-run with that mod ALONE and with it REMOVED before believing it.

Second trap, from the same neighbourhood: a mod's `Remove original/` folder may hold empty-clump
REPLACEMENTS rather than a delete list ([mod-installer plan
010](../../tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md)) — which is exactly
the shape of "a model of the location is missing". `install()` now throws on a declared-and-placed
model with no loadable DFF, so that specific failure should no longer reach a build silently; if this
one did, that guard has a hole worth finding.

## Related

- The field run that surfaced it: [`vehicle-cutscene` plan
  004](../../tools/vehicle-cutscene/docs/plans/004-full-scene-field-review.md) (CLOSED, 35/35 — the
  VEHICLE side of SCRASH2 is signed off).
- The override instrument: `cleo/scripts` plan 003, and `docs/debug/README.md`'s
  `cutscene-override-ini.ts` / `cutscene-scm-sites.ts` rows.
