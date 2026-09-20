# 2026-08-06 — CLEO VM cost (097/07 close-out benchmark)

The plan 097 big-rework benchmark: what running the whole shipped script corpus costs per tick, what
boot costs, and what `cleo.enabled: false` costs. Headless numbers are the VM+atlas+mock-host slice
measured in isolation (node 24, tsx, Apple-silicon dev machine, `scripts/debug/` bench scripts —
throwaway `.tmp-*`, method recorded here); the field run read the canonical fetch build
`build/original/opensa` through `?loader=http-dir` on the vite dev server.

## Headless: the corpus on the VM (recording host, 60 Hz ticks, car present + player seated)

| Measurement | Value |
| --- | --- |
| Boot: decode + spawn all 7 corpus scripts | median 0.23 ms, p95 0.42 ms |
| Steady state, whole corpus, trace OFF | **465 µs/tick** (~2 180 instr/tick) |
| Steady state, whole corpus, trace ON | 881 µs/tick (~1.9× — the field default is OFF) |
| `cleo.enabled: false` | one branch — ~1 ns/check, nothing else runs |

Per script (steady state, trace off):

| Script | µs/tick | peak instr/tick |
| --- | --- | --- |
| cardoor (bus/coach, class C inert) | 2.3–2.5 | 12 |
| firela | 3.9 | 17 |
| vandoor | **29** (was **3 011** — see below) | 94 (was 10 000) |
| ferris | 63 | 257 |
| windfarm | 99–113 | 466 |
| rhino | 295–364 | 1 334 |

Against the plan 03 budget: the cap is 10 000 instr/thread/tick; the worst honest script (rhino, by
design a full-script-per-frame walker) peaks at 1 334. Total corpus cost ≈ 0.47 ms/tick on this
machine — inside a 16.7 ms frame it is real but small; the tracer roughly doubles it and is a debug
toggle, not a default.

## The bug this benchmark caught: the 0AE2 walk never exhausted

First run measured **3 771 µs/tick** for the corpus with vandoor at a full 10 000-instr budget burn
every tick. Cause: both the recording host AND the engine host answered `carInSphere` with the first
match regardless of `findNext` — the script's recursive walk could never see "no more cars", so its
loop never reached the WAIT (the exact defect shape recorded in
`docs/postmortem/097-hotring-hotknife-intake.md` for `no_lights.cs`, now hit by a shipped script).
Fixed in both hosts (walk cursor: `findNext=false` restarts, `true` resumes, exhaustion answers
null): corpus 3 771 → **465 µs/tick**, vandoor 3 011 → 29 µs/tick (~100×). In the field this was a
standing ~2–3 ms/tick tax whenever any car sat within vandoor's 200 m probe.

## Field (canonical build, vite dev, 1440×900, DPR 1, this machine)

- Boot census: `[cleo] 6 script(s)` from `build/original/opensa`; canvas up, zero errors; the old
  blind `0D4E unimplemented` warn is now a symbolised, declared `atlas miss: read 0x18 —
  non-native address (size 4)` (windfarm's model-info field read — see the 07 ledger).
- F2 → CLEO at the wheel spot (`?spawn=383,-2035,8`): runner ON, **1 572 instr/tick** across 6
  threads (rhino's `PANZER4` 1 271, ferris 257), 21 script objects (the built wheel), coverage rows
  `0E43 ×780 conditional-false` / `0AF0 ×20`, live trace with per-conditional answers.
- Frame with the F2 panel open: 8–10 ms at this resolution — the CLEO slice is not separable in the
  frame profiler (`fixed` bucket), but is bounded above by the headless 0.47 ms corpus cost.

## Frame-level A/B/A (`?bench=all`, same day, run-order controlled)

Three consecutive sweeps on one session stack — baseline → `?cleo=1` → baseline again — DPR 2,
canonical `build/original/opensa`, raw rows in
[`2026-08-06-ingame-cleo-ab.json`](2026-08-06-ingame-cleo-ab.json):

- **CPU frame: parity.** avg 8.334 / 8.336 / 8.337 ms, p95 9.6–10.1 in every scene and every
  variant, 120 fps everywhere — vsync-locked with headroom, and the VM's ~0.5 ms rides inside it.
- **GPU pass: +0.45 ms mean with CLEO on** (off₁ 2.92 = off₂ 2.92 — zero drift; ON 3.37). This is
  the RENDER cost of the mod objects existing in the world, not VM cost: `ocean-horizon` goes
  27 → 84 draw calls and 136 k → 843 k triangles (the coast — wheel + turbines — enters the
  frame). In `ganton-noon` (+1.3 ms) and `ls-rain-night` (+0.7 ms) draws/triangles stay flat, so
  the per-scene GPU deltas beyond the content case sit inside GPU-timer variance — the honest
  claim is the A/B/A MEAN, not any single scene.
- Verdict for the `cleo.enabled` default decision: enabling CLEO costs ~0 CPU frame time at this
  headroom and ~0.4–0.5 ms GPU where its content is visible.
