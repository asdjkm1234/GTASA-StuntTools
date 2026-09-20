# 089/02 — Tyre smoke

**Status: SHIPPED + FIELD-APPROVED 2026-07-28** after three tuning rounds (below); the closing perf
impression ("dropped a little, in general") was answered with a full sweep — no regression, every scene at
the cap, gpu pass within jitter of the 091 reference
([`2026-07-28-headless-089-02-no-regression-sweep.json`](../../benchmarks/opensa-engine/2026-07-28-headless-089-02-no-regression-sweep.json)).

## The finding that shaped it: Rapier's wheel rotation is cosmetic

The obvious signal — the telemetry's rotation-derived slip ratio — is DEAD in this stack: Rapier's
`wheelRotation` follows the ground exactly (measured on the brake-strip lap: 0.05 m/s of "slide" during a
sustained −1.1 g full-brake stop), and its brake is an impulse CAP, so a wheel never visibly locks and a
burnout never visibly spins. A rotation-based tyre smoke would smoke never.

The honest longitudinal signal is **demand over cap**, and only `PhysicsWorld.setVehicleControls` knows
both sides: it clamps the brake to `grip × step` and the engine to `grip` (the original's
`CVehicle::ProcessWheel` adhesion limiting). It now records, per wheel per step, how far each demand went
PAST the tyre — `brakeExcess` (the handbrake reads exactly 1) and `spinExcess` — read back through
`readVehicleWheelSlip` (`VehicleWheelSlip`). Note the near-miss the sliding flag would have been:
the friction circle is judged against the BOOSTED lateral grip (081/09), so a full-brake wheel at speed
sits at a third of the circle and never flags.

## Shape

- **`packages/game/src/vehicle/vehicle-tyre-smoke.system.ts`** — per contacting wheel, one equivalent
  slide speed: `max(|speedLateral|, min(1, brakeExcess) × |speed|, min(1, spinExcess) × SPIN_TO_SLIDE)`;
  a linear ramp between `slideStart`/`slideFull` drives a per-wheel spawn accumulator (`rate` × intensity,
  fractional puffs carry across steps, a gripping tyre forfeits its fraction). Spawns at the wheel's
  contact point (`PhysicsWorld.wheelContactPoint`, now public — the controller already computed it).
  Deliberately NOT on `VehicleTelemetry` — that sampler is the F2/capture gate, and smoke must not need
  the debugger open. Driven car only (the readme's budget: the player's car is the target).
- **Host sink** (`engine-vehicles.ts`): one `collisionsmoke` emitter from the dynamic lane, repositioned
  per puff (GTA → engine space like the lamps), `lifeScale = 0.3 + 0.3 × intensity` (a chirp wisps in
  ~1.5 s, a burnout lingers ~3 s of the authored 5), `burst(count)`. `DynamicFxEmitter.lifeScale` is
  089/02's one addition to the lane.
- **Dials** — `?smokeStart=<m/s>` `?smokeFull=<m/s>` `?smokeRate=<n/s>` (the 081/09 session-dial pattern).
  Defaults 3 / 12 / 25. Every fitted number is in `docs/hacks/tyre-smoke-intensity-fit.md` — SA's
  `CFx::AddWheel*` bodies are stubs in gta-reversed, so the mapping is a fit, not a port.

## Verification

- **Tests**: `vehicle-tyre-smoke.system.test.ts` — negative first (on foot, gate off, no slip record,
  fast-but-gripping, sub-threshold drift, standstill lockup does NOT smoke, airborne wheels never smoke),
  then brake-past-cap ∝ speed at the contact point, handbrake at speed, standstill burnout via
  `spinExcess`, pure lateral drift, harder-slides-more-particles.
- **Headless brake-strip lap** (infernus, 126 km/h → 0 in 65.5 m at −1.1 g): two clean smoke trails
  follow the braking path, dense at the wheels, dissipating behind; frame pinned at the 120 Hz cap,
  GPU 1.87 ms during the skid (the smoke's screen coverage here does not register — the lane's cost story
  stays the 089/01 measurement, overdraw-bound).
  Run note: [`2026-07-28-headless-089-02-brake-strip-smoke.json`](../../benchmarks/opensa-engine/2026-07-28-headless-089-02-brake-strip-smoke.json).

## Field round 1 (2026-07-28)

Verdict: too intense, "smoke pours constantly from under the wheels while just driving", and it read as
having no alpha. Root cause of the constant smoke: keyboard pedals are BINARY — a full-throttle pull-away
in a low gear and an ordinary full-pedal stop both demand past the tyre's cap, and round 0 counted any
excess as slide. Fixes, all in the hack doc: demand DEADZONES (brake 0.25, spin 0.75 — riding the cap is
ABS-shaped gripping, only well past it is a skid; the handbrake's exact 1 still ramps to full), rate
halved 25 → 12, life 1.25–2.5 s, and the lane now scales collisionsmoke's authored alpha envelope by 0.45
(SA's envelope assumes its own sparse spawns; our per-step bursts stack — full alpha read as solid white).

## Field round 2 (2026-07-28)

Still puffing "on every gear shift down a straight" and in ordinary corners; wanted half the smoke again
and opacity BY EVENT — ~10–15 % at a launch, 50 % at a hard slide/emergency stop. Fixes: the wheelspin
channel now FADES with ground speed (`SPIN_FADE_SPEED` 10 — an upshift's demand spike at 20 m/s is
drivetrain noise, not a burnout), `slideStart` 3 → 4, rate 12 → 6, and the lane gained a real PER-SPAWN
opacity channel: encoded in the fraction of the instance's system slot (`1 − fract(z)` in the shader — the
baked lane's integer slots stay opaque, the 9-float layout untouched), surfaced as
`DynamicFxEmitter.alphaScale`, driven by intensity² (`0.1 + 0.4 × i²`). Round 1's static 0.45 library
alpha scale is retired by it; the `?fxprobe` column sets its own 0.5.

## Open / next

- Surface routing (smoke on tarmac vs dust on dirt) is step 5's job — today every surface smokes white.
- Skid marks (089/03) should read the SAME `readVehicleWheelSlip` record — the darker-the-harder rule is
  this step's intensity, applied to a decal ribbon.
- Field drive owed: lock-up stop, handbrake flick, gentle corner (must stay silent), burnout launch.
