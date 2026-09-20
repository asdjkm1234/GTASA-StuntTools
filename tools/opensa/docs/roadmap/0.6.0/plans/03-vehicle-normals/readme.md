# 0.6.0 · 03 — Vehicle body normal smoothing

**Status: IDEA (parked by the user 2026-07-16: do not touch normals now, skip).**
Deferred out of [074/16 step 4](../../../../plans/074-opensa-engine/16-vehicle-paint.md) after steps 1–2
(probe + the skygfx-neo reflection model) were accepted; the reflections made the flat-facet problem less
pressing, and the quality mods in the user's set already ship smooth authored normals.

## The problem

Low-poly vehicle bodies (stock SA cars, simple mods like the funky Comet) read as "melting facets": their
DFFs either carry flat per-face normals or duplicate vertices along panel borders, so the neo reflection
LERP paints one constant environment sample per triangle and panel edges crease where the body should flow.
Field phrase that named it (paraphrased): no depth, the normals melt together.

## The design (settled during 074/16, ready to lift)

**Level: `buildVehicleModel`** (`packages/renderware/src/vehicle/build-vehicle-model.ts`) — CPU, at model
build time. This is the shared builder (the game builds cars at SPAWN, the bench fixtures use the same
code), so the fix needs **no pak reconvert, no shader change, no vertex-format change** — only different
values in the existing `normals` attribute.

Mechanics = the map-optimizer normals batch (plans 020–023, field-confirmed on the world):

1. **Preserve-authored gate** — if the DFF carries good smooth normals (the quality ./1 mods), touch
   nothing. Detect the same way plan 020 did (facet/duplicate heuristics), never overwrite good data.
2. **Angle-weighted recompute** with a **crease threshold** (~45°): wings and bonnets become continuous
   gradients; hard edges (bonnet lip, wheel arches) stay hard.
3. **Weld split vertices by position** before accumulation — SA models duplicate vertices along panel
   borders; without the weld the smooth normal still seams mid-door.

Shared machinery already exists at `tools/tool-kit/src/mesh/smooth-normals.ts` (the world batch), but
`packages/renderware` cannot import from `tools/` (nx boundaries) — port/extract the function into
`packages/renderware/src/mesh/` when implementing.

**Gate:** a bonnet shows a continuous reflection gradient, not one flat patch per triangle (the 074/16
step-4 gate, verbatim).

## Later, separate line

Procedural **orange-peel micro-normal** in the rigid shader (a real property of car paint) — shader-level,
independent of this builder work; listed in 074/16 step 4 as the optional second half.
