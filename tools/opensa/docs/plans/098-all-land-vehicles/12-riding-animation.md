# 098/12 — Riding animation: lean poses, stunts and hands on the bars

**Goal:** on top of 04's static seat, the rider's BODY follows the ride — steer and lean poses blended
from the physics state, the wheelie/stoppie attitude, the bicycle's pedal / standing-sprint / bunny-hop
cycle, the push-back at standstill, the foot down at a stop, and hands that stay on the grips through a
full-lock turn. **Field checkpoint 5: a wheelie on the NRG-500 and a bunny-hop on the BMX look like the
rider is DOING them, not sitting through them.**

**Boundary.** 03 owns the physics (the bike pitches, the lean angle, the hop impulse); 04 owns reaching
the clips, resolving the group, the seated clip and mount/dismount. This plan owns everything that
happens to the rider WHILE riding. 04's former step "wheelie/stoppie/hop pose overlays" moved here
(2026-08-20) so the two plans do not both half-own it.

## What SA ships (measured 2026-08-20 — `scripts/debug/anim-census.ts` over `anim.img`, `ped.ifp`, `gta3.img`)

The nine ride groups `vehicles.ide` names in its `anims` column, and what each IFP carries:

| Group (`anims`) | Carriers | Clips | Beyond the shared 12-slot set |
| --- | --- | --- | --- |
| `bikes` | pcj600, fcr900, nrg500, copbike, bf400 | 20 | `jumponL/R`, `getoffLHS/RHS/BACK`, `kick`, `Snatch_L/R` |
| `biked` | sanchez | 19 | same + `shuffle`, no snatch |
| `bikeh` | freeway | 18 | same, no snatch |
| `bikev` | pizzaboy, faggio | 18 | same, no snatch |
| `wayfarer` | wayfarer | 18 | same, no snatch |
| `bmx` | bmx | 18 | **`bunnyhop`, `pedal`, `sprint`**, `jumponL/R`, `getoff*`; no kick/hit/passenger |
| `mtb` | mtbike | 18 | same as bmx |
| `choppa` | bike | 18 | same as bmx |
| `quad` | quad | 17 | **`reverse`** instead of `pushes`; `geton_LHS/RHS`, `getoff_B/LHS/RHS`, `kick` |

What the game resolves out of them (gta-reversed `AnimAssocDefinitions.cpp` / `AnimAssocDescriptions.h`):

- **Every group maps onto the same 12-slot table** (`aBikesDescs`): `Ride`, `Still`, `Left`, `Right`,
  `Back`, `Fwd`, `Pushes`, `Hit`, `DrivebyLHS/RHS/FT`, `Passenger`. Bicycles append three —
  `bunnyhop`, `pedal`, `sprint` (`aBmxAnimations`, 15 entries). The quad fills its `pushes` slot with
  `QUAD_reverse` and its `still`/`hit`/`passenger` slots with `QUAD_ride`.
- **`Left`/`Right`/`Back`/`Fwd` are 2–7-frame POSES flagged `PARTIAL | SECONDARY_TASK`** — additive
  upper-body targets layered over `Ride`, never full-body clips. `Ride`, `Still`, `Passenger` are
  2-frame statics with 32 bones (fingers included); the poses carry 26.
- **There is NO wheelie clip and NO stoppie clip, in any group.** SA's wheelie look is the physics
  pitching the bike plus the `Back` pose on the rider; the stoppie, `Fwd`. The pitch reaches the rider
  through the seat transform, the pose through the blend.
- `Pushes` is `LOOPED` on motorbikes only (the one flag difference between `aBikesDescs` and
  `aQuadDescs`): the rider paddles the bike backwards at standstill — SA's reverse on two wheels.
- Bicycles: `pedal` is a 21–23-frame loop with 32 bones; `sprint` a 21–25-frame standing loop with root
  motion; `bunnyhop` 4 frames — crouch, release.
- `ped.ifp` adds `BIKE_pickupL/R`, `BIKE_pullupL/R` (04's mount), `BIKE_fall_off`, `BIKE_fallR`
  (ragdoll — out of scope), `BIKE_elbowL/R` (melee — out). `bikeleap.ifp` (`bk_*`, `struggle_*`,
  `truck_*`) is mission choreography, not riding.

**The model side** (stock `gta3.img`, frame names): every motorbike authors `handlebars`, `forks_front`,
`forks_rear`, **`bargrip`** and `mudguard`; the bicycles add **`chainset`, `pedal_l`, `pedal_r`**; the
quad authors ordinary `wheel_*_dummy` names plus `handlebars` (so its wheels bake today — 03's regex
work is for the two-wheelers). `bargrip` is the point SA's `CBike::FixHandsToBars` pins the hands to.

**The runtime numbers SA keeps per rider** (`CRideAnimData`, plugin-sdk): `m_nAnimGroup`,
`m_fSteerAngle`, `m_fAnimLean`, `m_fHandlebarsAngle`, `m_fAnimPercentageState` — the rider pose is a
function of exactly these. `CBmx` adds `m_fBunnyHopCharge`, `m_fSprintLeanAngle`, `m_fPedalAngleL/R`,
`m_fWheelsBalance`. Recovered from `Bmx.cpp`: the hop charges while held (`+= timestep`, capped at 25),
power `= min(charge/25, 1) + 1`, force `0.06 · mass · power · up` — **and the impulse fires from the
animation's launch callback (`LaunchBunnyHopCB`), not from the key release**: the clip times the
physics. The standing sprint rolls the BIKE by `sin(clipPhase · 2π) · k` (`m_fSprintLeanAngle`).

**What is NOT recovered, stated plainly:** `CBike::ProcessRiderAnims` (0x6B7280) — the function that
turns steer, lean and the `!` row's `FullAnimLean` into `Left/Right/Back/Fwd` weights — is a
`plugin::Call` stub in gta-reversed, as is `CBike::ProcessControl`'s wheelie branch. The blend curve
cannot be read from source. Our mapping is therefore OURS, judged in the field, recorded as a
`docs/hacks/` card with what it stands in for; if someone disassembles 0x6B7280 later, the card says
what to compare.

## Design

- **One rider-pose layer, evaluated per fixed step**, fed by 03's state (lean angle, steer angle, pitch,
  wheel speed, hop charge, reverse intent, sprint) and 04's resolved group; it outputs clip weights and
  one post-sample bone override (hands). No clip name is spelled outside the group table.
- **Steer/lean poses.** `Left`/`Right` weight from the lean angle normalised by the authored row
  (`MaxLean`, with `FullAnimLean` as the angle at which the pose is fully on — the column legend's
  meaning, the formula ours); `Back`/`Fwd` from the rider's COMMANDED lean input (the same input 03
  reads for wheelie/stoppie intent), not from the bike's pitch — the pitch already moves the rider
  through the seat.
- **Stunt attitude.** Wheelie = `Back` at full weight while 03 reports the stunt active; stoppie =
  `Fwd`. That is what SA does; say so in the contract rather than inventing a clip.
- **Partial blending.** The poses are upper-body additives; the sampler needs a per-bone mask if it has
  none (04's recon: `IfpSampler` composes locals→worlds with no hook). The mask is the one new sampler
  capability this plan introduces, and it is generic (no bike knowledge in it).
- **Hands on the bars.** No IK layer exists. Minimal honest form: after sampling, aim each hand bone at
  `bargrip` carried by the `handlebars` frame's steer rotation (03 turns the bars) — a two-bone reach,
  not a solver. This is what makes steering visible on a bike; without it the bars turn and the hands
  float. Cost measured per frame before it is accepted.
- **Bicycle cycle.** `pedal` rate-synced to the crank: crank speed derives from wheel speed; the
  crank-to-wheel ratio is not something the model or the data states, so it is a fitted constant with a
  hack card until measured against the original. `pedal_l`/`pedal_r`/`chainset` parts rotate with the
  same phase through the articulation channel (02's transport, `setPartRotation`). `sprint` = the
  standing clip when sprint is held above a speed, with the sprint-lean roll handed to 03 (a pose
  driving a physics term — record it as such). `bunnyhop`: the crouch scrubbed by charge while held,
  the impulse released at the clip's launch point — the SA callback semantics, 03 owns the impulse.
- **Standstill set.** `Ride → Still` when stopped (foot down); reverse input at standstill plays
  looped `Pushes` on motorbikes and the `QUAD_reverse` pose on the quad, while 03 rolls the bike back.
- **`Hit`** is a one-shot partial (`FINISH_AUTO_REMOVE`) on 03's impact event. Small, last.
- **Out of scope, recorded:** `Passenger` (one skinned probe), `Driveby*`/`kick`/`Snatch`/`elbow`
  (weapons and melee are other chains), `fall_off`/`fallR` (ragdoll), `shuffle`.

## Steps

- [ ] **Census fixture.** The table above committed as a fixture from `scripts/debug/anim-census.ts`
      (the 9 groups × clip names), so a mod that overrides a ride IFP by bare name is diffed, not
      trusted.
- [ ] **Partial-pose mask** in the sampler. Negative first: a mask naming an absent bone, a mask over a
      clip with no such bone track.
- [ ] **Steer/lean poses** from 03's state through the `!` row; the weight-vs-lean curve captured
      self-describing (records the row it ran with) and filed as a hack card.
- [ ] **Stunt attitude** — `Back`/`Fwd` at full weight during wheelie/stoppie.
- [ ] **Hands to the grips** — post-sample reach to `bargrip` following the bars' steer; per-frame cost
      measured and recorded before acceptance.
- [ ] **Bicycle cycle** — pedal rate-sync + `pedal_l/r`/`chainset` rotation; standing sprint + the
      sprint-lean coupling into 03; bunny-hop charge → clip scrub → launch at the clip's launch point.
- [ ] **Standstill set** — `Still` on stop, `Pushes`/`QUAD_reverse` on reverse.
- [ ] **`Hit`** one-shot on impact.
- [ ] **Contracts + docs.** `docs/contracts/vehicles.md` §3 rows for `bargrip`, `pedal_l`/`pedal_r`,
      `chainset` (misspelled: hands float off the grips / pedals and crank freeze — silent, so the row
      says it); the rider section of `docs/features/vehicles.md`; the hack cards named above.

## Verification

Headless: the census fixture diff; every group resolves the full 12-slot table (bicycles 15) with zero
silent misses; mask tests; the weight curve capture carries its `!` row. Field, judged from the
reporter's angle: *does the rider look like he is doing the wheelie* (NRG), the bunny-hop and the
standing sprint (BMX), a foot down at every stop, hands on the grips through a full-lock U-turn, the
push-back when reversing a parked bike. Numbers into `docs/benchmarks/` — the hand reach and the pose
layer's per-frame cost beside 04's seated baseline.

## Ledger

(census reading as committed; weight-curve capture; hand-reach cost; field verdicts verbatim, paraphrased
to English)
