# Automatic render-scale / quality-tier ladder

**Status:** in reserve — measured and refused. [Plan 072](../../plans/072-quality-tiers-default-flip/readme.md) stays
closed; the deciding run is
[2026-07-21 scale ladder](../../benchmarks/opensa-engine/2026-07-21-scale-ladder.md) (index row #19).

**Impact: low on frame time, medium on memory — measured, and the measurement is why it was refused.**
Quartering the pixel count (scale 1.0 → 0.5) recovers **0.4–1.4 ms** of GPU pass across four scenes, −4 % to
−32 %, because `pass` carries a large resolution-INDEPENDENT floor (vertex/draw, ~1.9–2.5 ms). `post` is the
part that actually scales (−35…−45 %). Render-target residency does fall properly: **345 → 195 → 88 MB**. So
on the dev host it is a fraction of a millisecond against 8.33 ms of budget, and **it cannot touch the floor
at all** — the axis that dominates these scenes is the one `?draw=` reduces, not the one resolution does.

**Effort: medium.** The scaling itself already exists (`?scale=`); what does not is the policy — a detector,
a hysteresis that will not oscillate, and a tier definition per quality level. That is frame-loop work with
its own tuning round, and a tier that flickers is worse than a slow frame. **Refused on the WIN, not on the
effort**: it cannot touch the measured floor at all, which is the draw/vertex side.

## What we do today

One manual knob: `?scale=<0..1>` scales every render target (and `?draw=` scales the draw distance). Nothing
picks either automatically, and there are no low/medium/high presets.

## The lever

Detect a slow frame and drop the render scale (or a whole quality tier) without asking — the shape every
console game ships.

## What it would win

Bounded, and the bound is measured. Three headless `?bench=all` sweeps at scale 1.0 / 0.75 / 0.5, DPR 2,
M3 Pro:

| Scene         | pass 1.0 → 0.5 | Δ     |
| ------------- | -------------- | ----- |
| ocean-horizon | 2.15 → 1.45 ms | −32 % |
| country-dusk  | 3.87 → 2.79 ms | −28 % |
| lv-night      | 3.52 → 2.81 ms | −20 % |
| ls-rain-night | 2.33 → 2.25 ms | −4 %  |

Quartering the pixel count recovers **0.4–1.4 ms** of GPU pass, because `pass` has a large
resolution-INDEPENDENT floor (vertex/draw overhead ~1.9–2.5 ms). `post` is the honest resolution-scaler
(−35…−45 % at 0.5). Render-target residency does fall properly: **345 → 195 → 88 MB**.

## What it would cost

- Complexity in the frame loop plus a hysteresis policy — a tier that oscillates is worse than a slow one.
- It cannot touch the floor. On these scenes the cost is the draw-count/vertex side, which only `?draw=`
  (already there) reduces, at the price of pop-in.
- The measured headroom made it pointless: worst-scene GPU total was ~5.1 ms against an 8.33 ms budget.

## What would have to be true to pull it

- A genuinely slower GPU class becomes a target. Then **re-run the ladder there first** — the deciding
  number is the pass floor, not the resolution share, and it is hardware-specific.
- Or a scene appears whose `post` dominates (heavy bloom/fog), where the resolution axis actually pays.

## Cheaper things to try first

- Tell the user about `?scale=0.75`: it is already the one knob, and 0.75 costs little visually.
- `?draw=` — the draw-count floor is what the measurements say actually dominates.
