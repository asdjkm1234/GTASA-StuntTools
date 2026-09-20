# A 100-unit floor under the two tiniest fx systems

## What it is

`DRAW_DISTANCE_DEPARTURES` in `apps/web/src/ui/engine-particles.ts`, the `atLeast` rule:

```ts
{ rule: 'atLeast', systems: ['insects', 'cigarette_smoke'], value: 100 },
```

Both author `cullDist` **15**. They are drawn to 100 instead. The user's call, taken with
[the smoke raise](smoke-drawn-to-world-edge.md) — the two are opposite departures from the same table and are
recorded together on purpose, so a later reader does not see one and infer a rule.

## What it stands in for

A distance falloff we do not have. Read literally, 15 u puts a cloud of insects at arm's length: it appears
about two car lengths away and is gone again immediately, which reads as a bug rather than as an effect. SA
gets away with it because its own fog and draw distance hide the transition; ours does not.

100 is a compromise, not a derivation. It is also still **3× tighter than the flat 300** these systems had
before this step, so the departure improves on what shipped even while deviating from the table.

## What it was judged on

**Field-judged 2026-08-08 (canonical pak `13:19 08-08-2026`), and the verdict is that the number is inert.**
Each capture is an A/B at one spot: `?fx=1` (the floor) against `?fx=0.02` (every emitter culled) — the
positive control, because a 2 cm sprite is exactly the thing a screenshot cannot be trusted about. The
subject is the Santa Maria pier anchor `388.9, −2071.6, 8.4`, approached along the pier so the sight line is
proven by the near shots rather than assumed:

| Camera distance | Insects detectable in the A/B |
| --- | --- |
| ~9 m | **yes** — 6–8 isolated specks, and they read as flies over rubbish (the LS alley anchor `1337, −1842` shows the same) |
| ~19 m | marginal — two faint dots, at the limit of what the diff separates from noise |
| ~26 m | no |
| ~34 m / ~40 m | no |

So `insects` is invisible from roughly **20 u** out, and the floor keeps it alive to 100. The reason is in
the authored data, not in our renderer: `dump-fx-system insects` gives `size 0.02` — a **2 cm** sprite, which
is ~3 px at 9 m in a 2880-wide capture and under half a pixel at 100 m. SA's own 15 u cull is an honest
number for a swarm authored that small.

The floor therefore **buys nothing visible above ~25 u and costs nothing measurable** (100/04's A/B put the
whole particle system below the scene's noise floor, positive control included). It is kept because dropping
to 15 u restores the complaint it was raised for — the swarm appearing and vanishing within a few metres —
and there is no evidence for paying more than ~25 u for it.

## What would retire it

- **Making the swarm the size it needs to be.** The real defect is a 2 cm sprite, not a 15 u cull; a size
  the eye can hold at 30–40 m would make the authored distance the right one and this floor pointless.
- A size/alpha falloff with distance, which would make the pop the authored value causes invisible and let
  the 15 stand.
- Discovering that SA scales `cullDist` at runtime by something we do not read yet — the reversed source has
  not been searched for this, and if it does, the honest answer replaces the floor entirely.

## Blast radius

- **Counted off the shipping pak** (`scripts/debug/fx-anchor-census.ts`, self-checked): `insects` is **336 of
  the map's 943 anchors (36 %)** and `cigarette_smoke` a further **87** — the two systems are 45 % of every
  placed emitter in the game, which is what makes an inert 6.7× reach worth writing down even at zero
  measured cost. The 100 ledgers' 878 / `insects` 402 / `cigarette_smoke` **none** come from an in-process
  bake count and do not match the bytes that ship.
- Raising it hurts frame time in vegetated areas; lowering it toward 15 costs nothing and looks worse
  **only inside ~20 m** — beyond that there is nothing to lose.
- Both are `atLeast`, so a mod authoring either above 100 keeps its own value, and
  `graphics.effects.drawDistanceScale` multiplies the result like every other system's.
