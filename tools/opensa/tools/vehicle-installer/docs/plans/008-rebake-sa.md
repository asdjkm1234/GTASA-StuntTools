# 008 — Rebake for the real-SA target (`--kind sa`)

**Status: ✅ Implemented 2026-08-17.** `--rebake <game> --kind sa` re-installs the mod cars of a
`build/<game>/sa` tree that is ALREADY BUILT, in place — the vehicle half of the `sa` pipeline without the
pipeline. Measured on `build/original/sa` (212 cars, `vehicles.img` 1.87 GB + `vehicles2.img` 1.23 GB):
**one car (`cabbie`, 29.9 MB of dff/txd) in 4.2 s**, peak RSS 3.7 GB, against ~12 min for the full build.

## Why

Plan 006's rebake exists for the OpenSA target only: it converts a car to `.osm`. The `sa` target — the one
that ALWAYS runs OLA + FLA + `perfect-map.asi` — had no one-car turnaround at all, so a car swapped into
`new/` (plan 007) cost a full `sa` build to look at. Session 18's close (2026-08-17) filed exactly that: the
`new/` cabbie looked un-installed in the field. It was not — the built tree carried it byte for byte; the
BOTTLE was stale (see the field note below) — but the round that found it out was a rebuild plus a diff of
three trees, and the user's ask was the same as plan 006's: rebake must work for `sa` too.

## What it does, per mod folder under `mods-src/<game>/vehicles`

Nothing is converted. A real-SA tree carries the mod's own `.dff`/`.txd`, so a rebake is exactly the install
step over one car — the SAME `applyVehicle` the install runs, archive on:

1. **`.dff` + `.txd`s → the vehicles archive FAMILY, replaced by name.** The archive is read off the tree the
   way the install reads it (`models/vehicles.img` on a split tree, `gta3.img` on an unsplit one), and the
   whole family is opened as ONE archive (`openImgFamily`, new in tool-kit): the install spilled 212 cars into
   `vehicles.img` + `vehicles2.img`, and a paint-job dictionary the sibling holds is replaced THERE — an
   editor that opened only the base member would have added a second `cabbie1.txd` beside the stale one, and
   the game resolves a duplicate by registration order, silently.
2. **Settings → the BUILT `data/*`** (replace-by-model, idempotent), `features.txt` → `vehicle-features.txt`
   and the slot → the mod ledger, both MERGED (plan 006's rule: one car must not disarm the rest).
3. **The family is written back** with `writeImgFamily` — re-planned under the archive cap, a new sibling
   registered in `gta.dat`, a stale one deleted — and `data/img-layout.json` restated (it is a report; whoever
   finishes a tree rewrites it).

Idempotent by construction and by measurement: two runs over the accepted `build/original/sa` left both
archives byte-identical (md5 `d2d5909f…` / `28d4e443…` before and after).

## What it refuses, and what it cannot do

- **A CONVERTED tree** — `<model>.osm` in any archive means `--kind opensa`; refused BEFORE its data is
  merged. The mirror guard went into plan 006's path the same day: a tree still carrying `<model>.dff` is a
  real-SA build and the OpenSA rebake now refuses it instead of merging the rows and then finding no `.osm`
  to replace (a half-written car).
- **A car whose `.dff` lives outside the family it edits** (any other `models/*.img`) — refused by name.
- **The cutscene twin.** `cs<model>` in `cutscene.img` was cut from the PREVIOUS car by the cutscene stage;
  a rebake leaves it and WARNS. The fleet and its cutscene copies are separate outputs by design.
- **`added` cars** work as in plan 006 (the mod's own ide row, id ownership checked); the same "no traffic
  until a full build writes the placements" warning.

## The cost that is documented rather than fixed

`openImgFamily` reads every member INTO MEMORY (each under the 1.75 GiB cap by construction) — 3.7 GB peak
RSS on the original's fleet. That is what makes writing the family back over the same paths safe: the writer
truncates each file it rewrites, and an fd-backed reader (`openLazyVer2`) would be reading a hole. A
write-to-temp-then-rename family writer would drop the RSS to one entry; not built, because 4 s and 3.7 GB
on the machine that builds 10 GB trees is not the bottleneck of a vehicle round.

## Field note — the finding that opened this plan (2026-08-17)

The `new/cabbie` "not installed" report was a **stale bottle**: for the LOD retest only `models/gta3.img`,
`data/gta.dat`, `data/maps/*` and `procobj.dat` had been copied into the CrossOver bottle (16 Aug 22:45);
`models/vehicles.img`/`vehicles2.img` were the 15 Aug build (before `new/` existed) and
`data/{vehicles.ide,carcols.dat,handling.cfg,carmods.dat}` were from 10 Aug. The built tree was right on every
point (`vehicles.img` → `cabbie.dff` md5 equal to `new/`'s, ide row `1f10 / 0.757`, paint jobs in
`vehicles2.img`, registered). Rule recorded in `docs/gta-sa-original/reference-install.md`: **a field run
reads the BOTTLE, so a delivery is the whole `models/` + `data/` of the built tree, not the files a session
happens to be about.**

## Verification

`tools/vehicle-installer/src/rebake-sa.test.ts` (9, real `zr350` fixture, spilled two-member family):
the CONVERTED-tree refusal, the mirror refusal in `rebakeVehicles`, ledger merge, `--only`, the paint job
replaced in the SIBLING with no duplicate, sibling registration + manifest, the unsplit-tree path, idempotence.
`tools/tool-kit/src/archive/img.test.ts` gained `openImgFamily` (4). Suite: vehicle-installer 92/92.
