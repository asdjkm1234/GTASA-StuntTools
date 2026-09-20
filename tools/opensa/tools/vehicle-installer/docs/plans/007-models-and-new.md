# 007 — `models/` + `new/`: a vehicles folder that carries the car being replaced

**Status: ✅ Implemented 2026-08-15.** `mods-src/<game>/vehicles` may now hold `models/` (the installed
fleet), `new/` (candidates that OVERRIDE their slot's folder in `models/`) and `screenshots/` (pictures,
never installed). A flat folder — every other game today — keeps working unchanged.

## Why

`mods-src/original/vehicles` was restructured by hand on 2026-08-15 into `models/` (212 cars),
`new/` (empty at that moment) and `screenshots/` (212 pictures). Two things follow, and only the first is
the feature:

1. **Trying a replacement must not mean deleting the incumbent.** Drop
   `new/admiral - 1994 Dodge Stealth RT 1.1 - mad_driver` beside
   `models/admiral - 1976 Mercedes-Benz 230 - k1real24` and the build takes the `new` one, because `new` is
   the higher-priority layer. Move it out and the incumbent is back — no folder was ever renamed, moved or
   deleted to run the A/B.
2. **Every tool that reads this folder is broken RIGHT NOW.** `install`, `--rebake` and
   `vehicle-cutscene`'s census all take "every immediate subfolder" as a car, so today they see three cars
   called `models`, `new` and `screenshots`, find no `.dff` in any of them, and install NOTHING — silently,
   because a folder with no `.dff` is a legitimate skip. This plan is what makes the tree readable again, so
   its steps are not optional.

## The folder-name contract (new — it used to be free text)

```
admiral - 1976 Mercedes-Benz 230 - k1real24
^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^
slot      what the car really is    author
```

The **slot** is the first field, everything before the first ` - `, case-folded. It is the game model the
mod replaces, and it is the **key the two layers are matched on** — the other two fields are free text and
differ between an incumbent and its candidate by definition (`admiral - 1976 Mercedes-Benz 230 - k1real24`
is replaced by `admiral - 1994 Dodge Stealth RT 1.1 - mad_driver`; only `admiral` is shared).

`docs/contracts/vehicles.md` §1 says today that "the folder name is free text and is never parsed". **That
sentence is what this change retires**, and it is corrected there in the same commit.

### Why the slot is read from the FOLDER and not from the `.dff`

The obvious alternative — key on the `.dff` inside, as `applyVehicle` does — is worse here, measured on the
real tree: **13 of the 212 folders carry more than one `.dff`** (a bodykit: `exh_a_l.dff`, `spl_c_l_b.dff`,
… beside `elegy.dff`), and in **10 of them the alphabetically first `.dff` is a bodykit part**, not the car
(`flash` → `exh_a_f`, `slamvan` → `bbb_lr_slv1`, `voodoo` → `bbb_lr_slv1`, …). A key taken from there would
match a candidate against a spoiler. The folder name is the one place the author states the slot once.

That measurement also exposes a **pre-existing bug this plan does not fix** — see "Found on the way" below.

## The shape, and what it refuses

Resolution is one function, `resolveVehicleSources(inPath)`, and it returns the folders to install in order.
It lives in **`@opensa/tool-kit/vehicles-dir`**, not inside this tool, because `vehicle-cutscene` reads the
same folder and must agree with the installer about which cars are in the build — two copies of this rule
would diverge into a cutscene fleet that does not match the driving one.

| Tree | What happens |
| --- | --- |
| **flat** (`gostown`, `carcer`, `anderius`) | every immediate subfolder is a car, exactly as today |
| **structured** (`models/` and/or `new/`, `screenshots/` optional) | `models` first, then `new` replacing any slot it repeats |

Refused rather than guessed, the same way `mod-installer`'s layers are (plan 011):

- **a stray folder beside the reserved ones** — that is what a misspelled `New/`, `model/` or `Screenshots`
  looks like, and it is also a car folder left at the top level. Guessing here would silently install a
  fleet nobody asked for;
- **two reserved folders differing only in case** (`new/` + `New/` on a case-sensitive filesystem) — one
  folder on macOS and Windows, so it must not become a second layer and must not silently lose either;
- **two folders in the same layer claiming one slot** — today both install and the last one alphabetically
  wins, with nothing said. The real tree has 212 unique slots, so this refuses only genuine mistakes.

A `new/` folder whose slot has no incumbent is **not** an error: it is a car the fleet did not have, and it
installs. Every override is logged as `new/<candidate> replaces models/<incumbent>`, because a build whose
fleet changed silently is the failure this folder exists to make visible.

## Steps

### 1 — `@opensa/tool-kit/vehicles-dir` (the resolver + its tests)

`resolveVehicleSources(inPath)` → `{ folder, name, origin: 'flat' | 'models' | 'new', slot }[]`, ordered by
folder name case-insensitively (the order the installers already use; after resolution each slot appears
once, so order is determinism, not semantics). Plus `parseVehicleSlot(name)` for the prefix rule, exported
because the census keys on the slot too.

Tests: flat unchanged · `new` overrides by slot · `new`-only slot installs · `screenshots` ignored · each of
the three refusals · slot parsing (no ` - `, extra spaces, case).

### 2 — the three readers

- `install()` (`src/install.ts`) — replaces its `readdirSync` scan; logs the overrides.
- `rebakeVehicles()` (`src/rebake.ts`) — same swap; `--only <slot>` keeps working because the resolved list
  is the same one it filters.
- `vehicle-cutscene`'s `indexModFolders()` (`src/census.ts`) — the same swap. Not a refactor: without it the
  cutscene stage bakes the fleet the installer did not install.

`pmb` needs no change — it hands `mods-src/<game>/vehicles` to both and the resolution happens inside.

### 3 — the paths that name a car folder as text

`scripts/test-fixtures.ts` and `scripts/debug/dump-vehicle-ao.ts` name mod folders as literal strings, and
both were **already stale before this change**: `104/120` fixtures resolved, because session 14's mod
layering + renumber had moved four of them (`60. Pacific Park…` is `common/59.` today) and this change moved
seven more. Committed copies kept every test green while the sources drifted — the silent kind exactly.

Fixed at the root rather than by re-typing the paths: `modsSrcPath` resolves a mods-src fixture by the mod's
**NAME**, ignoring the numeric prefix (a position, which `renumber-mods` compacts) and searching every layer
(`common`/`sa`/`opensa`, `models`/`new`). The manifest states the name and nothing else. The AO script takes
its two cars by SLOT through the resolver, so it follows a `new/` candidate like the build does.

### 4 — docs, in the same change

`docs/contracts/vehicles.md` §1 (the folder name carries the slot; the `models`/`new`/`screenshots` shape and
its three refusals), `tools/vehicle-installer/readme.md`, `tools/vehicle-cutscene/readme.md`,
`docs/commands.md`.

## Verification — measured 2026-08-15

| Check | Before | After |
| --- | --- | --- |
| `vehicle-cutscene --inspect` over the real `mods-src/original/vehicles` | **0 of 23** slots ready ("no mod" for every one) | **23 of 23 ready**, each naming its `models/…` folder |
| `npm run test:fixtures` | 104/120 (16 MISSING) | **120/120** |
| Suite | 4313/4313 | **4334/4334** (476 files), tsc + eslint clean |
| Resolution over the real trees | — | `original` **structured, 212 cars**; `gostown`/`carcer`/`anderius` **flat, 2 each** — unchanged |
| `--rebake original --only admiral` against the 3.1 GB built tree | — | 1 rebaked (7.8 MB of `.osm`), 211 skipped, **3.1 s** |

Two more on real assets, writing nothing into `mods-src`: a scratchpad tree holding real `taxi` + `voodoo`
folders under `models/` and a candidate `new/taxi - 1985 Some Other Taxi - test` — `--inspect` resolves
`cstaxi92` to the **`new/`** folder and `csvoodoo` to its `models/` one; adding a misspelled `Newe/` beside
them fails the run with the mixed-tree error naming `Newe`.

### 5 — the slot the install RECORDS (found on the way; the user's call, same session)

The slot `vehicle-installer` recorded for a car was **the first `.dff` in the folder**, and for **10 of the
212** that is a bodykit part: `applyVehicle` took `imgNames.find(n => n.endsWith('.dff'))`, and `exh_a_f`
sorts before `flash.dff`. What that cost, silently:

- `data/vehicle-mods.txt` named `exh_a_f` — video mode's mod-car switch never saw the `flash` slot as modded;
- the same wrong key carried the mod's `features.txt` declaration, onto a model that does not exist;
- `--strip` would have kept the exhaust and dropped the car it was told to keep;
- a `--rebake` converted the **exhaust** into `exh_a_f.osm` while the car kept its old model — and
  `--only flash` matched nothing at all, so the one-car turnaround did not work for those ten;
- two of the ten claimed the SAME wrong slot (`bbb_lr_slv1`: slamvan and voodoo), so they also collided.

`resolveVehicleModel` (`src/model.ts`) now takes the folder's slot and confirms it against the `.dff`s that
ship. A folder that claims a slot it has no `.dff` for keeps the OLD rule — the first `.dff`, so a mis-named
folder installs exactly as before — and warns naming both. Used by `applyVehicle` and by the rebake's
`modelOf`, so the install and the rebake cannot disagree about which car a folder is.

**Measured over the real tree**: 212 cars, **10 slots corrected** (`flash`, `jester`, `remingtn`, `savanna`,
`slamvan`, `stratum`, `sultan`, `tornado`, `uranus`, `voodoo`), **0 folders** whose name matches no shipped
`.dff` — the naming contract holds across all 212, so the fallback warning fires on nothing today.
`--rebake original --only voodoo` now rebakes the car (23.1 MB of `.osm`, 2.5 s); before it matched nothing.
