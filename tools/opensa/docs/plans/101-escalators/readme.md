# 101 — Escalators in OpenSA

**The steps have never moved in our engine.** `packages/renderware` decodes the type-10 2dfx entry (plan 044)
and `apps/web/src/game-config.tsx` carries a `LS - Escalators` debug waypoint; `packages/engine`,
`packages/cell-weld` and `packages/engine-formats` contain no escalator code at all. The staircase draws —
it is ordinary geometry — and standing on it does nothing. Real San Andreas implements them natively, so this
is a gap against the original, not a feature nobody asked for.

Split out of [plan 100](../100-2dfx-at-lod-range/readme.md) 2026-08-07 by the user's call: 100 carries the
2dfx types our engine already consumes to LOD range, and type 10 is not one of them **because the behaviour
does not exist**. Building it is this chain.

## What the data gives us

The entry (`RWEscalator`, 40 bytes, model-local) is a path plus a flag:

| Field | Meaning |
| --- | --- |
| `position` | entry point of the escalator |
| `bottom` | lower landing |
| `top` | top of the incline |
| `end` | upper landing |
| `direction` | u32 flag, 0 or 1 across the whole stock corpus (up vs down) |

The corpus is tiny and fully enumerable — **5 entries in 4 models** (`escl_la` ×4 placements, `escl_singlela`
×2, `vgseesc01`, `vgseesc02`), so every one of them can be verified by hand rather than by aggregate.

## Steps

| # | Step | Lands in |
| --- | --- | --- |
| [00](00-recover-sa-behaviour.md) | recover what SA actually does (step spacing, speed, how a ped is carried) + inventory what our engine can already move | research, no code |
| [01](01-escalators-into-the-pak.md) | the entries reach the engine: weld → format → per-cell escalator table | `cell-weld`, `engine-formats`, `opensa-pack` |
| [02](02-moving-steps.md) | the steps move | `packages/engine` |
| [03](03-carry-the-player.md) | standing on one carries you | `packages/engine` (physics) |

00 gates everything: per the standing rule, the original's own formula comes before any constant of ours, and
a fitted number is a documented debt rather than an answer.

## Out of scope, deliberately

- **The staircase mesh.** It is ordinary geometry and already bakes like any other prop; step 01 only checks
  that it survives the LOD cell's culls, and fixes that if it does not.
- **LOD-range behaviour.** An escalator you cannot reach does not need to run; the visual can stop with the
  HD band. Whether the steps freeze or vanish at range is [02](02-moving-steps.md)'s call, made with a
  measurement rather than in advance.
- **Interiors.** Two of the four models sit in the LS mall; interior placement is its own problem and this
  chain does not touch it.
