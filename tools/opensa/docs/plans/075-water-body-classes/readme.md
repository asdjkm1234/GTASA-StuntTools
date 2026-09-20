# 075 — Water body classes: SEA vs INLAND (differentiated water effects)

[← plans index](README.md) · related: [069 water](../069-water/readme.md) · engine home: [074/06 row 12](../074-opensa-engine/06-world-effects-parity.md)

**Status: SHIPPED + FIELD-CONFIRMED (2026-07-15) — CLOSED.** User: inland water calm + livelier ("water is livelier").
Bake classifies each water.dat quad by height (z > 1 m ⇒ INLAND), carries a per-vertex class in `water.bin`
(stride 16 → 20), and the `water` WGSL zeroes swell/surf/swash/foam for inland (+ a `calmRipple` normal so a
still pool shimmers) while the sea path is untouched. pak-map reconverted: **2,895 INLAND verts / 61,946 SEA**
(inland z 2.8 – 1082 m: pools, reservoirs, casino interiors). tsc + eslint clean, golden WGSL snapshot updated.

<details><summary>Original field report + design (2026-07-15)</summary>

Field report (2026-07-15): elevated INLAND water (the LV pools/basins,
reservoirs, mountain lakes) is rendered with the OCEAN's full dynamics — swell displacement, surf front, swash
surge and foam — so a contained pool visibly **spills its waves past its edges** and reads as choppy sea where
it should be a calm sheet. The ocean itself is correct. One water surface, one set of effects, is the root.

## What exists today

- **One mesh, one behaviour.** `tools/opensa-pack/src/water.ts` tessellates EVERY `water.dat` polygon (+ the
  offshore ocean frame) into one `water.bin` — vertex `[x, y, z, depth]` (stride 16), where `depth` is the
  baked water−ground field. The engine's `water` WGSL (`vsWater`/`fsWater`, `packages/engine/src/render/shaders.ts`)
  applies to that whole mesh: Gerstner **displacement** (two long trains, shore-damped), the breaking **surf**
  front, the swash **surge** (±0.25 m breathing the waterline), and the **foam** band + shallow tint. Every one
  of those is an OCEAN effect.
- `water.dat` per-polygon type flag exists but is dropped by `parseWater` (`water.parser.ts`), and it does NOT
  cleanly separate the two kinds (measured below).

## The classifier — by HEIGHT (decided 2026-07-15)

The distinguishing signal is elevation above sea level. SA's ocean sits at **z ≈ 0**; every enclosed/inland
body sits ABOVE it. Measured on `game-src/original/data/water.dat` (307 polys):

| z band         | polys | reading                                        |
| -------------- | ----- | ---------------------------------------------- |
| \|z\| < 1 (≈0) | 263   | **SEA** — the open ocean sheet + shore quads   |
| z > 1 (1–60)   | ~44   | **INLAND** — pools, reservoirs, mountain lakes |

The `water.dat` flag (`1`×284, `3`×21, `0`×2) does not split them (flag 1 covers both sea and inland), so it
is NOT used. **Rule: a polygon is INLAND when its (flat) water z > `SEA_LEVEL_MAX` (≈ 1.0 m); else SEA.** The
offshore ocean frame is always SEA.

**v1 limitation (accepted):** rivers/canals that sit AT sea level (z ≈ 0) stay classed SEA and keep gentle
waves. The reported bug (elevated pools) is fully fixed; a sea-level river that reads wrong later escalates to
v2 (connectivity/width classifier — see open questions).

## Naming

Replace the loose "ocean/inner" with the matched geographic pair **`sea` / `inland`** (self-documenting, and it
mirrors the z-classification: sea level vs above it). The per-vertex value is a `waterClass` (0 = sea,
1 = inland). Behaviour-first alternatives considered and rejected as less obvious in data/UX terms: `tidal/still`,
`open/calm`.

## Design

1. **Bake (`water.ts`)** — classify each `water.dat` quad by z; the offshore frame is always SEA. Carry the
   class per vertex. `water.bin` vertex grows `[x, y, z, depth]` → `[x, y, z, depth, class]` (stride 16 → 20;
   +25 % on a ~2.3 MB loose file — negligible). Bump the `water.bin` layout comment; the manifest already
   stores only vertex/index COUNTS, so no manifest schema change.
   - _Encoding note:_ an explicit 5th float is chosen over the sign-of-`depth` sentinel trick — the format is
     ours end-to-end (bake → host → engine) and explicitness beats a hidden flag (CLAUDE.md rule).
2. **Host loader** (the game side that reads `water.bin` and calls `engine.setWater`) — interleave the class
   into the vertex data it hands the engine (GTA→engine axis change already happens there).
3. **Engine** — the `water` pipeline vertex layout gains `@location(2) waterClass: f32` (stride 20);
   `setWater` uploads the wider stride.
4. **WGSL (`vsWater`/`fsWater`)** — gate every ocean dynamic on `waterClass < 0.5`:
   - `vsWater`: INLAND ⇒ NO displacement (swell + surf + surge all zeroed) — this is what stops the spillover.
   - `fsWater`: INLAND ⇒ no foam, no surf/swash, a much smaller ripple-driven normal (tiny shimmer only),
     simpler fresnel tint toward the sky. SEA path unchanged.
   - Keep it uniform-gated / branch-light (the wave code already runs per pixel; a `select`/`mix` by class is
     cheap and keeps one pipeline).

## Files

- `tools/opensa-pack/src/water.ts` (classify + emit class), `water.test.ts` (a sea quad @ z0 and an inland quad
  @ z>1 → correct class bytes; spillover-relevant vertices flagged).
- `packages/engine/src/render/pipelines.ts` (water vertex layout stride 16→20 + attribute),
  `packages/engine/src/render/shaders.ts` (class gate in `vsWater`/`fsWater`), `packages/engine/src/engine.ts`
  (`setWater` stride), golden WGSL snapshot.
- The host water loader (interleave class).

## Done means

- The LV pool/basin renders as a calm sheet — no waves, no foam, water stays inside its edges — while the ocean
  keeps its swell/surf/swash/foam and shoreline exactly as today. **Reconvert required** (`water.bin` grew a
  per-vertex class). Field-check a pool, a reservoir, and a beach in one session.

## Open questions / v2

- **Sea-level rivers/canals** (z ≈ 0) are classed SEA in v1. If one reads wrong, add a v2 signal: flood-fill
  connectivity to the ocean frame (enclosed body ⇒ inland) or a width/area test (narrow ⇒ inland).
- **Inland tuning**: ~~faint ripple vs dead-flat mirror?~~ DONE (2026-07-15, user asked to make it livelier):
  `calmRipple()` — two gentle criss-crossing ripple trains + a lazy wide drift perturbing the LIGHTING NORMAL
  ONLY (no displacement → no spillover), plus the ripple-texture weight raised 0.35 → 0.6 for inland, so the
  reflection and sun glint shimmer and slide on a still pool. Shader-only (no reconvert). Amplitudes are small;
  bump `calmRipple` constants if the field wants more life.
- **Fountains / moving inland water** (the LV canal boats, waterfalls) are out of scope here — those are 2dfx
  particles / UV-scroll, not `water.dat`.

</details>
