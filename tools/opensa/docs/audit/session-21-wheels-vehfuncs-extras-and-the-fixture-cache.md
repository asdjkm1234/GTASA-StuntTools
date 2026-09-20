# Session 21 (2026-08-17): container wheels, VehFuncs extras, the ide comma, and the fixture cache

**On `main`, 9 commits after `2048af9c` (session 20's audit), tree clean, suite 491 files / 4 481 green /
0 skipped, e2e 26/26, tsc + eslint clean.** His order: one field bug (two cars with no rims), then extras,
then a small ide fix he asked for on the spot, then the fixture folder decisions — with a from-scratch
regeneration as the proof. Field verdict at the end: the car fixes are all in place.

## What changed

| area | change | commit |
| --- | --- | --- |
| `packages/renderware` (vehicle builder) | **A `f_wheel_<mask>` container wheel is its whole CHOSEN PATH, not its first atomic.** The alfamodding cabbie (`f_extras:2 → tire:1 → tire` + `rim:1 → hubcap`) and stretch (`f_extras:1 → rim:1 → wire_spoke`) drove on bare tyres in OpenSA because `containerWheels[0]` was the tyre. The VehFuncs `<name>:K` walk the cutscene tool settled in plan 004 round 11 is now in the builder (`chosenContainerWheel`): the set rides one part per dummy, `wheelFit` measures the set as one solid, `tyreMaterials` judges each mesh's band against the WHOLE wheel's radius (a hub cap alone would pass for rubber), a mesh offset below the container root is baked into wheel-local space (`frameWorldTransform(…, stopAt)`) | `7b2c41ae` |
| `packages/renderware` + `packages/game` + `tools/opensa-pack` | **VehFuncs recursive extras are a SPAWN decision.** Census: 59 of 213 original mod cars carry `f_extras`, 32 `f_class`; every variant drew at once. The builder emits the selector tree (`variants` in the `.osm` DESC, `VehicleVariantNode` = frame-index id, `select [min,max]`, `requires` tags, `condition` verbatim) and tags option meshes (`submesh.variant`); `EngineVehicleHandle` walks it once per car (`pickVariants` — `:N`, `:0`, `:0+`, `:N+`, class tags gating `[tag]` options) and composes it with LOD/damage/`extraN` visibility. `dump-vehicle-rig.ts` prints the tree | `eb3d62ea` |
| `packages/renderware` (text parsers) + `tools/vehicle-installer` | **IDE/IPL rows are split the way `CFileLoader::LoadLine` reads them — commas AND whitespace as one separator.** dodo, emperor and wayfarer ship a `.settings.txt` ide row without the model/txd comma; a comma-only split read the model as `dodo\t\tdodo`, appended a duplicate id row to the built `vehicles.ide` (both trees) and never applied the mods' numbers. `splitRow` fixed for every IDE/IPL reader and the installer's column reads; `mergeIde` replaces the first row of a model and drops any stale twin | `f30c331a` |
| fixtures | **Nothing under the fixture folder is committed**; the 37 custom fixtures (30 with no other source on disk) live in the local, uncommitted `fixtures-src/`, mirrored (wipe + copy, FIRST) into `fixtures/custom` by `npm run test:fixtures`, which says loudly when the source folder is absent | `e80256ae` |
| fixtures | **`tests/` renamed `fixtures/`** — 177 files rewritten (code, configs, docs, in-repo memory; eslint json ignore, serve-static's viewer root, `.gitignore`). The from-scratch regeneration found FOUR fixtures four vehicle-cutscene tests read that NO manifest line produced (`securica`/`cssecurica92` dffs, `smoke1b`/`synd_4a` ifps — `anim/cuts.img` joined the archive list); added | `80fd00a6` |
| `CLAUDE.md` | the fixture rule: game-src, mods-src, or the `fixtures-src` cache — and always a manifest line, verified by regeneration | `4a827b48` |
| e2e | the object-viewer WebGPU screenshot baseline refreshed (6 % drift past the 5 % gate, identical at the previous HEAD) | `202a8530` |
| docs | `contracts/vehicles.md` (`f_wheel` chosen path + what a misspelling does; `f_extras`/`f_class`/`[tag]`/`?cond`/`!characteristics` rows; `vehicles.ide` split rule), `features/vehicles.md`, `architecture/world-streaming.md` (DESC `variants`), `hacks/vehfuncs-conditions-always-true.md` + README row, `links.md` (the VehFuncs wiki page), `debug/README.md`, `open-issues/fixed/vehicles-ide-missing-comma-duplicate-rows.md` + README row, `development/getting-started.md` + `scripts.md`, `commands.md`, `.gitignore` | all |

## What it cost / what it bought

- Rebakes, all in place (no pmb run): cabbie + stretch 9 s; the whole `original` fleet for the extras
  (197 cars, 2 669 MB of `.osm`, ~13 min); dodo/emperor/wayfarer in both trees (~10 s each). The bench pak
  was not touched — cars live in `vehicles.img`, so the field could look the same hour.
- Bought: rims on the two cars and on every other container-wheel car; 59 cars that no longer wear every
  option at once; three ide rows that carry their mods' numbers; a fixture folder that is regenerable end to
  end (proved by regenerating it) and a name that says what it is.
- Tests: renderware vehicle 93 → 95 (+2 wheel), `variants.test.ts` new (14), builder real-cabbie block (+2),
  handle +2, `text-lines` +1, `merge` +2. Suite 4 458 → 4 481. Real fixture added: `cabbie-container-wheel.dff`
  (one manifest line).

## Verified by measurement

- Wheels: the rebaked `.osm` carries 6 submeshes per wheel (cabbie 7 026 tris, 1 tyre material; stretch
  9 776 tris, 3 tyre materials) against one tyre mesh before; **field-accepted** the same day.
- Extras: `vehicles.img` after the fleet rebake — 23 of 103 `.osm` carry a tree (cabbie: 3 extras + 1 class
  containers, 57 of 278 submeshes tagged; taxi: 8 + 2, 90 of 368); **field-accepted**.
- IDE: `awk`-count of duplicate ids in both built `vehicles.ide` → 0 (was 3); rows 585/586/593 carry the
  mods' wheel scales (0.749, 0.673, 0.56).
- Fixtures: `fixtures/` moved away, regenerated from `game-src` + `mods-src` + `fixtures-src`, `diff -rq`
  against the backup EMPTY (127 + 37 + 7); the first attempt was not empty — that is how the four missing
  manifest lines were found. Full unit run with the verbose reporter: no `↓` line (0 skipped). e2e 26/26
  after the baseline refresh (25/26 before, the failing one identical at the previous HEAD in a worktree).
- Stale-path grep after the rename (repo-wide, `tests/original|custom|viewer`, `'tests'`, `tests/**`,
  `/tests/`): 0 hits outside `NO_COMMIT`/history.

## Decisions taken (do not re-derive)

- **Extras are picked at RUNTIME, per spawn, from a tree the model ships** — never at build time. The plugin
  is in the reference install (`VehFuncs.asi`), so the SA target randomises per spawn; freezing one set
  into the pak would put the same clutter on every car in the world.
- **`?condition` and `!characteristics` are carried, not evaluated** (hack card). The tree ships them
  verbatim so a runtime that learns to evaluate them needs no rebake.
- **The wheel container's chosen path stays DETERMINISTIC** (first eligible child) — a wheel is one design;
  the runtime tree excludes the wheel container.
- **`splitRow` is the game's separator class for every IDE/IPL reader**, not a per-call tolerance; empty
  cells cannot exist under that reading, exactly as in the game.
- **Nothing under `fixtures/` is committed; `fixtures-src/` is local** (his call): the suite is only run
  locally, and the folder is his backup (`NO_COMMIT/backups/fixtures-src-2026-08-17` made this session).
  A fresh clone runs the suite with the custom-fixture tests skipped, and `test:fixtures` says so.
- **A fixture is a manifest line or a `fixtures-src` file, verified by regeneration** — in `CLAUDE.md`.

## Open after this session

- His OpenSA lab verdict on `burger01_law` (`?src=/build/original/opensa-lab`) — still pending.
- The GPU-pass regression (`docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md`) — untouched;
  next = the UNCAPPED headless sweep on the 08-17 pak.
- `packages/validation` 001 → `apps/cutscene-converter` 001/002.
- VehFuncs conditions (`?c1`, `?rain`, `?h6-18`) and class characteristics (`_pj=`, `_cl=`) — the hack card
  names what retires it.
- The `$`/`!` handling sub-tables in dodo's and wayfarer's `.settings.txt` are still dropped (pre-existing,
  roadmap 0.6.0 air/water/rail).
- The cutscene tool's `pickVariantPath` and the builder's `chosenContainerWheel` are two implementations of
  one walk (different inputs: `ClumpModel` vs `RWClump`); a shared core is a candidate if either changes.
