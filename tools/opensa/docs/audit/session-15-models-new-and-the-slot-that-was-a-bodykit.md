# Session 15 — `models/` + `new/`, the slot that was a bodykit part, and a page to look at the fleet

**2026-08-15, 15 commits.** Two pieces of work: vehicle-installer plan 007 (a restructured `vehicles`
source folder the whole toolchain had stopped reading), and `cars-server`, a local page showing what the
fleet replaced. Plus three defects the work exposed, all pre-existing and all silent.

## What changed

### 1. `models/` + `new/` (vehicle-installer plan 007, closed)

The user restructured `mods-src/original/vehicles` by hand into `models/` (the fleet), `new/` (candidates)
and `screenshots/`. A candidate in `new/` replaces the `models/` car holding the same SLOT, so trying a
replacement renames, moves and deletes nothing.

Resolution is ONE function — `resolveVehicleSources` in `@opensa/tool-kit/vehicles-dir` — because
`vehicle-installer` (install + rebake) and `vehicle-cutscene` (census) read the same folder, and two
readings are two different fleets that nothing in the build compares. That rule is now in
`docs/restrictions/architecture.md`, recorded as SILENT.

**The restructure had already broken the toolchain**, which is the number worth keeping: every reader took
"every immediate subfolder" as a car, so it saw three cars called `models`, `new` and `screenshots`, found
no `.dff` in any of them, and did nothing — a folder with no `.dff` being a legitimate skip.
`vehicle-cutscene --inspect` reported **0 of 23 slots ready and exited 0**; after, **23 of 23**.

The flat tree — every other game — installs **byte-identical** before and after the change (`diff -rq`,
403 MB / 60 files, gostown). Numbers: [`benchmarks/tools/2026-08-15-vehicle-installer-models-new.md`](../benchmarks/tools/2026-08-15-vehicle-installer-models-new.md).

### 2. The slot the install RECORDS (the same plan, step 5)

Found while choosing the join key, and it is the more serious half. The slot a car was recorded under was
**the first `.dff` in its folder**, and 13 of the 212 folders ship a bodykit whose parts sort first:

- `flash` entered `data/vehicle-mods.txt` as `exh_a_f`, `voodoo` and `slamvan` BOTH as `bbb_lr_slv1`;
- video mode's mod-car switch therefore never saw those slots as modded;
- the mod's `features.txt` was keyed onto a model that does not exist;
- `--strip` would have kept the exhaust and dropped the car it was told to keep;
- `--rebake --only flash` matched nothing, so the one-car turnaround did not work for those ten.

`resolveVehicleModel` now takes the slot the folder NAME states and confirms it against the `.dff`s that
ship; a folder claiming a slot it has no `.dff` for keeps the old rule and warns naming both. **10 of 212
slots corrected, 0 folders mis-named** — the naming contract holds across the whole fleet, so the fallback
fires on nothing today. The contract is `docs/contracts/vehicles.md` §1, whose old sentence — "the folder
name is free text and is never parsed" — this change retired.

### 3. `cars-server` (`npm run cars`)

One local page per game: every installed car with its model id, `<slot> replaced to: <car>`, the author,
what the mod brings, and the stock picture beside the field screenshot; click the screenshot for a
near-full-screen modal. Express + handlebars, styles inline, no build step, rendered per request.

Three sources joined on the SLOT: bundled stock metadata (19 sections, 212 cars — moved out of `NO_COMMIT/`
into `scripts/cars-server/data/`), the fleet `resolveVehicleSources` reports, and `screenshots/`. **Five of
the 212 pictures do not match their folder's name character for character** (`at400 - Boeing 727-100
Liveries- carcer.png` lost a space), so a filename join would have dropped exactly those five and looked
like missing screenshots. Tags (`Tuning`, `New Tuning Parts`, `N Paint Jobs`, `Car4 Supported`,
`New Colors`, `Has Cleo Script`) are read from the folder with the installer's own settings parser and its
`carcolsSection` rule — exported for the purpose rather than copied.

## What the audit itself found

1. **A test that only just fit its timeout.** `vehicle-cutscene`'s byte-identical `--no-base-copy` check
   (session 14's load-bearing one) runs ~2.8 s alone but past the default 5 s under full-suite contention:
   it failed **4 runs in 5** at load average 8 while passing on its own. The work IS the test — two full
   conversions — so it was given an explicit 30 s budget rather than made to do less. 3/3 green after.
2. **A stale architecture diagram.** `docs/architecture/assets/packages.svg` had not been re-rendered since
   `img-splitter` and `perfect-cutscene-asi` were added (sessions 13–14) — both packages were missing from
   the picture. Re-rendered. `boot-flow.svg` re-renders to byte-different output with identical content, so
   it was reverted rather than committed as noise.
3. **A fixture manifest that had been stale for a session.** `npm run test:fixtures` resolved **104/120**:
   session 14's mod layering moved four mods into `common/` and renumbered them (`60. Pacific Park…` is
   `59.` today) and this session's restructure moved seven more. Committed copies kept every test green
   while the sources drifted. Fixed at the root: a mods-src fixture is now found by the mod's NAME, ignoring
   the number (a position, which `renumber-mods` compacts) and searching every layer. **120/120** after.

Two of the three were invisible by construction — the tests were green throughout.

## Cost and state

| | |
| --- | --- |
| Commits | 15 — 6 for plan 007, 5 for cars-server, 3 for the audit's own finds, this write-up |
| New code | `tool-kit/vehicles-dir` (~170 lines), `vehicle-installer/model.ts` (~40), `scripts/cars-server` (~450 incl. the view) |
| New tests | 44 (17 resolver, 8 slot rule, 18 cars-server, 1 installer e2e) |
| Suite | 4313 → **4358**, tsc + eslint clean, 3/3 repeat runs green |
| Deps added | `express`, `handlebars`, `@types/express` (dev) |
| Docs | contract §1, `restrictions/architecture.md` + README, pmb architecture, `commands.md`, `development/scripts.md`, three readmes, two plans, one benchmark |

## What is NOT done

- **`new/` has never been exercised in a real build.** Every check used a temporary candidate; the folder
  is empty in the tree today. The first real A/B is the user's.
- **The screenshots are full-resolution** (up to 3.8 MB each, 212 of them). Lazy loading carries the page,
  and the modal drops its picture on close, but a resize pass is the fix if a phone struggles.
- **The other installers still carry private `guardOut` copies** (mod-installer, ped-installer,
  vehicle-installer) — carried over from session 14, untouched.
