# Vehicle effects (plan 089)

**State: SHIPPED 2026-07-28** — the whole chain, five steps, all field-approved. Vehicle physics is
[plan 081](../plans/081-vehicle-physics/readme.md); this is what that physics LOOKS like: smoke where a
tyre slides, marks where it slid, a puff where the car hit, dust where the ground is dirt.

## The two capabilities under the effects

- **The dynamic one-shot particle lane** (089/01, `packages/engine/src/render/dynamic-particles.ts`):
  pooled CPU spawns feeding the existing sprite passes — the baked 2dfx path loops forever in the vertex
  shader and cannot start/move/stop. Same 9-float instance, `phase = −spawnTime`, an age-clamping
  `oneShot` pipeline override; per-spawn opacity rides the FRACTION of the system slot. Library installed
  once at boot (`DYNAMIC_SYSTEMS` in `engine-particles.ts` — with per-entry `sizeScale`/`tint`/`alias`);
  pools are capped (1024 per blend mode) and DROP on overflow.
- **The decal lane** (089/03, `packages/engine/src/render/skid-marks.ts`): the engine's only ground-decal
  system — a ring of quad segments (4096), persistent buffer, positional uploads, wall-clock fade in the
  shader. Today's sole writer is the skid marks; bullet holes / footprints would extend it.

## The effects (all driven-car only — the plan's budget)

| Effect | Trigger | Where |
| --- | --- | --- |
| Tyre smoke (089/02) | demand-over-cap slip + lateral slide (`equivalentSlideSpeed`) | `vehicle-tyre-smoke.system.ts` |
| Skid marks (089/03) | the same signal, laid as a seamless ribbon, darker the harder, 12 real-second fade | `vehicle-skid-marks.system.ts` |
| Impact smoke (089/04) | the damage system's own 300 kN strong-hit gate (`onStrongHit`) | sink in `engine-vehicles.ts` |
| Surface dust/sand (089/05) | surfinfo `W_*` flag under each wheel; rolling throws, sliding doubles | `vehicle-surface-fx.system.ts` |

The SIGNAL is shared and honest (physics reads: `readVehicleWheelSlip`, `planarMotion`, the surface
probe); every LOOK number is an eye-fit because `CFx::AddWheel*` are stubs in gta-reversed — one hack doc
per effect (`docs/hacks/tyre-smoke-intensity-fit.md`, `skid-mark-look-fit.md`, `impact-smoke-fit.md`,
`surface-fx-fit.md`). Session dials: `?smokeStart/?smokeFull/?smokeRate`, probe `?fxprobe=<system>`.

## Known gaps (also in the hack docs / edge cases)

- No per-spawn COLOUR in the lane — surface tints are per class, not per ground (SA tints per spawn).
- No wheel SPRAY — `W_SPRAY` is wetness-gated in SA and the game tracks no road wetness
  (`docs/edge-cases/sa-formats.md`).
- Skid marks lay the rubber texture on every surface — the surfinfo `skidmark` column
  (DEFAULT/SANDY/MUDDY) is parsed but not yet routed to sandy/muddy textures.
- Marks lie in the horizontal plane (contact normal unread) — steep banking can clip them.

## Test coverage

`render/dynamic-particles.test.ts` · `engine.dynamic-particles.test.ts` · `render/skid-marks.test.ts` ·
`engine.skid-marks.test.ts` · `vehicle-tyre-smoke.system.test.ts` · `vehicle-skid-marks.system.test.ts` ·
`vehicle-damage.system.test.ts` (the strong-hit sink) · `vehicle-surface-fx.system.test.ts` (incl. the
tarmac-W_SPRAY regression) · `engine-particles.test.ts` (the lane library on the real fxp/txd fixtures).
