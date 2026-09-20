# First-person camera

> ## ⛔ Step 0 — before ANY work on this idea
>
> **Download this mod and study how it does it, then report back before anything is designed or built:**
>
> **<https://libertycity.net/files/gta-san-andreas/239321-ultimate-first-person-beta.html>** — "Ultimate
> First Person (beta)"
>
> The user's call, 2026-08-11. It is prior art for exactly the questions section 5 leaves open — how the
> head is hidden without clipping, what happens to weapon aim and vehicle interiors, and how much of it is
> camera work versus model work. **What is written below was reasoned from our own engine and has never
> been checked against a shipped implementation**, so treat the mod as evidence and this page as the
> hypothesis it gets to correct.

**Status: IDEA (2026-07-25).** Written at the close of the [080 cinematic-camera
chain](../../plans/080-cinematic-camera/readme.md), while everything it learned is still fresh. Nothing here
is scheduled — [0.6.0·07 view presets](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md) holds the C-key preset
ring that would carry it, and it is deliberately NOT next.

The question that decides the whole thing was asked directly: **can we find the character's head, so the
camera can sit there and the head can be taken out of the shot?** The answer is yes, and it is measured
below rather than assumed.

## 1. The head is a real, named bone — measured

Dumped from a stock ped (`fixtures/original/character/bmypol1.dff`) through the shipping
`buildPedModel` path — SKIN ORDER, HAnim ids, and each bone's bind offset from its parent:

```
0  id=0   parent=-1  Root       bind=[ 0.000, 0.000, 0.000]
1  id=1   parent=0   Pelvis     bind=[ 0.000, 0.000, 0.000]
2  id=2   parent=1   Spine      bind=[-0.001, 0.000,-0.001]
3  id=3   parent=2   Spine1     bind=[ 0.190, 0.000, 0.000]
4  id=4   parent=3   Neck       bind=[ 0.289, 0.000, 0.000]
5  id=5   parent=4   Head       bind=[ 0.114, 0.000, 0.000]   ← here
6  id=8   parent=5   Jaw        …          (7 = L Brow, 8 = R Brow, also parented to Head)
```

Facts that matter:

- **`Head` is HAnim bone id 5**, parented to `Neck` (4). `pedClip` already resolves bones **by id first,
  trimmed name second** — so the same two-key lookup finds the head on a ped whose exporter renamed it, and
  degrades to the name when a mod ships no ids. That resolution rule is shipped code, not new work.
- The bind chain runs along the ped's local **+X** (Spine1 0.190 → Neck 0.289 → Head 0.114 above its
  parent): SA's bind mesh lies flat along X, which `engine-player.ts` already documents and handles.
- The skeleton also carries `Jaw` and both brows as CHILDREN of the head — anything parented under bone 5
  travels with it, which is what makes the hiding trick below work for hats and hair too.

## 2. The head's live world matrix already exists in memory

`IfpSampler` (`packages/engine/src/anim/ifp-sampler.ts`) walks the parent chain every frame and keeps a
private `worlds: Float32Array` — one **world matrix per bone** — before multiplying each by its inverse bind
to produce the GPU palette. The head's world matrix is therefore already computed for every animated frame;
exposing it is one accessor (`boneWorld(index)`), not a new system.

Two ordering facts make this usable rather than theoretical:

- `engine-player.ts` advances the clip clock and uploads the palette **once per RENDERED frame**, not per
  fixed step — so the matrix is at the drawn pose, the same one the render-interpolated body is at.
- In the host loop, `posePlayer(...)` runs **before** the camera snapshot is assembled. A first-person
  camera reading the head this frame reads the pose the player is about to SEE, with no one-frame lag and no
  re-ordering of the loop.

The eye is not the head bone's origin (that sits at the base of the skull). The camera would be
`headWorld × <a small authored offset in head space>` — forward and up by a few centimetres. Per the
chain's standing rule that goes in `CameraConfig`, so a field round can move it without a rebuild.

## 3. Taking the head out of the shot

Two ways, and the cheap one is very cheap:

**(a) Collapse the head bone in the palette.** Write a zero-scale matrix into the head's palette slot and
every vertex weighted to it degenerates to a point — no mesh surgery, no second model, no rebuild, and hats,
hair, brows and jaw all vanish with it because they are weighted to bone 5 or parented under it. One line at
palette-upload time, gated by the preset.

Its known cost: vertices weighted PARTLY to the head (the neck blend) collapse partially, so the neck
stretches toward the vanished head. In practice the collar and the near plane hide it; whether it reads
badly on SA's low-poly necks is exactly the sort of thing only a field look answers.

**(b) A first-person mesh variant.** `PedModelData` carries `joints` (4 bone indices per vertex) and
`weights`, so the converter — or the host at build time — could drop every vertex whose dominant bone is the
head. Cleaner necks, but it is a second model per ped and a build-path change. Only worth it if (a) is
rejected in the field.

**Neither solves the torso.** With the eye inside the skull, the ped's own shoulders, chest and arms sit
across the near plane (0.5 m). The options, in increasing order of work: raise nothing and accept clipping;
drop the near plane for the preset (it is a `resolveCamera` field already); collapse the upper-body bones
too; or hide the player model outright — which is what plan 08 assumed, and what most third-person games do
when they ship a first-person toggle.

## 4. What the 080 chain already hands it

This is why the idea is worth writing down now:

- **A preset is a config object, not a code path.** `stepCamera(state, snapshot, config)` picks its numbers
  from the config it is handed; driving already runs as a second tuning table through `vehicleTuning`. A
  first-person preset is the same trick with `followDistance: 0` plus a focus swap.
- **The transition is already tested.** `camera-transitions.test.ts` walks the mode matrix and asserts the
  eye never moves against its focus by more than 1 u/frame outside declared transitions — a new mode plugs
  into that exam instead of needing its own.
- **The landing dip gets its second chance.** It is implemented, tested and shipped OFF because 20 cm of
  frame drop is invisible at a 7 m orbit. At the head it IS the effect: `landingDipScale` becomes a preset
  value rather than a global. Same for the bob — a head-mounted bob needs a fraction of the third-person
  amplitude, and the frequency lesson (it is CYCLES PER METRE, and 4.9 Hz reads as a vibration) transfers
  directly.
- **Collision goes quiet.** At distance 0 there is nothing between the eye and the look point to cast
  against; the floor guard likewise. That removes the layer most likely to fight a head-mounted camera.

## 5. Open questions (the go/no-go this idea has to survive)

1. **Does SA's head animation shake the camera?** The clips were authored for a third-person view and the
   head track is not smooth. A damped filter on the head matrix is the standard answer and `@opensa/math`'s
   damp/spring helpers are right there — but how much filtering before it stops feeling attached to the body
   is a field question.
2. **Pitch range.** Looking down should show the body, which means the pitch clamp is a preset value and the
   collapsed-head trick must not leave a stump in view.
3. **Seated.** The head is inside a car whose interior is drawn from outside; the near plane and the
   collapsed head interact with the cabin geometry differently than on foot. Plan 08 lists a bumper view
   separately for a reason.
4. **Aim.** First person implies the crosshair IS the aim; that touches whatever shooting eventually looks
   like, which does not exist yet.
5. **Comfort.** The chain's field rounds were consistently sensitive to motion — a head camera amplifies
   every one of those channels, so `reducedMotion` likely needs a first-person default of its own.

## 6. What would make it a plan

**Step 0 is the mod at the top of this file** — study a shipped first-person implementation before spending a
measurement on a question it may already answer. Then measure, in this order, before committing:

1. Expose `boneWorld` and print the head's world position across a walk cycle — confirm it tracks the drawn
   head and quantify how much it shakes (this is question 1, answered with numbers).
2. Collapse the head in the palette on the live player and LOOK at the neck from third person — that alone
   decides (a) vs (b).
3. Park a camera at the head with the rig otherwise untouched and walk around: near-plane clipping against
   the ped's own body is the thing that either kills it or sets the model-hiding requirement.

Only then does it earn a plan — most likely as the substance of 0.6.0·07's first-person preset rather than a
plan of its own.
