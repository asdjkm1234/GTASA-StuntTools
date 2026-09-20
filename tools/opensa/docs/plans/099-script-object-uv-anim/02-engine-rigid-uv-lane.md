# 099/02 — The rigid UV-anim lane (per-model uniform, identity slot 0, dynamic offsets)

The engine half: play the animations 01 delivered, at ZERO cost and bit-exact identical output for
every model that has none — which is every car, every ped and every current script object except the
wheel's lights.

## Decisions

1. **One uniform buffer per animated model, dynamic offsets select the transform per submesh.**
   Layout: slot 0 = IDENTITY `(0, 0, 1, 1)` **always**; slots 1..N = the model's animations. Slot
   stride = 256 B (`minUniformBufferOffsetAlignment` — WebGPU's floor). Models WITHOUT animations
   share one engine-global identity buffer, so they allocate nothing.
2. **The binding rides the existing VEHICLE material bind group** (`createVehicleBindGroup` /
   `rigidBindGroup`): a new `{ buffer, hasDynamicOffset: true }` entry on the vehicle material layout.
   `drawVehicles` already rebinds group 1 per texture array; it now passes
   `[UV_ANIM_STRIDE * (submesh.uvAnim === undefined ? 0 : submesh.uvAnim + 1)]` as the dynamic
   offset. Rigid draws are UNBUNDLED (pass-encoded every frame), so the layout change cannot stale
   any recorded bundle — the world's bundled `materialLayout` is untouched (restriction noted in the
   plan readme). The ped path shares the rigid shader family: it binds the identity buffer at offset
   0 and is behaviourally unchanged.
3. **One keyframe stepper, shared with the world.** Extract the manifest-path walker
   (engine.ts `advanceUvAnimations`, the lerp at 1997–2017 with its paired-keyframe step handling)
   into a helper both lanes call. Per frame, ONLY models that (a) carry animations and (b) have a
   live instance step their transforms and `writeBuffer` — a scene without animated script objects
   pays nothing (the counter proves it in tests).
4. **WGSL: the world's exact term** — `uv * uvAnim.zw + uvAnim.xy` — applied in the rigid (and ped,
   via the shared include) vertex path. Identity makes it algebraically a no-op, and the A/B in
   verification makes "no-op" a MEASURED claim, not an assumed one (the goals rule).

## Subtasks

- [x] `VehicleModelInit`/`VehicleModel`: carry `uvAnimations` + per-submesh index;
      `createVehicleModel` mints the per-model uniform (animated models only) and destroys it in
      `destroyVehicleModel`.
- [x] Vehicle material layout + `createVehicleBindGroup` + `rigidBindGroup` (cache key unchanged —
      the buffer is per-model, the offset per-draw) + `drawVehicles` dynamic offset.
- [x] Shared stepper helper (`packages/engine/src/render/uv-anim.ts`) + the per-frame advance for live
      animated models (frame clock `seconds`, the same one the world lane reads).
- [x] WGSL: the rigid shader's term; identity default. **The ped path needed NO change** — see the
      ledger's deviation note.
- [x] Tests (fake GPU, decisions not API calls): `packages/engine/src/engine.uv-anim.test.ts`, 8 cases.
- [x] Bench guard — **taken 2026-08-12, and it came back with a different answer than the box assumed.**
      The standing sweep is recorded
      ([`docs/benchmarks/opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json`](../../benchmarks/opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json)),
      but **the before/after DELTA cannot be measured on this build** — both ways of building the "before"
      arm failed, for reasons recorded in the benchmark note and summarised in the ledger below. What the
      guard was protecting is instead established by construction + the fake-device tests. The pixel A/B
      was not run: with no animated model in a bench scene, the only thing that could differ is the
      identity transform, which is the value a non-animated draw binds either way.

## Verification

Headless: spawn the (01-rebaked) lights model as a script object, two HUD-stamped screenshots 0.3 s
apart differ in the bulb texels; a stock car scene is pixel-identical to pre-change; bench numbers
recorded. All engine + web suites green.

## Ledger

**Deviation from decision 2 — the ped path was NOT touched, and needed nothing.** The plan assumed peds
share the rigid shader family. They do not: `ped` is its own WGSL module (`PedVsIn`/`PedVsOut`, its own
vertex struct) behind its own three-entry bind-group layout, so the rigid layout's new binding 10 is
invisible to it. Nothing was added to the ped lane, and nothing had to be.

**Deviation from decision 4 — the WGSL term is in the rigid module only**, for the same reason. It is the
world lane's exact expression, `uv * uvAnim.zw + uvAnim.xy`.

**Bit-exactness of the extraction (lesson 17 — diff what the OLD code DID, not just that it still runs).**
`advanceUvAnimations` now calls the shared `stepUvAnimation`; the extracted body is character-for-character
the old loop, and engine.ts's private `lerp` (`a + (b − a) * f`) moved with it rather than being replaced by
another package's, which computes `(1 − t)x + ty` and is NOT the same float expression. The world lane's
output is unchanged by construction, not by hope.

**Cost of the no-op path, measured on the fake device** (`engine.uv-anim.test.ts`, 8/8 green):

| claim                                            | how it is proven                                              |
| ------------------------------------------------ | ------------------------------------------------------------- |
| a model with no animations allocates nothing      | `vehicle-uv-anim` never appears in the created-buffer labels   |
| …and writes nothing per frame                     | 0 transform writes across a frame at t = 300 s                 |
| …and still draws                                  | both submeshes issue on `rigid-opaque`                         |
| an animated model with no live instance is skipped | 0 writes — an unsampled buffer is pure cost                   |
| each submesh binds its own slot                   | recorded dynamic offsets `[0]` and `[256]` on the two draws    |
| destroy frees the model's uniform, not the shared one | `vehicle-uv-anim` destroyed, `uv-anim-identity` never       |

The fake device gained one capability to make the fifth row possible: `setBindGroup` now records its dynamic
offsets per bind-group index. A bind group with `hasDynamicOffset` is a DIFFERENT binding at a different
offset, and the label alone cannot say so — without this the two draws were indistinguishable.

**Buffer arithmetic.** Slot stride is WebGPU's `minUniformBufferOffsetAlignment` FLOOR, 256 B, so the layout
is legal on any device: an N-animation model costs (N + 1) × 256 B. The ferris ring (N = 1) costs 512 B.
Every other model costs 0 — it binds one engine-wide 256 B identity buffer.

**Suite after the change: 432 files / 3 758 tests green** (was 3 750 before this step's 8). One golden
snapshot updated: `shaders.test.ts` → `rigid`, the two intended lines and nothing else.

**Field verdict, 2026-08-07:** the user rebuilt the pak and ran the game — the wheel blinks, and the report
was "looks perfect". That closes the lane's PURPOSE. The rest of the frame was judged in the same run: no
regression reported anywhere else, which is what the pixel A/B existed to check.

**The bench guard, taken 2026-08-12 — and what it could and could not answer.**

The sweep ran: 8 of the 9 `?bench=all` scenes, uncapped, DPR=2, on the user's 2026-08-11 18:04 pak —
`avgMs` 2.85 (ocean-horizon) → 5.03 (lv-night, country-dusk), `gpuMs.pass` 1.84 → 3.70, draws 39 → 2 213.
Recorded as
[`2026-08-12-ingame-uv-anim-lane-guard.json`](../../benchmarks/opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json)
with a row in the benchmark index.

**But a sweep of ONE arm is not a guard, and the second arm cannot be built on this build.** Both attempts
and their exact failures:

1. `git revert -n 402a450d` onto HEAD — conflicts in three places with later engine work, one of them an
   unrelated `drawClutter` signature change. Resolving them by hand would have produced an engine nobody
   ever shipped, which is precisely the instrument this project has been misled by before.
2. A worktree at the pair itself (`402a450d^` = `fc0f89c8`, then `402a450d`) — boots, runs CLEO, prints the
   bench protocol, and renders **zero frames**. Both sides die identically on `texture array 5 not loaded
   (cells must load after their arrays)` and an index-range overflow on a LOD render bundle (65 538 indices
   into a 27 284-byte buffer). The 2026-08-07 engine era cannot read the 2026-08-11 pak — a fact about the
   pak format, not about this lane, and proven from BOTH sides of the pair. The arms also registered 1 196
   road cars against today's 1 219, so the workload would not have matched either.

A real delta needs an era-matched pak rebuild, and that pak would no longer describe today's world (mod 39
deleted, the procobj species floor added since) — so it would answer a question about a world we no longer
ship. **What stands instead, and it is a bound rather than a measurement:** the lane's always-on cost is one
integer compare per rigid submesh bind (`array === current.array && offset === current.offset`), because a
non-animated model's offset is always 0 — so the rebind pattern is identical to the pre-lane one. No
allocation, no per-frame write, no extra bind: pinned by the fake-device counters above, which is the level
where this is decidable.

**Per-frame cost where it is NOT zero**, measured the same day on the real built fixture: `stepUvAnimation`
is **132.2 ns/call** over 2 000 000 calls with the ferris ring's actual 261-keyframe `f13d`, plus one 16-byte
`writeBuffer`. Against an 8.33 ms frame that is 0.0016 % for the one animated model in the whole world.
