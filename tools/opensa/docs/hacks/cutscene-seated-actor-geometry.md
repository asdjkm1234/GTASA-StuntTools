# The seated-actor test is a box, a spread and three thresholds

**Taken 2026-08-15, `tools/vehicle-cutscene/src/seat-patch.ts` + `seats.ts` (plan 005).**

## What it stands in for

"Is this cutscene actor RIDING that car, and in which seat?" — a question **the original game never
asks**, because it never needs to: R\* authored each actor's absolute position by hand, against their
own car. There is no SA formula to recover here, so nothing to dig out of the reversed source. The
question exists only because we retarget those positions onto a mod donor's own seat, and it has to be
answered from the scene's animation data alone.

So the answer is geometric, and every number in it is judged rather than derived:

| Constant | Value | What it is |
| --- | --- | --- |
| `CABIN` | x 1.3, y 2.2, z 1.0 m | The box around the car's root an actor must sit inside to count as riding it. Eyeballed to fit a saloon generously. |
| `MAX_SPREAD` | 0.12 m | Above this the offset is drifting rather than riding. Chosen from the measured fleet: the four real seated actors spread 0.058–0.092, the nearest non-rider is well past it. |
| `MIN_FRAMES` | 30 | Too short a pair to judge at all. |
| `MATCH_TOLERANCE` | 0.35 m | How far an actor's mean offset may sit from a seat point and still be that seat (x/y only). The worst measured y drift is 0.12 m against x agreement inside 0.02 m. |
| `MIN_CORRECTION` | 0.05 m | Below this nothing is applied. **The one number with a real derivation**: R\* placed the actors at the stock car's own `ped_frontseat` to within 0.03 m, so a smaller delta is indistinguishable from the authoring's noise. |

The per-frame ramp is NOT in this ledger — it has no tunable window: it is built from the scene's own
cabin mask, so the transition is where the data says it is.

## What it was judged on

Field runs, and the measured distribution over the whole fleet rather than one car. On the current
23-model fleet the whole apparatus resolves to **exactly one site** (`smoke2b.ifp`, both occupants),
with the mothership's `csmstand` prop rejected by the skinned-clump test and PROLOG1's `csstew`
rejected by `MATCH_TOLERANCE` — both correctly, both checked by eye against what those scenes do.
SMOKE2B and its two regression scenes were field-accepted the same day.

## What would retire it

Nothing in SA — there is no better source. What WOULD retire it is a change of question: if the
converter ever emitted its own scene data instead of patching R\*'s, the seat would simply be authored
and no classifier would be needed. Short of that, the honest improvement is to stop guessing the cabin
and read the DONOR's own cabin bounds (its interior/seat geometry is already parsed) instead of a
fixed box.

## What else moves if it changes

- Loosening `CABIN` or `MATCH_TOLERANCE` risks matching a prop or a bystander to a seat — the failure
  mode already seen once, when a prop was lifted 1.6 m before the skinned-clump test was added.
- Tightening `MIN_CORRECTION` starts moving actors in scenes nobody complained about (FINAL2B's pair
  sit 0.03 m from their donor seat and are deliberately untouched).
- `MAX_SPREAD` and `MIN_FRAMES` also gate `scripts/debug/cutscene-seated-actors.ts`, which IMPORTS
  them — the census view cannot drift from the patch, but it does move with it.

**Guarded?** Partly, and the gaps are the point. `seat-patch.test.ts` pins the ride judgement and the
ramp on synthetic tracks, and the build PRINTS every site it patches (`actor seated on the donor's own
seat: …`), so a new match cannot land silently. What nothing catches is a threshold that is merely
WRONG for a scene nobody runs: the classifier fails by staying quiet, and only the field sees it.
