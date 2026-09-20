# 2026-07-21 — render-scale ladder (072 tier-ladder decision data)

Three headless `?bench=all` sweeps at `?scale=1.0 / 0.75 / 0.5` (DPR 2, `drive.js`, ANGLE/Metal, M3 Pro,
build `10:45 21-07-2026` via `?loader=http-dir`). Raw lines: [2026-07-21-scale-ladder.json](./2026-07-21-scale-ladder.json).
Question answered: **is the single `?scale` knob enough, or does the parked 072 quality-tier ladder have a
job on the own engine?**

All 18 runs are vsync-locked at 120 fps with `lateCreates` 0 and identical draws/triangles per scene — only
the GPU timers and the render-target residency move.

## gpuMs.pass + post (the scale-sensitive part), ms

| Scene         | 1.0: pass / post | 0.75: pass / post | 0.5: pass / post | pass Δ 1.0→0.5 |
| ------------- | ---------------- | ----------------- | ---------------- | -------------- |
| ls-noon       | 2.76 / 0.85      | 2.57 / 0.65       | 2.52 / 0.49      | −9 %           |
| sf-fog-dawn   | 2.18 / 0.85      | 2.08 / 0.72       | 1.89 / 0.55      | −13 %          |
| lv-night      | 3.52 / 0.89      | 2.98 / 0.66       | 2.81 / 0.53      | −20 %          |
| country-dusk  | 3.87 / 0.82      | 3.11 / 0.59       | 2.79 / 0.45      | −28 %          |
| ocean-horizon | 2.15 / 1.15      | 1.91 / 1.13       | 1.45 / 1.10      | −32 %          |
| ls-rain-night | 2.33 / 0.86      | 2.21 / 0.70       | 2.25 / 0.58      | −4 %           |

Render-target residency confirms the knob reaches every target: **345 MB → 195 MB → 88 MB**.

## Reading

- **Huge headroom at full scale.** Even at scale 1.0 / DPR 2 (≈2880×1800), worst-scene GPU total
  (pass+post+probe+submit) is ~5.1 ms against the 8.33 ms/120 fps budget. Nothing here needs ANY knob on
  this hardware class.
- **The frame is not resolution-dominated.** `pass` has a large resolution-independent floor
  (vertex/draw-overhead ~1.9–2.5 ms): halving the resolution area 4× recovers only 4–32 % of pass.
  `post` is the honest resolution-scaler (−35…−45 % at 0.5). So the total recoverable by ANY
  resolution-side tier is bounded — on these scenes ~0.4–1.4 ms.
- **`probe` rises slightly as scale drops** (e.g. sf-fog-dawn 1.29 → 1.79). The vehicle cube probe is
  fixed-res, so this is timer/scheduling redistribution on a non-quiescent machine, not a real cost —
  flagged, not chased.
- **072 verdict data:** a quality-tier ladder (low/med/high/ultra) would gate content/effects, but the
  measured GPU cost is dominated by the draw-count floor, which tiers can't shrink without cutting draw
  distance — and `?draw=` already exists for that. The resolution axis is fully served by `?scale`.
  **Nothing on the own engine currently needs a tier ladder; 072 stays closed.** Revisit only if a genuinely
  slower GPU class becomes a target — then re-run this ladder there (the deciding number is the pass floor,
  not the resolution share).
