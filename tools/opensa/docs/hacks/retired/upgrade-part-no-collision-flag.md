# A new tuning part is given `0x200000` because parts that carry it do not crash

> **RETIRED the same day it was taken, 2026-08-20 — the field disproved it in two crash logs.**
> `1194 spl_b_lr_bl` and `19051 exh_lr_rem1_059` both carry `0x200000`, and both die at `0x0059F8B4` with
> `EDI = 0` when spawned. The flag changes nothing. What the 46 derived parts had in common was not the flag
> but that **nothing had ever spawned one** — the mod shop MOUNTS a part onto a car and never reads
> `m_pColModel`, so the whole "evidence" was a class of use, not a property of the data.
>
> **Replaced by the honest thing**: every part we add now gets a bounds-only COL3 model of its own in
> `models/coll/opensa-parts.col`, registered with one `COLFILE` line in `default.dat`
> (`tools/vehicle-installer/src/upgrade-collision.ts`, `writeUpgradeCollision`), and a build whose
> `veh_mods.ide` names a part with no collision anywhere is REFUSED. Field-confirmed 2026-08-20: with the
> file in place, both ids spawn.
>
> **Two lessons, and the second is worse.**
>
> 1. The hack's own "what it was judged on" listed the derived fleet as evidence of the flag working. It was
>    evidence of nothing — those parts had never been through the code path that crashes. *A control group
>    that was never exposed to the treatment is not a control group.*
> 2. It claimed the bit's meaning was unrecovered. **This project already knew it**: bit 21 is DISABLE
>    BACKFACE CULLING, on 1 586 stock object defs, implemented in our engine since plan 004 and tabulated in
>    [`docs/plans/039-ide-object-flags/readme.md`](../../plans/039-ide-object-flags/readme.md). Two greps
>    would have killed the hack before it was written, and the standing rule — dig out the original's own
>    answer first — points at exactly that search. *"Nobody has recovered this" is a claim that needs the
>    same grep as any other.*

**Taken 2026-08-20**, plan [`vehicle-installer/014`](../../../tools/vehicle-installer/docs/plans/014-borrowed-tuning-parts.md)
step 5.

## What it is

`withNoColFlag` (`tools/vehicle-installer/src/tuning-parts.ts`) ORs `0x200000` into the flags column of
every `veh_mods.ide` row this project writes for a part outside the stock upgrade block (ids 1000–1193),
whatever the author wrote and whatever the stock part it was cloned from carried.
`assertUpgradeCollision` (`upgrade-collision.ts`) then refuses a built tree where any part has neither a
`veh_mods.col` entry nor that flag.

## What it stands in for

~~Knowing what bit 21 of an IDE flags column actually means to the exe.~~ **It was already known — see the
closing block: DISABLE BACKFACE CULLING, plan 039.** What follows is the reasoning as it was written. The crash it prevents is
understood exactly — a tuning part is previewed as an ordinary `CObject` and the constructor dereferences
`CBaseModelInfo::m_pColModel` with no null check (`0x59F8B4`), while `gta3.img : veh_mods.col` carries
collision for exactly the 194 stock parts. What is NOT recovered is why the flag changes that outcome. The
honest version reads the bit's meaning out of the reversed source or the exe and says either "this is the
no-collision bit, so setting it is correct" or "this is something else, and the real fix is a collision
entry per new part".

## What it was judged on

Measurement over a real install, written up in
[`gta-sa-original/veh-mods-col-and-the-upgrade-object.md`](../../gta-sa-original/veh-mods-col-and-the-upgrade-object.md):
every part with no `veh_mods.col` entry that carries the flag survives the shop preview (the added fleet's
46 derived parts, field-played), and both parts measured without it crash — twice in the field, and the
crash followed them when their ids were moved to 19701/19702, so it is the flag and not the id. Stock parts
are not evidence either way: all 194 have an entry.

The census the guard produced the day it was written: **stock `game-src/original` clean, `build/original/sa`
7 offenders** — the blade's two hand-written rows (`1194`, `1195`, flags `0`) and all five parts derived from
the tornado (`19074`–`19078`, flags `4096` and `0`, inherited from stock rows that carry no `0x200000`). The
original write-up predicted two of those seven.

## What would retire it

Reading the bit in gta-reversed / the exe. Two outcomes:

- it IS the "has no collision" bit — this stops being a hack and becomes a documented contract; the guard
  stays as it is;
- it is something else — then the flag is a coincidence that happens to route around the null read, and the
  honest fix is to give every new part a collision model (append entries to `veh_mods.col`, which nothing in
  this project writes yet).

## Blast radius

Only rows this project writes, and only outside 1000–1193. A part that gets the flag wrongly changes
whatever the bit really does to a model that exists only because we added it — no stock part is touched, and
`assertUpgradeCollision` fails the build rather than shipping a tree that crashes the mod shop. If the flag
turns out to be wrong, the parts affected are the ones listed in the census above plus whatever a mod adds
later.
