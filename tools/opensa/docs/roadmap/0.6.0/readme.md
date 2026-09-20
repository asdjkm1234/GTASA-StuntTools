# Ideas — 0.6.0

Future-work plans for the 0.6.0 cycle. Same convention as [0.5.0](../0.5.0/readme.md): each feature is a
chain of small plans under [plans/](plans/).

## Dynamic vehicle deformation (VehDeform-style, GTA4 feel) — MOVED to ideas

Impact-driven MESH deformation of vehicle bodies graduated OUT of this scheduled cycle into a high-level
idea (it still needs a spike/tuning round before it can be a plan): see
[docs/ideas/vehdeform/readme.md](../../ideas/vehdeform/readme.md).

## Water realism (own-engine v4+)

The 074 water v3 (baked depth field, oscillating foam front, swash surge) hit the ceiling of "analytic
shader x 2005 sprite textures" — user parked it: the look needs AUTHORED textures first (foam atlas,
ocean normal maps — buying assets is approved), then live tuning knobs, a baked shore-direction field,
a refraction tap off the plan-09 scene target, and the Gerstner-Jacobian whitecaps carried over from the
deleted 0.5.0 water idea.

Full plan: [plans/02-water-realism/readme.md](plans/02-water-realism/readme.md).

## CAD depth — the dispatch console's missing half

The console ships in 0.5.0 ([plan 201](../../plans/201-dispatch-console/readme.md)) as a real map with a mock
desk: real world, real streaming, real picking, real operator chrome — and a client-side simulation standing
in for the operations feed. This is what a working dispatch system has that a mock does not: the **live feed**
(contract first — the source is a native CAD plugin on the client, the seam is already named in
`apps/dispatch/src/ops/sim.ts`, and there is no networking anywhere in this repo yet), **real routes** instead
of bearings (blocked on the `original`-only vehicle node graph), **history across shifts**, **multi-operator**,
and **install + offline**. Deferred on 2026-08-06 by decision rather than difficulty — except the within-shift
time axis, which moved forward into [201/8](../../plans/201-dispatch-console/8-the-time-axis/readme.md).

Full plan: [plans/05-dispatch-cad-depth/readme.md](plans/05-dispatch-cad-depth/readme.md).
## Air, water and rail vehicles (IDEA — parked recon facts)

Not scheduled work: the fact sheet the 098 all-land-vehicles recon produced about the out-of-scope
classes — boats' rows never parse (column-count guard), the `$`/`%` handling sub-tables are unread,
`anim.img` ingestion and the features module (`PLANE_SMOKE`) give them a landing path, and boats wait on
water realism. Full note: [plans/05-air-water-rail/readme.md](plans/05-air-water-rail/readme.md).

## Graphic improvements — shadows + street-lamp lighting (DRAFT)

A draft bundle of three parked look questions, kept together because one thinking round (possibly the
hd-realtime concept decision) may answer them all: (01) baked directional sun shadows, second attempt —
moved from roadmap/0.5.0/03, the receiver-densification prerequisite stands; (02) street-lamp surface
lighting v2 — light ALL lamps of the loaded HD cells at once (the 2026-07-17 field observation says the
budget likely exists), killing the ignition-pop artifact class by construction; (03) contact darkening/
shadows for dynamics — the "SSAO for cars/peds" question reformulated (near cascade / capsule AO / blob
v2 candidates); (04) real light from 2dfx coronas — 085 row E's Ten Green Bottles blink glow done
properly (blink-synced diffuse wash, wet-road specular, clustered lighting for the full strip).

Full bundle: [plans/04-graphic-improvements/readme.md](plans/04-graphic-improvements/readme.md).

## Anisotropic texture filtering (IDEA)

Every sampler in the engine runs at anisotropy 1 — `maxAnisotropy` appears nowhere in `packages/engine/src`.
Trilinear picks the mip from the LARGER UV derivative, so a grazing-angle surface (most of the ground, with a
chase camera) loses detail on the axis that was fine. That is why the original's authored UV stretch reads
harsher in OpenSA than in real SA, which is what the [025 texel-smear
investigation](../../../tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md) turned up next to
the data defect it was actually chasing. It SHARPENS rather than smooths, and it cannot repair a stretched
mapping — the two are independent. Deferred because it is a whole-world look change with an unmeasured frame
cost, and because doing it now would confound 025's field rounds.

Full plan: [plans/06-anisotropic-filtering/readme.md](plans/06-anisotropic-filtering/readme.md).

## Switchable camera view presets, first person included (the C key)

Was `080/08`, moved here whole on 2026-08-11 when the cinematic-camera chain closed — deferred work rather
than a debt against a finished chain. Verified unbuilt at the move: no `CameraPreset`, `cycleView` or
`cameraView` exists anywhere in the tree.

**Every dependency it had already shipped in 080** — the vehicle rig, an opt-out-able collision layer, the
transition blends that would cover a preset switch for free — and the constraint the plan placed on that
chain held (no step hard-codes a value a preset would need to override), so this is pickable up as written
rather than a rework. The plumbing is a config object handed to the same `stepCamera`; the real work is
first person: a head-bone eye anchor, hiding the player's own mesh, and re-tuned motion amplitudes.

**Two gates before any work**: the researched idea
[`docs/ideas/first-person-camera/`](../../ideas/first-person-camera/readme.md), and that idea's own step 0 —
study the "Ultimate First Person" mod, because everything written on both pages was reasoned from our engine
and has never been checked against a shipped implementation.

Full plan: [plans/07-camera-view-presets/readme.md](plans/07-camera-view-presets/readme.md).
