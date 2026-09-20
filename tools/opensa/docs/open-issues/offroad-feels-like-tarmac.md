# Off-road grip is applied, and still feels like tarmac

**Status: shelved 2026-07-27 by the field's own call, after the mechanism was shipped and verified.**
The engine reads what a wheel stands on and scales its grip by it ([081/10](../plans/081-vehicle-physics/10-surface-types.md));
what is missing is everything ELSE the original does to a car on soft ground. Nothing here is broken — the
gap is that a grip CEILING is invisible until you are at it.

## The symptom, in the field's words

Paraphrased, two rounds on the same day: *"drove on grass — no real difference from tarmac"*, then
*"drove on sand too, no effect, tried several cars"*, and finally, with the readout open, *"maybe a very
small difference, almost unnoticeable"*.

## What was verified, so nobody re-diagnoses it

The F2 Physics panel names the ground under each wheel and the share of tarmac grip it gives. The field's own
capture of it, standing on grass:

```
FR ● ████░░░░░░ 5.0kN 0.00 p_grassmid1 ×0.71
RL ● ████░░░░░░ 4.3kN 0.00 p_grassmid1 ×0.71
FL ● █░░░░░░░░░ 2.4kN 0.00 p_grassmid1 ×0.71
RR ● █░░░░░░░░░ 2.1kN 0.00 p_grassmid1 ×0.71
```

So the chain works end to end: the collision material reaches the physics, the surface is resolved, the
factor is applied, and the steering limiter is given the same number. **This is not a plumbing bug.**

And the effect IS large where a ceiling can show — measured on the `grass-corner` lap (comet, `?surfGrip=0`
against the default, `docs/benchmarks/vehicle-physics/2026-07-27-headless-grasscorner-{off,on}-comet.json`):

| signal             | tarmac-only | surface grip      |
| ------------------ | ----------- | ----------------- |
| top speed          | 71.9 km/h   | **52.7** (−27 %)  |
| settled yaw rate   | 34.8 °/s    | **21.7** (−38 %)  |
| heading come round | −272°       | **−186°**         |

## Why it still feels the same

**A grip ceiling only matters when the tyre is against it.** That lap is at the limit: full throttle plus a
held 0.4 of steer. Ordinary driving on grass — part throttle, a gentle line — never asks the tyre for more
than 0.71 of tarmac's budget, so nothing changes and nothing should.

**In SA, what makes soft ground FEEL soft is not that cell.** Three mechanisms the original has and this
engine does not read at all:

- **`SAND`** in `surfinfo.dat`, whose own legend reads *"is sand (car tyres sink in and can get bogged
  down)"* — a rolling resistance, felt at EVERY speed rather than only at the limit. 12 surfaces set it.
- **`ROUGHNESS`** (0–3) — the ride over uneven ground (SA drives pad vibration off it).
- **`bOffroadAbility`** in `handling.cfg` — the per-car differentiator that should make an offroader keep
  what a sports car loses. Unread, like the two above.

## The options, and what each costs

1. **Leave it** (chosen 2026-07-27). Data-faithful, costs nothing, and it does show up where a ceiling
   shows up: launches, hard cornering and braking distances off-road. The field's call was that this is fine
   for now.
2. **Port the missing mechanisms** — the honest fix, and the one that would answer the complaint: dig SA's
   own sand/roughness handling out of the reversed source FIRST (repo rule: the game's formula before our
   constant), then derive rolling resistance from the `SAND` flag and ride from `ROUGHNESS`, differentiated
   by `bOffroadAbility`. It touches nothing on tarmac, so it does not re-open the fleet-wide-longitudinal
   line 081/09 drew.
3. **Bend the number** — exaggerate the off-road loss (a power on the factor, or a scale on the non-ROAD
   groups) behind a session dial like `?gripVd`/`?gripCap`. Fast, tunable in the field, and the weakest:
   this project has twice rejected global multipliers, and a bend here is a constant standing in for the
   three mechanisms above.

**Read before reopening**: much SA ground that looks off-road is adhesion group **ROAD** — `dirt` and
`dirttrack` both are, and 73 of the 179 surfaces — so `×1.00` on a dirt track is the correct answer, not a
defect. The rubber row is road 4.5 · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8.

Instruments that already exist: the F2 readout above, the `grass-corner` scene (starts ON grass and never
leaves it), and `?surfGrip=0` for a one-URL A/B that every capture records for itself.

**The wet half of the same seam lives elsewhere**: `WET_GRIP` is parsed and reaches the physics, but there is
no rain in the engine to be wet from, so the rule moved to
[roadmap 0.5.0 / 05 rain, piece 9](../roadmap/0.5.0/plans/05-weather-rain/readme.md). Whoever implements it
should read this page first — a wet road is the same shape of change and will meet the same verdict unless it
arrives with the visuals and, if the field asks, the mechanisms above.
