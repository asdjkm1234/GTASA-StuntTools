# img-splitter

Splits a game's `models/*.img` into typed, size-bounded archives — map objects, vehicles, peds — so no single
archive grows past what a reader can open, and each installer downstream owns one file instead of rewriting a
shared multi-gigabyte one.

Runs **before anything installs**, which is what keeps every entry name in exactly one archive. See
[`docs/architecture/img-archive-layout.md`](../../docs/architecture/img-archive-layout.md) for the design and
[`docs/plans/001-archive-split.md`](docs/plans/001-archive-split.md) for the chain.

## What decides a bucket

The IDE section a model's own row sits in — `cars` → vehicles, `peds` → peds, `weap` → weapons,
`objs`/`tobj`/`anim`/`hier` → map — reading columns 1 and 2 as the model and its texture dictionary. Never a
roster of names in our code, so a mod that adds a car to `cars` is bucketed correctly without this tool
changing.

Two places where the section is not the whole answer, and the game's own tables are:

- **`carmods.dat`** names the 190 mod-shop parts. They are authored as ordinary `objs` rows, so section alone
  would file a spoiler under map — away from the car it bolts onto, and contesting the car's dictionary.
- **`weapon.dat` is NOT the source for weapons.** It is the stats table and addresses a weapon by numeric
  `modelId`; the names live in the `weap` section, so that file could only point back there.

Two outcomes are reported rather than absorbed, because a classifier that quietly swallows surprises is the
failure mode:

- **contested** — claimed by two buckets, resolved to `map`. On the stock tree exactly one entry is:
  `slamvan.txd`, because `veh_mods.ide` declares `bnt_lr_slv1`/`bnt_lr_slv2` against it and `carmods.dat`'s
  `slamvan` row lists neither — two bonnets the mod shop never offers. An inconsistency in the stock data.
- **unclaimed** — no IDE row declares it, resolved to `map`: `.col`/`.ipl`/`.ifp`/`.dat`, the generic
  dictionaries reached through `txdp` parents, and a handful of special models.

Both are safe in `map` because the game resolves an entry by NAME across every registered archive — the split
decides size and ownership, never visibility.
