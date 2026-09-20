# 073/09 — Productionize the WebGPU mode

**Priority: P3 (after P0–P1 make it look right).**

## Tasks

- [~] Flags → config: `?webgpu/bundle/appear/matcache` become `graphics.renderer` config (+ debug menu toggle);
      bundles default ON under webgpu after a soak period.
- [~] Device fallback: no WebGPU adapter → WebGL path automatically (today the flag just fails).
- [~] Bench parity: `?bench=all` under webgpu (fix `renderer.info` draw counting inside `executeBundles` — the
      counter can't see bundled draws; add a bundle-aware count or GPU-timer based gating).
- [~] Patch hygiene: production patch minimal (plan 01), `?bundledebug` logging split out, patch re-validation
      checklist for three upgrades (re-run both harnesses + a field smoke).
- [~] Memory/lifecycle audit: bundle containers vs cell cache (objects reparented on unload — verify no leaks via
      renderer.info.memory over a long drive).
- [~] Update `concept/` (moved here from docs/concepts) statuses → graduated pointers to this chain.

## Done

`graphics.renderer: 'webgpu'` shippable behind a config default decision; WebGL remains the fallback; benches run
on both paths.
