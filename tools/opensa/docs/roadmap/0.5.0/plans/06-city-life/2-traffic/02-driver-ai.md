# 06·2·02 — Driver AI: fixing the idiot at the wheel

[← chain](../readme.md) · prev: [01 sim core](01-sim-core.md) · next: [03 lights](03-traffic-lights.md)

The ring-0 driver — a real car, our controls. This is where the original's most famous defects die
(user commitment 5): drivers that plough into obstacles, ignore signals, queue onto rail crossings and
drive under trains. Goals directive 3 applies with teeth: every known SA driver defect we can fix and
do not is a defect we chose to ship.

## The defect list we are REQUIRED to beat (each becomes an acceptance row)

| SA defect | Our behaviour |
| --- | --- |
| Rams obstacles it never predicted (simple forward scan) | Predictive braking against route curvature + the tracked leader + static obstacles on the lane corridor |
| Runs lights when its global-timer window disagrees with the visual | One phase owner (2/03): the driver samples the SAME controller the bulbs render |
| Queues ONTO rail crossings and stops under trains | Box-junction rule: never enter a gated window unless the exit fits (crossings and marked junctions are "do not block" zones from the sidecar) |
| Wrong-way swerves and lane teleports | Directed-lane discipline from 1/02; lane changes only through the ring-1 lane-change model carried into ring 0 |
| Panic-brakes into permanent gridlock | Yield with timeout + creep; deadlock breaker at controller level (2/03 arbitration, not per-agent heroics) |

## Architecture (restriction-shaped)

- The driver is an **input source**: it emits `InputState` (steer/throttle/brake) as a SIBLING source in
  `CombinedInput`, reads back through `EnterVehicleSystem.steeringModel()`, and never recomputes
  `steerLimit()` — scripted control commands what a player commands (restrictions/architecture.md).
- Two layers, cleanly split:
  - **Decisions** (shared with ring 1, host-portable, part of the D5 spec): target speed + target lane
    position along the route, from curvature, leader gap (IDM-style following), controller phase,
    crossing gates, gap acceptance. Pure functions over sim state — fixture-testable.
  - **Actuation** (host-specific): decisions → pedals/steering for a Rapier raycast vehicle. Gains are
    **DERIVED from the car's own numbers** — handling row (brake force, engine acceleration, steering
    lock), measured grip — not tuned constants. This RETIRES `docs/hacks/autopilot-gains.md` (move to
    `hacks/retired/` in the same change, pointing here); video mode's PathFollowSource migrates to this
    driver as its second consumer.
- Obstacle sense WITHOUT casts: the ≤ 5 casts/frame budget is spoken for. Leaders/peds/player come from
  sim state + the vehicle registry (positions we already own); static obstacles come from the lane
  corridor's baked clearance (a 1/02-computed link attribute where geometry pinches). If a real cast
  ever proves necessary, it must displace something in the budget explicitly — a plan-level decision,
  not a code one.
- The player is just an unpredictable leader: measured position/velocity feed the same following model
  (this is what makes traffic feel aware of you).

## Goals gate

1. *Authored data:* handling rows read as authored (brake/accel/lock feed the actuation math);
   per-vertex path speeds respected as the subject's own.
2. *Original:* `CCarAI`/`CCarCtrl` steering law is RESEARCH (recover what its data meant); its
   execution and its bugs are not ported.
3. *Better:* the defect table above, each row demonstrated in the field program below; plus the 081
   lesson — feel verdicts come from the driver's seat (here: the observer's seat), not from matching SA.
4. *Cost:* decisions are part of the 2 ms sim gate; actuation is O(ring-0 count) trivial math.
5. *Contract:* nothing new; consumes sidecar "do not block" zones (1/04 schema).

## Verification

- Unit: decision-layer fixtures (following, yielding, box-junction, one-way) — negative cases first.
- Kinematic-bicycle harness (the autopilot-gains method, now with derived gains): cross-track p95 and
  |gLat| p95 recorded per vehicle CLASS, not per tuned constant.
- Field program (headless + eyeball): (a) 30-minute downtown observation — zero wrong-way, zero
  obstacle rams, zero cars stopped on crossings; (b) the player brake-checks a follower — it stops;
  (c) a blocked lane — traffic flows around after timeout; (d) light compliance sampled at 3 junctions
  over 10 cycles.

## Tasks

- [ ] Decision layer (following/curvature/yield/box-junction/gap acceptance) + fixtures.
- [ ] Actuation layer with handling-derived gains; migrate video mode's follower onto it.
- [ ] Retire `autopilot-gains` hack (move + closing block) in the same change.
- [ ] Lane-corridor clearance attribute (1/02 extension) for cast-free obstacle sense.
- [ ] Field program above; record verdicts + numbers here.
- [ ] Docs: `docs/features/traffic.md` update; any discovered limit → edge-cases/restrictions.

## Measured numbers

- Cross-track / |gLat| p95 per class: —
- Defect-table field verdicts: —
- Decision tick share of the 2 ms gate: —
