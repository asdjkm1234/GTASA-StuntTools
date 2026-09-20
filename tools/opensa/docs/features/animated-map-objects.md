# Animated map objects (plan 041)

UV animations: `packages/renderware/src/parsers/binary/dff.ts` (UVAnimDict parsing),
`tools/opensa-pack/src/weld.ts` (per-object kind-4 registry baked into the pak),
`packages/engine/src/render/shaders.ts` (the per-cell `uvAnim` uniform, and the rigid lane's
`rigidUvAnim`), `packages/engine/src/render/uv-anim.ts` (the keyframe walker both lanes step through),
`packages/renderware/src/vehicle/build-vehicle-model.ts` (the rigid builder's material → dict binding).
IFP-animated clumps: `packages/renderware/src/anim/frame-clip.ts` (frames-as-bones clip),
`packages/engine/src/anim/` (`IfpSampler`), host wiring in `apps/web/src/ui/engine-anim-objects.ts`.

## Implemented

**UV-animated textures** (signs, waterfalls — e.g. the LV skull sign `visagesign04`)

- UVAnimDict parsed from the DFF; materials reference entries by name (UV Anim PLG).
- Registry: one shared `(offX, offY, sclX, sclY)` value per dict entry — the converter records the
  animation list in the pak manifest and gives every affected object a kind-4 `objectTable` entry
  carrying its slot, so all instances animate in sync (vanilla behaviour) with no vertex-format growth.
- Generic keyframe-pair lerp looping over the duration; equal-time key pairs snap (stepped
  flipbooks like `DolSign`). Scroll direction verified against the original game (no flip).
- The world shader applies it per object cell: `uv = uv * scale + offset`.
- **The RIGID lane plays the same animations** (plan 099): a script-spawned object, a prop, the `.osm`
  spike — anything uploaded through `createVehicleModel`. Its list is MODEL-local rather than a pak-wide
  registry (a rigid model streams in and out on its own), and a per-draw dynamic offset picks the
  submesh's slot out of one uniform whose slot 0 is the identity. Both lanes step through the same
  walker (`packages/engine/src/render/uv-anim.ts`) on the same frame clock, so a sign on a building and
  a sign on a script object cannot drift. A model that animates nothing allocates no buffer, writes
  nothing per frame and binds the shared identity — the Pacific Park ferris wheel's blinking bulb ring
  is what this exists for.

**IFP-animated clump objects** (IDE `anim` section — oil pumps, windmills, fans)

- `anim` defs are excluded from the merged cell batch; each instance keeps its **frame hierarchy with
  transforms KEPT** (the one exception to the map's frames-ignored rule), one rigid part per atomic
  under its named frame node. The converter leaves only the MOVING frames out of the cell bundle, so
  the static host (e.g. the `burger01_LAw` diner) still batches.
- The clip comes from `<def.anim>.ifp`, named after the model, bones bound by frame name;
  translation is KEPT (object clips animate part positions — unlike ped clips).
- A frame hierarchy is just a skeleton where every vertex has one bone, so the engine's existing
  `IfpSampler` drives it with identity inverse-binds — no new pipeline, no new shader. Streamed-out
  objects stop being updated and resume on re-entry.

## Known gaps / candidates

- Moving parts don't cast the dynamic shadow (cheap to enable per object — open note).
- Moving parts have no animated collision.
- ANP3 time scale is the ped-tuned 1/60 (verified fine on the pumps).

## Test coverage anchors

`parsers/binary/uv-anim.test.ts` (parse/interp/real asset), `engine.uv-anim.test.ts` (the rigid lane:
zero cost without animations, the advance, the per-submesh dynamic offset), `vehicle/build-vehicle-model.test.ts`
+ `opensa-pack/model-osm-uv-anim.test.ts` (the bake and the `.osm` round trip, on the real ferris ring),
`roadsign.test.ts` shares the 2dfx walk,
`anim/frame-clip.test.ts` (frames-as-bones clip), `engine/src/anim/ifp-sampler.test.ts`,
`ide.parser` anim rows, `ifp` parser tests.
