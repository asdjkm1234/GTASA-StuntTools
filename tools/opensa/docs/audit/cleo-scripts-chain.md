# Audit — the `cleo/scripts` chain: two authored replacements, one of which should never have existed

The chain set out to replace the two shipping corpus scripts with our own, authored on the SDK, as a
standing conformance test of the VM against real CLEO. It closed 2026-08-07 with **one script shipped and
one withdrawn**, and the withdrawal is the more useful result.

| | 001 rhino tracks | 002 no_lights |
| --- | --- | --- |
| outcome | **SHIPPED**, field-proven on both runtimes | **WITHDRAWN** — the effect belongs to the model |
| artifact | 2 628 B vs 34 114 B | 237 B vs 19 513 B (built, measured, then deleted) |
| cost in the frame | 5.4× cheaper at peak, **114× with no tank in range** | 19.7× cheaper with a hotring, 32× without one |
| what it really cost | **three engine/VM defects** that had to be fixed first | **one engine defect** that removed the need for it |

## What the chain actually bought

**Not the scripts.** Both were small, correct and measurably better than the originals — and neither is
what the chain is worth. What it bought is that authoring a script against our own VM asks the engine
questions nothing else asks, and every one of those questions found a defect that was already live for
every user:

1. `0AA5`-`0AA8` marshalled native-call arguments in the script's order, not the C order — every
   multi-parameter call was reversed. Silent: the only other corpus consumer is shape-matched.
2. The engine published no live wheel roll into script-visible part state, so any script reading a wheel
   frame read a constant. The rhino's tread could never have advanced.
3. The wheel-fitting rule inflated a model's flat MARKER wheel 23.5×, drawing six half-metre shards that
   swept with the wheels — visible to every player, blamed on the script twice before it was measured.
4. `lampAnchorsOf` invented lamp anchors from the half-extents for any model with no lamp dummy, and took
   a zeroed dummy at face value. That gave headlights to every trailer and aeroplane in the game, and it
   is the whole reason 002 had anything to smash.

Three of the four are engine bugs with a blast radius far beyond CLEO. (4) is the one that ended the chain.

## The withdrawal, and why it is not a failure

002 shipped: engine seam, atlas rows, script, field verdict. Then the user said the effect was not
relevant on original SA any more. Measured rather than accepted:

| | `headlights` | `taillights` | lamp materials |
| --- | --- | --- | --- |
| STOCK `hotring` | real | real | head + tail |
| the installed mod | real | **origin (0,0,0)** | **none of 91 submeshes** |

So the script was correct when written — the stock car authors a full set of lamps — and redundant for the
car actually installed, which authors none. The lights it smashed were **ours**, invented by the fallback.
An asset property belongs in the engine, and the replacement is a rule every model is read through
([098/11](../plans/098-all-land-vehicles/11-model-derived-lamps.md)); the car is dark today because a
12-byte edit to its own DFF says so, with no engine code for it at all.

**Kept from 002, and not wasted:** the light-damage state and the `SetLightStatus`/`GetLightStatus` atlas
rows are SA DATA support, not script support — any CLEO mod smashing lights lands on them, and collision
damage (which SA drives from its light component group, never a model id) is the extension they were built
for. The corpus also gained an 8th decode/re-encode subject.

## What it cost

Seven field rounds across the chain, of which **two were wasted and both for the same reason**: a run that
tested something other than what we thought. Once the artifact had never been placed into the build; once
the diagnosis was aimed at a model property nobody had measured. Both are now standing lessons.

No benchmark row exists for either script, and that is a decision rather than an omission: the VM-side
instruction counts are in the plan ledgers, and both scripts' cost sits far below the noise floor of the
standard bench scene, so a `docs/benchmarks/` row would be noise. The lamp rule changed no measurable
runtime cost — it removes work (fewer lamps emitted), and only for models that should never have had it.

## The pattern, stated once because it recurred three times in two days

001 fixed a tank whose tracks would not move — the engine was not publishing wheel roll. 098/09 and 10
turned two more tank symptoms into model-derived rules instead of per-model special cases. 002 ended by
deleting a script written to remove lights the engine should never have invented.

**Ask what the ENGINE is doing wrong before authoring content that compensates for it.** A per-asset script
is a symptom, and the SDK is at its most valuable when it is being used to find that out.

## Coverage the chain leaves behind

Guarded, each verified to fail when its fix is reverted: native-call argument order
(`packages/cleo/src/vm/handlers/natives.test.ts`), a wheel reporting its DRAWN pose
(`engine-vehicle-handle.test.ts`), a zero-width marker wheel staying unscaled
(`build-vehicle-model.test.ts`), the rhino script over the REAL model's part list
(`cleo/scripts/rhino-tracks/integration.test.ts`), the lamp rule at both the unit and system level
(`vehicle-lamps.test.ts`, `vehicle-lamp.system.test.ts`), and the light-damage mask through to the GPU row
(`engine.lamps.test.ts`).

Still uncovered, stated rather than implied: the CLEO→engine wiring in `engine-cleo-setup.ts` (both sides
tested, the wiring between them not), the `.osm` path the game actually loads for model assertions, and the
WGSL shader gate — nothing in the repo compiles shaders, so the golden snapshot reviews a diff it cannot
validate.
