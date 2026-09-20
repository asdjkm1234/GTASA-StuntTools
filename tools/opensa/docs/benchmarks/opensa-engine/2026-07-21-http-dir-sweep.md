# 2026-07-21 — `?bench=all` sweep through the http-dir loader (plan 079 phase 3, headless DPR 2)

The first bench sweep run **through the real load path** (`?loader=http-dir&src=http://localhost:3001/build/original/opensa`,
`serve-static` + `fetchInstallSource`, no fake picker — plan 079 phase 3). Against the fresh 2026-07-21
`build/original/opensa` reconvert (`buildTime 10:45 21-07-2026`). Harness: `drive.js` headless Chromium,
`--use-angle=metal`, DPR 2. Machine NOT quiescent (a vite dev server was live alongside the harness).

The comparison reference is the only other headless-DPR-2 six-scene row: the **07-18 post-teardown ritual**
in `2026-07-18-series.md`. It is an OLDER build (pre the 078/084 field rounds and this reconvert), so map
CONTENT differs — draws are compared for direction (nothing LOST), not equality.

| Scene         | avg / fps   | p95 ms | draws (07-21) | draws (07-18 ref) | Δ draws | avgTriangles | gpu pass ms | late |
| ------------- | ----------- | ------ | ------------- | ----------------- | ------- | ------------ | ----------- | ---- |
| ls-noon       | 8.333 / 120 | 9.2    | 1 157         | 1 020             | +13 %   | 2 312 529    | 2.64        | 0    |
| sf-fog-dawn   | 8.333 / 120 | 9.3    | 1 009         | 835               | +21 %   | 1 409 820    | 1.99        | 0    |
| lv-night      | 8.334 / 120 | 9.2    | 1 647         | 1 049             | +57 %   | 1 857 137    | 3.56        | 0    |
| country-dusk  | 8.333 / 120 | 9.2    | 882           | 515               | +71 %   | 1 336 708    | 3.90        | 0    |
| ocean-horizon | 8.334 / 120 | 9.3    | 16            | 9                 | +7      | 126 125      | 2.03        | 0    |
| ls-rain-night | 8.333 / 120 | 9.3    | 942           | 978               | −4 %    | 1 671 435    | 2.30        | 0    |

## Reading

**The loader change is rendering-neutral by construction, and this run confirms nothing was lost.** The
http-dir loader changes HOW bytes reach the engine, not WHAT the engine draws — draws are a function of the
scene camera, the loaded cells and the car population, all independent of the byte source. A broken loader
shows up as MISSING draws (a lost subsystem) or a crash; here every scene renders, all six are vsync-locked
at 120 fps, `lateCreates` is 0 everywhere, and draws are **≥ the reference on five of six scenes**. So the
phase-2/3 gate — "the load-path rework did not move pixels" — holds: the surrogate is gone and the real
loader drives the full sweep intact.

**The higher draw counts vs the 07-18 reference are the BUILD, not the loader.** lv-night +57 % and
country-dusk +71 % are large, and a loader cannot add geometry — this is the newer/fuller 07-21 build
(LOD/procobj/vegetation and the 078/084 rounds since 07-18). It was direct evidence for the "the map got
heavier" question: the night/dusk countryside-heavy scenes grew most in draws. **ANSWERED 2026-07-21 →
[layer-decomposition](2026-07-21-layer-decomposition.md)** — the `trees` stage, and mostly one mod. Not a
phase-3 regression. `gpuMs.pass` is not
compared (machine not quiescent; the reference's own pass column is flagged unusable).

**Verdict: phase-2/3 load-path gate PASS.** The full sweep runs headlessly through the shipping
loader, all vsync-locked, nothing dropped. The draw growth vs the old build is a separate perf lead.
