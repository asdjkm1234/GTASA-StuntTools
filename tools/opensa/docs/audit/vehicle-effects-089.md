# Audit — plan 089: vehicle particles (2026-07-28, one day, five steps, six field rounds)

The 081 physics chain left the car doing things the eye had no evidence of: locking wheels, sliding,
hitting things — silently. Plan 089 is what that physics LOOKS like. All five steps shipped and were
field-approved in one day; this is the close-out.

## What changed

- **Two new engine capabilities**, each worth more than the effects on top:
  - the **dynamic one-shot particle lane** (089/01) — runtime CPU spawns over the existing sprite
    passes, where the baked 2dfx path could only loop; pooled (1024/blend mode, drop on overflow), one
    partial `writeBuffer` per changed half per frame, same shader under an age-clamping `oneShot`
    override, per-spawn opacity in the system slot's fraction, per-entry `sizeScale`/`tint`/`alias` at
    library build;
  - the **decal lane** (089/03) — the engine's first ground decals: a 4096-segment quad ring, positional
    uploads, wall-clock fade in the shader, no new render pass.
- **Four effects on the driven car**: tyre smoke, skid marks (12 real-second, severity-darkened,
  grow-in ribbons), impact smoke off the damage system's own 300 kN gate, and surface dust/sand routed by
  surfinfo's own `W_*` flags (mods inherit the dispatch).
- **One new physics read**: `readVehicleWheelSlip` — per-wheel demand-over-cap recorded where
  `setVehicleControls` clamps (brake excess, spin excess) — because the obvious signals turned out DEAD:
  Rapier's wheel rotation is cosmetic (0.05 m/s of rotation-"slide" during a −1.1 g locked stop) and the
  friction-circle flag misses at speed (judged against the 081/09-boosted circle). Now in
  `docs/edge-cases/physics-runtime.md`.

## What it cost

- **Frame time: nothing measurable at gameplay shapes.** The close-out sweep
  ([`2026-07-28-headless-089-closeout-sweep.json`](../benchmarks/opensa-engine/2026-07-28-headless-089-closeout-sweep.json))
  sits on the 091 reference within run jitter, every scene at the 120 Hz cap. The real prices are
  per-event: **+2.3 ms GPU** at the probe's worst-case ⅓-viewport plume (overdraw-bound — screen
  coverage, not particle count), ~10.8 KB/frame upload at full smoke, ~168 B per skid segment, one
  surface ray per contacting wheel per fixed step (driven car only — priced against 081/07 §3).
- **Residency**: two 36 KB instance buffers + a small atlas (particle lane), one 688 KB vertex buffer +
  a 32² texture (decal ring). Created once at boot.
- **Debt, all in `docs/hacks/`** (four files: tyre-smoke, skid-mark, impact-smoke, surface-fx fits):
  every LOOK number is an eye-fit because `CFx::AddWheel*`/`CSkidmarks` are stubs in gta-reversed — the
  SIGNALS are honest physics reads, the mappings are not ports.

## What it bought

Braking, drifting, launching, crashing and leaving the road are now all VISIBLE, in SA's own assets
(collisionsmoke, particleskid, wheeldirt, the W_* dispatch), at SA's own semantics (wall-clock fades,
wetness-gated spray left out until wetness exists). Plus the two lanes as general capability: bullet
impacts, foot dust, blood pools, footprints all have their substrate now.

## What the six field rounds taught (the method notes)

- **Keyboard pedals are binary** — any demand-threshold effect needs deadzones, or every launch and stop
  triggers it. And the SPEED FADE, not the deadzone, is what silences gear-shift demand spikes.
- **SA's data encodes triggers, not looks**: the `prt_*` systems have no emrate (code-triggered — the
  caller owns the count → `burst()`), are authored PURE WHITE (colour arrives per spawn via
  `FxPrtMult_c` → the lane's per-class tints), and `W_SPRAY` on tarmac means "when wet", not "always"
  (→ the snowflakes-on-asphalt round). Reading SA data at face value produced three of the six rounds.
- **Paint a new decal RED before judging its look** — the skid lane shipped pixel-perfect and invisible
  (particleskid's alpha averages 0.4); one debug tint separated "broken" from "subtle" in one run.
- **A "perf dropped" impression is answered with a sweep**, not a debate: measured no-regression twice
  (mid-chain and at close), both against the same-day 091 reference, same pak named in every record.

## Still open (inherited by later work, recorded in the plan + hack docs)

Sandy/muddy skid-mark textures (surfinfo's `skidmark` column is parsed, unrouted) · per-spawn colour
(per-ground dust tint) · wheel spray with a wet-roads state · marks on steep banking (contact normal
unread) · effects for non-driven cars (the plan's budget said the player's car is the target).
