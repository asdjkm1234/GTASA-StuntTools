# 006 — One transform for a 2dfx entry

**Shipped 2026-08-07.** Came from
[07 — LOD generators, extended](../../../../docs/roadmap/0.5.0/readme.md)
(`lod-common/02`) and moved here when it landed. Depended on
[rw-codec/001](../../../rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) (the typed payloads) and
[005](005-2dfx-keep-policy.md) (the keep-policy).

## Context

Every LOD path already applied SOME transform to a carried 2dfx entry, and each did it differently:

- **decimate** (`collectClumpEffects`) mapped entry positions through `clumpFrameTransforms`;
- **cells** (`collectCellLightEffects`) mapped them through `instanceTransform` — instance rotation, instance
  position, cell origin;
- **verbatim** applied nothing, because the LOD inherits the model's own frame.

All three then handed the bytes to `build2dfxSection`, which overwrites the first 12 bytes with the new
position and leaves the rest untouched. So the shared behaviour was already "transform the position, keep the
payload" — spelled three times, and unable to express anything else.

## Decisions

1. **One entry point: `transform2dfxEntry(entry, transform)`**, replacing the implicit position-only rewrite.
   Opaque types behave exactly as before; a decodable type also gets its spatial payload rewritten.
2. **The transform is the caller's, not the function's** — `clumpFrameTransforms` and `instanceTransform` stay
   where they are.
3. **Rotation applies to directions, points get rotated and translated, and the difference is tested.**
4. **Non-uniform scale is out of scope and says so** — a scaled basis throws rather than stretching a plate.

## What shipped

`tools/lod-common/src/two-dfx-transform.ts` (`@opensa/lod-common/two-dfx-transform`):

- **opaque payloads** (light, particle, every undecoded type) — position moves, bytes verbatim, as before;
- **roadsign (7)** — the plate's Euler rotation is composed with the transform's rotation and decomposed back
  into the same convention;
- **escalator (10)** — bottom / top / end are carried as POINTS;
- a **rotation-identity short-circuit**: a translate-only transform leaves the payload byte-for-byte alone, so
  a plate is never rewritten by a move;
- **guards**: a scaled or mirrored basis throws.

Both call sites are rerouted: `collectClumpEffects` (decimate) and `collectCellLightEffects` (cells).

**The roadsign rotation convention now has ONE home.** `composeRoadsignRotation` (Z→X→Y, solver-verified) was
a private function in `packages/renderware/src/roadsign/glyph-quads.ts`; it is exported and named, and this
module builds its matrix by running it over the basis vectors rather than restating its terms. A second copy
of that convention is exactly the bug this plan exists to prevent.

## Tasks

- [x] `transform2dfxEntry(entry, transform)`: opaque path + typed path per decodable type.
- [x] Unit tests over the field classes (point moves and rotates, flag untouched, opaque payload identical).
- [x] Identity test: byte-for-byte for every type.
- [x] Reroute `collectClumpEffects` and `collectCellLightEffects`, keeping their current keep-sets.
- [x] Throw on a scaling transform; test it.

## Verification

`npx vitest run tools/lod-common tools/opensa-lod-generator tools/sa-lod-generator` — green, with **9 new
tests** in `two-dfx-transform.test.ts`. Every existing test is unchanged: the reroute did not need one
adjusted. **Re-measured 2026-08-07 after the chain landed: 35 files, 195 tests.** (The first figure written
here, 34/185, was read off the run taken BEFORE the new test file existed — a count belongs to the run it
came from, and this one did not.)

- **Identity transform is byte-identity** on all four carried types (roadsign, escalator, particle, light).
- **A turned plate faces where the HD plate faced**: the carried sign's plate normal — the text normal through
  `composeRoadsignRotation` — equals the transform applied to the HD normal, to 1e-5, and everything else in
  the payload (plate size, flags, all four text lines, the pad) is unchanged.
- **An escalator's step path rotates and translates; its `direction` does not move.**
- **A scaled basis and a mirrored basis both throw.**

## Measurements / notes

**Field classification per type**: roadsign — `rotation` is a DIRECTION triple (Euler degrees), everything else
opaque; escalator — `bottom`/`top`/`end` are POINTS, `direction` is a **u32 flag**; particle and light — no
spatial payload at all.

**The plan's decision 3 was wrong about one field, and the payload settled it.** It called an escalator's
`direction` a direction vector to be rotated. It is a u32 step-direction flag (0 or 1 across the whole stock
corpus); rotating it would have written a garbage float where an enum lives. Recorded here because the plan
was read as a spec, and a plan's assumption about code it has not read is a hypothesis.

**Two deviations from the plan, both deliberate:**

1. **The scale guard fires only where a payload is spatial**, not on every entry. A scaled transform applied to
   an opaque entry only scales its position, which is exactly what happens to the vertices beside it; making it
   throw would break a mod's model that works today for no gain. Stock has **0** scaled fx-geometry frames, so
   neither choice changes stock output.
2. **A translate-only transform does not rewrite a plate** (the short-circuit above). Without it, byte identity
   would fail on the stock plates: they sit at `rx = ±90`, the gimbal-locked case, where the Euler TRIPLE is
   not unique and re-encoding produces a different-but-equivalent triple. The rotation matrix is the invariant;
   the triple is not, which is why the test asserts the plate NORMAL.

**Why the reroute could not move any output, measured rather than argued**
(`npx tsx scripts/debug/two-dfx-census.ts --game original --frames`, 14 865 models, 1851 carrying 2dfx):

| fx-geometry frames | count |
| --- | --- |
| rotating | **0** |
| scaled | **0** |
| translating | 4 — `coastg`, `marquis`, `rcbaron`, `stunt`, all carrying type-0 lights only |

Only a ROTATING frame can change a payload, and no stock model carrying 2dfx has one; the four translating
frames are vehicles carrying coronas, which take the opaque path. The cell path carries type 0 only today, so
it is opaque there as well. That is a stronger statement than a golden diff: it says WHY nothing moved.

**The gimbal-locked branch is not an edge case here — it is the stock case.** All four `vegasnroad19` plates
are `rx = -90` or `+90`, so every real sign this code will ever turn goes through it. It is covered by the
plate-normal test rather than by an Euler comparison.
