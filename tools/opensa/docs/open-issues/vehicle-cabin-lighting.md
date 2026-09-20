# A modelled car interior: LIGHTING is wrong (bright dash, black cabin at night, red under braking)

**Status: open, first attempt reverted 2026-07-28.** Three symptoms on the same geometry — a mod car with a
fully modelled interior (`previon`, the 1986 Starion in `gostown`). One round of fixes shipped and was
withdrawn the same day; what was tried and why it failed is in
[`postmortem/090-vehicle-cabin-at-night.md`](../postmortem/090-vehicle-cabin-at-night.md).

> This file used to also carry the SEE-THROUGH family (cabin elements drawing crisp OVER the glass); that
> half was fixed 2026-08-04 on the comet — two defects, forensics in
> [`fixed/vehicle-glass-see-through.md`](fixed/vehicle-glass-see-through.md). **Before chasing anything
> below, re-shoot it on a REBAKED car**: both the blend roster and the blend order the measurements were
> taken against have changed since.

## The symptoms, paraphrased from the field

1. **The dashboard shows through the windscreen wrong** — from outside, the dash reads bright, "as if lit", and
   only under certain sunlight. In shade the effect is gone. (Paraphrased: it looks like it has a backlight
   and shows up very brightly on the glass, while the steering wheel still occludes it correctly.)
2. **The cabin is almost black at night**, from the interior camera — the seats are silhouettes.
3. **Interior parts turn red under braking.** Unverified and never chased.

## What is measured, so nobody re-derives it

All of it from `npx tsx scripts/debug/dump-vehicle-materials.ts gostown previon`, which reads the BUILT pak.

| geometry | material class | reflection | sky occlusion |
| --- | --- | --- | --- |
| dash trim (in `starion88_interior`) | **chrome**, coefficient 0.5, specular 25 | mirrors the live probe at HDR gain | 0.63 |
| rest of the interior / gauges / seats | matte | — | 0.32–0.69 |
| outer bodywork | paint / matte | coefficient 0.5 | 0.90–1.00 |
| glass | glass, alpha 150 | coefficient 0.05 | 0.95–1.00 |

- The mod's exporter stamps an **env map on every material it ships**, which is why cabin surfaces come out
  reflective at all. This is a known authoring habit, already noted in `build-vehicle-model.ts`.
- The car's night vertex-colour set **equals its day set** and both are `255,255,255` over most of the cabin,
  so the engine's `night − day` emissive channel can never fire for it.
- Its seat vertices' occlusion is NOISY, not banded: 23 % at sky 0.8–1.0, the rest at 0.2–0.5, scattered.
- The previon carries lamp tags only on `starion88_lights`, `misc_a` and `boot_ok`. **No cabin geometry
  carries a lamp tag**, and a car's own lamps go into the DYNAMIC light half, which vehicles do not read — so
  symptom 3 is neither of those. The remaining suspect is bloom (brake glow 4.0 against a 0.7 threshold)
  washing red over what is near it in screen space. Unverified.
- Two of that model's REAR lamps carry the FRONT-lamp marker colour (probably reverse lights marked wrong by
  the author) — cosmetic, listed here so it is not mistaken for an engine bug.
- **The STATIC light pool is the one light term the car's own occlusion does not gate — but it is LATENT, not
  live.** `out.poolDiffuse = localLightStatic(world, normal)` carries no `in.local.w`, where the indirect term
  beside it does, so a street lamp would light a dashboard as if the roof were not there. It accounts for
  nothing today: `fillLightPool` has pushed host dynamics ONLY since the 2026-07-17 static-2dfx removal, so
  `params3.x === params4.x` and `localLightStatic`'s range is empty every frame — a vehicle currently takes
  nothing at all from the pool. The bug fires the moment static lamps are readmitted (085 row E), with no
  warning. Read out of the shader, not measured in a scene.
- **A car cannot be lit by its own lamps, by construction.** The pool is ordered dynamic-first, and the
  vehicle path (`vsRigid`) reads only the STATIC range while a car's headlights are pushed as DYNAMIC — so
  "feed the cabin from the headlight source" is not a tuning question but a split that would have to be
  changed. See [`restrictions/engine-lighting.md`](../restrictions/engine-lighting.md).
- Whatever a rebaked car shows, it is not the reverted work: the rebaked previon carries only head (127) and
  tail (105) lamp tags — no cabin tag exists in the build, and no cabin code exists in the engine.

## What has NOT been done, and should be first

**No in-engine capture exists for any of this.** Every number above is offline. The repo's own triage method
(`docs/debug/README.md`, step 5) says that for anything the test suite cannot see, the shader is patched to
output its terms as colour and the game is shot headless — the bench harness does exactly that and was never
pointed at this car. Do that before forming another hypothesis:

- shoot symptom 1 at the sun angle that triggers it, with the reflection term, the specular term and the
  diffuse term each output alone, and find out which one is actually bright;
- shoot symptom 2 at a night hour from the interior camera, so "black" has a number;
- shoot symptom 3 while braking, with the bloom pass off, which settles the bloom question in one frame.

## Pointers

- The tool: `scripts/debug/dump-vehicle-materials.ts <game> <model>` — per submesh: class, lamp tag, night
  twin, minimum alpha, reflection slots, mean sky occlusion. **Its trap: `.osm` indices are BYTES; decode by
  `index16` or every number belongs to somebody else** (that mis-read produced one wrong verdict already).
- The car: `mods-src/gostown/vehicles/previon - 1986 Mitsubishi Starion ESI-R - mad_driver`, built into
  `build/gostown/opensa`.
- The lighting terms: `rigidShade` / `fsRigid` in `packages/engine/src/render/shaders.ts`; the per-vertex
  occlusion bake in `packages/renderware/src/vehicle/sky-occlusion.ts`.
