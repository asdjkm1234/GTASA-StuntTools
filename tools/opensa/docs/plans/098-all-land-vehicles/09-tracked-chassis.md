# 09 — Tracked chassis: ground support that spans the track, not six point wheels

**Goal:** a tracked vehicle rides on its TRACK, not on the handful of wheel dummies its author
happened to place. Field symptom that opened this: driving the Rhino, the tracks intermittently sink
through the ground. Field checkpoint: drive the tank over kerbs, ramps and crests with the track ends
staying on the surface.

**Not a hardcode.** The user's framing was "maybe hardcode a different chassis model for the tank",
and the standing rule refuses it: *"NEVER hardcode a value for a specific car/model/asset — a rule
must DERIVE from what the asset itself carries"* (`CLAUDE.md`, `docs/restrictions/assets-and-data.md`).
Every rule below keys on geometry the model ships, so it applies to any tracked vehicle a modder
builds and to none that is not one. `track_*` already carries behaviour by name
(`docs/contracts/vehicles.md`, added by `cleo/scripts` 001) — this extends the same contract.

## What is measured (2026-08-07, the GTA 5 Rhino's own DFF)

Contact geometry, straight off `buildVehicleModel`:

| Thing | Where |
| --- | --- |
| front wheels | y = **+2.703**, z = −0.349 |
| rear wheels | y = **−2.457**, z = −0.349 |
| "middle" wheels | y = **−3.398**, z = **+0.169** |
| `track_1` mesh | y = **−3.588 … +3.941**, z = −0.866 … +0.454 |

Two findings, and the second is the one that bites:

1. **The middle wheels are mis-authored.** They sit BEHIND the rear pair (−3.398 vs −2.457) and
   **0.518 m higher**. With the built radius (0.65) their contact point is 0.518 m above the other
   four, so they never touch level ground: the tank is really a FOUR-point vehicle.
2. **The track overhangs its support by more than a metre at each end.** Support spans
   y ∈ [−2.457, +2.703] = 5.16 m; the track spans 7.53 m. That leaves **1.24 m unsupported at the
   front and 1.13 m at the rear.** Pitch the hull a few degrees — a kerb, a crest, a ramp — and the
   overhanging ends swing below the surface. Nothing holds them up because nothing is there.

On flat ground the track bottom (−0.866) sits 0.133 m above the contact plane (−0.999), so the
resting pose is fine. This is a PITCH problem, not a ride-height one, which matches "sometimes".

## Design

- **Detect a tracked vehicle from its geometry**, never from a model id or name list: the model
  carries `track_*` mesh parts (the contract 001 established). One boolean on the fixture, derived
  at build time, so the runtime pays nothing to ask.
- **Derive the support line from the TRACK footprint.** A real track distributes load along its
  whole ground run. Add suspension contact points spanning the track's y-extent instead of only
  where the author dropped dummies — count derived from the track length over a spacing the road
  wheels themselves imply, so a short track gets fewer and a long one more.
- **Ignore a wheel dummy that cannot reach the ground.** A contact point sitting materially above
  its siblings contributes nothing but noise; the rhino's middle pair is the case in hand. The test
  is relative (against the other wheels of the same vehicle), so it needs no absolute threshold.
- **Keep the physics radius honest** — the ide/handling row owns it, as `wheelFit` now enforces
  (`docs/contracts/vehicles.md`, the MARKER wheel rule); this plan must not re-derive radius from
  track geometry.
- **Recover SA's own answer first.** Before fitting anything, read how `CAutomobile`/`CVehicle`
  treats the tank's suspension in the reversed source (`docs/links.md` → gta-reversed) — SA drives
  the rhino as an ordinary six-wheeler, so the question to answer is *why that is enough there and
  not here* (stock rhino's track is shorter relative to its wheelbase — measure it, do not assume).
  Anything fitted instead of recovered is a `docs/hacks/` entry in the same change.

## Steps

- [ ] Recon: measure the STOCK rhino's overhang ratio against this mod's, and read SA's tank
      suspension in gta-reversed. Record both in the ledger — they decide whether this is a mod-data
      defect we absorb or a general rule we owe every tracked vehicle.
- [ ] Fixture + builder: derive `tracked` and the track footprint at build time; `.osm` DESC gains
      the fields additively (old paks keep loading — the 098 architecture rule).
- [ ] Runtime: support points along the footprint; drop unreachable wheel dummies. Unit-tested
      against the REAL rhino rig fixture, the way `cleo/scripts/rhino-tracks/integration.test.ts`
      does — a synthetic rig cannot express this defect.
- [ ] Measured before/after: hull pitch over a fixed obstacle course, and the per-frame physics cost
      of the extra contact points (performance is part of the specification). Numbers into the
      ledger and `docs/benchmarks/`.
- [ ] Field close-out: kerbs, ramps, crests — the track ends stay on the surface.

## Verification

Headless: the rig test pins the derived support line for the real model and a non-tracked car is
provably untouched. Field: the visual verdict above. Ledger records the overhang measurements, the
contact-point count chosen and why, and the physics cost.

## Ledger

(recon findings; measured numbers; field verdicts)
