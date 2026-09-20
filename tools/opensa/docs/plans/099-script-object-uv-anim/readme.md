# Plan 099 — UV animations on script objects (the ferris wheel's blinking lights)

**STATUS: 🔒 CLOSED 2026-08-12** — all three steps shipped 2026-08-07; the user rebuilt and ran the game and
the bulbs step ("looks perfect"), and the `docs/edge-cases/engine-rendering.md` row is removed, the
limitation lifted. The numbers the chain still owed were taken 2026-08-12: **observed cadence 0.225 s
exactly** (130 strip steps across the 29.25 s loop, off the built fixture), **advance 132.2 ns/call** plus
one 16-byte write, and a recorded bench sweep
([`2026-08-12-ingame-uv-anim-lane-guard.json`](../../benchmarks/opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json)).
**The before/after frame delta was NOT obtainable and the chain closes saying so**: the pre-change engine
does not render against the 2026-08-11 pak — both sides of the commit pair fail identically on `texture
array 5 not loaded`, an era mismatch unrelated to this lane. In its place stands a bound: the lane's
always-on cost is one integer compare per rigid submesh bind, with no allocation, no per-frame write and no
extra rebind for any model that animates nothing. The edge-cases text below is kept as the diagnosis record.

**Field report (2026-08-05, the 097/07 bug round):** the Pacific Park ferris wheel spins but its light
bulbs do not BLINK the way the original mod does under SA. Diagnosis is complete and recorded in
`docs/edge-cases/engine-rendering.md`: the blink is a **UV animation**, not a script effect —
`ferriswheel_lights.dff` carries a UVAnimDict entry `f13d`, and its `Frames` material (a film-strip
texture of bulb states) references it via the material's UV-anim effect. The CLEO script only rotates
objects. Our WORLD path plays exactly this mechanism (kind-4/5 objectTable draws, plan 074/18 B7·c);
the RIGID path — every script-spawned object, the osm spike, and incidentally every vehicle — has no
UV-anim lane, so the material renders frame 0 forever.

## Measured recon (2026-08-05, all against the mod's own dff)

- `parseDff` already recovers EVERYTHING: `clump.uvAnimations = [{ name: 'f13d', duration: 29.25 }]`
  and `material('Frames').effects.uvAnim = { channelMask: 1, names: ['f13d'] }`. No parser work.
- `f13d` is a STEP animation: paired keyframes at the same timestamp jump `uv offset.x` by
  `0.07692 ≈ 1/13` every **0.225 s** — a 13-frame film strip, full loop 29.25 s (130 steps). The
  engine's existing keyframe walker (`advanceUvAnimations`, engine.ts) handles paired-keyframe steps
  already — the world's LV skull sign crawls through the same code.
- The world converter's binding logic is `resolveUvAnim` (`packages/cell-weld/src/weld.ts:904`):
  material effect name → clump dict entry → registry slot. The rigid builder
  (`packages/renderware/src/vehicle/build-vehicle-model.ts`) ignores `material.effects.uvAnim` — that
  is the whole gap.

## Restrictions check (docs/restrictions/ + engine invariants, read 2026-08-05)

- **No render-bundle staleness risk**: rigid draws are encoded directly in the pass
  (`drawVehicles`), never recorded into bundles — a new bind-group binding on the VEHICLE material
  layout cannot invalidate cell bundles. The world's `materialLayout` (bundled) is NOT touched.
- **The frame uniform is not grown** (growing it stales every cell bundle — engine.ts:1109 comment).
  The transform rides a NEW per-model uniform with dynamic offsets.
- **`.osm` DESC evolution follows the established optional-field pattern** ("absent on old fixtures"
  — bounds/center did the same): an old `.osm` reads as "no animations", byte-identical behaviour.
- **No original-logic port**: we read the mod's authored DATA (the dict + the material effect — the
  same data SA reads) and play it in our own lane; cadence and offsets come from the keyframes,
  nothing is fitted.

## The chain (each step ships alone)

1. **[01 — bake the animation through](./01-bake-the-animation-through.md)** — builder → fixture →
   `.osm` → `readModelOsm`, ending with the rebaked ferris `.osm` carrying `f13d`.
2. **[02 — the rigid UV-anim lane](./02-engine-rigid-uv-lane.md)** — the per-model transform uniform
   (identity slot 0, dynamic offsets), the shared keyframe stepper, the WGSL term; zero cost and
   bit-exact no-op for every model without animations.
3. **[03 — field close-out](./03-field-close-out.md)** — full rebuild, the blink proven by a
   timed screenshot A/B at the wheel, numbers to the ledger, the edge-cases row REMOVED (limitation
   lifted), docs synced.

Named beneficiaries beyond the wheel: any future scripted/animated mod object with film-strip or
scrolling materials (billboards, signs), and 097/08-authored scripts get it for free.

## Post-chain review pass (2026-08-07, after the field verdict)

An adversarial re-read of the whole chain with fresh eyes — the lesson that two audits over an
already-field-confirmed chain produced ~20 real findings in minutes. Six held up; all six are fixed.

**1. A crash-class hole: the engine trusted `uvAnim` from the file.** The dynamic offset was computed as
`(uvAnim + 1) × 256` with no bound. `uvAnim` is read out of a `.osm` DESC — a file a mod ships — and a slot
past the model's list binds past the end of the buffer, which is a WebGPU VALIDATION error *inside the
render pass*: the frame dies, and on some drivers so does the device. Now `uvAnimOffset()` falls back to the
identity for a slot that is missing, negative, fractional or out of range — the same "render static, never
error" philosophy the builder already applies to an unresolvable dict name. Covered both at the unit level
and end-to-end (a model whose submesh claims slot 3 of 1 draws at offset 0).

**2. The shared stepper had no test of its own.** 099/02 claimed the extraction was bit-exact; the world
lane's only coverage (`engine.frame.test.ts`) asserts that a write HAPPENED at offset 16 and never what was
in it, so a value regression would have moved every scrolling sign in the map silently.
`render/uv-anim.test.ts` now pins the walker: DFF param order, the lerp, the paired-keyframe HOLD (the
difference between blinking and smearing), the wrap at the duration, the degenerate cases, and the offset
write. **One of those tests was wrong on the first run and the code was right** — sampling at exactly
`duration` wraps to time 0, which is correct and which the fixture had not accounted for. The rig failed
before the thing measured did, again.

**3. `toRigidModelInit` was a third, untested path.** The round-trip test covered `.osm` → runtime, but the
DFF → runtime path (what `engine-props.ts` and `engine-cleo-setup.ts` use when a model has no baked `.osm`)
passed the animations through with nothing asserting it. `no-data-loss.test.ts` now compares all three.

**4. …and that gate was BLIND.** Adding a `uvAnimations` comparison to a corpus where nothing animates is
`undefined === undefined` on every row. `ferriswheel_lights` joined the corpus as its own asset class, and a
guard test names it — drop the row and the gate fails loudly instead of going quiet. (Its 3.7 MB DFF blows
vitest's 5 s default, so those rows carry an explicit 30 s budget; deterministic work, just a lot of it.)

**5. Three docs the chain owed and had not written.** The material→dict NAME rule with its silent failure
mode (`docs/contracts/vehicles.md` §4 — a misspelt or dropped dict entry renders static and logs nothing,
which looks exactly like the bug before the feature existed); the bind-group-layout growth rule the chain
*relied* on (`docs/restrictions/gpu-and-shaders.md` — bundled layouts cost a re-record, pass-encoded ones are
free, which is why `rigidLayout` could grow at all); and the keyframe-encoding lever
(`docs/performance/deferred-optimizations/uv-anim-keyframe-encoding.md` — 19 312 B verbatim on the one
animated model, kept simple on purpose).

**6. `dump-osm.ts` read the manifest wrong** — recorded in 01's ledger; found by running the plan's own
verification rather than by reading the code.

**No separate `docs/audit/` entry was written**, and that is a judgment, not an omission: this is a feature
addition whose "what changed / what it cost / what it bought" is already the three step ledgers, not a
migration or subsystem rewrite. The audit rule's other half — the benchmark — is the chain's one open item
and is named as such above.
