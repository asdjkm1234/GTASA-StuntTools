# Car-paint reflection: the HDR gain, the fake ground, and the metallic flake

**What it is.** Three constants and one invented effect in the rigid (vehicle) shader,
`packages/engine/src/render/shaders.ts`:

```
const REFLECT_HDR    = 4.5   // the sky's missing dynamic range, restored where it matters
const REFLECT_GROUND = 0.10  // a dark road under the car, so the horizon reads as a hard line
const PAINT_ROUGHNESS = 0.35 // analytic-fallback blur only
```

plus **metallic flake**: a per-pixel micro-normal anchored in MODEL space, applied to paint.

**What they stand in for.** Three facts about SA cars that a physically-honest reflection cannot work around:

1. The sky texture is not HDR, so a mirrored sky comes back dimmer than the paint's own diffuse. `REFLECT_HDR`
   restores the dynamic range that was never captured.
2. A reflection with no dark ground and no horizon LINE has no contrast to move as the car turns — it reads
   as a flat tint. `REFLECT_GROUND` invents the road that the environment does not contain.
3. **SA panels are FLAT.** On a flat quad the mirror direction is constant, so even a perfect mirror paints a
   constant colour. AAA cars are dense, curved and normal-mapped; we have none of that. The flake is the
   stand-in for the geometry we do not have — and, conveniently, it is what real car paint actually is.

**What they were judged on.** The look, in the field, round 4 of 074/16 — user-directed, against skygfx's neo
car pipe (aap's `neoVehiclePass1VS`) as the reference. No measurement; "blown-out sky on a wing is not a bug,
it is what a car looks like" is the recorded standard.

**What would retire them.** A real HDR environment probe would retire `REFLECT_HDR` and `REFLECT_GROUND`
together — the probe already exists (074/16 step 2) but is fed an analytic sky fallback at `probeMix` 0. The
flake retires only if vehicle geometry gains normal maps, which is a different project.

**Blast radius.** All three are global to every painted vehicle. `REFLECT_HDR` interacts with the sky-occlusion
gate that plan 090 tried and reverted — a surface mirroring more sky than it can see is the symptom that
started that chain, and it is still open
([`open-issues/vehicle-cabin-lighting.md`](../open-issues/vehicle-cabin-lighting.md)). Changing the gain
without re-reading that postmortem re-opens it.
