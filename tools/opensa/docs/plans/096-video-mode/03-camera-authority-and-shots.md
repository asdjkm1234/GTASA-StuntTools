# 096/03 — Video camera authority + shot presets + framing

**Priority P1. Ships alone: the drive scene from 02 is now filmed — car-anchored shots (chase, front,
rear, wing) with rule-of-thirds framing and declared cuts. Tripod stations (world-anchored) follow in 04.**

**SHIPPED 2026-07-30.** Numbers in the plan readme's ledger. What the phase did differently from this doc,
and why:

- **Shot names are the CAMERA's placement, not the car's face.** This doc's `rear` ("camera ahead looking
  back") and `front` ("camera behind-high") read backwards to each other in a log line, so they shipped as
  `nose` (ahead, looking back) and `high` (behind and above). Same two shots, a name a field report can use.
- **The example multipliers were too tight to clear the car.** `1.4 × halfExtents.x` puts a wing camera
  0.36 m off the bodywork of a saloon; the shipped wing is `5 ×` (4.5 m) and the flyby `6 ×` (5.4 m). The
  half-extent SCALING is the rule that mattered and it is intact — only the constants moved, and they moved
  against a measurement (see the ledger's flyby note).
- **The pan cap is enforced by an exact rotation** (Rodrigues about the axis the two directions span), not by
  the normalized lerp the first cut used: nlerp overshoots the cap by a hair on a fast pass, and a cap a test
  cannot pin to its own value is not a cap.
- **`ALSO=<tag>` was added to `tools-debug/bench-harness/drive.js`** — the acceptance needed the `[cam]`
  watchdog echoed while `[video]` reports were being counted, and the harness could only follow one protocol.
- **Not built: task 6's early-cut for a subject that has left the frame is the 1.5 s clock, nothing more.**
  A shorter window for "the car is BEHIND the camera" was written, measured and REVERTED: a tripod pans with
  the car, so it is almost never behind the eye — the condition was a misdiagnosis of what the pan-cap lag
  had done to the flyby.

## What exists

- `resolveCamera` priority chain `bench > flyEye > follow` (`apps/web/src/ui/camera/engine-camera.ts:87-110`),
  pinned by `engine-camera.test.ts`; `benchCamera` as the external-owner precedent
  (`engine-canvas-host.tsx:1182`, `camera-director.ts:99-101`, whitelisted by the `[cam]` watchdog at
  `:1981`).
- FOV is a live animated output (`CameraState.fovYRad`, damped on the rig; projection rebuilt each frame).
- `screenBasis(forward)` (`engine-camera.ts:113`) — the exact rows of `mat4LookAt`, i.e. the tool for
  placing a subject at a chosen screen anchor.
- Damping: `@opensa/math` `damp/dampAngle/smoothDamp/smoothDampAngle` with caller-owned velocity refs.
- Car anchors, all DERIVED from the asset (the CLAUDE.md rule — never per-model constants):
  `renderPosition`/`renderOrientation` (body→world, render-interpolated), `halfExtents`,
  `VehiclePartInfo.position`, `lampAnchor('head'|'tail')` (`vehicle-handle.ts`).
- The continuity exam: `camera-transitions.test.ts` asserts `|Δeye − Δfocus| ≤ 1 u/frame` outside
  DECLARED cut frames; `watchCameraJump` whitelist (`engine-canvas-host.tsx:1961-2000`).
- Roll does not exist (`resolveCamera` hard-codes `up: [0,1,0]`) — v1 shoots level; no Dutch tilt.

## Tasks

### A. Authority

1. Add the `video` slot to `resolveCamera`: priority `bench > video > flyEye > follow` (rationale in the
   plan readme §3 — bench numbers untouchable, video is a scripted run, fly stays the interactive escape
   BELOW it because during a recording an accidental K+M must not steal the frame). The slot carries
   `{ eye, target, fovYRad? }` engine Y-up, `null` when video mode is off.
2. Update `engine-camera.test.ts` (the priority pin) and add video to the `watchCameraJump` whitelist —
   but ONLY between declared cuts: the module raises a `cutFrame` flag the watchdog block reads, so an
   UNdeclared jump still trips diagnostics (the watchdog stays a real tripwire, per constraint 8).
3. Host accessor `setVideoCamera(pose | null)` mirroring `setBenchCamera` (`:1642-1644`) — added to
   `VideoRunsHost`.

### B. Shot system (`apps/web/src/ui/video/shots.ts`, `director.ts`)

4. `ShotPreset` (config objects, one table — never a code path per shot; the 080 preset rule):
   - `chase` — the shipped follow rig IS this shot: the director simply yields authority (writes `null`)
     for chase segments. Zero new camera math, and the rig's collision/motion layers come free.
   - `rear` (car front-on, camera ahead looking back), `front` (camera behind-high), `wing-l/r`
     (lateral, low), `flyby` (static-velocity pass) — each defined as: an anchor offset **in the car's
     heading frame, scaled by `halfExtents`** (e.g. wing = `1.4 × halfExtents.x` lateral, `0.9 ×
     halfExtents.z` height), a screen anchor for the subject, an FOV, min/max duration, and a damping
     profile. Offsets in the SUBJECT's heading frame, never the camera's screen frame — the
     `docs/edge-cases/camera-rig.md` composition trap.
5. **Framing math**: given desired subject screen anchor `(sx, sy)` (thirds/golden points — e.g.
   `(0.38, 0.55)`), compute `target` such that the car's centre projects there: offset the look point
   from the car by `screenBasis` right/up vectors scaled by `tan(fov/2) · distance · (0.5 − s)`.
   **Lead room** (D4's "drives into the frame"): pick the horizontal anchor on the side OPPOSITE the
   car's screen-space motion direction, so the car moves into open frame. Damped target and eye
   (`smoothDamp`, per-preset time constants); pan rate capped (start 60°/s) so a drive-past reads as a
   deliberate pan, not a whip.
6. **Cut scheduler** (`director.ts`): builds the scene's shot list up front from the seeded RNG (D9 —
   the shot list is part of the seed's contract): durations ≥ 5 s (D4), weighted preset picks, chase
   guaranteed at least once per scene. Executes cuts as hard camera swaps on declared frames behind a
   1-frame `cutFrame` flag; between cuts the pose is continuous by construction (damping). **Empty-frame
   guard v0** (full version in 04): if the subject's screen position leaves the safe frame
   (|s − 0.5| > 0.45) for > 1.5 s, cut early to the next shot — the "camera must not linger after the
   car passed" decision.
7. Add video legs to `camera-transitions.test.ts`'s sequence (cuts declared, continuity between them)
   and unit-test the framing math (subject anchor within ε at several distances/FOVs; lead-room side
   flips with motion direction). Negative cases first.

## Acceptance / verification

- Headless 5-seed run: subject inside the safe frame ≥ 95 % of non-cut frames (measured from projected
  car position in the telemetry line); 0 undeclared `[cam] jump` lines; all shots ≥ 5 s.
- Field look on the 02 corner route: cuts read as cuts (not glitches), car composed off-centre with lead
  room, drive-pasts end within 1.5 s of the car leaving frame.
- Ledger: safe-frame percentage per seed, cut counts, pan-rate clips.

## Risks / notes

- Car-anchored shots inherit the car's every vibration — the damping profile is the knob; if a shot
  still reads shaky at idle-speed, that is a field-round number, not a redesign.
- `flyby` at high closing speed can blow the pan cap — the guard cut (task 6) is the answer; do not
  raise the cap first (whip pans read as errors).
- No roll in v1: if a field round asks for horizon tilt, that is a `resolveCamera.up` one-line input
  change PLUS the standing 080 "no roll, ever" contract on the additive layer to renegotiate — flag it,
  do not sneak it.
