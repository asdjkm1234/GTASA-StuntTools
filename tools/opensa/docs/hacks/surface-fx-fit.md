# Surface-FX fit

**Live.** Taken 2026-07-28 with plan 089/05 (surface-driven wheel effects).

## What it is

`packages/game/src/vehicle/vehicle-surface-fx.system.ts` and the look table + system routing in
`apps/web/src/ui/engine-vehicles.ts` / `engine-particles.ts`:

```ts
const DRIVE_START = 4;   // ground speed (m/s) where a flagged surface starts throwing
const DRIVE_FULL = 20;   // …and where it throws hardest
const SLIDE_WEIGHT = 2;  // a sliding wheel works the surface twice as hard as a rolling one
const RATE = 10;         // puffs per wheel per second at full intensity
// class → look (alpha at full ~0.6–1.0× these, life as a share of the authored envelope):
dust/gravel → wheeldirt-dust (tint .62/.54/.42) · grass → wheeldirt-grass (.45/.5/.3)
mud → wheeldirt-mud (.4/.32/.22) — three lane ALIASES of the same prt_wheeldirt
sand → prt_sand (tint .82/.72/.52, sizeScale 0.35 — authored as a BULLET plume, 8–13 m)
alphas .16–.22, lives .3–.4 of the authored envelope
```

**Spray is deliberately absent.** `W_SPRAY` is set on `default` and every `tarmac*` surfinfo row: in SA it
means "spray when the road is WET" (`CWeather` wetness gates it), and this game tracks no road wetness.
Read unconditionally it sprayed every road — field round 1's "white snowflakes on asphalt". The rule is
pinned by a test on `surfaceFxClassOf` and spray returns WITH a wet-roads state, not before.

## What it stands in for

`CFx::AddWheelGrass/Gravel/Mud/Dust/Sand/Spray` — the same unrecoverable stubs as every wheel effect. What
is NOT fitted: the DISPATCH. Surface → class comes from surfinfo.dat's own `W_*` columns (read since
081/10), which is exactly `CVehicle::AddWheelDirtAndWater`'s routing — a mod that flags a surface gets the
effect with no code change.

Two knowingly-taken substitutions inside the fit:

- **grass/gravel/mud ride `prt_wheeldirt`** — the stock fxp ships no wheel-grass system (SA's grass
  clippings are a different mechanism entirely), and dedicated gravel/mud systems were not identified.
  One dusty puff family for all four earth classes, told apart by opacity/life only.
- **Per-CLASS tint instead of per-GROUND colour** (field round 2: "white smoke on grass — the original
  is dirt-coloured"). SA passes a ground-derived colour into every `prt_*` spawn (`FxPrtMult_c`) — the
  systems themselves are authored pure WHITE (measured: prt_wheeldirt's envelope is 255³ and
  smokeii_3/bullethitsmoke are neutral grey), so unpainted they render as white smoke. The lane has
  per-spawn alpha but no per-spawn colour, so the tint is baked per class ALIAS at library build
  (`wheeldirt-dust/-grass/-mud`). The residual gap: within one class, dark soil and light soil throw the
  same colour.

## What it was judged on

The headless grass-corner lap: a subtle dust trail follows the car through the grass corner, silent on
tarmac and below ~4 m/s. Field verdict may move every number.

## What would retire it

Recovered `CFx::AddWheel*` parameters; a per-spawn colour channel in the lane (a second fraction-encoded
attribute would need a layout change — that one is a real cost) would retire the no-tint substitution;
dedicated fxp systems per class would retire the wheeldirt sharing.

## Blast radius

Surface effects only. The dispatch (surfinfo flags) is shared truth; retuning the look table moves nothing
else. `sizeScale` in `DYNAMIC_SYSTEMS` also affects any FUTURE user of prt_sand/prt_splash through the
dynamic lane — the scale is per-system, not per-caller.
