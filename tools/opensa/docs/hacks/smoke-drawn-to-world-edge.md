# Smoke is drawn as far as the world is drawn

## What it is

`DRAW_DISTANCE_DEPARTURES` in `apps/web/src/ui/engine-particles.ts`, the `world` rule:

```ts
{ rule: 'world', systems: ['ws_factorysmoke', 'smoke30m', 'smoke30lit', 'smoke50lit'] },
```

Those four systems ignore their authored `cullDist` and take the host's LOD radius instead — the same number
`setupStreaming` is given (`GAME_CONFIG[game].drawDistance`, 1500 for `original`). Every other system in
`effects.fxp` takes its authored value verbatim; this is one of exactly two departures, the other being
[the tiny-fx floor](tiny-fx-distance-floor.md).

Authored, for the record: `ws_factorysmoke` 150, `smoke30m` and `smoke30lit` 155, `smoke50lit` 255.

## What it stands in for

Nothing recoverable — this is a deliberate deviation from the game's own table, not a stand-in for a formula
nobody dug out. SA's numbers are correct for SA, whose world does not draw the factory either at that range.
Ours does: the streamer keeps a cell's baked LOD resident out to the host's draw distance, and
[plan 100](../plans/100-2dfx-at-lod-range/readme.md) exists precisely so an effect survives to that range. A
chimney drawn to 1500 u with its plume switched off at 150 is the defect the chain is named for.

Read against `docs/project-goals.md` this is the sanctioned half of the split: honour the authored data
(every other system does, and several got 4–12× TIGHTER as a result), do not inherit a 2004 machine's ceiling.
The authored 150 is a draw-distance budget from a game whose world faded at 300, and a budget is not a
meaning.

## What it was judged on

**Priced, not eyeballed.** Placed anchors in the stock map, by system: `insects` 402, `vent` 206, `vent2` 162,
`fire` 45, `smoke30m` 19, `smoke30lit` 16, `waterfall_end` 9, `water_fountain` 7, `smoke50lit` 6, `flame` 3,
`water_fnt_tme` 1, `ws_factorysmoke` 1, `carwashspray` 1 — 878 anchors across 13 systems.

**The departure touches 42 of those 878 (4.8 %)**, while the same change cuts 836 anchors from a flat 300 to
between 15 and 100. The raise is paid for several times over by the step that carries it; see the frame
numbers in [100/04](../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md).

**And the LOOK was field-judged 2026-08-08**, on the first pak built after plan 100 (buildTime
`11:42 08-08-2026`). Subject: the Las Venturas plant stacks (`vegasplant09/10`, `smoke30m`), shot from open
desert due west at 300, 400, 440 and 600 u with `?look` aiming the camera. **At 600 u every stack still
carries its plume**, attached to the chimney head rather than smeared or detached — the authored 155 would
have ended it at less than a third of that, and the old flat 300 at half. It reads as a working refinery seen
across a valley, which is what the departure was for.

The same series shows the departure is not a blanket raise: the white cooling-tower puffs visible at 300 u
are gone by 600 while the stack plumes remain. Different systems, different authored distances, both live —
which is [100/04](../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md)'s table doing its job in the
field, not just in a test.

## What would retire it

- The field check deciding that a plume at 1500 u reads as a smear rather than as smoke, in which case the
  rule becomes a smaller multiple of the authored value and this file records THAT number instead.
- A per-effect size/alpha falloff with distance, which would let the authored cull distance stand and let the
  plume simply fade — the honest version of what this buys.

## Blast radius

- The four systems are 42 anchors, so frame cost moves only where one is on screen. A dense industrial view
  (Ocean Docks, the LS refinery) is where to measure it.
- The rule is keyed on the host's draw distance, so **a profile that draws further smokes further** — a game
  config change moves this silently. That is intentional (the point is "as far as the world"), but it means a
  smoke regression can be caused by a number in `game-config.tsx`.
- Nothing else reads `DRAW_DISTANCE_DEPARTURES`; the placed lane and the dynamic `prt_*` lane both go through
  `fxDrawDistance`, and no `prt_*` system is in this table.
