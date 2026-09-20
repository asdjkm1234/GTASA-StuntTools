# 06·2·04 — Far traffic rendering (the ring 1/2 visuals)

[← chain](../readme.md) · prev: [03 lights](03-traffic-lights.md) · next: [05 ASI traffic](05-asi-traffic.md)

The visual payoff: streets alive to the fog line. The old plan assumed an "instancing path we already
have" — **the engine has none for vehicles** (every car = one draw per visible submesh, instanceCount
literally 1, no frustum cull). This plan builds the missing renderer; it is the chain's biggest
engine-render work and the reason the GPU gate exists.

## Current state (verified 2026-08-02)

- `Engine.drawVehicleModel`: per-instance, per-submesh draws; no cull. 091 field data: cars cost GPU
  (pass mean 13.73 → 15.64 ms at 5× cars; draws p50 1049 → 1113) — draw count and projected area are
  the enemies.
- `vehicle_vlo` is NOT a standalone mesh — it is submeshes inside the full HD model's buffers, toggled
  by visibility; drawing vlo today keeps the whole HD model + texture array resident.
- The corona pass already accepts wholesale per-frame dynamic instances (`Engine.dynamicCoronas`,
  CORONA_CAP 2048) — the old plan's "extend the pass" task is ALREADY DONE; what remains is capacity
  and a feeder.
- Varying budget: the rigid path stands at 15 of 16 inter-stage locations — ONE slot left; the far
  path is a separate lean shader, not an extension of the rigid one.

## Design

### Ring 1 — the vlo arena (new converter output + new instanced pipeline)

- **Converter**: pack every `vehicles.ide` model's `_vlo` mesh (they are tiny) into a shared arena —
  one vertex/index buffer set + one small texture array + a per-model table (offset, count, tint
  slots). Built by opensa-pack beside pack-vehicles; models without `_vlo` get an auto-decimated body
  shell (the lod-common HD→LOD core — same machinery as ped silhouettes, D3).
- **Runtime**: ONE pipeline, ONE draw per model group (`drawIndexed(count, instances)`), instances fed
  per frame from ring-1 agent transforms (position/heading/tint from seed via carcols); frustum-culled
  on the CPU per agent (cheap — they are points in the sim). Fixed texture array — it never grows at
  runtime (the growing-array/bundle restriction stays untriggered).
- Wheels don't rotate at this range; colour classes quantized so tint is per-instance data, not
  per-material state.

### Ring 2 — light streams and day specks

- Night: 1–2 coronas per agent (headlight pair white forward / taillight red backward — orientation
  from heading vs camera) through the EXISTING corona pass; raise `CORONA_CAP` 2048 → 4096 (measure —
  instances are 8 floats; capacity is memory-trivial, fill-rate is the real question).
- Day: a single dim micro-quad per agent in body colour (cars read as moving specks) — same instance
  buffer, corona texture swapped for a neutral splat.
- Headlights only where "only the driven car lights up" allows: these are CORONAS (additive sprites),
  not pool lights — the 64-slot light pool is explicitly NOT a rivers-of-headlights budget
  (restrictions/engine-lighting.md). Real projected light stays 0.6.0 work; do not depend on it.

### Transitions

- vlo ↔ corona hand-off in a distance band with dithered fade (no popping — goals directive 6);
  ring 1→0 swap is same-model so it is invisible by construction; promotion prefers off-frustum
  moments (2/01's bias).

## Goals gate

1. *Authored data:* `_vlo` meshes (SA authored them for exactly this), carcols tints.
2. *Original:* SA culls traffic at ~100 m and never had a far tier — nothing to recover; the AAA
   pattern (GTA V light rivers) is the reference, our implementation.
3. *Better:* by construction (SA has nothing here); demonstrated = the 5/01 night-city shot + the
   bench row staying inside the gate.
4. *Cost:* **≤ +1.5 ms GPU at 2× retina with full far population; sim feed ≤ 0.5 ms CPU**; stated in
   `gpuMs.pass` + draw counts per the 091 verdict. The arena adds ~1 draw per visible model class —
   target < 40 far draws total.
5. *Contract:* the arena is a pack product (a new section/file recorded in world-streaming formats);
   `_vlo` frame-name semantics already live in `docs/contracts/vehicles.md`.

## Verification

- Bench: the 6-scene sweep + a new night-flight row with full far population (the gate row); A/B far
  population on/off for the exact GPU delta.
- Field: night drive — headlight rivers on the LS highways, no popping at the vlo/corona band, day
  drive — specks read as traffic, not noise; census lines for arena residency.
- Soak: `?soak=30` clean with the far tiers running.

## Tasks

- [ ] Converter: vlo arena (+ auto-shell fallback) + tint table; loud report of models covered/fallback.
- [ ] Instanced far-vehicle pipeline + CPU cull + per-frame instance feed.
- [ ] Corona feeder from ring-2 buffer (+ CORONA_CAP raise, measured); day micro-quads.
- [ ] Dithered band transitions.
- [ ] Bench row + field program; numbers below.
- [ ] Docs: world-streaming formats table (arena), performance/ entry for any rejected cheaper variant.

## Measured numbers

- GPU pass delta with full far population (2× retina): —
- Far draw count / corona instance count at the gate scene: —
- Arena size on disk / VRAM: —
