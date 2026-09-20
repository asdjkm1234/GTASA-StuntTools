# 066·05 — Runtime integration, CSM scope-down, tiers

[← chain](readme.md) · prev: [04 ambient/emissive](04-ambient-emissive-channels.md)

The landing plan. It flips consumption of everything 01–04 produced, **re-scopes CSM** now that static shadows are baked,
and exposes the whole tool as tier knobs feeding [072](../072-quality-tiers-default-flip/readme.md). Nothing here changes a
DFF/TXD-only build — all of it is gated on native-cell data being present.

## Decisions

1. **Consume the native cell end-to-end.** World material reads batched groups ([02](02-static-batching.md)), sunVis +
   directional static shadow ([03](03-baked-sun-occlusion-shadows.md)), skyVis/AO + emissiveMask
   ([04](04-ambient-emissive-channels.md)) — each uniform-gated, each graceful when absent. One program, feature flags,
   no per-toggle recompile (the established world-material pattern).
2. **CSM re-scoped to dynamic-only.** With static shadows baked, drop mid/far cascades and the static caster passes; keep
   a single small hi-res **near cascade for cars/peds/dynamic objects** at short range. The world receives the baked
   static term + the near dynamic map. This is where the +35–50 % draw regression is paid back. Guarded so that cells
   **without** baked shadows keep the current full CSM (mixed builds stay correct).
3. **Tiers (feeds 072).** The tool's knobs slot straight into the ladder:
   - **low**: batched geometry + scalar sunVis + baked AO offset; CSM off or near-only tiny; LDR buffer.
   - **medium**: + directional static shadows (moving sun); near dynamic cascade; emissiveMask glow.
   - **high**: + soft penumbra (larger sun disc), full skyVis indirect, HDR buffer, full SSAO on top of baked AO.
   - **ultra**: unchanged 072 extras (volumetric clouds, water shore/SSR).
4. **Streaming**: native cells load on the worker path (plan 060 invariants — warm invisibly, atomic appear); KTX2 upload
   is cheaper than TXD decode, so this should _help_ the cell-swap freeze budget, not hurt it. Verify against 060 harness.

## Tasks

- [~] World-material: consume batched groups + sunVis/static-shadow + skyVis + emissiveMask, all uniform-gated; assert
      program cache keys unchanged when toggled (shader-test pattern).
- [~] CSM re-scope: remove mid/far static cascades when baked static shadows are present; keep near dynamic cascade;
      per-cell guard for mixed (native + DFF) builds.
- [~] Config + tiers: extend `GraphicsConfig`/tier ladder; debug sliders for each channel + CSM near-only toggle;
      eslint `--fix` after adding.
- [~] Streaming: native-cell worker load path against plan 060 invariants; measure cell-swap freeze vs DFF.
- [~] Bench all 6 scenes: modern-072 baseline → modern + native (batched + baked shadows + CSM scope-down); record draws,
      frame ms, GPU ms, shadow ms.
- [~] Docs: update 072 with the new tier definitions; roll headline numbers into the [chain readme](readme.md).

## Verification

- The 6 bench scenes improve vs the 072 modern baselines — CPU-bound night scenes (`lv-night`, `ls-rain-night`) most
  (batching + dropped static caster passes); `ls-noon` GPU not regressed.
- Static shadows smooth/stable (03) with CSM now dynamic-only; dynamic shadows on cars/peds unchanged in quality.
- Mixed build (some native, some DFF cells): correct everywhere — DFF cells keep full CSM, native cells use baked.
- Classic pipeline and a DFF/TXD-only build both byte-for-byte unaffected; full test suite + eslint + tsc green.

## Measurements

_(record after implementation — the chain roll-up copies these to the readme)_

- 6-scene table: draws / frame ms / GPU ms / shadow ms, modern-072 → modern+native: …
- cell-swap freeze (060 harness) DFF → native: …
