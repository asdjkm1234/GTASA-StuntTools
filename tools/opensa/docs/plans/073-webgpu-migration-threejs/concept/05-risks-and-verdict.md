# 05 — Risks & honest verdict

## Risks, worst-first

### R1 — render bundles don't deliver (KILLS the thesis)

The entire upside rests on three `0.177`'s render-bundle support collapsing per-frame submission for a _streaming_
scene. If three can't bundle our scene graph, can't invalidate a single cell without re-recording everything, or
the win is only ~2× the per-draw cost (Level 1) rather than record-once (Level 2) — the payoff shrinks below the
cost and we should **not** migrate.
→ **Mitigation:** Phase 0 spike measures exactly this before any real work. Two-week insurance.

### R2 — `world-material` TSL port isn't pixel-faithful (HIGH)

480 lines of carefully tuned day/night/CSM/fog/emissive GLSL. Re-authoring in TSL risks subtle colour/lighting
drift that's hard to notice in one frame and obvious across a day cycle.
→ **Mitigation:** port it _first_ (Phase 1), gate on the map-viewer compare workflow across a dawn→night sweep.

### R3 — no WebGPU drop-in for god-rays / SSAO / SMAA (MEDIUM-HIGH)

`postprocessing` gave these for free on WebGL. On WebGPU they're custom TSL passes or community ports of varying
quality. Could add weeks and/or a visual delta.
→ **Mitigation:** scope in Phase 3; accept MSAA-instead-of-SMAA; treat god-rays/SSAO as "match or sign off a delta".

### R4 — GPU floor caps the win (MEDIUM, inherent)

Even a perfect submission fix lands us GPU-bound at ~31 ms (~32 fps) with today's 3.2 M triangles + post-FX. So
the realistic first result is ~30 fps, not 60. Going higher is _more_ work (triangles, post-FX cost) — WebGPU
unlocks that headroom but doesn't hand it over.
→ **Mitigation:** set expectations at "≈13 → ≈30 fps first," with a clear path beyond once CPU-unbound.

### R5 — dual-backend tax (MEDIUM)

Keeping a WebGL fallback doubles the test/QA surface and constrains TSL to the GLSL-compatible subset. WebGPU-only
is simpler but narrows reach on old browsers.
→ **Mitigation:** decide explicitly in Phase 5 based on real browser-share data; default lean WebGPU-only.

### R6 — streaming hitch on bundle re-record (MEDIUM)

Re-recording a bundle when the visible cell set changes could reintroduce a boundary-crossing hitch — exactly the
class of problem plan 060 (streaming smoothness) fought.
→ **Mitigation:** re-record only the changed cell's bundle off the appearance frame; fold into the plan-060 invariants.

### R7 — three.js churn (LOW-MEDIUM)

three's WebGPU/TSL surface still evolves release-to-release; upgrades may break TSL materials.
→ **Mitigation:** pin the three version for the migration; budget upgrade passes.

## What this does NOT fix

- **Triangle count / GPU time** — orthogonal; that's LOD/decimation/post-FX work, valuable _after_ CPU-unbound.
- **procobj vegetation cost** — stays (and must, per project constraint); WebGPU makes its draws cheaper to submit
  but doesn't remove them.
- **The art** — untouched, by design. That's the point: we stop fighting SA's tiled textures.

## Final verdict

**Yes, this is the right direction — and the only one that fixes the root cause without sacrificing quality —
but commit to the spike, not the migration.**

- The diagnosis is solid and measured: CPU-bound on draw submission, art-side fixes capped at single-digit %.
- WebGPU render bundles are the one lever that targets it directly.
- The cost is a real 2–3-month rendering rewrite with two genuine risks (bundle maturity, TSL fidelity).
- **Phase 0 (1–2 weeks) converts the biggest unknown into a measured yes/no for cheap.** Run it on a throwaway
  branch, keep the WebGL engine untouched, and let the number decide.

If Phase 0 says GO, this is how OpenSA becomes a AAA-capable browser engine. If it says NO-GO, we learned it in two
weeks instead of two months. Either way, it's the honest next experiment — and unlike the parked tooling, it
attacks the wall we actually measured.

## Outcome (2026-07-11) — how the risks actually landed

The spike ran; both synthetic gates were GO. The migration then **died on risk R1 in its engine-integration form**:
render bundles never rendered the streamed world correctly (static-bundle transform baking), and a risk we had NOT
listed — **per-InstancedMesh pipeline compilation on the streaming frame** (three's own TODO, PR 29066) — froze
the field experience regardless of bundles. Everything is parked behind `?webgpu=1`; WebGL ships (improved: three
0.185.1 + shadow fixes). Full chronology and resume conditions: [phase-1-findings.md](phase-1-findings.md).
Lesson recorded: synthetic spikes validated the _mechanism_ but not the _integration_ — the next attempt must
re-run the spikes AND a real-engine smoke (streamed cells, real materials) on the newer three before committing.
