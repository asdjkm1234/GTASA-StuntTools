# 081 — Vehicle driving physics (feel overhaul on the own engine)

**Status: 01–07 SHIPPED — the chain is code-complete and AWAITING ONE FIELD ROUND** (2026-07-27; the three
drives it needs are listed in the close-out audit). 01–05 field-accepted 2026-07-26; 06 shipped 2026-07-27
(air control + camber; its §2 kerb assist CLOSED as not-needed by the field); 07 shipped the regression pack,
the vehicle-slice price, the class sweep — whose class-factor table came out EMPTY by measurement — and the
close-out; 08 (SA gravity) CLOSED-REJECTED (postmortem `../../postmortem/081-vehicle-physics/sa-faithful-feel.md`
— do not reopen); 09 (responsive steering at speed) SHIPPED; 10 (surface types) steps 1–5 shipped and shelved
as an [open issue](../../open-issues/offroad-feels-like-tarmac.md). Two field bugs came in the same evening
and are answered: an airborne wheel now turns with the engine (06's ledger), and the FPS-drop report was
traced out of the vehicle chain entirely — to an unbudgeted texture upload between frames
([the lever](../../performance/applied/texture-upload-budget.md)).** Supersedes the idea at
`docs/ideas/0.4.0/plans/07-vehicle-physics/` (2026-07-12, "THE priority gameplay task") — rethought against
what the engine actually is now. The audit of what the chain cost and bought:
[`docs/audit/vehicle-physics-081.md`](../../audit/vehicle-physics-081.md), the instruments day's
[`vehicle-physics-081-instruments.md`](../../audit/vehicle-physics-081-instruments.md), and the chain's
[close-out](../../audit/vehicle-physics-081-closeout.md).

> **Checkbox sweep 2026-08-11: all 22 remaining boxes struck, and the chain is now clear.** They were the
> implementation and field-round lists of steps 02–06, which the banner above already records as SHIPPED and
> field-accepted (01–05 on 2026-07-26, 06 on 2026-07-27 with its §2 closed BY the field). `drivetrain.ts` and
> its tests are in `packages/game/src/vehicle/`, so the code backs the banner. Nothing in this chain is owed;
> what is still live from the vehicle work lives elsewhere — the shelved
> [off-road grip issue](../../open-issues/offroad-feels-like-tarmac.md) and 10's surface types.

**The gate (05) is answered: STAY on `DynamicRayCastVehicleController`.** Every complaint the field raised
turned out to be a number this engine had guessed where the game ships the answer, not a ceiling in the
controller — and each of those numbers was reachable through DRCVC's own per-wheel API. What the controller
DOES cost is written down as three known asymmetries, all worked around in `setVehicleControls` and all
documented at the call site: its friction clamp is skipped when a wheel has no side impulse, its friction
circle weighs braking at half and cornering at full, and it exposes no skid state (so sliding is inferred
from the impulses). An own controller remains a later option, not a blocker.

**Goal: driving feels GREAT — SA-arcade responsive but physically grounded.** The original complaints
(user, 2026-07-12): steering responds instantly with no feel, braking pitches the nose UP instead of
down, cars flip far too easily. Steering has since gained a rate-limit + speed-sensitive lock; the
other two complaints are untouched and their root causes are now LOCATED, not hypothesised (below).

## What changed since the 0.4.0 idea was written

The idea doc planned a "phase 0.5 spike: adopt Rapier's `DynamicRayCastVehicleController` or build our
own". **That decision was made by history: plan 018 shipped DRCVC and it has been production for the
whole 074 arc** (bench road cars, enter/exit, damage, LOD streaming all ride it). The engine study for
this plan (2026-07-19) mapped the exact current state:

- **Vehicle = Rapier raycast vehicle** (`createDynamicVehicle`, `physics-world.ts:175-230`), chassis
  collider from COL convex primitives with an **equal mass share per shape** — the centre of mass
  "emerges" as the mean of primitive centres (`:700`), which includes cabin boxes → **COM sits high.
  This is the flip-happiness root cause.** `handling.cfg` ships an authored `CentreOfMass` per vehicle;
  nothing reads it. `setAdditionalMassProperties` is never called.
- **`handling.cfg` is parsed but 5 of ~40 fields are consumed** (mass, maxVelocity, engineAccel,
  brakeDecel, steeringLock — `gta-sa-world.adapter.ts:707-723`). Traction, suspension, brake bias,
  drive type, gears, turn mass, drag, anti-dive: all parsed into raw strings and ignored.
- **One shared constant set for every car** (`physics-world.ts:16-31`): suspension rest 0.15 /
  stiffness 120 / compression 12 / relaxation 2.3 / travel 0.25 / `WHEEL_FRICTION_SLIP` 10.5;
  chassis angular damping 2 ("resist roll-flip", i.e. the flip problem is band-aided globally).
  A firetruck and an Infernus currently share identical suspension and tyres.
- **Drive is always 4WD** (engine force split equally across wheels, `setVehicleControls`
  `:516-531`); handbrake (Space) is a full 4-wheel brake — no rear-grip-cut slide.
- **Driving logic lives in `enter-vehicle.system.ts:381-440`** with honest workarounds for DRCVC
  quirks that must be preserved as a ledger: phantom ~0.95 rest speed (real speed read from body
  velocity), reverse cannot start from rest (`seedReverse`), parking brake 80 at spawn.
- **One-fixed-step control latency**: `drive()` runs AFTER this step's `updateVehicle`
  (`physics.step` updates vehicles first, `engine-canvas-host.tsx:708-719`) so controls apply next
  step.
- **No physics telemetry exists anywhere**; no visual suspension travel (wheels only spin+steer —
  `VehicleRig`); the F2 Vehicles screen is graphics-only.
- Infrastructure that did NOT exist in 0.4.0 and this plan now leans on: the F2 debugger +
  capabilities system (a Physics tab is cheap), the `[bench]` JSON console protocol + headless
  harness (a `[phys]` twin is cheap), deterministic fixed-step loop, `InputState` as an interface
  (scripted input source = trivial), and plan 080's camera chain which will CONSUME the slip/speed
  signals this plan produces (080/05 drift framing).

## The architecture decision (made here, not re-litigated per plan)

**Stay on `DynamicRayCastVehicleController` through plans 02–04; the own-controller question is a
GATE in plan 05, decided by telemetry, not preference.**

Reasoning: everything that fixes the reported complaints is expressible OUTSIDE the controller —
COM/inertia are body mass properties; anti-roll bars, anti-dive, downforce, air control are chassis
forces; brake bias, handbrake rear-cut, drive-type torque split, per-car suspension, traction scaling
are per-wheel DRCVC parameters (`frictionSlip`, `sideFrictionStiffness`, per-wheel brake/engine are
all in the API). The ONE thing DRCVC owns that we cannot shape is the tyre force curve itself
(Bullet-lineage: grip scalars, no slip-angle model, no combined-slip circle, no load sensitivity).
Whether that ceiling actually blocks "SA-arcade but grounded" is an empirical question — plan 01's
telemetry + plan 05's gate criteria answer it. **Every system in 02–04 must therefore be
controller-agnostic** (chassis-level forces, or parameters an own controller would also have), so a
positive gate verdict swaps the controller without invalidating the chain.

## Sub-plans

| #   | Plan                                                     | One-liner                                                                                                                            |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [Telemetry + test track](01-telemetry.md) **SHIPPED** | Physics HUD, scripted-input replays over real map locations, `[phys]` JSON capture, BEFORE baselines.                                |
| 02  | [handling.cfg as truth](02-handling-truth.md) **SHIPPED** | Full typed unit-mapping; COM + inertia applied (THE flip fix); per-car suspension; control-latency fix.                              |
| 03  | [Stability forces](03-stability.md)                      | **SHIPPED, differently than planned**: the fix was the SPRING (SA's own law), the authored axle bias, and ride height from the authored centre of mass — not added stabiliser forces. |
| 04  | [Drivetrain + brakes](04-drivetrain-brakes.md) **SHIPPED** | Gears + drive type F/R/4, engine braking, brake bias, handbrake = rear grip cut (the SA slide), reverse rework.                      |
| 05  | [Tyres + steering + THE GATE](05-tyres-steering-gate.md) **SHIPPED** | Traction mapping, steering feel v2, counter-steer assist; gate verdict: DRCVC tyre ceiling → own controller go/no-go.                |
| 05b | Damageable tyres (see below)                              | Burst a tyre: grip drops on that corner, the car pulls, the wheel sits on its rim. The detection half already shipped.               |
| 06  | [Air, kerbs, visual suspension](06-air-kerbs-visual.md) **SHIPPED** | §1 air control (the original's own turn forces, `?airCtl`), §3 visible travel + camber from the authored axle. §2's kerb assist is CLOSED as not-needed — the field could not reproduce the block. |
| 07  | [Presets + physics CI](07-presets-regression.md) **SHIPPED** | The regression pack + its gate, the vehicle slice priced, the five-class sweep (no class factor needed), and the close-out. The pack owes a re-record on the two jump scenes IF the field accepts air control — see its ledger. |
| 08  | [SA gravity](08-sa-gravity.md) **CLOSED-REJECTED**       | The 2g experiment — built, measured, field-rejected same day; postmortem carries the two findings. Do not reopen.                    |
| 09  | [Responsive steering at speed](09-speed-steering.md) **SHIPPED** | Speed-growing lateral grip (virtual downforce) + the SLIDE_SPEED 50× unit-bug fix; longitudinal frozen at baseline; dials field-owned. |
| 10  | [Surface types](10-surface-types.md) **1–5 SHIPPED** | The wheel learns what it stands on: COL materials through the seam, a per-wheel probe, grip from `surface.dat`'s group matrix instead of the tarmac-only 4.5. Field: applied and verified, but off-road reads as almost unnoticeable → [open issue](../../open-issues/offroad-feels-like-tarmac.md); wet grip → [roadmap 05 rain](../../roadmap/0.5.0/plans/05-weather-rain/readme.md). |

Execution order + rationale: [priority.md](priority.md). What the physics LOOKS like — tyre smoke, skid
marks, impact smoke, and the surface effects 10 unlocks — is its own plan:
[089 vehicle particles](../089-vehicle-particles/readme.md).

### 05b — damageable tyres (queued 2026-07-22, no code yet)

The half nobody could do before is done: **the tyre is identifiable**. `renderware/src/vehicle/wheel-tyre.ts`
finds a wheel's rubber by geometry — it is the outer band of the disc, see
[plan 084 row 3b](../084-vehicle-appearance/readme.md) — and every tyre submesh is tagged `tyre: true` in the
built model, on the converted and the modloader path alike. 180 of 215 stock vehicles have one; the rest
(boats, aircraft, a few one-material wheels) have none, and the feature has to survive that.

What it still needs, when the row is picked up:

- **State per CORNER, not per car.** The wheel index is already the handle's unit (`VehicleWheelInfo`); tyre
  damage belongs beside it, not in the damage-GROUP set the body panels use.
- **Physics**: friction slip and suspension dropped on that wheel alone. Plan 02 makes per-car suspension
  real, and this is the same seam driven to a per-WHEEL value.
- **Visual**: hide the tyre submesh (the same per-instance visibility that already hides `_dam` and the
  unchosen `extraN`) and drop the wheel radius to the rim so the corner sits down. The rim is exactly the
  wheel submeshes NOT tagged `tyre`.
- **Cause**: gunfire, and kerb/impact thresholds — which wants plan 06's kerb work first, or every pothole
  bursts a tyre.

## Ground rules

1. **Telemetry first — nothing is tuned blind** (carried verbatim from the idea; now cheap to honor).
   Every feel change in 02–06 lands with a before/after replay capture in that plan's ledger.
2. **`handling.cfg` is the tuning source of truth.** Mapped, never invented; the unit-conversion
   table is written ONCE (plan 02) with unit tests pinning real rows (LANDSTAL, ADMIRAL, INFERNUS).
   Where a mapping is deliberately arcade-bent, the bend is a named, documented factor.
3. **Controller-agnostic feel systems** (the architecture decision above) — chassis forces and
   per-wheel parameters only; nothing may reach into DRCVC internals.
4. **The DRCVC quirks ledger is load-bearing**: phantom rest speed, seedReverse, parking brake,
   spawn defer/slide/pitch lessons. A plan that touches adjacent code re-verifies the quirk's test.
5. **Determinism**: replays = scripted `InputState` + fixed spawn + fixed step; captures are
   comparable run-to-run on the same build. Physics tests never depend on wall clock or randomness.
6. **Renderer untouched.** The vehicle systems output body/wheel transforms through `VehicleHandle`;
   the only render-side change in the whole chain is the plan-06 suspension-travel parameter.
7. **Feel is field-judged** per plan (the 080 rule): a plan's defaults freeze only on user verdict;
   `?veh=legacy`-style A/B is NOT provided — physics cannot honestly run two worlds — instead each
   plan keeps its constants config-patchable live via the new F2 Physics tab for in-session A/B.
8. **Measurements ledger per sub-plan** (standing rule), including the fixed-step cost budget:
   vehicle physics for 8 live cars ≤ 0.5 ms per fixed step, measured at plan 07.

## The DRCVC quirks ledger — final state (07 §4)

Ground rule 4 says this list is load-bearing: each row is a place where Rapier's raycast controller does not
behave the way the code above it would assume, and each one cost a session to find. **A change touching the
adjacent code re-verifies the quirk's test.** As the chain closes, this is the whole set:

| Quirk                                                                                                   | Where the workaround lives                       | Its test                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| `currentVehicleSpeed` reports a **phantom ~0.95 at rest** → reverse reads as forward                     | `drive()` takes the speed from the BODY velocity  | `enter-vehicle.system.test.ts`       |
| Reverse **cannot start from a dead stop**                                                                 | `seedReverse` kicks 1 m/s backward, once          | `physics-world.test.ts` (`seedReverse`) |
| A parked car **creeps** with no brake on it                                                              | `PARKING_BRAKE = 80` at spawn, released by throttle | `enter-vehicle.system.test.ts` (seat/parking path) |
| The **friction clamp is skipped in a straight line** (`skid_info` applies only with a side impulse)      | our own longitudinal clamp in `setVehicleControls` | `physics-world.test.ts`              |
| The friction circle weighs **braking at half, cornering at full**, so a "locked" wheel still grips        | `LOCKED_SIDE_FRICTION = 0.03` while the lever is up | `physics-world.test.ts`             |
| **No skid state is exposed**                                                                             | sliding inferred from last step's impulses         | `physics-world.test.ts`              |
| A suspension **ray sees nothing until the world has stepped once** (the query pipeline is built in `step`) | the surface probe's own guard + its fixture       | `physics-world.test.ts` (081/10)     |
| Wheel order is the **model's dummy order**, not FL/FR/RL/RR                                              | everything per-wheel is keyed by placement, never by index | `phys-capture` / stance tests |

## Cross-links

- **080/05 vehicle camera** consumes `speed`, `velocityDir`, and (new here) a slip proxy — drift
  framing gets honest data from plan 01's telemetry channel.
- **[098 all-land-vehicles](../098-all-land-vehicles/readme.md)** (formerly roadmap 0.5.0/04) rides on
  this chain (plan 07 here shipped it an EMPTY class-factor table, by measurement);
  bikes' balance controller remains out of scope for 081.
- **0.6.0/01 vehdeform** consumes the same Rapier contact events — orthogonal, no coupling.
- Vanilla references for feel targets: the user's real-SA installs under `game-src/` (same
  handling.cfg rows) — plan 01 records reference captures of expectations per test-track scene.
