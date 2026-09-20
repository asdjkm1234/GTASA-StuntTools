# 081/06 — Air control, kerb smoothing, visible suspension

The perceived-quality plan: three smaller systems that turn "correct" into "alive". Runs after the
gate (05) so it tunes against the final tyre behaviour.

## 1. In-air attitude control (SA lets you fly a little)

- Airborne = all four wheels out of contact for > 0.15 s (debounced — kerbs must not trigger it).
- While airborne: pitch torque from throttle/brake input (W noses up, S noses down — SA semantics),
  small roll torque from steering; magnitudes scaled by `turnMass`, clamped so a crest jump is
  correctable but backflips take commitment. Landing: no special-case — plan-02/03 suspension +
  stabiliser absorb it (the crest-jump replay pins the landing pitch envelope).
- The 080/06 camera landing-dip integration point: vehicle landings feed the same impact channel
  as the damage system's contact events (no new plumbing).

## 2. Kerb / step contact smoothing

- Known raycast-vehicle weakness: a vertical kerb face is invisible to a downward ray until the
  wheel centre crosses the edge → snag or launch. v1 mitigation inside DRCVC: a short forward
  low-height probe per front wheel (reuses the plan-04/080 raycast API) that converts a detected
  step ≤ ~0.25 m at low speed into a brief upward impulse ramp (curb-mount assist), and above a
  height/speed threshold lets the collision happen honestly (kerbs at 80 km/h SHOULD punish).
- If plan 05 went own-controller: the honest fix is wheel SHAPECAST instead of ray — do that there
  and this section reduces to tuning.
- The `kerb-strike` replay is the acceptance instrument (mount smoothness at low speed, honest hit
  at high speed, no launch).

## 3. Visible suspension: travel, camber, and the axle the car was authored with

**The field brief (user screenshot, 2026-07-26).** A modded Mercedes 230 mid-corner: the body is rolled over
the outside wheels, the loaded wheels have climbed into their arches, the unloaded rear wheel hangs and
**leans with its axle**, and the contact patches smoke. Three separate mechanisms are visible there, and the
engine currently has exactly one of them.

| What the eye reads          | Mechanism                                        | State today |
| --------------------------- | ------------------------------------------------ | ----------- |
| The body leans              | rigid-body roll about the authored centre of mass | **have it** (081/02) — it only became visible once the COM stopped being emergent |
| Wheels move in their arches | per-corner suspension TRAVEL on the drawn wheel   | missing — the render path has no per-part translation at all |
| Wheels lean                 | CAMBER from the axle type + travel                | missing — and the axle type is authored data we parse and ignore |

### 3.1 The data already exists (all of it)

- **Per-corner travel, every fixed step**: `readVehicleWheels` returns `suspensionLength`, `restLength` and
  `maxTravel` per wheel; `WheelFrame.compression` is already that ratio, 0 hanging … 1 bottomed. The visual
  needs no new physics read — 081/01 built this channel for the telemetry and it is the same number.
- **The authored axle type**: `handling.cfg`'s `modelFlags` hex carries, per the file's own legend, the 5th
  digit for the FRONT axle and the 6th for the REAR — `1 NOTILT · 2 SOLID · 4 MCPHERSON · 8 REVERSE`. Plan
  02 types that column but nothing maps it; this section is its first consumer. (Stock examples: most sedans
  leave it 0 = independent-ish default; trucks and vans set SOLID.)
- **The travel limits**: `suspUpper` / `suspLower`, already typed, already the clamp the physics uses — the
  visual must clamp to the SAME numbers or the wheel leaves its arch.

### 3.2 The one new engine primitive

`RigidEntity` composes a part as `root × (bindRotation ⊗ animQuat, bindTranslation, scale)`. There is an
**animation rotation and no animation translation** — `setPartRotation` exists, nothing else does. So the
whole render-side item reduces to one primitive:

- add an `animTranslation` channel (3 floats per part) and add it to `bindTranslation` inside `flatten()`;
- `setPartTranslation(part, [x, y, z])` alongside the existing rotation setter.

Small, and NOT wheel-specific: any part that needs a per-frame local offset (a bouncing bonnet, a sinking
bumper, later damage sag) rides the same lane. **This is the only change below the vehicle layer.**

### 3.3 The chain, corner by corner

1. `VehiclePhysicsSystem` reads the per-wheel compression it already has and hands it to `VehicleRig` —
   which today knows only speed and steer.
2. `VehicleRig` turns compression into two numbers per wheel and smooths them:
   - **travel** (m): `(restLength − suspensionLength)`, clamped to the authored limits;
   - **camber** (rad): from the axle rule below.
3. `VehicleHandle.setWheel(index, spin, steer)` grows to `setWheel(index, { camber, spin, steer, travel })`
   — a shaped argument, because four positional numbers of which two are angles about different axes is how
   a sign bug ships.
4. The engine handle composes `steer(Z) ⊗ camber(Y) ⊗ spin(X)` — **order matters**: a steered wheel must
   camber about ITS OWN forward axis, not the body's, and the spin has to be innermost or it drags the
   camber round with it. Translation goes to the new `setPartTranslation` along the body's local Z.

### 3.4 The camber rule, per authored axle

- **SOLID** (`AXLE_*_SOLID`): the two wheels of the axle are rigidly parallel — the whole axle tilts by
  `atan((travelLeft − travelRight) / trackWidth)` and BOTH wheels take that same angle. This is what the
  screenshot's rear end shows, and it is the visually loudest of the three rules.
- **Independent / McPherson** (default, or `AXLE_*_MCPHERSON`): each wheel cambers with its own travel about
  a per-axle gain — compression leans the top inward (negative camber), droop leans it out. One authored
  gain constant, documented, tuned once in a field round rather than per car.
- **NOTILT**: camber stays 0. Bikes and anything the artist froze.
- **REVERSE**: the sign flips (SA uses it for models whose wheel dummies were exported mirrored).

Track width comes from the wheel placements the physics already has (`connection.x` per side), so nothing
new is measured.

### 3.5 What will go wrong, and the rule for each

- **Buzz.** A raycast suspension length jitters by millimetres on a trimesh; drawn raw it reads as a
  vibrating wheel. Both channels get a short critically-damped smooth (~25 Hz), and the smoothing lives in
  the RIG (fixed step), not in the renderer — a variable-rate smoother would change with frame rate.
- **Wheels through arches.** Clamp to the authored travel, and clamp again to a per-model ceiling measured
  from the wheel-arch geometry if one turns out to be tighter than the handling row claims. Failing that,
  the visual is wrong in the safe direction: less travel, never more.
- **LOD bands.** `setLodBand` swaps to bodies whose wheels may be merged into the hull; the travel/camber
  writes must be no-ops there rather than moving a part that no longer means what it did.
- **Detached parts.** A wheel torn off by damage takes `setPartWorldMatrix` and must ignore both channels.
- **The rider.** The seated ped is placed from the CHASSIS transform, not the wheels — nothing to do, but
  worth stating so nobody "fixes" the seat when the body starts leaning properly.

### 3.6 Why this is worth its place in a physics chain

It is the only item here that changes nothing about how a car behaves and much about whether the car looks
like it has suspension. 081/01 measured that the body barely pitches (0.07° under a 1.6 g stop) and 081/02
found the cause in the springs — so as 02/03 make the body genuinely move, the wheels staying welded to it
becomes the next thing the eye rejects. The two land together or the improvement reads as half-done.

## Subtasks

- [x] Airborne detector + attitude torques + clamps + tests (debounce, no-input = no torque,
      crest-jump envelope). **Shipped 2026-07-27** — the original's own law, `?airCtl` dial, ledger below.
- [~] Kerb probe + impulse ramp + thresholds + tests; `kerb-strike` A/B captures.
- [x] `animTranslation` + `setPartTranslation` on `RigidEntity` (the one primitive below the vehicle layer).
      **Landed early (2026-07-27)** as the stance fix's dependency — see the audit addendum.
- [x] Axle-type mapping from `modelFlags` (front/rear digits) into the typed handling row. **Shipped
      2026-07-27** — `axleFront` / `axleRear` on the handling row.
- [x] `setWheel` reshaped to `{ camber, spin, steer, travel }`; rig computes + smooths both channels at the
      FIXED step; engine handle composes `steer(Z) ⊗ camber(Y) ⊗ spin(X)` and the local-Z offset.
      **The travel half landed early** (shaped `{ lift, spin, steer }`, smoothed in the rig at the fixed
      step, `lift = connection raise − live spring length`); **camber joined it 2026-07-27**, shaped
      `{ camber, lift, spin, steer }` with the composition order pinned by its own test.
- [x] Clamps + no-ops: authored travel, LOD bands, detached parts — see the ledger; two of the three are
      structurally impossible today rather than guarded.
- [~] **Field round**: jumps (crest at varying speed), kerb mounts, cobbled/uneven streets ("do the
      wheels live?"), plus regression drive of everything since 02.

## Acceptance

- Crest jump: attitude correctable in air, landing absorbed without porpoising or nose-plant
  (replay envelope + field).
- Low-speed kerb mount smooth; high-speed kerb honest (replay).
- Wheels visibly work over uneven ground; no visual buzz (field).
- A solid-axle car leans its axle in a corner the way the reference screenshot does; an independent-axle car
  does not (the two must be distinguishable on screen, or the axle data is not reaching the render).

## Ledger

_(thresholds, torque clamps, capture numbers, field verdict)_

### 2026-07-27 — §2, the instrument: the kerb scene never met a kerb, and the real one stops a car dead

Before any assist: **the capture learned to say WHERE it was.** `TelemetryFrame.position` (copied, never
aliased — the same trap that once made every orientation-derived rate read 0) and `x`/`y`/`z` appended to the
series columns, at the END so `phys-compare` keeps comparing like with like. Everything below came out of
that one channel in an afternoon.

**`kerb-strike` is a prop-collision lap, not a kerb test.** The comet's lap ends against the traffic light at
(2221.8, 1203.3) losing 57 → 20 km/h; the infernus meets something at 100 g at (2170.5, 1225.3), in a plaza
of bollards, palms and ramps. Its own scene comment carried the doubt from the start ("UNCONFIRMED: whether
the angle below actually mounts the kerb") and the answer is no. The scene is KEPT, unchanged — the whole
record and the new regression pack are measured against it — but no kerb conclusion may be drawn from it.
**The flip that motivated this section does not reproduce at head**: comet `kerb-strike` peaks at 14.2° of
roll with no flip on any of the five cars (the 20.6° → 179° in `physics-world.ts` is now annotated as
scene-dependent, so nobody reads it as evidence the mechanism was fixed).

**The new `kerb-mount` scene drives SQUARE at a pavement edge**, off the power at ~25 km/h. Where it points
took three tries and each one is a datum: a drifted approach on the SF street drove into a traffic light; a
square approach there stopped every car dead (comet −62.1 g, admiral −61.3 g, infernus −68.0 g, **firetruk
−47.8 g**) but SF's pavement is FLUSH in collision and the blocker there is a building wall; so the scene now
stands on the LV plaza edge — a real pavement edge, proven by the `kerb-strike` comet climbing it (z +40 cm)
at 57 km/h. Square at that edge: **comet −61.0 g and firetruk −47.1 g, both stopped, ~5-7 cm of climb.**

So the mechanism is confirmed and its shape is worse than "snag or launch": at town speed a car **cannot get
onto a pavement at all**, while the same edge is climbable at 57 km/h and a shallow angle — momentum is the
only thing that gets a car over. A 10-tonne fire truck is stopped as flatly as a comet, which rules out ride
height and mass; what is left is the mechanism §2 named, the downward ray that cannot see a step face.

Baselines: `2026-07-27-headless-kerbmount-baseline-{comet,firetruk}.json` (the kerb) and
`2026-07-27-headless-kerbwall-sf-{comet,admiral,infernus,firetruk}.json` (the four-car wall reproduction).

### 2026-07-27 — §2 CLOSED by the field: there is no kerb problem to fix

Before building the probe, the baseline went to the field. **Verdict: kerbs behave well in play — the user
could not reproduce the block at all, including accelerating a comet over kerbs, which is smooth.** Two
checks then explained the gap between that and the capture, and both point the same way:

- **Not a throttle artifact.** The lap was re-run with the throttle HELD through the mount: numbers identical
  to the first run (comet −60.99 g / gVert 5.5 / 27.9 km/h; firetruk −47.1 / 8.54 / 21.16). The edge arrives
  ~2 s in, so the "off the power" keyframe was never reached — the car was already accelerating into it.
- **Most pavements have no kerb to be blocked by.** The SF probe measured it directly: a car crosses that
  pavement with z DEAD CONSTANT, flush in collision. What the scene found in LV is a plaza edge the same
  comet climbs at 57 km/h with a **+40 cm** rise — a ledge, not a kerb, and a car stopped by a 40 cm ledge at
  25 km/h is behaving, not failing.

**So §2's kerb assist is PARKED as not-needed**, not deferred for later tuning: nothing in the field asks for
it, and the mechanism it would fix turns out to bite only where being stopped is the right answer. What the
work leaves behind is worth more than the assist would have been — the position channel, three located
collision spots, and the fact that the flip that motivated this section had stopped reproducing months of
tuning ago without anyone noticing. Reopen only on a field report that names a specific kerb.

The other two §2 items stand unchanged and unmeasured: the high-speed shallow-angle case ("a kerb at
80 km/h SHOULD punish") has no clean instrument, and §1's in-air attitude control is untouched.

### 2026-07-27 — §1 shipped: the original's air control, and the scene that could not see it

**The law is the original's, not a feel constant.** `CAutomobile::ProcessControl` (gta-reversed) runs three
`ApplyTurnForce` calls on the player's car once `m_nNumContactWheels` reaches zero, and `ApplyTurnForce` ends
in `m_vecTurnSpeed += cross(point, force) / m_fTurnMass`. The lever arm is a unit body axis, so the whole
block collapses to an angular-velocity change of `0.0007 × min(1, 3000/turnMass) × input × timeStep` —
**1.75 rad/s² per unit of stick** once the game's 1/50 s time unit is divided out, the same for every car
under 3000 turn mass and proportionally less above it (a fire truck's 20 000 gets 15 %). The `0.02` gate is
1 rad/s: the driver may not push an axis that is already turning fast the other way. `air-control.ts` carries
the source block, the derivation and the three deviations — the pitch axis is our throttle axis (this control
scheme has no separate up/down, and the throttle is inert in the air anyway), there is no driving-skill stat,
and gravity is 9.81 where SA's is 20, so the same jump lasts about twice as long and buys twice the rotation.
That last one is why the strength is a session dial (`?airCtl=<×>`, 1 = the original) rather than a number
fitted here: the field decides, and every `[phys]` capture records what it flew with.

Controls in the air: **W/S pitch · A/D roll (off the throttle) · A/D + handbrake yaws**. The debounce is
ours — 0.15 s of every wheel off the ground — because our four suspension RAYS blink off over a kerb or a
driveway lip where SA's contact-wheel count does not, and without it the steering would roll the car in the
middle of an ordinary corner.

**The instrument had to be built before the measurement could be read.** `airborneS` is a TOTAL, and a lap
that skips over a crest in a dozen 40 ms hops reports the same second of air as one that flies. The summary
gained `air { atS, seconds, pitchDeg }` — the LONGEST unbroken flight, where it was, and what the nose did
during it. The `atS` half earned itself immediately (see below).

**Measured** (infernus, `?airCtl=0` vs `1`, captures + table in
[`../../benchmarks/vehicle-physics/readme.md`](../../benchmarks/vehicle-physics/readme.md)):

- **`u-turn` is the lap with real air** — both runs launch from the same event at 4.23 s. With the driver
  holding W the nose comes up **+35.6° instead of +24.4°**, and the car is down **1.3 s sooner** (1.93 s of
  flight against 3.27 s): a nose-up car meets the slope tail-first. Repeat run of the shipped config:
  byte-identical.
- **`crest-jump` is a crest, not a jump** — longest flight 0.2–0.5 s, and the two runs do not pick the same
  flight (10.52 s vs 6.33 s). Its deltas are landing chaos, exactly the spread 07 §2 measured and widened for.
  In the 0.2 s window it does allow, the traces are identical until the control engages and then diverge by
  **+0.9° of nose-up** — the law working, at the size the window permits. Same class of finding as
  "`kerb-strike` never met a kerb": recorded so nobody reads that scene's numbers as air-control evidence.

**Owed, and named rather than done**: a scene that actually flies on purpose (a launch with a deliberate
attitude input, not a u-turn that happens to leave the road). Until then §1's acceptance — "correctable in the
air, landed without a nose-plant" — is a FIELD verdict on a real stunt jump, which is what this plan's field
round asks for anyway.

### 2026-07-27 — §3 camber shipped: the axle the car was authored with now reaches the screen

`modelFlags`' two axle nibbles are read into the handling row (`axleFront` / `axleRear`, each a type plus the
`REVERSE` modifier — five stock rows carry REVERSE with no type beside it, so it had to be a modifier rather
than a fourth type). The rig turns them into a per-wheel lean, the handle composes it, and the order is the
whole correctness of the line: **`steer(Z) ⊗ camber(Y) ⊗ spin(X)`**, pinned by a test that turns the wheel to
full lock BOTH ways and checks the axle tips out of the horizontal by the same angle, and by a second one that
spins the wheel 12.5 rad and checks the lean does not move.

**The rules, and what each one costs:**

- **SOLID** is free of constants: one beam, both wheels square to it, so relative to the body they take
  `atan(Δlift / track)` — which is exactly the body's own roll, taken back out. A pickup's rear wheels stay
  upright while its body leans over them, which is what the field brief's screenshot shows.
- **INDEPENDENT / MCPHERSON** carries the one fitted number in the file, `0.44 rad/m`, and it is fitted to
  real suspensions (about a degree of negative camber per 40 mm) rather than to a car. It is applied to a
  wheel's travel **relative to its axle partner**, because the rig is fed hub offsets whose REST value
  belongs to a standing pose it does not know. Stated price: a symmetric bump draws no camber here where a
  real wishbone would gain some; in a corner the two are identical. **The original's own rule is not in the
  reversed source** — nothing in gta-reversed reads `AXLE_*` — so this is ours until it is, and it is the
  only piece of §3 that is.
- **NOTILT** is zero, **REVERSE** flips the sign, and a wheel with no partner on its axle (a three-wheeler, a
  model whose dummies did not pair) is zero: an unknown axle may not invent a lean.

**The data, read from the BUILD rather than from the source tree** (the standing rule, and it paid again):
27 of the built `handling.cfg`'s 210 rows author an axle, 19 of them a solid rear one — savanna, tornado,
picador, sadler, blade, towtruck, tractor, quadbike… **and the COMET's row differs from stock**
(`0x40000800` → `0x40442000`, McPherson front and rear): a mod authored an axle onto one of the two cars the
field names by name. Stock `admiral`, `infernus` and `turismo` author none, so they draw the independent
default — which is also the answer to "why does my sedan not lean its wheels": it is not authored to.

**The three no-ops §3.5 asked for, honestly:** the authored TRAVEL clamp is already structural (the lift comes
from the controller's own suspension length, which cannot exceed what it was configured with); a hidden LOD
band leaves the part index valid, so the write lands on a part nobody draws and is inert; and a DETACHED wheel
cannot happen — wheels are not in the damage system's part set, which owns `setPartWorldMatrix`. Guarding
either of the last two today would be guarding against a mechanism that does not exist. **Reopen this line
when wheels become detachable** (05b damageable tyres would do it).

**Not measured, on purpose.** This changes nothing about how a car behaves — no capture channel can see it,
and the `[phys]` matrix is byte-identical by construction. Its acceptance is the FIELD one this plan already
asks for: a solid-axle car (`savanna`, `picador`) and an independent one (`infernus`) through the same corner,
distinguishable on screen.

### 2026-07-27 — field bug: a wheel in the air did not turn (the other half of §3's drawn wheel)

Reported the same evening the chain closed: hold the throttle with the wheels off the ground and nothing
turns until they touch down. The cause was in this section's own code — the rig rolled EVERY wheel from the
car's planar displacement, which is the right source for a wheel on the road and no source at all for one in
the air.

The original has the answer per wheel, at the end of `CAutomobile::ProcessCarWheelPair`: with no contact, a
DRIVEN wheel under throttle winds up (`0.1` per frame forward, `0.05` back — **250 and 125 rad/s²**), and
every other airborne wheel decays `×0.95` per 1/50 s. Its `±1.0` test is the same shape as §1's air-control
gate: not a speed cap, a refusal to push a wheel already spinning hard the other way — so a held throttle
keeps winding, which is what a blurred wheel is.

Two details worth keeping: the roll RATE is per wheel now and survives the transition (a wheel spun up in the
air is taken back over by the road on landing instead of snapping to it), and the spin signal is the
DRIVETRAIN's output rather than the key — so a free wheel runs down on the brake and on the coast, and the
front wheels of a rear-drive car never spin in the air. `nDriveType` decides which wheels the engine reaches,
the same test `setVehicleControls` makes.
