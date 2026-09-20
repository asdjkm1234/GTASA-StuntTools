# Postmortem

**Where dead directions are laid to rest — with the reason.** When a [concept](../concepts/README.md)
(or an in-flight plan) fails its go/no-go, it does NOT just get deleted: we write down *what we tried, what we
measured, and why it did not work*, so the same dead-end is never re-run from scratch. See the full lifecycle
in [docs/README.md](../README.md):

```
concept  →  docs/plans/       (validated — we build it)
         ↘  docs/postmortem/  (died — recorded here)
```

Each postmortem should carry: the goal, where the code lives (branch/commit, if any), the measurements or
observations that killed it, and the conditions under which it might be worth revisiting.

## Postmortems

- [uv-stretch-repair.md](./uv-stretch-repair.md) — the `repair-uv-stretch` map-optimizer pass (plan 025),
  built and retired the SAME day (2026-08-11) on the field's verdict. It repaired 3 849 faces across 104
  models and passed every measured guard, and the first before/after look reversed it: a partial repair of a
  *continuous* UV defect converts a soft smear into hard-edged patchwork, and the "correct" mapping it wrote
  is invented — there is no authored frame to restore (model fit residual ~1.8 UV). Keeps the two structural
  reasons no automated repair survives here, what IS still valid (the scanner, the diagnosis that it is R\*'s
  own data), and the one real exit: hand-authored UV fixes shipped as data
- ~~07-2dfx-on-baked-cells.md~~ — **REVIVED the same day, 2026-08-07**, and no longer rests here. Roadsigns
  and escalators onto `opensa-lod-generator`'s baked cells died when its two premises failed measurement and
  the user closed its last route; hours later that decision was reversed and the scope widened to both LOD
  generators. The research (world-space sign coordinates 489/489; nothing reads a cell LOD's 2dfx section;
  the HD/LOD radii that size the gap; escalators having no consumer in OUR engine) lives on as step 00 of
  [plan 100](../plans/100-2dfx-at-lod-range/00-research-and-findings.md). The row stays so the death is not
  edited out of the record — a plan that died and came back is worth knowing about
- [universal-texture-transcode.md](./universal-texture-transcode.md) — Basis/KTX2 in `.ostex` with a
  transcode at load (plan 200 chain 2's original gate), replaced 2026-08-06 by a DIRECT ASTC encode in the
  converter. Not measured away: decided away, on the loss budget (one generation instead of two), on the
  fact that the target device carries ASTC natively, and on the moving parts a transcoder adds to the worker.
  The price accepted is that one pak no longer serves every GPU. Revisit when a single artefact for all
  devices becomes a requirement.
- [200-hotring-hotknife-intake.md](./097-hotring-hotknife-intake.md) — two CLEO vehicle mods
  analysed and cut the SAME day (2026-08-05) by the user's call: hotknife (paintjobs) cut
  entirely; hotring's CAR kept but `no_lights.cs` skipped — a polling loop for a one-shot effect
  belongs engine-native. Keeps the verified natives (`SetLightStatus@0x6C2100`,
  `CAutomobile+0x5A0`) and the fully recovered SA paintjob/remap mechanism (numbered TXDs,
  `remap*` textures, first-texture swap, spawn roll) for the day liveries or light damage are
  built engine-native — plus a live recording-host defect (`carInSphere` ignores `findNext`).
- [runtime-modloader-overlay.md](./runtime-modloader-overlay.md) — the boot-time `modloader/` overlay
  (`@opensa/modloader`, plan 058) and the runtime DFF fallback it fed, both removed 2026-07-28. Not measured
  away but ARGUED away: what a car carries beyond geometry — its `features.txt` pop-up declaration, its plate
  slots, its baked occlusion — is decided at BUILD time now, so a car served from a runtime `.dff` spawned
  silently WRONG rather than merely slower. Mods install into the game dir instead (`mod-installer` /
  `vehicle-installer --rebake`). Carries the condition for revisiting in-browser modding.
- [090-vehicle-cabin-at-night.md](./090-vehicle-cabin-at-night.md) — the sky-gated reflection (`3e37d10`) and
  the whole 090 cabin chain (night relax + a lit cabin + one dash lamp), built and REVERTED the same day
  (`ae6548e`) on the field's verdict. The measured data was never wrong; it just never answered what the eye
  was asking, because **not one in-engine capture was taken in three rounds of look-work**. Carries the
  flat-varying artefact (a per-vertex flag drawn through `@interpolate(flat)` = hard triangular patches) and
  the noisy-bake-threshold speckle. The symptoms stay open in
  [`open-issues/vehicle-cabin-lighting.md`](../open-issues/vehicle-cabin-lighting.md).
- [modern-cell-tooling.md](./modern-cell-tooling.md) — custom `.cell` format + baked channels + static
  batching/atlasing (plans 066 + opensa-lod-generator 005–010). No measurable perf/quality gain; code parked
  on `backup/tooling-experiment`. Produced the CPU-bound-on-draw-calls diagnosis that led to the own engine
  (074).
- [080-cinematic-camera/multiray-collision.md](./080-cinematic-camera/multiray-collision.md) — the multi-ray
  collision fan (plan 080/04), the WORST variant of the chain. Built (`811bca9`) and field-rejected same day
  (`e1541ec`): the boolean all-hit gate is discontinuous, so the camera JUMPED instead of sliding approaching
  a house. Lesson: collision must stay a continuous function of approach, not a boolean gate. Carries the
  "On Top" revisit note.
- [080-cinematic-camera/collision-collider.md](./080-cinematic-camera/collision-collider.md) — a kinematic
  sphere COLLIDER (move-and-slide) for the same collision (plan 080/04). Rejected by reasoning, never coded:
  character controllers stick in the game's many narrow nooks, the classic reason spring-arm cameras use a
  cast, not a body. Kept the simple single sphere cast + near-plane cap.
- [081-vehicle-physics/sa-faithful-feel.md](./081-vehicle-physics/sa-faithful-feel.md) — three SA-derived
  tyre scales and the full 2g experiment (SA gravity + SA springs, branch `081-08-sa-gravity`, complete and
  measured), all field-rejected in one day. Produced the two findings the next step stands on: the "weak at
  speed" complaint is a SHAPE (μ·g vs v²), not a scale — and this project's feel target is the field's
  verdict, not the original's numbers.
- [asi-perfect-vegetation-view-weighted-cards.md](./asi-perfect-vegetation-view-weighted-cards.md) — the
  fourth `asi/sdk` consumer: a render-callback wrap that would weight each impostor card's material alpha by
  how squarely it faces the camera, so a tree LOD shows ONE canopy projection from every angle
  (lod-trees 013 cause 1). Scaffolded 2026-08-21 (`8faafc67`), **removed 2026-08-22 without a single exe site
  ever being read** — not disproved, just out of a reason: cause 1 measured as mostly cause 3, OpenSA's
  cutout weld lands at ×0.97 of the HD on its own, and the `sa` half reached the same parity in the DATA
  (step 06's second cage, 3 cards thinned per tree). Keeps the mechanism, the rule it demonstrates (an ASI is
  for what data cannot say), the alpha-reference-100 cliff any successor inherits, and the field trigger that
  would revive it — whose answer for OpenSA would be a material class, not a plugin
