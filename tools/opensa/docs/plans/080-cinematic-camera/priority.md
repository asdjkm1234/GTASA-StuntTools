# 080 — execution priority

The order is a dependency chain, not a preference list: each plan consumes machinery the previous
one ships, and each ends with a field round so tuning debt never stacks more than one layer deep.

| Order | Plan                            | Why it sits here                                                                                                                                                                                                                                                             |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **01 Foundations**              | Everything else imports it: damp/spring math, the director skeleton with the layer order, config fields, debug tab, `?cam=legacy`, and the free-fly/map-viewer mode moved in at parity. Ships zero feel change — pure seams — so it can land any time without a field round. |
| 2     | **02 Follow rig**               | The core feel (input dampening, lag, springs, dead zone, vertical softness). Every later plan writes to channels 02 creates; tuning them first means later rounds tune ONE new thing at a time. First field round.                                                           |
| 3     | **03 Auto-center + look-ahead** | Pure writers on 02's channels — cheapest possible plan once 02 exists, and it completes the on-foot baseline (the no-input experience). Must precede collision so 04 can test the recenter-vs-collision interaction.                                                         |
| 4     | **04 Collision**                | Needs the FINAL on-foot rig pose to defend (02+03). Blocks vehicles: driving into buildings/tunnels without camera collision would poison the 05 field round. Also the only plan adding physics API — land it before the vehicle variant consumes it.                        |
| 5     | **05 Vehicle camera**           | The biggest payoff, deliberately after the rig+collision base: it is a retune + new writers, not new machinery. Drive-heavy field round.                                                                                                                                     |
| 6     | **06 Motion feel**              | Additive layer on top of the collision-resolved pose (its caps are defined relative to 04's margin), and its vehicle-impact shake needs 05's mode plumbing. Comfort-sensitive → latest possible, easiest to cut/scale.                                                       |
| 7     | **07 Transitions + polish**     | Needs all layers to audit transitions between them; freezes tuning, runs the perf/bench exit exam, deletes the legacy path. The chain's close-out.                                                                                                                           |
| 8     | **08 View presets**             | Added 2026-07-25. Needs 05 (the vehicle ring is half the feature) and 04 (first person opts OUT of collision), and its preset blends belong to 07's transition audit — so it runs after 05, alongside or just before 07. Its ARCHITECTURE, however, constrains 02-06 from now on: every tuned value stays in `CameraConfig`, so a preset is a different config object, never a second code path. |

## Checkpoint rhythm

- **After 02, 03, 04, 05, 06, 08**: user field round; verdicts + frozen values go into that plan's
  ledger before the next plan starts. A rejected round loops within its plan (every tuned value is a
  `CameraConfig` field on the debug Camera tab, so a bad channel can be zeroed live instead of blocking
  play — that replaced the `?cam=legacy` A/B, deleted 2026-07-25).
- **After 01 and 07**: ritual bench sweep (the two points where host wiring changes shape) —
  proof the bench bypass invariant holds, plus a map-viewer field check (01 moves the fly path,
  07 audits the viewer ⇄ gameplay blend).
- Plans 02+03 may be reviewed in one combined field round if 02's round is delayed — they are the
  only adjacent pair without new host/physics surface between them. No other merging: each later
  plan changes a different axis (physics API / vehicle mode / comfort) and needs its own verdict.

## Fast path

If a minimal "feels good this week" cut is wanted: 01 → 02 → 03 gives the complete on-foot
cinematic baseline with no physics or vehicle work; 04+05 make it survive real gameplay;
06+07 are the last 10 % of feel and the close-out. The chain is designed so stopping after any
field-accepted plan leaves the game in a shippable state.
