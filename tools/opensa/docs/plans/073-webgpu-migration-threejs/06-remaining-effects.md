# 073/06 — Remaining effects (water, particles, coronas, uv-anim, wind, reflections)

**Priority: P2.** Every remaining GLSL consumer, smallest-risk order. Each is independent — pick off one at a time.

## Tasks

- [~] `night-fill`/`uv-anim` (103/55 lines) — trivial TSL ports (uv scroll = `uv().add(time)`; fill in plan 02).
- [~] Coronas (`corona.ts`, Points + ShaderMaterial) → `PointsNodeMaterial`/sprite nodes; kill the
      `ShaderMaterial is not compatible` console spam.
- [~] Particles (`build-particles.ts`, 298 lines) → TSL sprite/points path.
- [~] Wind mod (vertex sway) → TSL `positionNode` offset; verify against foliage.
- [~] Water plugin (392 lines Gerstner) → TSL; interacts with fog + reflections — schedule after plan 04 fog.
- [~] Vehicle reflection cube-probe under WebGPU (CubeCamera works on WebGPURenderer; re-enable the plugin).

## Done

No `ShaderMaterial is not compatible` warnings; water/particles/coronas render; foliage sways; vehicles reflect.
