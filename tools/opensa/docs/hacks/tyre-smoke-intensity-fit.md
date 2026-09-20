# Tyre-smoke intensity fit

**Live.** Taken 2026-07-28 with plan 089/02 (tyre smoke on the dynamic particle lane).

## What it is

`packages/game/src/vehicle/vehicle-tyre-smoke.system.ts` and the sink in `apps/web/src/ui/engine-vehicles.ts`:

```ts
export const TYRE_SMOKE_DEFAULTS: TyreSmokeDials = { rate: 6, slideFull: 12, slideStart: 4 };
const SPIN_TO_SLIDE = 7; // m/s of "slide" bought by a full wheelspin surplus
const SPIN_FADE_SPEED = 12; // wheelspin smoke fades to nothing by this ground speed (m/s)
const BRAKE_DEADZONE = 0.25; // demand must exceed the cap by this before it reads as a lockup
const SPIN_DEADZONE = 0.4; // and by this before it reads as wheelspin
smokeEmitter.lifeScale = 0.25 + 0.25 * puff.intensity; // 1.25–2.5 s of the authored 5 s collisionsmoke life
smokeEmitter.alphaScale = 0.1 + 0.4 * puff.intensity ** 2; // ~12 % at a launch, 50 % at a full slide
```

Plus the shape of the signal itself: three channels reduced to one "equivalent slide speed" —
`max(|speedLateral|, ramp(brakeExcess) × |speed|, ramp(spinExcess) × spinFade × SPIN_TO_SLIDE)` where
`ramp` is the deadzone-to-1 linear map — then a linear ramp between the two dials drives the spawn rate,
the particle life and (squared) the per-spawn opacity.

**Field round 1 (2026-07-28)** produced the deadzones, a halved rate and the shorter life: keyboard pedals
are binary, so a full-throttle pull-away in first and an ordinary full-pedal stop both demand past the cap
— the verdict was "smoke pours constantly while just driving", and the full authored alpha stacked
per-step bursts into solid white ("is there no alpha channel?"). A demand that merely rides the cap is
ABS-shaped gripping; only demand well past it reads as slide. The handbrake's recorded 1 still maps to
full lock through the ramp.

**Field round 2 (2026-07-28)** halved the rate again (12 → 6), raised `slideStart` 3 → 4 (ordinary
corners puffed), added `SPIN_FADE_SPEED` (puffs from both driven wheels on every GEAR SHIFT down a
straight — each upshift's demand spike crossed the deadzone; tyre-lighting wheelspin is a low-speed
phenomenon), and replaced round 1's static 0.45 library alpha with PER-SPAWN opacity from intensity
squared — the user's numbers: ~10–15 % at a launch, 50 % at a hard slide/emergency stop. The per-spawn
channel is encoded in the fraction of the instance's system slot (`1 − fract(z)` in the shader), so the
baked lane's integer slots stay opaque and the 9-float layout is untouched.

**Field round 3 (2026-07-28)** — "the launch smoke disappeared": round 2's three cuts stacked on the one
channel (threshold 4 wants near-max spin, the fade closed the window by ~3.3 m/s, and rate 6 × intensity
0.25 yields under one puff inside it). Since the SPEED FADE — not the deadzone — is what silences gear
shifts (even a full surplus at 6+ m/s stays under `slideStart`), the deadzone dropped 0.75 → 0.4,
`SPIN_TO_SLIDE` 6 → 7 and `SPIN_FADE_SPEED` 10 → 12: the launch window now reaches ~5 m/s at ~12–16 %
opacity, and the straight stays silent.

## What it stands in for

SA's `CFx::AddWheel*` parameterisation — how many particles per wheel state per frame, at what life, at what
opacity. Those bodies are STUBS in gta-reversed (they call the original addresses), so there is no formula
to port. The wheel-state DETECTION, by contrast, is not fitted: brake-demand-past-cap and engine-past-cap are
read from the same clamps `setVehicleControls` applies, which mirror `CVehicle::ProcessWheel`'s adhesion
limiting; `speedLateral` is a measured velocity.

`SPIN_TO_SLIDE` exists because Rapier has no tread overspeed at all (wheel rotation is cosmetic — it follows
the ground even under a −1.1 g locked stop, measured 2026-07-28), so a burnout's slide SPEED is
unrecoverable and the surplus RATIO buys speed at a made-up exchange rate.

## What it was judged on

The headless brake-strip lap (infernus, 126 km/h full stop): two clean smoke trails follow the braking
path, dense at the wheels and dissipating behind — reads as the game's own brake skid. Unit tests pin the
signal (burnout smokes, standstill handbrake does not, gentle corners silent). The user's field verdict is
the plan's acceptance and may move all four numbers — they are session-dialable for exactly that
(`?smokeStart/?smokeFull/?smokeRate`).

## What would retire it

Recovered `CFx::AddWheel*` parameters (a deeper gta-reversed pass, or measuring the original's particle
counts per wheel state frame-by-frame from captures). The lifeScale mapping retires if the dynamic lane ever
carries per-particle alpha — rate and life are the only per-spawn look knobs today.

## Blast radius

Tyre smoke only (089/02). Step 4's impact smoke and step 5's surface effects will carry their own fits —
this one's numbers are not shared. The `readVehicleWheelSlip` record itself is honest physics and is NOT
part of the hack; skid marks (089/03) are expected to read the same record.
