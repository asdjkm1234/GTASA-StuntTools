# Audit — `cleo/scripts` 001, the authored rhino track script (2026-08-07)

One plan, executed end to end in a single session: recover the original's math, author a replacement
on the SDK, ship it, field it. What it actually cost and bought, and where the coverage is still
thin.

## What changed

| Area | Change |
| --- | --- |
| `cleo/scripts/rhino-tracks/` | NEW — the authored script (2 628 B artifact), story test, integration test |
| `packages/cleo` | native-call argument order fixed (`0AA5`-`0AA8` were reversed); `partForward` test option on the recording host |
| `packages/game` | wheel parts now report their DRAWN pose to scripts, not a bind-pose shadow |
| `packages/renderware` | `axleScale` → `wheelFit`: a zero-width MARKER wheel is no longer normalised, and the physics radius is decoupled from the visual scale |
| docs | `edge-cases/cleo-vm.md` (new), `hacks/cleo-track-link-hide.md` (new), `contracts/vehicles.md` (tracked-vehicle names + marker wheel), `hacks/cleo-frame-sibling-order.md` (judged-on corrected), 097/07 defect row closed |

## What it bought

Measured, 60 ticks, same harness for both:

| | avg instr/tick | peak | effects / 60 f |
| --- | --- | --- | --- |
| ours, one tank in range | **241** | **245** | **1 298** |
| ours, no cars | **11** | **11** | 0 |
| the original, its best case | 1 312 | 1 334 | 236 |
| the original, on the REAL rig | 1 275 | 1 297 | **0** |

**5.4x cheaper at peak, 114x cheaper in the frame with no tank in it** (the frame the player is in
essentially always — the original paid a 139-slot pool walk unconditionally), artifact **2 628 B vs
34 114 B**, and two defects of the original fixed rather than reproduced: a parked tank showed no
tread at all (the ladder's windows left `270 = 15 x 18` uncovered), and links were hidden by
teleporting them to −1e35. Field-confirmed on OpenSA and, by the user, under real CLEO in Wine.

## What it cost

The script was the small half. **Three defects underneath it had to be fixed first, and not one was
findable from the script side:**

1. `0AA5`-`0AA8` marshalled arguments in the script's order, not the C order — every multi-parameter
   native call was reversed. Silent: the only other corpus consumer is shape-matched and worked by
   accident.
2. The engine published no live wheel roll into script-visible part state, so any script reading a
   wheel frame read a constant. The tread could never have advanced.
3. The wheel-fitting rule inflated this model's flat MARKER wheel 23.5x and drew six half-metre
   shards sweeping with the wheels.

Two of those three are engine bugs with a blast radius far beyond this script, and (2) and (3) were
already live for every user before any of this work — they were simply invisible until something
asked the engine a question it had never been asked.

**Three field rounds** were spent, and the first one was wasted: the artifact had never been placed
into `build/original/opensa/cleo/`, so the run tested the author's script. Cost: one full round-trip
and a wrong attribution in the ledger. The lesson is the one already in the repo — a capture must
say what it was configured with — applied to placement, not just parameters.

## Coverage: what is now guarded, and what still is not

Added this session:

- `packages/cleo/src/vm/handlers/natives.test.ts` — the argument order, on rhino's own call shape.
  Verified to bite: 3 of its 4 tests fail with the fix reverted.
- `engine-vehicle-handle.test.ts` — a wheel reports its drawn pose. Verified to fail when reverted.
- `build-vehicle-model.test.ts` — a zero-width marker stays unscaled AND keeps its ide radius.
- `cleo/scripts/rhino-tracks/story.test.ts` — 9 tests, the script's own logic.
- **`cleo/scripts/rhino-tracks/integration.test.ts` — NEW and the one that matters**: our compiled
  artifact, on the VM, over the part list of the REAL model (`fixtures/original/vehicles/rhino.dff`,
  added to the fixture manifest). It also pins the ORIGINAL doing nothing on that rig, so the whole
  001 diagnosis has a regression guard.

Still thin, stated rather than implied:

- **The story test still proves less than it looks.** It drives the recording host, whose
  `partForward` is a value the test itself supplies — an option added in step 3 to make the test
  possible, which is precisely what let the field defect through. It is a logic test, not evidence
  about the runtime. The integration test is the one to extend when this script changes.
- **No test covers the CLEO→engine seam end to end.** `engine-cleo-setup.ts` wires
  `NativeWorld.partForward` to the handle; both sides are now tested, the wiring between them is
  not. A defect there would look exactly like the one we shipped.
- **Nothing exercises a rebuilt pak.** All model assertions run through `buildVehicleModel` from a
  DFF; the `.osm` path that the game actually loads is verified only by hand (`dump-osm.ts`).
- **No benchmark row.** The instruction counts above are VM-side and recorded here and in the plan
  ledger, but nothing went into `docs/benchmarks/` because no frame-time measurement was taken —
  the script's cost is far below the noise floor of the standard bench scene, so a row would be
  noise. Recorded as a decision, not an oversight.

## The corpus nearly lost its subject — found and closed here

`mods-src/original/vehicles/rhino - GTA 5 Rhino - _F_/cleo/` now contains OUR `rhino-tracks.cs` and
no longer the author's `rhino tracks.cs`: what was waived as step 4 was in effect done by editing the
mod source, so the plan's stated invariant ("the author's mod in `mods-src/` stays byte-untouched")
no longer holds. That is a shipping decision, not a defect — but it silently took a fixture with it.

**`npm run test:fixtures` began reporting `fixtures/original/cleo/rhino.cs` MISSING**, and the corpus
decode and trace tests kept passing only because a stale local copy survived: the exact "stale
fixture masks a missing source" trap the manifest's own comment warns about, and one a fresh
checkout would have discovered instead of us.

Closed 2026-08-07 (user's call): the pristine script is COMMITTED at `fixtures/custom/cleo/rhino.cs`
(sha1 `41f0e33d…`) and the manifest reads it from there through a new `committed` fixture type. A
corpus subject may no longer depend on a mod folder that can be edited under it. Verified by
DELETING the stale `fixtures/original/` copy and regenerating — 96/96, no MISSING — because asserting
against the stale file is the same mistake one level up.

## Follow-on work this raised

Two sub-plans filed into 098 from the same field round, both tank-shaped symptoms with model-derived
causes: [09 tracked chassis](../plans/098-all-land-vehicles/09-tracked-chassis.md) (the track
overhangs its support by ~1.2 m at each end; the middle wheels sit 0.518 m too high to touch
anything) and [10 high entry boarding](../plans/098-all-land-vehicles/10-high-entry-boarding.md)
(the door hinge is 1.82 m above the ground plane).
