# 0.6.0 · 07 — Switchable view presets (the C key), first-person included

**Status: DEFERRED to 0.6.0 (2026-08-11, the user's call).** Was `080/08`; moved here whole when the rest of
[080](../../../../plans/080-cinematic-camera/readme.md) closed, so that chain has nothing left open and this
step stops reading as a debt against it. Verified unbuilt at the move: no `CameraPreset`, `cycleView` or
`cameraView` exists anywhere in the tree.

> ## ⛔ Two things to read before any work starts
>
> 1. **[`docs/ideas/first-person-camera/`](../../../../ideas/first-person-camera/readme.md)** — the researched
>    half of this plan, with the feasibility questions already answered from the code: the head IS a named
>    bone (HAnim id 5) with a live world matrix every rendered frame, and hiding it is a zero-scale palette
>    slot that takes hats and hair with it.
> 2. **That idea's own step 0 is a GATE**, and it applies here: download and study the "Ultimate First Person"
>    mod first. Everything below was reasoned from our own engine and has never been checked against a shipped
>    implementation — near-plane clipping against the ped's own torso, weapon aim and vehicle interiors are
>    exactly what it would correct.

**Originally added 2026-07-25 at the user's request**, deliberately written while 080 was still being built
so that no step in that chain hard-coded a value a preset would need to override. That constraint held, which
is why this can be picked up later without reworking the rig.

SA cycles camera views with a key; we want the same, plus a first-person view — and, more importantly, the
ARCHITECTURE for it, so no plan hard-codes assumptions that make a second view impossible.

## The shape

A **preset** is a named set of rig values, not a new code path. Every tuned number in this chain already
lives in `CameraConfig` and reaches the director as its `config` argument (plan 01's rule: no magic numbers
in the rig) — so a preset is simply a different object handed to the same `stepCamera`:

```ts
type CameraView = 'first' | 'third'; // what the rig frames — the ONLY structural flag

type CameraPreset = {
  key: string; // 'normal' | 'far' | 'close' | 'first-person' | 'bumper' | …
  label: string; // debug/HUD text
  view: CameraView;
  /** Overrides applied over the base `Config.camera` (distance, height, pitch clamps, lag times, FOV …). */
  rig: Partial<CameraConfig>;
};
```

- `Config.camera.presets: { foot: CameraPreset[]; vehicle: CameraPreset[] }` — **one ring per mode**, as SA
  has (on foot and in a car cycle independently, and each remembers its own choice). `fly` has no ring: the
  viewer/photo camera is a tool, not a view.
- The active index lives in `CameraRigState` (`presetIndex: { foot, vehicle }`), so it survives mode
  switches and is trivially serialisable later.
- Resolution is one pure function above the rig: `resolveTuning(config, mode, presetIndex) → CameraConfig`.
  The director does not learn about presets at all — it keeps taking one tuning object.
- **Input**: a `cycleView` intent in `CameraSnapshot` (the host reports the key edge, default binding
  `Config.controls.cameraView = 'KeyC'`, like the other bindings). The director advances the ring for the
  CURRENT mode. One place, no scattered key handling.
- **Switching is a transition**, not a jump: a preset change writes new targets into the same channels the
  follow rig already damps (distance, height, FOV), so the blend plan 07 builds covers it for free. The one
  case that cannot glide is third ⇄ first (the eye teleports into the head) — that gets a short fade or an
  instant cut, decided in the field round.

## What first-person actually costs (the real work of this plan)

Everything above is plumbing. The first-person VIEW is the part with real dependencies:

- **Eye anchor**: the eye must ride the ped's head, not `focus + followHeight` — the head bone's world
  matrix from the animated skeleton (`engine-player`/IFP sampler already poses it), plus a small forward
  offset so the near plane never clips the face. Falls back to `focus + eyeHeight` if the bone is absent
  (a modded ped may not carry it).
- **Hiding the player**: the ped must not be drawn (or at least not its head) — the engine has no
  per-instance "hide" for the player mesh today; that is the one engine-side addition this plan needs.
- **Collision layer opts out** (plan 04): there is nothing between the eye and the head to pull in.
- **Additive motion re-tunes, not re-uses** (plan 06): head bob that reads well in third person is nausea in
  first; the preset carries its own amplitudes, and `reducedMotion` must zero them here too.
- **Pitch clamps widen** — first person looks nearly straight up and down; the follow rig's clamps would
  feel broken.
- **The controller needs nothing**: `CharacterControllerSystem` already takes its forward from the camera
  shim, so movement stays camera-relative in either view.
- **Vehicle first person** is the same mechanism with a car anchor (bumper / dash dummy from the model's
  frames) instead of a head bone — worth shipping in the same plan since the ring is per mode.

## What it depends on — all of it already shipped

Written as "after 05, before/with 07" while [080](../../../../plans/080-cinematic-camera/readme.md) was live.
That chain is now closed and accepted, so **every dependency this plan had is in place**: the vehicle rig
exists (the vehicle ring is half the feature), the collision layer can be opted out of (04), and the
transition blends (07) will cover a preset switch for free. The standing constraint it placed on the rest of
the chain — that nothing in 02–06 hard-codes a value a preset would need to override — held, which is what
makes this pickable up later rather than a rework.

## Subtasks

- [ ] `CameraPreset`/`CameraView` types + `resolveTuning`; unit tests (ring wrap, per-mode independence,
      overrides applied over the base config, unknown/empty ring falls back to the base).
- [ ] `cycleView` intent through the snapshot + `Config.controls.cameraView` binding; host key edge.
- [ ] Default rings: foot `normal / far / close / first-person`, vehicle `normal / far / bumper /
      first-person`; values tuned in the field round.
- [ ] First-person anchor: head-bone matrix from the posed skeleton + forward offset + absent-bone
      fallback; unit test on the anchor math with a stubbed pose.
- [ ] Engine: hide the player's own mesh while `view === 'first'` (per-instance flag on the ped draw).
- [ ] Vehicle anchor: bumper/dash dummy lookup with a fallback to a body-space offset.
- [ ] Per-preset motion amplitudes + pitch clamps; `reducedMotion` still wins.
- [ ] Debug: the active preset on the HUD/Camera tab, and a row to cycle it without the key.
- [ ] **Field round**: cycle on foot and while driving, at speed, mid-jump, entering/leaving a car.

## Acceptance

- C cycles views on foot and in a car independently; the choice survives entering/leaving a vehicle.
- First person: no player mesh in frame, no clipping through the head, look range usable, movement still
  camera-relative, and the HUD/crosshair still make sense.
- A preset switch never snaps a channel the rig damps (distance/height/FOV glide); third ⇄ first is the one
  deliberate cut.
- Suite green; the director's cost stays inside the chain budget (0.1 ms p95).

## Ledger

_(append measurements + tuned values + field verdicts here)_
