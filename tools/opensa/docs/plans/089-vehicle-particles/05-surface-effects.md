# 089/05 — Surface-driven wheel effects

**Status: SHIPPED 2026-07-28** (branch `089-05-surface-effects`), awaiting the field verdict — the chain's
last step, closing the plan's code work.

## Shape

- **The dispatch is the original's, verbatim in structure**: surface id under each wheel (081/10's
  `readVehicleWheelSurfaces` — one short ray per contacting wheel, priced in 081/07 §3, driven car only)
  → the surfinfo row's own `W_*` flag → the effect class, exactly `CVehicle::AddWheelDirtAndWater`'s
  routing. A mod that flags a surface gets the effect with no code change; tarmac has no flag and stays
  silent at any speed.
- **Rolling throws, sliding throws harder** — the part that sells a surface change: a dirt road dusts at
  speed with zero slide (drive term = ground speed), and a slide on the same surface doubles in
  (`SLIDE_WEIGHT`), through the shared `equivalentSlideSpeed`.
- **Class → look** (`vehicle-surface-fx.system.ts` + the host table): dust/grass/gravel/mud ride
  `prt_wheeldirt` (the stock fxp ships no wheel-grass system — one earth family, told apart by
  opacity/life), sand rides `prt_sand` (a bullet plume by authorship — the lane's new per-system
  `sizeScale` shrinks it 0.35×). All numbers are an eye-fit → `docs/hacks/surface-fx-fit.md`, including
  the honest gap: no ground-brightness tint (the lane has per-spawn alpha, not per-spawn colour).

## Field round 2: white smoke on grass

The puffs rendered WHITE because that is what the data says: prt_wheeldirt's authored colour envelope is
pure white and its texture neutral grey — in SA the earth colour arrives PER SPAWN (`FxPrtMult_c`'s
colour, derived from the ground), a channel the lane does not have. The stand-in: the lane's library
entries grew `tint` (and `alias`, so one fxp system registers per class) — `wheeldirt-dust/-grass/-mud`
carry earthy per-class tints, prt_sand a sandy one. Per class, not per ground — the residual gap and the
retirement path (a per-spawn colour channel) are in the hack doc.

## Field round 1: the snowflakes on asphalt

`W_SPRAY` turned out to be set on `default` and EVERY `tarmac*` row — in SA it means "spray when the road
is WET" (`CWeather` wetness gates the read), and round 0 read it unconditionally: every road at speed
threw additive white splashes ("white snowflakes on asphalt"). Fix: the classifier (`surfaceFxClassOf`,
now a pure exported function) does not read `wheelSpray` at all — the game tracks no road wetness, so
there is nothing honest to gate on. A test pins REAL tarmac's flags mapping to silence; spray returns
with a wet-roads state.

## Verification

- **Tests** (`vehicle-surface-fx.system.test.ts`, negative first): on foot / gate off / tarmac at any
  speed / airborne wheels / crawling below the throw threshold / unknown surface id — all silent;
  rolling fast on dirt dusts with NO slide at the contact point, the surface picks the class
  (beach → sand, ford → spray), a slide throws harder than rolling at the same speed.
- **Headless grass-corner lap**: a subtle dust trail follows the car through the grass corner.

## Open / next

- Ground-brightness tint (the original's colour term) needs a per-spawn colour channel the lane does not
  have — a real layout cost, deferred until the look demands it.
- Wheel SPRAY needs a wet-roads state (rain exists as weather ids only) — deferred with it.
- Skid-mark TYPE by surface (`skidmark` column: DEFAULT/SANDY/MUDDY) is still open — the rubber ribbon
  currently lays on every surface; the sandy/muddy variants want their own textures and, ideally, the
  same shared per-step surface read.
- The plan-level ACCEPTANCE drive across all five steps is the remaining item before the plan closes.
