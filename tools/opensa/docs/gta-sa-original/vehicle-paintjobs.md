# A paintjob is a numbered texture dictionary, and nothing in the data names it

**A fact about the original game and the adjuster it ships with, not about OpenSA.** Measured on stock
`game-src/original` 2026-08-20, with the field answers marked as the user's.

## What a paintjob is made of

A car's paintjob is a whole texture dictionary of its own, named by CONVENTION off the car's model name:
`blade1.txd`, `blade2.txd`, `blade3.txd` beside `blade.txd`. **No IDE row, no `carmods.dat` line and no
`carcols.dat` entry names any of them** — the convention is the only thing that ties them to the car, which
is why a tool sorting archive entries by "which row claims this" leaves every one of them unclaimed
([plan 103](../../tools/img-splitter/docs/plans/002-one-owner-per-archive-entry.md)).

Stock ships **36 of them across 13 cars**:

| paintjobs | cars |
| ---: | --- |
| 3 | `blade`, `elegy`, `flash`, `jester`, `remingtn`, `savanna`, `slamvan`, `stratum`, `sultan`, `tornado`, `uranus` |
| 2 | `broadway` |
| 1 | `camper` |

The car's own dictionary is the anchor of that bundle, and the naming is strict enough to delete by: over
the 212 rows of `vehicles.ide`, **no two cars share a dictionary and no car's dictionary is named anything
but its own slot** — 0 and 0.

## `Make paintjobs work for any ID` is about ADDED cars

FLA's `[SPECIAL]` setting, `= 1` in the reference install
([reference-install-config.md](reference-install-config.md)). **It lets a car at a NEW model id have
paintjobs** — the stock game answers the paintjob question only for the ids it shipped with, so an added
car (ours live at 19 001+) gets none without it. The user's correction, 2026-08-20.

It is **not** a lift of some per-id paintjob COUNT for the stock cars, which is what plan 103 first assumed
it must be. That assumption produced a worry with nothing behind it: that a mod shipping fewer paintjobs
than its stock car would leave the shop offering one whose dictionary is gone.

## Fewer paintjobs than stock is fine

**Field answer, 2026-08-20 (the user):** a mod that replaces a car and ships fewer numbered dictionaries
than the stock car had works — the shop simply offers what exists. So a tool replacing a slot may drop the
whole stock bundle without owing the player a replacement for each one, which is what
`pruneReplacedSlotTextures` does.

Neighbours: [`carmods-upgrade-ceilings.md`](carmods-upgrade-ceilings.md) (what a tuning part's NAME must
look like), [`veh-mods-col-and-the-upgrade-object.md`](veh-mods-col-and-the-upgrade-object.md) (why a new
part needs a collision flag), and `docs/contracts/vehicles.md` for what a mod folder may ship.
