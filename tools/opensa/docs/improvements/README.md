# Improvements

Enhancement ideas that are **not being worked on yet** — deliberately parked. Each file captures the
idea, why it's worth doing, the approach options we've considered, and any investigation already done,
so picking it up later starts warm.

Distinct from the neighbouring rubrics:

- `docs/features/*` — things that are implemented and work.
- `docs/open-issues/*` — known problems/bugs investigated but unsolved (no shipped fix).
- `docs/performance/*` — optimizations we deliberately left on the table, with their price: the plan-B list
  for when frame time gets bad.
- `docs/improvements/*` — nice-to-have enhancements we've chosen to defer (no problem, just not now).

When one gets picked up, promote it to a `docs/plans/*` plan.

| Improvement                                        | Doc                                                      | Status                 |
| -------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| **Original-game defects and quirks we intend to fix** — the collecting place | [original-game-defects.md](original-game-defects.md) | open list, nothing scheduled. **A video must be watched with the user before any work starts from it.** Seeded from SilentPatch's SA changelog, read as a defect INVENTORY rather than a fix list — note that our reference `sa` install already runs SilentPatch, so the gap it really tracks is our own engine |
| Blowing rubbish on the streets — a system GTA III had and SA dropped | [ambient-rubbish.md](ambient-rubbish.md) | parked — not doing yet. Reference implementation exists ([`rubbish-sa`](https://github.com/gennariarmando/rubbish-sa)), useful twice over: as a worked ASI example for `asi/city-life`, and as the feature itself. Natural consumer of the wind system |
| `fla-quiet` — close FLA's monthly "main window" dialog without re-typing the code. **Original SA only** | [fla-quiet-startup.md](fla-quiet-startup.md) | parked 2026-08-19 — designed (separate `!fla-quiet.asi`, a WH_CBT hook clicking Continue; never shipped in the pmb tree), not built. Says plainly that it circumvents a freeware author's donation reminder |
| Procedural stochastic texturing (de-tiling)        | [stochastic-texturing.md](stochastic-texturing.md)       | parked — not doing yet |
| Character material maps (normal / emissive / spec) | [character-material-maps.md](character-material-maps.md) | parked — not doing yet |
