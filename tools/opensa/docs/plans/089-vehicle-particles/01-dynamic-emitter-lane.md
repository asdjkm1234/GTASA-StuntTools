# 089/01 — The dynamic emitter lane

**Status: SHIPPED 2026-07-28** (branch `089-01-dynamic-emitter-lane`). The capability the readme priced
above the effects themselves: particles that can start at a MOVING point, at a runtime-decided rate, and
stop — which the baked 2dfx lane structurally cannot (it uploads once per cell-set change and loops its
whole lifecycle in the vertex shader).

## Shape

The lane reuses everything the baked path already owns and adds nothing per frame but one buffer write:

- **Same shader, one override.** `packages/engine/src/render/shaders.ts` gains `override oneShot: bool` —
  the ONLY arithmetic change is `select(fract(cycles), clamp(cycles, 0..1), oneShot)` plus a visibility cut
  at `cycles >= 1`. A dynamic instance is the SAME 9-float record with `phase = -spawnTime`, which turns the
  baked lane's loop clock into that particle's own age. Two new pipelines (`particle-add-once`,
  `particle-blend-once`, `pipelines.ts`) bind the same layouts and the same unit quad.
- **The corona pattern, not `setParticles`'.** `packages/engine/src/render/dynamic-particles.ts`:
  `DynamicParticlePool` (preallocated, spawn = 9 float writes, death = swap-remove, no allocation per
  particle, ever) + `DynamicParticles` (one pool per blend mode, persistent instance buffers created once at
  library install, one partial `writeBuffer` per changed half per frame). Pruning runs on the SAME clock the
  shader animates with (`engine.frame`'s `seconds`) — pruning on any other clock flashes a reborn particle
  for one frame.
- **Engine surface.** `initDynamicParticles(library)` (once, at boot) ·
  `spawnParticle(system, x,y,z, vx,vy,vz, life)` · `particlesEnabled` — the `graphics.effects.enabled` gate,
  synced from config by the host each frame; it now gates the BAKED lane's draw too, so the knob is honest.
- **Host library + emitters.** `engine-particles.ts` bakes `DYNAMIC_SYSTEMS` (a boot-time list — the lane's
  atlas cannot grow later) through the SHARED `bakeFxSystem`, and `createEmitter(name)` returns a spawner
  with `position` (mutate freely), `rate` (multiplier for authored-rate systems) and `burst(count)`.

## The finding: the `prt_*` family is code-triggered

`prt_collisionsmoke` and `prt_smokeII_3_expand` carry **no `emrate` track at all** — the bake dropped them
as dead layers, which is CORRECT for a placed 2dfx anchor and wrong for this lane: SA spawns these from code
(`CFx::AddWheel*`, collisions) with an explicit per-call count. So:

- `bakeFxSystem(system, { includeTriggered: true })` keeps rate-less emitters (the placed path is untouched);
- `FxBakedEmitter` now carries the authored `rate` (the old bake folded it into `perEmitter` and threw it
  away);
- the honest primitive for these systems is **`burst(count)`** — per fixed step, caller-decided — which is
  exactly the shape tyre smoke (089/02, count from slip) and impact smoke (089/04, count from force) want.

## Budget (the readme's cap, designed in)

`DYNAMIC_PARTICLE_CAP = 1024` per blend mode (36 KB per instance buffer). A full pool **drops** new spawns —
nothing grows, nothing queues. Unknown system index, missing library, gate off: the spawn is dropped and
`spawnParticle` says so (`false`).

## Verification

- **Tests** (3046 green, `tsc` + `eslint` clean): `render/dynamic-particles.test.ts` (pool:
  drop-on-full/drop-on-dead-life/prune-exactness negative first; record layout, swap-remove packing,
  no-realloc recycling) and `engine.dynamic-particles.test.ts` on the fake device (no-library and
  out-of-range spawns dropped, gate kills draws, blend routing, one-shot pipelines bound, **no buffer
  creates per frame and no re-upload when the pool did not change**). The fake device's `writeBuffer` now
  honours element offset/size — it used to record every partial upload as the whole scratch.
- **Headless screenshot** (gate-check.js, `?fxprobe=prt_collisionsmoke`): a smoke column rises from the
  ground beside the player, small/opaque at the base, growing 2 → 8 m and fading to transparent — the
  authored envelope, played once per particle.
- **Numbers** — [`2026-07-28-headless-089-dynamic-particle-probe.json`](../../benchmarks/opensa-engine/2026-07-28-headless-089-dynamic-particle-probe.json):
  ~300 live one-shot particles at ~⅓ viewport coverage = **+2.3 ms GPU** (2.77 → 5.10 submit), +1 draw,
  frame at the 120 Hz cap throughout; CPU/upload side does not register (~10.8 KB/frame partial write).
  The delta is overdraw-bound (screen coverage), not per-particle.

## Left open for the next steps

- The probe spawns 60/s because a fixed-step burst(1) is the simplest steady stream — gameplay rates are
  the next steps' tuning question (and `CFx::AddWheel*` parameters are unrecoverable, so those will be
  documented fits by eye → `docs/hacks/` when taken).
- Particle rotation (EMROTATION/ROTSPEED) and emitter volumes stay unbaked — the known 3-key envelope gap,
  unchanged by this step.
- The F2 `worldEffects` capability stays off on the engine host: the enable toggle now works through
  config, but the panel's drawDistance slider would still be dead (records bake a fixed 300), and a
  half-live panel lies. Wire it when a step needs the dial.
