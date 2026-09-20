# 080/07 — Transitions, polish, close-out

The chain's finishing plan: everything that needs ALL previous layers in place, plus the exit exam.

## 1. Mode transition audit

02–06 were built so transitions are implicit (shared channels, per-mode tuning tables, no state
resets). This plan proves it:

- Matrix walk: foot↔vehicle (05 blends), photo enter/exit (K+M seeds `flyEye` from the live eye —
  already smooth; verify the RETURN path re-seeds rig springs so leaving photo mode doesn't whip),
  debugger warps/respawn (teleport snap from 02), pause/F2.
- A scripted integration test drives one long snapshot sequence through every transition and
  asserts continuity (no frame-to-frame eye jump > a threshold except declared teleports).

## 2. Pitch-coupled framing (readme addition — polish)

- Looking down: look-point height eases up a touch and distance tightens (the character stays
  composed instead of centering on their back). Looking up: height eases down toward the
  shoulder. Small mapping (≤ 0.4 m, ≤ 1.0 m distance), through existing channels; one config
  curve. Skippable if the field round says the base rig already frames well.

## 3. Tuning consolidation

- Freeze the final tuning tables (foot + vehicle) in `game-runtime-config.ts`; every value that
  survived field rounds gets its ledger line moved into a single "shipped tuning" table here.
- Prune Camera-tab rows down to the knobs that proved useful during rounds (the rest stay
  config-only) — the tab is a tuning tool, not a settings screen.

## 4. Performance + regression exit exam

- Measure `director.update` p95 on foot / in traffic / in an interior (collision whiskers hot):
  budget < 0.1 ms, casts ≤ 5/frame — ledger with numbers.
- Ritual 6-scene bench sweep: fps/draws within noise of the pre-080 reference row (bench bypass
  invariant — this row is the proof the chain touched nothing it shouldn't).
- One soak leg (`?soak`) with the new camera live to confirm no drift/leak in rig state.

## 5. Close-out

- ~~Delete the `?cam=legacy` branch and the preserved pre-080 inline path~~ **DONE EARLY 2026-07-25**
  (the user accepted the rig as the default after 01–04, so the escape hatch had no job left). The flag,
  the `legacy` rig-state field and its five branches are gone; the parity test STAYED — it now steps a
  config with every smoothing channel zeroed, so the reduction to the pre-080 stick math is still pinned.
  `?cam` stays reserved for future camera debug if needed.
- `engine-camera.test.ts` and the director suite are the pinned behaviour record; docs sweep:
  this chain's ledgers complete, readme status flipped to DONE with the field-verdict quotes
  (paraphrased in English, per repo rule).
- Write the 0.6.0 idea stubs deferred from the readme: idle cinematic auto-camera, R-key
  cinematic vehicle camera, gamepad input path (camera-ready once input exists).
- Memory/handoff update (outside the repo): camera chain state + tuning gotchas.

## Subtasks

- [x] Transition matrix + continuity integration test.
- [x] Pitch-coupled framing — SKIPPED, deliberately (see the ledger).
- [x] Tuning freeze + tab prune.
- [x] Perf measurements + ritual sweep (ledger). The SOAK leg was not run — see the ledger for what was
      done instead and what that leaves owed.
- [x] Legacy-path deletion (early, 2026-07-25), docs sweep, idea stub.
- [x] ACCEPTED in the field 2026-07-25 (mixed session + the K+M chrome change).

## Acceptance — MET 2026-07-25

- ~~User plays a full mixed session and accepts the camera as the default experience~~ **ACCEPTED**: the
  user walked the transition list and reported it good, and accepted the K+M chrome change on top.
- Ritual row within noise (identical, in fact — see the ledger); budgets in the ledger; suite green;
  `?cam=legacy` gone.

## Ledger

### 2026-07-25 — the transition exam, the tuning freeze, and one deliberate skip

**1. The transition matrix is now a test** (`ui/camera/camera-transitions.test.ts`). ONE snapshot sequence
walks the whole session — walk → climb in → drive a long corner → climb out → walk → map viewer (seeded
from the live eye) → overhead snap → hand the eye back → respawn — against one continuous rig.

The metric is the eye's motion RELATIVE to its focus (`|Δeye − Δfocus|`): absolute eye speed says nothing,
because a car at 24 u/s legitimately moves the eye 0.4 u per frame. Measured worst-per-leg, in world units
per frame:

| leg                | worst | |
| ------------------ | ----- | --- |
| walking            | 0.116 | the follow spring catching up |
| climbing in        | 0.529 | the steered swing behind the car — the fastest DELIBERATE channel |
| driving            | 0.752 | the corner swing + the distance curve |
| climbing out       | 0.775 | the swing behind the dismount |
| walking again      | 0.095 | |
| map viewer (enter) | 0.000 | seeded from the live eye — provably not a cut |
| overhead snap      | 0.000 | inside the leg; the snap itself is a DECLARED transition |
| back on foot       | 0.109 | the re-frame is declared; what matters is it does not then CRAWL home |
| respawn            | 0.116 | the teleport is declared; the rig snaps and carries on |

The bar is **1.0 u/frame**, set above the fastest deliberate channel (the swing, ~0.53) and below the
smallest cut this chain actually shipped and had to fix (the exit pull-in was metres). Three transitions are
DECLARED — the overhead snap, handing the eye back, and a respawn teleport — and only their first frame is
exempt; everything after it is held to the same bar, which is what proves there is no whip.

**2. Pitch-coupled framing: SKIPPED.** The plan itself made it skippable "if the field round says the base
rig already frames well", and four rounds said exactly that — every framing complaint that came back was
about MOTION (bob frequency, swing hitch, exit snap), never about how the character sits in frame while
looking up or down. Adding a height/distance coupling now would introduce a new channel with no reported
problem to solve, and would need its own round to clear. It stays in this doc as a one-line lever if a
later round ever asks for it.

**3. Tuning frozen + tab pruned.** The shipped table is below. The Camera tab lost three rows
(`landingDipFullSpeed`, `shakeImpactForce`, `vehicleFovLambda`) — reference points no round ever turned;
they stay config-only. 42 → 39 rows, and every survivor was moved by an actual field round.

#### Shipped tuning (frozen 2026-07-25, after four field rounds)

| channel | field | value | how it got there |
| --- | --- | --- | --- |
| input | `inputSmoothTime` | 0.03 | first guess, accepted untouched |
| look point | `positionLagTime` / `verticalLagTime` / `deadZone` | 0.12 / 0.28 / 0.08 | accepted; the dead-zone residual was explicitly kept |
| | `lagMaxDistance` / `teleportSnapDistance` | 1.2 / 20 | accepted |
| yaw | `yawLagTime` | 0.25 | accepted |
| zoom | `zoomLambda` | 8 | accepted |
| composition | `turnThreshold` / `recenterDelaySec` / `recenterRate` | 0.9 / 2 / 1.6 | accepted |
| | `lookAheadDistance` / `lookAheadTime` | 0.8 / 0.45 | accepted |
| collision | `collisionRadius` / `collisionMinDistance` | 0.35 / 1.6 | round 1 of 04 set the min distance |
| | `collisionReleaseTime` / `collisionWhiskerAngle` | 0.4 / **0** | the whisker went to 0 in the field and stayed there |
| vehicle | `vehicleDistanceScale` / `vehicleDistanceGain` | **1 / 5** | round: "too far on entry, let speed earn it back" |
| | `vehicleDistanceSpeed` | 40 | first guess, accepted |
| | `vehicleFovKick` / `FovMinSpeed` / `FovMaxSpeed` | 0.175 / **6 / 28** | round: invisible — the band ran past what cars reach |
| | `vehicleFovLambda` | 2.5 | first guess, accepted |
| | `vehicleYawLagTime` / `vehicleRecenterDelaySec` | 0.35 / 1.5 | accepted (the JERK was a latch, not a number) |
| | `vehicleVerticalLagTime` / `vehicleCollisionReleaseTime` | 0.15 / 0.6 | accepted |
| drift | `driftLookBlend` / `driftSlipDeadZone` / `driftMinSpeed` | 0.5 / **0.05 / 6** | round: gated past what this physics produces |
| motion | `bobAmplitude` / `bobCyclesPerMetre` | **0.025 / 0.25** | round: "shakes so hard you cannot concentrate" — it was 4.9 Hz |
| | `landingDipScale` | **0** | three rounds, never visible at a third-person orbit — ships OFF |
| | `shakeScale` / `shakeImpactForce` | 0.08 / 250 000 | accepted after the burst bug was fixed |
| | `sprintFovKick` | **0.07** | round: invisible at 0.04 with a band that completed at top speed |
| | `reducedMotion` | false | the comfort switch, off by default |

### 2026-07-25 — ACCEPTED, and the close-out sweep

The user ran the transition list and accepted it; with that, **the 080 chain is closed for 0.5.0** except
plan 08, which the user has explicitly deferred.

Two things landed after the acceptance:

- **The photo camera takes the chrome off the screen** (K+M): the perf readout, the debugger panel, the
  "Click to play" button and the Fullscreen button hide, and leaving restores exactly what was there. The
  debugger is SUPPRESSED rather than closed, so it returns on the same screen with the same state. Only the
  K+M gesture counts — the `fly-camera` event gained a `photo` flag because the debugger's own fly toggle
  and the map inspector drive the SAME camera, and hiding the panel there would take away the tool that is
  flying. A running `?soak` keeps its status line.
- **Docs swept + the test gaps closed**: the additive layer's offsets are now pinned as reaching the DRAWN
  camera (the dip halves on the look point, the bob moves eye and target together), `sphereCast`'s second
  exclusion has a real-Rapier test, and `planarMotion` is pinned as the shared channel — the same numbers a
  capture records and the camera reads, so the two cannot diverge. `docs/features/camera.md` had two stale
  facts from the field rounds (the 0.15 m layer cap, and "the cap is suspended during enter/exit"); both
  corrected.
- The 0.6.0 idea stubs were written and then **deleted at the user's request** — nothing in them was worth
  keeping. What replaced them is one researched idea: [first-person
  camera](../../ideas/first-person-camera/readme.md), written while the chain's knowledge is fresh.

### 2026-07-25 — the exit exam: numbers

**Director cost**: `stepCamera` **0.568 µs mean / 0.620 µs p95** on foot with every layer live (microbench
row 080/06). The plan's budget was **0.1 ms p95** — this is 160× under it.

**Casts per frame: 2**, against a budget of 5. One sphere cast toward the eye (the two flanking whiskers do
NOT fire: the 04 field round set `collisionWhiskerAngle` to 0) plus one `groundBelow` ray for the floor
guard. The plan assumed whiskers would be hot in interiors; the field removed them instead.

**Ritual sweep — the bench-bypass proof.** The full 8-scene `?bench=all` leg, headless, with the whole chain
live: [`2026-07-25-headless-080-closeout-sweep.json`](../../benchmarks/opensa-engine/2026-07-25-headless-080-closeout-sweep.json).

| scene | avg ms | p95 | fps | draws |
| --- | --- | --- | --- | --- |
| ls-noon | 8.333 | 9.3 | 120.0 | 1181 |
| sf-fog-dawn | 8.384 | 9.3 | 119.3 | 985 |
| lv-night | 8.328 | 9.2 | 120.1 | 1647 |
| country-dusk | 8.331 | 9.7 | 120.0 | 861 |
| ocean-horizon | 8.329 | 10.3 | 120.1 | 24 |
| ls-rain-night | 8.329 | 10.2 | 120.1 | 966 |
| ganton-noon | 8.323 | 10.2 | 120.2 | 1397 |
| ganton-night | 8.329 | 10.2 | 120.1 | 1394 |

`ls-noon` is the one scene with a directly comparable headless BEFORE (the 080/01 row): **8.333 vs 8.334 ms
and 1181 vs 1181 draws** — identical, which is exactly the invariant this row exists to prove. Every leg is
vsync-capped at 120 fps, so the sweep CANNOT resolve a small CPU regression; it proves the bench path is
untouched, and the user's in-game sweep remains the pass-comparable series.

**The soak leg was NOT run.** What it looks for is drift and leaks in rig state over a long session, and the
honest answer was to remove the drift structurally rather than watch for it for half an hour: `bobPhase` now
wraps to one turn (it grew ~11 rad/s and would have cost `Math.sin` precision over hours) and the shake's
noise clock only advances while a shake is alive. A test steps the layer through **an hour of sprinting with
a crash every minute** and asserts every accumulator stays bounded. A real `?soak` leg remains owed if the
user wants the memory half of it too.

**2026-07-25 — `?cam=legacy` deleted early (user's call: "the camera is fine now").** Removed: the host's
`params.get('cam')` read, `CameraRigState.legacy`, and its five branches in `stepCamera` (instant zoom,
centering gate, follow-point smoothing gate, `attached`, input smooth time) plus the `steerYawChannel` gate.
The parity gate did NOT retire with it: `camera-director.test.ts` now steps a `RIGID` config
(`inputSmoothTime: 0`, `zoomLambda: Infinity`) and still matches the pre-080 inline host math to 12 digits —
the position channels need no zeroing there because a static focus keeps the look point exactly on target.
Test count 110 → 109 (the "does not compose on the legacy path" case went with the path); the rest of the
suite is untouched. `tsc --noEmit` + eslint clean.
