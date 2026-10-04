# 003 — game-shaped output: `--game` in, a game out

**Status: every phase SHIPPED (0–6).** Each class in the archives converts — vehicles, breakables, clutter,
topple props, animated objects, peds and the ~14 000 map objects — plus the engine, the production player
and the pmb stage. Both phase-3 gates are closed (no DFF parse at spawn; 45× measured).

Phase 5g steps 1–6: `planModelTextures` (the raw-TXD
dictionary that preserves mip chains) plans per BUILDER LAYER, `remapModelLayers` rewrites `meta` onto the
planned slots, a per-submesh `array` index carries the multi-array case through the engine, and the rigid
path now reads PRELIT and NIGHT vertex colours (clutter and the rigid emissive included).

The bulk convert ships: **13 841 map objects, 0 failed**, against the SHARED world dictionary (400 MB, not
the 3 674 MB a private dictionary each would have cost), and `gta3.img` came out SMALLER than the input
(1 224 vs 1 328 MB) with 14 349 entries deleted.

**Still open**: the **full pmb run end to end** — the user runs it last. The `pack` stage is proven at the
library boundary (byte-identical pak) and by the typechecker, not yet through the pipeline.

The three audit gaps are CLOSED (2026-07-19) — measured, and none of them costs anything today; see
"The three audit gaps, measured" below.

Supersedes the output half
of [074/14](../../../../docs/plans/074-opensa-engine/14-pmb-integration.md); the pmb-stage half stays there.

Shipped so far: `--out` is a game-dir copy with products under `<out>/opensa/` (phase 1, commit `189d81b`);
the `.osm` container + baked `COLL` + the vehicle writer + BC1/BC3 per-model `.ostex` (phase 2, commits
`dc10ceb` · `4f9b64f` · `0d88b59` · `bea5554` · `71de581` · `a896334`). Nothing in the RUNTIME reads a
`.osm` yet — that is phase 3, and until then this is converter-side only.

opensa-pack is the odd tool in the chain. Every other tool takes `--game <dir>` and emits `--out <dir>`
that is a complete, bootable game dir (`tools/perfect-map-builder/src/pipeline.ts:138-152` — each stage
hands the next a full game tree). opensa-pack instead emits four loose files —
`world.ospak`, `manifest.json`, `water.bin`, `report.json` (`src/cli.ts:126-135`) — that only the engine
host and the lab know how to read, wired in through a symlink farm in `public/`.

This plan makes it behave like the rest of the chain: **`--out` is a copy of `--game`**, and everything we
convert into our format REPLACES its original inside the IMG archives. The VFS looks for our format first,
falls back to the stock asset, and warns when neither exists.

This is explicitly an **opensa-only build** — the real game cannot boot it, and it does not need to. The
chain already forks at the LOD stage (`pipeline.ts:171-185`): the `sa` target is the real-game build, the
`opensa` target is ours. opensa-pack is the final conversion of the `opensa` target and of nothing else.

## Terminology: optimized vs unoptimized models (user, 2026-07-18)

The chain has exactly two kinds of asset at runtime, and **it is a property of the ASSET, not of the
build** — both kinds coexist in the same session:

- **Optimized** — converted by opensa-pack into our format (`.osm`/`.ostex`), carrying every offline
  optimization we have: prepared buffers, resolved `txdp` chains, baked collision in engine shape,
  precomputed bounds. Loaded by reading a section. No RW parser runs.
- **Unoptimized** — a stock or modded `.dff`/`.txd` reached through the **current** runtime flow: parse,
  build, upload, at the moment it is needed. This is what a `modloader/` asset always is.

opensa-pack converts **everything in the IMG archives** — map objects, vehicles, peds — so a stock build is
100 % optimized. The unoptimized path exists for one reason: a user drops a mod into `modloader/`, and it
must work without a reconvert. That makes the RW parsers permanent runtime code, not legacy — they are the
unoptimized path's engine, and this plan must not weaken them.

It also settles a question this plan had left open: restoring the runtime `txdp` walk (constraint 4) is not
optional polish. It is the unoptimized path's texture resolution, and without it a modded TXD with a parent
silently loses textures.

## Why the output shape has to change

Three concrete costs of the current shape:

1. **The manifest carries data that also exists in the game dir, and the two drift.** The 2026-07-18
   black-night bug and the engine-vs-prod fog mismatch both traced to the host reading the PAK-BAKED
   timecyc copy instead of the live game file (`apps/web/src/ui/engine-canvas-host.tsx:256-271` now prefers
   the game and falls back to `setup.timecyc`). Every field the manifest carries that ALSO exists in the
   game dir is a future instance of that bug. If `--out` is a game dir, `data/timecyc.dat` is simply
   there — `manifest.timecyc` and `setup.timecyc` die with no replacement.
2. **The runtime still parses DFF.** Vehicles are built at SPAWN time from stock DFF bytes
   (`@opensa/renderware/vehicle/build-vehicle-model`, moved to a worker in plan 21 to hide ~170 ms
   new-car-type freezes). The freeze was hidden, not removed. An offline per-model format removes it.
3. **Two hosts, two loaders, one symlink farm.** `packages/engine/src/stream/setup.ts:30-35` and
   `apps/engine-lab/src/pak-loader.ts:20-26` duplicate the manifest fetch/validate; the paks live in
   `apps/engine-lab/public/` with root-level symlinks (`public/pak-ls`, `public/pak-map`, `public/ped`) as
   the sharing mechanism. Plan [079](../../../../docs/plans/079-canonical-build-source/readme.md) collapses
   that, and it needs this plan's output shape to collapse ONTO.

## The gap this plan has to close first

**There is no per-model native format today.** `.oscell`/`.ostex`/`.oswire`/`.ospak`
(`packages/engine-formats/src/`) are all WORLD-scoped: welded cells and shared texture arrays. Nothing in
the repo writes "one model, our format". The two probe CLIs that look like it —
`src/vehicle-probe.ts`, `src/ped-probe.ts` — bake single throwaway lab fixtures (`vehicle.json`+`.bin`,
`ped.json`+`.bin`) and are documented as such.

So "delete the dff, put our file in its place" is **new format work**, not a repackaging. Its scope is
every model in the archives — map objects, vehicles, peds — per the convert-everything decision above.
Static map geometry is ALSO still welded into cells: welding is the draw-call win and nothing replaces it;
the per-model `.osm` serves the by-name lookups (breakables, clutter, animated objects, script spawns).

## Design

### Output layout

```
<out>/                          ← byte-copy of <game>, then mutated in place
  data/…                        ← untouched: timecyc, water.dat, handling, gta.dat, IPL/IDE
  models/gta3.img               ← REBUILT: converted entries replaced, everything else passed through
  models/gta_int.img            ← same
  opensa/                       ← the world-scoped products (no 1:1 IMG entry exists for these)
    manifest.json               ← indexes OUR products only — see the manifest rule below
    cells/<x>_<y>.hd.oscell
    cells/<x>_<y>.lod.oscell
    textures/<ref>.ostex
    water.osw
```

**That block is the TARGET, not today.** As of phase 1 the products land in `<out>/opensa/` but keep their
current shape — `world.ospak` + `manifest.json` + `water.bin` + `report.json`. The split into named cell
and texture files is phase 4, and it is gated on the container-vs-files measurement.

Inside the IMG, per user decision 2026-07-18: **full replacement, own extension, same basename.**
`landstal.dff` → `landstal.osm`; `landstal.txd` → `landstal.ostex`. The original is DELETED. `EditableImg`
(`tools/tool-kit/src/archive/img.ts:13-26`) already has exactly this API — `delete(name)` + `set(name, data)`
— and `writeImgFile` (`img.ts:97`) streams the rebuild without doubling peak RSS, which is how
map-optimizer survives a ~1 GB archive (`tools/map-optimizer/src/adapters/gta-sa/build.ts:36`).

Extensions are deliberately visible in the archive listing: a file that says `.dff` but is not a DFF lies
to every other tool and to us.

### The manifest rule (user decision, 2026-07-18)

A manifest for OUR OWN auxiliary data is fine and stays — a browser cannot list a directory over HTTP, and
`cellSize`, the district bounds and a format version have to come from somewhere. The rule is about what it
may CARRY:

> **A manifest may index only what opensa-pack itself produced. It may never carry data that can be read
> directly from the game dir.**

So it keeps: format version, `cellSize`, cell bounds, the cell/texture/water entries with their offsets and
encodings. It loses: `timecyc` and `timecyc24` (read `data/timecyc_24h.dat` / `data/timecyc.dat` — the
engine host already prefers exactly that, `engine-canvas-host.tsx:260-261`), and anything else later
tempted in from `data/`. The `water` pointer stays, because the baked mesh is ours; `data/water.dat` stays
the fallback it already is.

Independently of the manifest, cells and textures should still be addressable by COMPUTED name
(`cells/12_-7.hd.oscell`, textures resolved from refs recorded in the cell that needs them). That is what
makes **per-ring texture laziness** — the standing post-flip lever, ~767 MB world-array boot — fall out of
the layout instead of needing its own pass. The manifest then indexes those files rather than being the
only way to find them.

### VFS resolution order

Per user spec, in the layer that resolves an asset by name (not in `Vfs` itself — `packages/vfs/src/vfs.ts`
is a flat name→bytes map by design, and the resolution belongs above it, next to
`packages/renderware/src/archive/asset-cache.ts:41-44`):

1. **modloader wins outright — as an UNOPTIMIZED asset.** If a mod ships the name, it is used and it goes
   through the current parse-at-runtime flow (user decision 2026-07-18). `packages/modloader/src/index.ts:71-73`
   already resolves by bare name before falling through; this makes it a stated rule. It is also the correct
   precedence: our optimized asset is the un-modded original, so a mod replacing it must beat it.
2. `<name>.osm` / `<name>.ostex` → **optimized**, section read, no RW parser touched.
3. `<name>.dff` / `<name>.txd` still in the archives → unoptimized. After a full convert this should be
   empty for models; it stays as the safety net and for anything a future converter skips.
4. neither → **console warning**, once per name, silenced by a game-config flag so it cannot spam.

One honesty note on rule 1: a runtime modloader override of a **welded map model** does not show, because
that geometry is baked into a cell. This is not new — mods enter the build at the mod-installer stage,
long before opensa-pack — but modloader-first makes it a question people will ask, so it belongs here.

The local loader must ingest our extensions too: `packages/loaders/src/asset-local-loader/build-vfs.ts`
selects entries by IDE-derived `.dff`/`.txd` names (`:61-76`) and would otherwise skip every converted
asset — the same class of bug as the procobj miss recorded in the memory
(`procObjModelRefs`, plan 19/20's blocker).

### CLI

`--game <dir>` + `--out <dir>`, resolved through `@opensa/tool-kit/cli` (`argValue`/`fromCwd`) instead of
the private `arg()` helper at `src/cli.ts:31` — opensa-pack is currently the only tool with no cwd-relative
path resolution. `--out` gets a `guardOut` equivalent (refuses root, refuses an `--out` that is or contains
`--game`; today only `mod-installer/src/install.ts:15-25` has one — promote it to tool-kit rather than
writing a fourth private copy).

`--rect` stops being required: absent means the whole map. Bake flags keep their 2026-07-17 defaults
(AO on, `--no-ao` to skip; sun-vis opt-in via `--bakes`).

## Non-goals

- **The real game must still boot `--out`.** It must not and will not. Any tool downstream of opensa-pack
  is out of the chain by construction.
- Re-deriving cells. The welding/baking pipeline (`src/convert.ts:104`) is not touched by this plan except
  where it writes its results.
- Compression format changes. `.oswire` + deflate-raw stay as they are.
- Peds/vehicles gaining new visual features. This is a format and IO plan; the pixels must not move.
- **Removing the RW parsers.** They ARE the unoptimized path. `parseDff`/`parseTxd`/`parseIfp`/`parseCol`
  stay, stay tested, and stay correct — a mod must work without a reconvert.
- `002-fetch-game-paks` (the hosted-pak question) — unblocked by this plan, still its own plan.

## Phase 0 results

### Manifest audit against the manifest rule

Fields are `OspakManifest` (`packages/engine-formats/src/ospak.ts:33-55`), produced at `src/convert.ts:236-240`.

| Field          | Origin                                           | Verdict                                                                                           |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `version`      | format constant                                  | **keep**                                                                                          |
| `byteLength`   | pak size                                         | **keep** while a container exists; dies with it if phase 4 goes to loose files                    |
| `cellSize`     | converter choice (the `CELL_SIZE` constant, 250) | **keep** — not derivable from the game; the welder picked it                                      |
| `cells`        | welded output                                    | **keep**                                                                                          |
| `textures`     | our texture arrays                               | **keep**                                                                                          |
| `uvAnimations` | extracted from DFF UVAnimDict plugins            | **keep** — the source DFFs are welded away, and cells index this array by slot, so it is ours now |
| `water`        | our baked mesh pointer                           | **keep** — the MESH is ours; `data/water.dat` remains the runtime fallback it already is          |
| `timecyc`      | verbatim `data/timecyc*.dat` text                | **DELETE** — rule violation, and the one that already bit us                                      |
| `timecyc24`    | which of the two files was found                 | **DELETE** — same                                                                                 |

Two fields die. Their consumers, in the order they must be cut:

- producer `src/convert.ts:232-239`
- `packages/engine/src/stream/setup.ts:18-20` (the `StreamSetup.timecyc`/`timecyc24` fields) and `:111-112`
- `apps/web/src/ui/engine-canvas-host.tsx:262-266` — only the `setup.timecyc` FALLBACK branch goes; the live
  path (`:260-261`, `data/timecyc_24h.dat` → `data/timecyc.dat`) is already prod's exact preference and
  becomes the only path
- `apps/engine-lab/src/main.ts:535-536` — **ordering dependency**: the lab has no VFS today and reads
  timecyc exclusively from the manifest, so this field cannot be deleted until the lab reads a game dir
  ([079](../../../../docs/plans/079-canonical-build-source/readme.md) phases 1–2). 079 phase 2 and 003 phase 4
  are the same cut.

### Convert-everything dissolves the exclusion set — and creates a size question

An earlier draft of this plan had to compute an **exclusion set**: which DFFs may be deleted from the
archives, given that welded map geometry lives in cells but breakables, clutter, animated objects and
script spawns are still fetched by name. Getting that set wrong is a silent no-render of exactly the kind
that blocked plans 19/20 (the `procObjModelRefs` miss).

Converting **everything** removes that risk by construction: every by-name lookup finds an `.osm`, so
deletion is uniform and there is no set to get wrong. The by-name inventory below stays useful — it is now
the list of what must be TESTED after conversion, and the map of which classes need which `.osm` sections.

It does duplicate: a map object is welded into its cells AND kept as a per-model `.osm`. That is worth a
line in the ledger and nothing more:

- cells store geometry **per placed instance** (a model placed 50 times contributes 50 times), while the
  per-model catalogue is one copy per model — so the addition is a fraction of the welded world, not a
  doubling of it;
- a per-model `.osm` is fetched **lazily, by name**. One never requested costs no memory and no frame time.

So the cost is delivery size only. **Convert everything; record `--out` size and the per-model share in
phase 1.** If it ever becomes material, skipping per-model output for map objects with no by-name use is an
optimization with a known price — a much better position than guessing an exclusion set up front.

### The mixing rule

Optimization is per FILE, so a mod can produce a half-and-half asset: `modloader/` ships only a car's
`.txd` while the model is still our `.osm`.

**Decision (user, 2026-07-18): take the optimized side only, and warn.** A half-modded asset resolves to
our `.osm` + our `.ostex`; the lone modded file is ignored with a console warning naming it.

**The consequence, accepted 2026-07-18:** a retexture-only car mod — the most common kind of car mod there
is — does nothing but print a warning. The user weighed this and it is fine for now.

Recorded so a future reader does not have to rediscover it: supporting retexture mods later means **`.osm`
binding textures by NAME rather than baking indices into an atlas only its own `.ostex` can satisfy**, so a
runtime-parsed `.txd` can be bound instead. Cheap to design in, near-impossible to retrofit — so if that
day comes, expect a format revision, not a patch.

### By-name asset inventory (the exclusion set)

The cell-streaming worker (`packages/engine/src/stream/pak-worker.ts`) resolves nothing by name — it reads
`.ospak`/`.oscell` ranges only. That confirms the welded-map premise: everything below is what remains.

| Asset class                | Pattern built                                                                     | Call site                                               | Trigger                | Runtime parse                         |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | ------------------------------------- |
| Vehicle model              | `${def.model}.dff`                                                                | `gta-sa-world.adapter.ts:612`                           | **spawn**              | `parseDff` (worker)                   |
| Vehicle collision          | _same DFF bytes_                                                                  | `gta-sa-world.adapter.ts:619`                           | spawn                  | `parseDffCollision` (**main thread**) |
| Vehicle textures           | `${def.txd}.txd` → `models/generic/vehicle.txd`                                   | `gta-sa-world.adapter.ts:371-373`                       | spawn                  | `parseTxd` + DXT                      |
| Prop (topple) model + hull | `${modelName}.dff` via `getClump`                                                 | `engine-props.ts:69`, `:187`                            | collision event        | `parseDff`                            |
| Clutter species            | `${modelName}.dff` via `getClump`                                                 | `engine-clutter.ts:34`                                  | cell stream-in         | `parseDff`                            |
| Animated map objects       | `${modelName}.dff` via `getClump`                                                 | `engine-anim-objects.ts:79`                             | first spawn in range   | `parseDff`                            |
| Breakable shatter mesh     | `${modelName}.dff` via `getBreakable`                                             | `renderware/src/breakable/mesh.ts:49`                   | break + collider build | `parseDff`                            |
| IFP clips (anim objects)   | `${ifpName}.ifp`                                                                  | `asset-cache.ts:57`                                     | anim-object build      | `parseIfp`                            |
| Per-class texture dicts    | `${txdName}.txd`                                                                  | props `:70`, clutter `:35`, anim `:83`, debris `:134`   | with the model         | `parseTxd`                            |
| Corona + water sprites     | `models/particle.txd` (literal)                                                   | `engine-particles.ts:47`, `engine-canvas-host.tsx:1127` | **boot**               | `parseTxd` ×3                         |
| FX atlas + library         | `models/effectspc.txd` → `models/effectsPC.txd`, `models/effects.fxp`             | `engine-particles.ts:67-68`                             | boot                   | `parseTxd` / `parseFxp`               |
| Collision libraries        | **suffix sweep**, not by name                                                     | `collision-index.ts:32-38`                              | first collider call    | `parseColLibrary` over EVERY `.col`   |
| World data + text          | `data/*.dat/.ide/.cfg`, IPL streams, `text/american.gxt`, `data/paths/nodes*.dat` | `resolve-map.ts`, adapter, host                         | boot                   | text/binary, no RW                    |

Everything in that table survives in `--out`. Everything else in the archives is welded-only and may go.

### Four design constraints this surfaced

1. **The collision index is an enumeration, not a lookup.** `collision-index.ts:32-38` scans `archive.names`
   for the `.col` suffix and parses **every** library on first use, on the main thread. We are not
   converting COL, so the contract holds — archive deletion must not disturb `.col` entries and any naming
   scheme must leave the suffix sweep intact.

   **Open, measured question (user raised it 2026-07-18):** putting collision INTO the model file does not
   remove this sweep, because cell colliders are needed for welded models that will never have an `.osm`.
   The only thing that removes it is baking colliders into the CELL offline — after which `.col` could be
   dropped from the archives entirely. That is a bigger change than this plan, and its value is unknown
   until we measure what the sweep actually costs (first-collider-call ms, and how much of it is libraries
   nothing in the district references). **Measure first, in phase 1; decide after.**

2. **The modloader hardcodes the extension list.** `packages/modloader/src/scan.ts:63-66` knows
   `.dff`/`.txd`/`.col`/`.ifp`; `index.ts:71-73` resolves by BARE name first, so a mod's `particle.txd`
   shadows `models/particle.txd`. `.osm`/`.ostex` must join that list, or mods silently stop overriding
   converted assets — and a mod DFF must be able to shadow our `.osm`, which is the resolution order doing
   its job.
3. **The vehicle DFF is consumed twice** — transferred to the worker for the model
   (`gta-sa-world.adapter.ts:377-381`) and parsed on the MAIN thread for collision (`:619`).
   **Resolved: `.osm` is SECTIONED** — a small header/offset table, then independent sections (model,
   collision, and whatever later classes need). The main thread reads the collision section without
   touching geometry; the model section is transferred to the worker as today. No round-trip, no double
   parse, and `parseDffCollision` at spawn becomes a struct read. This also answers "should collision live
   in the model file": for vehicles it already does (an embedded COL chunk), and the sectioned layout keeps
   that property while making it cheap to address.
4. **`txdp` parent chains are resolved OFFLINE, and that is the model for `.ostex`.** `asset-cache.ts:36-38`
   and `:74-85` are orphaned doc comments — `getTextures`, `setTxdParents`, `ownTextures` have no
   implementation left, and `MapDefinitions.txdParents` is still built (`resolve-map.ts:60,73,106`) and read
   by **nobody at runtime**. It is not a live bug, because the consumer that matters survived on the
   converter side: `TexturePlanner` walks the chain at weld time (`src/textures.ts:246`, fed at
   `convert.ts:117`), so welded map geometry gets its inherited textures baked in.

   **Decision (user, 2026-07-18): fix it, both sides.**
   - `.ostex` stays **FLAT** — the converter resolves the chain at build time, so nothing we produce needs a
     runtime walk.
   - The **runtime walk is restored** for the fallback path. Offline flattening only covers what we
     converted; a stock or modded `.txd` reached through resolution step 3 still needs its `txdp` parent,
     and today it silently loses those textures. `MapDefinitions.txdParents` is already built and carried
     (`resolve-map.ts:60,73,106`) — it just has no consumer. Re-implement `getTextures`/`setTxdParents`
     (the deleted machinery the `asset-cache.ts:36-38,74-85` comments still describe), wire it into the six
     bare-name TXD call sites (rows 4-8 of the inventory), and cover it with a test built from a real
     `txdp` case — mod-installer's HD-swap mod emits exactly one.

   Live impact today is probably nil (the HD-swap mod targets map models, which weld offline), which is
   why it went unnoticed — but it is a latent hole that opens the moment a mod parents a vehicle or prop
   TXD, and it is cheap to close.

### Two findings that belong to plan 079

- **The player ped never touches the VFS.** `apps/web/src/ui/engine-player.ts:54-56` fetches
  `/ped/ped.json` + `/ped/ped.bin` — the probe fixture — over HTTP, in the PRODUCTION host, not just the
  lab. `buildPedModel` exists and is reachable only from `apps/viewer`. So retiring the ped fixture is a
  production change, not a lab change, and it lands with 079.
- **`particle.txd` is fetched and fully re-parsed three times** at boot (coronas, ripple, foam) with no
  cache. Free win, noted so it is not lost.

## Phases

**Phase 0 — decisions + inventory.** Fix the extension names; enumerate every asset class the runtime
resolves BY NAME (vehicles, peds, clutter, breakables, particle/font TXDs) with the call site for each;
audit the current manifest field-by-field against the manifest rule. Deliverable: two tables in this plan,
no code.

**Phase 1 — IO rework, same products.** `--game`/`--out` via tool-kit, full copy, `guardOut`, IMG rebuild
via `writeImgFile`, world products under `<out>/opensa/`. Manifest still written, still read by both hosts.
Nothing visual changes; the ritual 6-scene sweep must stay flat. This phase is reversible on its own.

**Phase 2 — the `.osm`/`.ostex` per-model format.** Format spec in `packages/engine-formats/` next to
`oscell.ts`, with round-trip tests. Writer reuses `buildVehicleModel` offline (it is already
browser-and-node callable, which is why the probe CLI is thin). Vehicles first — they have the builder, the
fixtures, and the measured spawn cost.

**Phase 3 — IMG replacement + VFS order.** Delete-and-insert in the archives; the 3-step resolution with
the once-per-name warning and its config flag; local-loader ingest. Gate: a converted vehicle spawns with
NO DFF parse (assert the parser is never entered) and the plan-21 spawn measurement improves.

**Phase 4 — the world products move to `<out>/opensa/`.** Cells and textures become named files, textures
load per ring on demand, `world.ospak` dissolves into them, the manifest shrinks to the manifest rule
(`timecyc`/`timecyc24` deleted, `setup.timecyc` with them), and `setup.ts` + `pak-loader.ts` collapse into
one loader. **Measured gate:** boot time and steady-state must not regress against the ospak baseline —
many small files vs one range-read container is a real trade, decided by measurement, not by taste. If the
numbers say container, the container stays and only the manifest rule and the `opensa/` location apply.

**Phase 5 — the rest of the archives**: peds, clutter, breakables, animated objects, map objects. At the
end of this phase a stock build is 100 % optimized and the `.dff`/`.txd` entries are gone from the IMGs.

**The PLAYER ped lands here** (user decision 2026-07-18, not in 079): `apps/web/src/ui/engine-player.ts:54-56`
fetches `/ped/ped.json` + `/ped/ped.bin` — the probe fixture — in the **production** host, so moving it to a
by-name VFS load is a production change and needs its own field check, not just a green suite.
The lab stops having a private ped/vehicle fixture format here — it loads peds and cars by name through the
VFS like the game and the viewers (plan [079](../../../../docs/plans/079-canonical-build-source/readme.md)), so
`ped-probe.ts` / `vehicle-probe.ts` and `ped.bin` / `vehicle.bin` retire.

**Phase 5b — the unoptimized path proves itself. DONE 2026-07-19, and the field earned its keep.**

Booting the converted full map with a car mod in `modloader/` printed a warning nobody had asked for:
`ignoring modded coach.txd — 'coach' is an optimized model`, for a car with no mod anywhere near it. The
mixing rule was asking the MERGED VFS whether a `.txd` exists — and a convert deliberately KEEPS the stock
dictionaries that unconverted models still need, so it called every one of those a mod. `withModloader` now
exposes `moddedAssets` (the bare names the OVERLAY supplies) and the rule asks that instead; nothing else
can tell "a user modded this" from "the file is simply there".

The contract is now pinned as an integration test on REAL fixtures rather than on a screenshot, which could
not even resolve the swapped car at bench distance (`modloader-paths.test.ts`, four cases):

- a KEPT stock dictionary draws no warning — the regression the field found;
- a retexture-only mod still loses to the `.osm`, and the ignored file is named;
- a complete mod WINS and loads unoptimized, proven by VERTEX COUNT (the fixture set gained `cheetah.dff`
  so the mod is a different car under the admiral's name — "the mod won" is a fact about the mesh, not
  about which texture path happened to run);
- a modded dictionary still walks into its `txdp` PARENT for what it does not ship (constraint 4).

**Phase 6 — pmb stage. SHIPPED 2026-07-19.** `'pack'` joins `STAGE_NAMES` and the `--until` docs, running
on the `opensa` target after `swapLinearTxds` and the `linear-txd` cleanup — the LOD build is the last thing
that mutates the game dir, and `swapLinearTxds` rewrites the very texels the pak carries.

The convert became a LIBRARY first (`pack.ts` → `packGameDir(options)`), because a pipeline stage must not
go through argv; `cli.ts` is now flag parsing and nothing else. **The extracted path produced a pak
byte-identical to the pre-refactor build** — which is also the determinism pmb requires of every stage.

Where the output lands depends on how far the run goes, and the rule keeps "every stage hands the next a
complete game tree" true: `--until opensa` stops at the LOD build and leaves `opensa/` in GAME format, while
a full run (or `--until pack`) builds the LODs into `.work/opensa-lod` and the CONVERTED dir takes the
`opensa/` name. Config lives in `BuilderConfig.pack` — `{ ao, bakes, rect }`, and a pipeline build is a
SHIPPING build, so both bakes default ON.

Two things this surfaced, neither fixed here:

- **`config.cellSize` is 256 while the pack's `CELL_SIZE` is 250.** pmb's field is documented as "must match
  the engine streaming grid", but it feeds `buildOpensaLods` (the impostor bake), not the pack. Two grids,
  one name; worth resolving before someone changes the wrong 250.
- **`checkImgIdBudgets` does not run on the packed target**, and should not: it guards the REAL game's FLA
  pools, and the packed `opensa/` is not bootable by the real game. The convert moves 14 349 entries out and
  12 858 in, so the counts it would read are meaningless there.

**Owed**: a full pmb run end to end. The stage is proven at the library boundary (byte-identical pak) and by
the typechecker, but the pipeline wiring itself has not been executed — it needs the whole mods-src chain.

## Tasks

- [x] Phase 0 — manifest field audit (2 fields die: `timecyc`, `timecyc24`)
- [x] Phase 0 — by-name asset inventory = the archive-deletion exclusion set + 4 design constraints
- [x] Phase 0 — extensions fixed as `.osm` (model, SECTIONED) / `.ostex` (texture dict, FLAT)
- [x] Phase 0 — resolution order settled: modloader → `.osm`/`.ostex` → `.dff`/`.txd` → warn
- [x] Phase 1 — the `.col` sweep MEASURED (2026-07-19), and it says NOT to bake offline cell colliders
- [x] Phase 3 step 4 — the runtime `txdp` walk restored as `getTxdChain`/`setTxdParents`, wired into the
      FIVE live by-name TXD sites (props, clutter, anim objects, debris, vehicles). The sixth — the ped —
      does not read the VFS at all yet, so it gets the walk for free when it moves there in phase 5.
- [x] Phase 1 — `--game`/`--out` via `@opensa/tool-kit/cli` (+ `requireDir`); `guardOut` + `copyGameDir`
      promoted to `@opensa/tool-kit/game-dir` with tests
- [x] Phase 1 — full game-dir copy; world products under `<out>/opensa/`
      (**IMG rebuild deferred to phase 3** — with nothing yet replacing archive entries, rebuilding would be
      churn; `cpSync` carries the archives through untouched)
- [x] Phase 3 gate — the spawn measurement: 45× per car type (7.4 ms → 0.17 ms); the worker-hidden
      100–200 ms build per new car TYPE is gone, not hidden
- [x] Phase 2 — `.osm` container in `packages/engine-formats/src/osm.ts` + round-trip tests (9)
- [x] Phase 2 — **no new texture format**: a model's dictionary is an existing `.ostex` beside it
      (`.ost` would have collided with `.ostex`'s own `'OST1'` magic — the reuse was there all along)
- [x] Phase 2 — `COLL` section codec (`osm-collision.ts`): engine-shape collision, faces already flattened
      into indices, half-extents from the COL bounds — the whole main-thread spawn sequence, baked
- [x] Phase 2 — offline vehicle writer (`tools/opensa-pack/src/vehicle-osm.ts`) reusing `buildVehicleModel`
- [x] Phase 2 — per-model `.ostex` emission (`model-ostex.ts`) + `packOstexPayload` extracted so world and
      per-model layers share one row-packing
- [x] Phase 2 — texture compression DECIDED (user, 2026-07-18): BC1 when every layer is opaque, BC3 when
      any needs alpha; 4.07 → 1.16 MB per car, generation loss measured at ~1/255 mean
- [x] Phase 3 step 1 — IMG delete-and-insert (`archive-edit.ts` + `pack-vehicles.ts`, wired in `cli.ts`
      behind a default-on `--no-models` opt-out); vehicles only, phase 5 adds the rest of the classes
- [x] Phase 3 step 2 — the RUNTIME reads `.osm`/`.ostex`: resolution order in `loadOptimizedVehicle`, the
      mixing-rule warning (de-duplicated, surfaced via `onAssetWarning`), `.osm`/`.ostex` in the modloader
      allow-list, `readVehicleOsm` (the missing inverse of `packVehicleFixture`), and a COMPRESSED model
      texture path in the engine (`core/ostex-upload`, `ModelTextureInit` union)
- [x] Phase 3 step 3 — local-loader ingest: `partitionEntries` prefers `<base>.osm` and pulls the
      MODEL-named `<base>.ostex` with it; `looseGroup` routes both. Everything downstream
      (`filesForGroup`, `readEntry`) was already extension-agnostic.
- [x] Phase 4 step 1 — per-ring texture laziness, ON THE CONTAINER (cell entries carry `textures`; the
      driver loads an array with the first cell that draws it and releases it with the last). No file split
      was needed — see the ledger for why, and for the measurement that says the planner's global array
      packing, not the loading policy, is the residency lever.
- [–] Phase 4 — named cell/texture files under `<out>/opensa/`, one loader — DROPPED, not deferred: the
  laziness it was meant to enable shipped without it, and nothing else wants it.
- [x] Phase 4 step 2 — the MANIFEST RULE applied: `timecyc`/`timecyc24` deleted from `OspakManifest`,
      `buildOspak`, the converter, `StreamSetup` and the host's fallback branch. The lab reads the game's
      own `data/timecyc*.dat` via `?src=` naming an opensa-pack `--out` (`pak-source.ts`).
- [x] Phase 2 — mixing rule shipped with phase 3 step 2 (the de-duplicated `onAssetWarning` that names the
      ignored file); still to be PROVEN in the field — that is phase 5b
- [x] Phase 5a — `ClutterModelInit`/`DebrisUpload` widened to `ModelTextureInit` (ped left for its own step)
- [x] Phase 5b — `SHAT` section + `packBreakables` + `getBreakable` reading it (252 props, 1.6 MB)
- [x] Phase 5f step 2 — ped converter (`ped-osm.ts` + `packPeds`) + `readPedOsm` + the ped data-loss gate
- [x] Phase 5f step 3 — engine binds a ped's textures per SUBMESH; `engine-player.ts` loads the player by
      NAME from the VFS. FIELD-CHECKED (two real bugs the suite could not see — see the ledger)
- [x] Phase 5e — animated objects: `SKEL` (the frame tree); the IFP stays a separate, moddable asset
- [x] Phase 5 — REAL-FIXTURE conversion tests + the `no-data-loss` gate over one model per class
- [x] Phase 5d — topple props: `HULL` section (dedup'd collider cloud + fallback box), read by `boundsOf`
- [x] Phase 5c — clutter species converted + read on the cell-stream path (56/56); `TEXS` section replaces
      the sibling `.ostex`; `ModelBundles` merges every class's sections into ONE `.osm` per model
- [x] Phase 5 — peds, clutter, anim objects, map objects all converted
- [→] Probe CLIs + fixtures retired — MOVED to plan 079: `ped-probe`/`vehicle-probe` only die once the LAB
  loads peds and cars by name through the VFS, which is that plan's whole subject
- [x] Phase 5g — map-object textures preserve the chain: they plan from the RAW TXD through the SHARED world
      planner, which passes opaque DXT through byte for byte
- [x] Phase 5b — the optimized/unoptimized contract EXERCISED: a headless field check on the converted full
      map, then pinned as an integration test on real fixtures (`modloader-paths.test.ts`). The field check
      found a real defect — see the ledger
- [x] Phase 6 — pmb `pack` stage + `--until` docs (byte-identical pak across the library extraction)
- [x] Phase 1 — `openGameDir` reads archives through a FILE HANDLE (the >2 GB defect + the RSS win)
- [x] Close-out (2026-07-19) — 6-scene ritual sweep on the converted full map, `npm run lint` clean
      (0 errors), coverage floors held, plan + 074/14 repointed. See the close-out row below.

## Measurement ledger

**Phase 1 (2026-07-18)** — one-cell smoke convert, `--game game-src/original --rect 9,-7,9,-7 --no-ao`:

| Measure                      | Value                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| game dir copy (1.4 GB, APFS) | **1.2 s** — clone-on-write; not a cost worth engineering around                   |
| `--out` size vs `--game`     | 1.4 GB vs 1.4 GB + 9.2 MB of products                                             |
| convert wall-clock           | 3.3 s total (1 cell, no bakes)                                                    |
| products written             | `opensa/{world.ospak 6.1 MB, manifest.json 98 KB, water.bin 2.5 MB, report.json}` |
| game files after             | `data/gta.dat`, `models/gta3.img` present and untouched                           |

**Phase 2 (2026-07-18)** — `buildVehicleOsm` over `game-src/original`, offline build cost per model:

| Model      | `.osm` | build | geometry                          | baked collision                              |
| ---------- | ------ | ----- | --------------------------------- | -------------------------------------------- |
| `landstal` | 274 KB | 32 ms | 5 130 v / 3 613 t / 123 submeshes | 18 spheres, 10 tris, half [1.16, 2.56, 0.82] |
| `infernus` | 236 KB | 12 ms | 4 467 v / 3 822 t / 76 submeshes  | 20 spheres, 14 tris, half [1.20, 2.89, 0.69] |
| `bmyri`    | 55 KB  | 4 ms  | 963 v / 1 179 t / 1 submesh       | **fallback box** (no COL in the DFF)         |

**Phase 3 step 1 (2026-07-19)** — the whole vehicle roster converted INTO the copied archives, same
one-cell smoke command (`--game game-src/original --rect 9,-7,9,-7 --no-ao`):

| Measure                     | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| cars converted              | **201 / 201**, 0 failed, 0 TXDs held back                                    |
| `.osm` total                | **41.8 MB** (~213 KB/car)                                                    |
| `.ostex` total              | **153.0 MB** (~779 KB/car — BC1/BC3)                                         |
| archive edit                | `gta3.img` +402 −402 entries; 0 unplaced, 0 missing deletes                  |
| `gta3.img` after            | 897 MB → **1 048 MB** (the `.dff`/`.txd` out, `.osm`/`.ostex` in)            |
| archive rewrite wall-clock  | **18.2 s** (build 201 models + stream a 1 GB rebuild)                        |
| total convert wall-clock    | 3.3 s → **21.2 s** — hence `--no-models` for world-only iteration reconverts |
| peak RSS                    | **2.04 GB** — the streamed rebuild holds one 1 GB source buffer, not two     |
| `.col` entries after        | **216, untouched** (design constraint 1 holds)                               |
| `.dff` remaining            | 12 766 — map objects and peds, i.e. phase 5's work                           |
| `landstal.osm` round-trip   | DESC 5 130 v / 10 839 idx · COLL 14 v / 10 tris / half [1.16, 2.56, 0.82]    |
| `landstal.ostex` round-trip | BC3, 256×256, 14 layers                                                      |

**Found by this step — a latent parser bug, still live for any un-patched install.** The FIRST run
converted only 198/201: stock `vehicles.ide` rows 585/586/593 (`emperor`, `wayfarer`, `dodo`) are missing
the comma between `model` and `txd` — `585,\temperor\t\temperor, \tcar, …`. `parseVehicleDefs` splits on
commas only, so `def.model` became `"emperor\t\temperor"`, which also means those three **cannot spawn in
the engine** on stock data (`gta-sa-world.adapter.ts:608` throws "No vehicle definition"). SA's own parser
is whitespace-tolerant; ours is not.

The user patched the commas into `game-src/original`, and the numbers above are the re-run. **The
parser is still comma-only** — a fresh game dir reproduces this. Widening the row splitter is its own
change (it is shared by every IDE section), so it stays recorded, not fixed.

The failed run also proved the TXD guard: it held back exactly `car`, `bike`, `plane` — the mis-parsed
`type` column of the three broken rows — so nothing was deleted on a bad def's behalf.

**Phase 3 step 2 (2026-07-19)** — the runtime side. No numbers to report yet (the field measurement of the
spawn path is owed); what it settled instead:

- **The engine could not accept a compressed model texture at all.** `createVehicleModel` hardcoded
  `rgba8unorm-srgb` + `bytesPerRow: width * 4`. The world had the right path all along
  (`TextureArrays.load`), so it was extracted to `core/ostex-upload` and both now share it. BC1/BC3 reaches
  video memory untouched — pinned by a test at 128×128: **16 384 B/layer vs 65 536 B for RGBA8**. (First
  version of that test used 4×4 and proved nothing: `bytesPerRow` pads to 256, which swamps the payload.)
- **Resolution order is implemented `.dff`-FIRST**, which reads backwards until you see why: conversion
  DELETES `<model>.dff`, so afterwards only a `modloader/` override can still answer with one. There is no
  API to ask the VFS where a name came from, so this ordering IS the modloader-wins rule.
- `EngineVehicleData.model` is now the engine-ready `RigidModelInit` — both paths converge inside the
  adapter, and `engine-vehicles.ts` lost its inline copy of `toRigidModelInit`. The articulation the handle
  animates moved to a narrow `VehicleRigData` (`Pick` of the 5 fields), which the DFF build and the `.osm`
  fixture both satisfy structurally.
- **`packages/game` prints nothing** (the package has no `console` by design), so the warning leaves via
  `onAssetWarning` and the host prints it. De-duplication stays in the adapter — these fire on a spawn path.
- The phase gate lives in `tools/opensa-pack/src/vehicle-osm.test.ts`, not in the adapter's own integration
  test: it needs the WRITER, and the nx boundary forbids `type:engine` → `type:tool`. Correctly so.
- Gate result: a converted `admiral` spawns with **no `.dff` present at all**, and optimized vs unoptimized
  agree on positions, submeshes, half-extents, handling, seat, wheels and collision vertices. The wheel
  RADIUS initially disagreed — a lie in my fixture (hardcoded `wheelScale`), not a product bug; the test now
  reads the def exactly as `packVehicles` does.

**Phase 3 step 3 (2026-07-19)** — the browser local loader. One decision worth keeping:

> **A converted model's dictionary is named after the MODEL, not after the IDE's `txd` column.**

Several models share one stock `.txd`, but a converted model indexes its OWN baked atlas by layer index, so
`<base>.osm` is only meaningful beside `<base>.ostex`. The selection therefore pulls the `.ostex` from the
MODEL loop, not from the txd loop — and the txd loop still runs, because a shared dictionary must survive
for whatever stayed unoptimized (covered by a test where `house` is converted and `shed` is not).

Nothing else needed changing: `filesForGroup`/`readEntry` never looked at extensions. Only `partitionEntries`
and `looseGroup` did.

**Phase 3 step 4 (2026-07-19)** — the `txdp` walk. Two things it settled:

- **It returns a CHAIN, not a merged texture map.** The orphaned doc comments described a memoized
  `getTextures` with an `ownTextures` cache behind it. But both consumers — `VehicleTextures` and the ped
  path's `decodeTextures` — already merge an ORDERED list under a "first TXD wins" rule, and that rule IS
  `txdp` inheritance. So `getTxdChain` just returns `[child, parent, grandparent…]`. A second resolved-
  texture cache would have been a second copy of every decoded texel (the 073/08 memory lesson).
- **Five live sites, not six.** Props, clutter, animated objects, debris and vehicles read a TXD by bare
  name and are now wired. The ped does NOT: `character-viewer.ts:145` fetches dff/txd over HTTP from the
  dev server, and the production player reads `/ped/ped.json`+`.bin`. **User confirmed 2026-07-19 that the
  ped must load from the archive too** — that is the phase-5 move already on this plan, and it inherits the
  walk for free the moment it goes through the VFS.

`engine-debris.ts` needed a real fix beyond the swap: its texture map used `set` unconditionally, so with a
chain the PARENT would have overwritten the child. Now it skips names a nearer TXD already defined.

**Phase 4 step 1 (2026-07-19) — per-ring texture residency: SHIPPED, and the measurement says it is not
the lever we thought.**

Two premises this plan carried turned out to be wrong, and both were checked before writing code:

1. **Loose files are NOT what enables laziness.** `manifest.textures` was already `"array-<id>" → {offset,
length, format, w, h, layers}` — every array individually range-addressable inside the container. The
   ~767 MB boot was `setup.ts:57` ("request all, await all, upload"), i.e. the POLICY, not the format. So
   laziness shipped on the container, with no file split and no format change.
2. **Laziness barely moves peak residency.** Whole-map convert (`--rect -12,-12,11,11`, stock game,
   1 121 cell entries / 99 arrays / **165 MB** of GPU texture):

| Measure                                 | Value                                       |
| --------------------------------------- | ------------------------------------------- |
| resident at a focus (HD 380 / LOD 1000) | median **139 MB (84 %)**, max 163 MB (99 %) |
| saved vs the eager boot                 | median **26 MB**, worst case **2 MB**       |
| arrays touched by >25 % of ALL cells    | **17 of 99 — 95 MB of the 165 MB**          |
| cells per array                         | median **93**, max 691                      |

**Diagnosis: `TexturePlanner` packs arrays GLOBALLY.** A map-wide atlas is drawn by cells everywhere, so no
loading policy can evict it — wherever you stand, most of the district's bytes are legitimately in use. The
real residency lever is spatial locality in the planner (pack an array from cells that neighbour each
other), which is its own plan, not a phase of this one.

**Kept anyway**, because it is correct, cheap and backwards compatible, and it removes a real BOOT STALL
that peak-memory numbers do not show: boot no longer awaits all 99 arrays before the first cell can record —
it awaits only what the first ring needs, and the rest stream in behind the create budget.

**Measurement caveat, and it is the same trap this ledger already records twice:** these numbers come from
`game-src/original`, NOT from the map-optimizer output production actually ships (which carries mip
chains on 53 % of map textures). The absolute MB are therefore a floor. The RATIO is the meaningful part
and is structural — higher-resolution textures scale both sides equally.

**Phase 4 step 2 (2026-07-19) — the manifest rule applied.** `timecyc`/`timecyc24` are gone from the
manifest, `buildOspak`, the converter, `StreamSetup` and the host's fallback branch. Measured: the
one-cell manifest went **98 KB → 3 979 B**, because the whole `timecyc.dat` text was living inside it.

The lab blocker turned out to be smaller than this plan recorded ("079 phases 1–2 and 003 phase 4 are the
same cut"). Since phase 1, `--out` IS a game dir with products under `opensa/`, so the lab needs no VFS —
only for `?src=` to name the game dir. `pak-source.ts` probes `<src>/opensa/manifest.json`: present ⇒ that
is the products base and `<src>` is the game dir (timecyc read from `<src>/data/`); absent ⇒ the old
products-directory layout still loads, with the parametric environment it would have had anyway. A `..`
path hack was NOT possible — the browser normalizes `/pak/../data/x` to `/data/x`.

**Field-checked, not just green:** headless boot of the production host (`gate-check.js canvas`) against
`game-src/original` — WebGPU up, 120 fps, and the 22:10 night renders with correct timecyc mood (warm
lamps, lit windows, correct fog). That run also used an OLD `pak-map`, so it covered the backwards
-compatible eager-texture path at the same time.

**Phase 5 scope + the mip decision (user, 2026-07-19).** "Convert everything in the IMG archives" stands —
the ~1 000-model by-name subset was offered and declined, because script spawns are not enumerable.

The class map that made phase 5 a five-step job rather than one, each needing a DIFFERENT section:

| class            | what it needs beyond today's `.osm`                                           | count   |
| ---------------- | ----------------------------------------------------------------------------- | ------- |
| clutter          | nothing (narrower init + a `cutout` flag, derivable from the `.ostex` layer)  | 57      |
| animated objects | `SKEL`: frame tree + resolved IFP clip + the moving-part map                  | 54      |
| breakables       | `SHAT`: the six RW Breakable arrays + material table; never calls the builder | 269     |
| topple props     | a convex hull of ALL vertices — NOT the COL, so `COLL` does not serve it      | 382     |
| peds             | `SKEL` in skin order, `joints`/`weights`, `minZ`, clips, texture name→index   | 281     |
| map objects      | the rest                                                                      | ~14 000 |

> **Mips are required (user, 2026-07-19).** A per-model `.ostex` carries ONE format and ONE size per array
> because `meta.x` indexes a single array — but a map object's dictionary mixes sizes, so that contract and
> map-optimizer's chain cannot both survive. The chain wins: **the one-array-per-model contract gives way**
> (multiple arrays per model, or a per-submesh array index), not the mips. Resampling every layer to a
> common size is ruled out — it regenerates the chain, which is exactly what this plan forbids.

**Phase 5a + 5b (2026-07-19).**

- **5a** — `ClutterModelInit` and `DebrisUpload` now take `ModelTextureInit` and go through
  `createModelTexture`; two more hand-rolled copies of the same upload loop died with it. `PedProbeInit` is
  deliberately NOT widened — its texture is a single image and its submeshes address textures by NAME, so
  it moves with the ped conversion, where name becomes layer index.
- **5b** — `SHAT`: a prop's shatter mesh, baked. `getBreakable` reads it before touching a DFF, so the first
  hit on a smashable prop stops costing a main-thread `parseDff` + geometry scan. The
  **authored-vs-synthesized choice is resolved offline** (including the 65 535-vertex cap on the synthesized
  fallback), so the reader has no branch left.

Measured on `game-src/original` (whole `object.dat` set): **204 authored + 48 synthesized = 252 props in
1.6 MB**, 17 with nothing to shatter, 0 failed. 11 of them landed in `gta_int.img` — the `near` placement
picking the right archive per model. A prop KEEPS its `.dff`: only the shatter mesh is baked, because that
is the only thing the debris path resolves by name.

Texture names stay NAMES in `SHAT`, not layer indices: debris resolves them against the prop's TXD and
resamples onto its own 64² shard atlas, which is a different contract from the `meta.x` layer index model
geometry uses.

**Phase 5c (2026-07-19) — clutter, and two structural fixes it forced.**

1. **The sibling `.ostex` had to move INSIDE the `.osm`.** A VER2 entry name caps at 23 bytes, and `.ostex`
   is two characters longer than `.txd`: measured on the stock archives, **457 of ~14 900 models could not
   have carried one** (`veg_procgrasspatch.ostex` = 24 bytes), while `.osm` fits every single name (0 too
   long). The dictionary is now the `TEXS` section. The texture FORMAT is unchanged — the same `.ostex`
   payload, carried in the container instead of beside it — so the phase-2 "no new texture format" decision
   stands; only the packaging moved. It is also simpler: one file per model, one resolution step, and the
   "the converted pair is incomplete" error case is gone.
2. **One `.osm` per MODEL, not per class** (`model-bundle.ts`). A model belongs to as many classes as the
   data says, and the archive editor dedupes inserts by name — so emitting a file per class silently drops
   the second contribution. Found before it shipped, and confirmed on real data: `rockbrkq.osm` carries
   `GEOM` + `SHAT` in one container because that rock is clutter AND a breakable. The accumulator rejects
   two classes writing the same tag rather than picking a winner.

Measured (`game-src/original`, one cell): **56/56 species**, 2.7 MB of `.osm` of which 2.3 MB is
dictionaries; **508 models bundled** — one fewer than the class totals sum to, which IS the merge.
Field-checked headless against the CONVERTED game dir: 120 fps, 555 draws, vegetation and converted cars
rendering, residency 649 MB vs 713 MB on the stock build (BC dictionaries).

`cutout` for clutter now comes from the `.ostex` layer classes instead of scanning every alpha byte — the
converter already classified them, and a compressed payload has no bytes to scan.

**Phase 5d (2026-07-19) — topple props.** Toppling a lamppost cost TWO clump walks: one to build the
renderable, one to collect every vertex for the collider. `HULL` bakes the second.

- The cloud is **deduplicated**, which cannot move the collider: the host hands Rapier a point CLOUD and
  Rapier hulls it, and a convex hull is determined by the point SET. Measured: **32 554 of 73 194 points
  kept (44 %)**, whole set 0.4 MB. `lamppost1` alone: 81 → 29 points, `centre`/`half` identical to the
  stock walk.
- The hull is baked from the **raw CLUMP**, not from the built model's positions. `buildVehicleModel` can
  bake a frame transform into its output, and the host walks the clump — using the built positions would
  have silently moved the collider on any multi-part prop. (`extraSections` now receives the clump for
  exactly this.)
- **The bundle guard fired for real**, and taught the packers a rule: 11 topple props are ALSO clutter
  species (cacti, joshua trees, firs), so the rigid sections were already contributed. A class now checks
  `hasSection` and adds only what it adds — the guard stays a hard error for genuine disagreement.

351 of 382 converted; the 31 failures are all `object.dat` naming a model no archive holds. **208 models
carry `GEOM` + `HULL` + `SHAT` together** — a file-per-class design would have silently dropped sections on
every one of them.

**Phase 5e (2026-07-19) — animated objects, and the data-loss gate (user ask).**

`SKEL` bakes the clump's FRAME TREE — name, parent, position, the full 3×3 rotation, and `boneId`. That is
everything an animated object needs, because the runtime derives all of it (which frames the clip moves,
the sampler bones, the resolved tracks, the part→frame map) from those frames and nothing else. Verified on
the converted archives: baked frames are **byte-identical to the clump** across every field.

**The IFP is deliberately NOT baked in.** A clip is a separate, moddable asset resolved by name; burning it
into the model would freeze that binding — the mistake the manifest made with `timecyc`. `frameBones`,
`frameClip` and `animatedFrames` now take FRAMES rather than a clump, so one implementation serves both
paths.

Measured: **53 of 54 converted, 264 frames in 18 KB**; 690 models bundled overall.

### The data-loss gate (user directive, 2026-07-19)

> A converted build is very hard to debug in the game, so conversion must be proven lossless in tests.

`tools/opensa-pack/src/no-data-loss.test.ts` takes ONE REAL MODEL PER CLASS — `admiral` (vehicle),
`nt_noddonkbase` (animated), `lamppost1` (topple), `binnt08_la` (breakable), `sjmcacti2` (clutter) — and
compares what the runtime gets from the converted `.osm` against what it would have got from the stock
DFF/TXD:

- every geometry buffer (`positions`, `normals`, `uvs`, `colors`, `meta`, `reflect`, `indices`) **byte for
  byte**;
- every structural field (`parts`, `submeshes`, `doors`, `dummies`, `wheels`) deep-equal;
- the dictionary's size, layer count and layer ORDER (`meta.x` indexes it — a reordered dictionary silently
  retextures the model).

**The one deliberate exception is texture pixels** (BC re-encode, measured ~1/255 mean in phase 2).
Everything describing them is still exact. Audited by hand alongside it: all 13 `VehicleModelData` fields
are carried, and `wrap: 0` in the layer header is a pre-existing convention shared with the world planner
(the engine samples `repeat`), not a loss this plan introduced.

Fixtures added to `scripts/test-fixtures.ts` (real assets, one per class + their IDE-named TXDs):
`des_xoilfield.txd`, `lamppost1.dff`, `dynsigns.txd`, `labins01_la.txd`, `sjmcacti2.dff`, `gta_cactus.txd`.
Existing tests revisited: `packProps` now runs on the REAL `object.dat` instead of a hand-written row (the
hand-written one did not even parse), and the `HULL` codec test states its expectations through
`Math.fround` — 0.12, the production floor on a thin prop's box, is not representable in f32, and the
contract is exactness TO f32.

**Phase 5f (2026-07-19) — peds, step 1: the one-array contract gives way.**

Measured before designing anything (`game-src/original`, all of `peds.ide`): **265 peds build, 11 fail;
242 carry exactly ONE texture, 22 carry two, 1 carries three — and 23 peds MIX texture sizes.** A
`texture2d_array` is one size and one format, so those 23 cannot fit the single-array shape `TEXS` shipped
with earlier today.

Resampling them onto a common size is the option this plan forbids: it regenerates the mip chain
map-optimizer authored. So — exactly as the 2026-07-19 mip decision anticipated — **the one-array-per-model
contract gives way**: `TEXS` is now `OsmTextures`, a container of one or more `.ostex` arrays, and a
consumer addresses a texture as (array, layer). A rigid model is simply the `arrays.length === 1` case, so
vehicles and clutter are unchanged in substance.

Worth recording for the map-object step: the engine's ped path binds `textures[0]` ONLY today, so those 23
peds already lose their extra textures AT THE HOST. Conversion must still carry them — losing data in the
converter is not excused by a renderer that currently ignores it.

**Phase 5f step 2 (2026-07-19) — the ped converter.** A ped is the one class that cannot reuse the rigid
writer: no vertex colours, no paint/lamp `meta`, no reflection slots, but four bone indices and four weights
per vertex, a skeleton in SKIN ORDER carrying real inverse binds, and a posed `minZ`. So it gets its own
`DESC`/`GEOM` (`PedFixture`), and no `COLL` — a ped is collided as a capsule.

Textures bucket BY SIZE, one `.ostex` per bucket, and a submesh stores the resolved `(array, layer)` with
the texture NAME kept beside it for readability. Nothing is dropped for disagreeing with its neighbours.

Measured: **265 converted, 11 failed, 23 needed several arrays, 20.0 MB**; 955 models bundled overall,
archives now +928/−667 in `gta3.img`.

The ped gate in `no-data-loss.test.ts` compares the converted `bmypol1` against `buildPedModel`: every
skinned buffer byte for byte (`positions`, `normals`, `uvs`, `indices`, `joints`, `weights`), the WHOLE
skeleton deep-equal (skin order, parents, bone ids, inverse binds), `minZ` exact, and **every texture
present** — layer count summed across arrays equals the builder's, with each submesh's slot in range.

**Phase 5f step 3 (2026-07-19) — the engine and the production player. FIELD-CHECKED, and the field found
two bugs a green suite could not.**

The engine change turned out to need NO shader work: a ped now uploads one GPU texture per dictionary and
builds a bind group **per submesh**, each holding a `2d` view over `baseArrayLayer` — which looks exactly
like the single image the pipeline used to bind. The draw loop already iterated submeshes, so it just sets
its own bind group per iteration. Multi-array peds therefore render whole, not first-texture-only.

`engine-player.ts` no longer fetches `/ped/ped.json` + `/ped/ped.bin` — the LAB's probe fixture, baked by a
CLI, in the PRODUCTION host. The player is `male01.osm` from the archives and its clips resolve from the
game's own `ped.ifp` at load, so a modded IFP changes how the player walks.

**Bug 1 — the player lay flat on the ground.** `getIfp(fs, 'ped')` asks for `ped.ifp`; the browser VFS keys
loose files by relative path, so the archives' `anim/ped.ifp` never matched. With no clips the sampler holds
the BIND pose, and SA's bind mesh lies along X — the skeleton is what stands a ped up. Both spellings are
tried now, and a miss warns instead of shipping a corpse.

**Bug 2 — the player sank into the ground to the knees.** `minZ` is the lowest POSED vertex, and
`buildPedModel` takes the pose to measure it in (`options.poseWith`). The converter was not passing one, so
it measured the BIND pose. `packPeds` now resolves `idle_stance` — the clip a standing ped holds — and poses
with it; the log says which pose was used, and says so loudly when no IFP was found.

Both were invisible to 2 207 green tests and obvious in one screenshot. That is the whole argument for the
field check on a production path.

**Phase 3 gate, second half — the spawn measurement (owed since step 2, done 2026-07-19.)** 40 car types,
`game-src/original` vs its converted `--out`, in Node:

| Path                                                                 | mean        | worst   |
| -------------------------------------------------------------------- | ----------- | ------- |
| UNOPTIMIZED — `parseDff` + `buildVehicleModel` + `parseDffCollision` | **7.4 ms**  | 18.3 ms |
| OPTIMIZED — `readVehicleOsm` (section reads)                         | **0.17 ms** | 0.81 ms |

**45× per car type; 297 ms → 7 ms over the 40.**

Split by thread, because the gate is about a FREEZE and plan 21 had already moved the build off the main
thread:

- the old MAIN-THREAD half (`parseDffCollision` alone) was already cheap — **0.05 ms mean, 0.61 ms worst**;
- the new read does EVERYTHING on the main thread in **0.22 ms mean / 2.27 ms worst**.

That worst looks alarming and is not: broken down, `decodeOsm` is 0.007 ms, the `DESC` JSON parse 0.060 ms
(worst 0.16 ms, largest DESC = `ambulan` at 35 KB) and the `COLL` decode 0.014 ms. Nothing sums to 2.27 ms —
that outlier is the first call warming up, not steady state.

**So the honest claim is not "the main thread got faster".** It is that the ~100–200 ms browser build per
new car TYPE — which plan 21 moved into a worker to HIDE — is GONE rather than hidden, and what remains is
a fifth of a millisecond. Caveats: Node, not the browser, and no GPU upload is included in either column.

**Phase 5g step 1 (2026-07-19) — the per-model dictionary, planned from the RAW TXD.** The prerequisite for
map objects: converting 14 000 of them through `packModelOstex` would bake a single mip level into 95 % of
the modded textures, i.e. ship assets WORSE than the DFFs they replace.

`planModelTextures` reuses the WORLD planner, one instance per model. That inherits, with no second
implementation: the opaque-DXT pass-through that preserves the source chain byte for byte, the `txdp` walk,
the alpha pipeline for everything else, flat-colour materials, and content dedup. A fresh instance numbers
its arrays from 0, so `arrayRef` IS the model's array index — which is exactly the `(array, layer)`
addressing `TEXS` already carries.

Its test runs on a REAL modded map object, because a stock fixture cannot prove the point (the stock game
barely ships mips). `scripts/test-fixtures.ts` gained a `mod` fixture kind for it — the production input IS
a modded game — and the fixture is `chinatown_sfe1.dff` + `chinatownsfe.txd` from `17. Chinatown Project`:
19 material textures, several 512² DXT1 with **10 mip levels**. The test asserts the chain survives, that
the model needs MORE than one array, that no slot points at a missing array, and that every material
resolves.

**Phase 5g step 2 (2026-07-19) — the `meta` remap, and the two traps in it.** The planner now plans per
BUILDER LAYER (`built.texture.names`, in order) instead of per clump material, so its output IS the remap
table: `slots[i]` is where builder layer `i` went. Planning the clump's materials instead would have left
two orders to be matched up afterwards, and a mismatch there retextures the model without failing anything.
`remapModelLayers` then rewrites `meta` in place.

Two traps the remap had to answer, both invisible in a passing test:

1. **`white` must stay WHITE.** The builder resolves an UNTEXTURED material to a stand-in `white` layer and
   bakes the material colour into the VERTEX COLOURS; the shader multiplies `texel.rgb * in.color.rgb`
   (`shaders.ts` `rigidShade`). The world planner instead mints a flat-colour texture per colour — so
   remapping `white` onto one would apply the colour TWICE. `white` resolves as flat WHITE here, and the
   vertex colours keep carrying the colour.
2. **`meta.y` = 0 means "no lamps-on twin", not "layer 0".** The builder can rely on that because its layer
   0 is always the first body material; the planner has no such rule. A twin landing on planned layer 0, or
   in a DIFFERENT array than its base (a per-vertex swap cannot cross arrays — only `meta.x`'s array is
   bound), now THROWS rather than mis-sampling.

A deliberate divergence from the unoptimized path, recorded: a texture the chain cannot resolve comes out
MAGENTA (the planner's rule, which the welded cell path already shows for the same texture), where the
builder would give it a white texel. Loud beats an invisible white.

Measured on the fixture: **19 builder layers → 6 arrays**, every slot distinct, no twins. The array spread
is why a per-submesh array index is unavoidable — one model genuinely cannot be one array. The test asserts
the remapped index against the `.ostex` layer's `nameHash`, i.e. against the builder's NAME, for every slot
not claimed by content dedup.

**Phase 5g step 3 (2026-07-19) — the per-submesh array, and the builder bug the map sweep exposed.**
A submesh now carries an `array` index (absent = 0, which every runtime build and every car is) beside the
per-vertex `meta.x` layer. The engine builds ONE bind group per array and switches it per submesh — the ped
path's pattern, and free of bundle cost because rigid models are never in bundles. The OPAQUE draw order now
sorts by array (depth decides opaque order anyway), so a multi-array model re-binds once per array rather
than once per submesh; the translucent order keeps its back-to-front sort untouched.

**Multi-array is the NORM for map objects, not an edge case.** Swept all 14 296 map models of the real
modded game dir:

| arrays per model | 1     | 2     | 3     | 4     | 5   | 6   | 7   | 8   | 9–14 |
| ---------------- | ----- | ----- | ----- | ----- | --- | --- | --- | --- | ---- |
| models           | 6 091 | 4 024 | 2 134 | 1 054 | 493 | 275 | 103 | 66  | 43   |

Peak model: `vicstuff_sfe6004` at 29 857 vertices — half the uint16 index ceiling, which the builder
asserted rather than letting a bigger model WRAP its indices silently. (**Superseded 2026-07-19:** that
assert turned out to be a map-wide outage — the builder now widens to uint32 instead of throwing. See
[078 round 3](../../../../docs/plans/078-global-bug-fixing/readme.md).)

**The sweep found a real builder bug, and the user chose to fix it at the source.** 536 models (3.7 %) came
out with a submesh straddling two texture arrays. Cause: `appendGeometry` kept ONE vertex table per geometry
and wrote per-vertex attributes per MATERIAL GROUP, so a vertex shared by two materials took whichever
material wrote last — the wrong layer, colour, paint slot and reflection on that corner. It has always been
wrong on the unoptimized path too; splitting the arrays is only what made it fatal. The builder now emits
vertices PER MATERIAL GROUP (and drops vertices no triangle references).

Measured: **+0.2 % vertices** over 2 000 real map models, 6.9 % of models carry such a shared vertex, and
the straddle count went **536 → 0**: the sweep now converts **14 285 of 14 296 (99.92 %)**. The 11 that
remain are unparseable TXDs (`mine`), a pre-existing anti-rip case, not a phase-5g gap.

The alternative — skipping those 536 and leaving their `.dff` in place — was rejected because the optimized
and unoptimized assets must not drift: the builder IS the runtime's, and that is what keeps them identical.

**Field-checked**, because the builder is shared by every rigid model that already ships: a full-map convert
of the modded game dir (`--rect -12,-12,12,12 --no-ao`, 140.8 s) driven through the headless sweep — all six
bench scenes at **120 fps**, 841 road cars, `lateCreates 0`, and the screenshot shows the player, the traffic
and the street correctly textured. That exercises the split on the vehicle/ped/prop path; the map objects
themselves still reach the screen through the WELDED cell path until the bulk convert lands.

**Phase 5g step 4 (2026-07-19) — prelit and night vertex colours on the rigid path.** The audit listed
"night vertex colours (1 243 models)" as the gap; measuring first turned up a bigger one. `buildVehicleModel`
never read `prelitColors` EITHER — its `colors` buffer is the MATERIAL colour alone.

Measured on the real modded game dir, and the numbers decided the design:

| class       | models | carry prelit | carry a night set | prelit NOT white | mean prelit luma |
| ----------- | ------ | ------------ | ----------------- | ---------------- | ---------------- |
| vehicles    | 198    | **0**        | **0**             | 0                | —                |
| map objects | 3 000  | 2 987        | 2 869             | 2 972            | **88 / 255**     |

So SA bakes the map's lighting into the prelit set, it is DARK, and dropping it renders a converted building
roughly **three times too bright** — while no car is affected at all, which is what made it safe to read
prelit unconditionally instead of behind a per-class flag that would have to be set identically in two
places.

- `colors` is now material × prelit; a new `night` buffer is material × the authored night set.
- **Synthesis is gated on prelit.** With no authored night set, night = day × `NIGHT_AMBIENT` — but only for
  geometry that HAS a prelit set. An asset with none is not part of the baked-lighting world, and
  synthesizing for it would dim every car at midnight on top of the world light that already does that.
  `NIGHT_AMBIENT` moved to `prepare-clump.ts` and the welded cell path now imports it: ONE night formula, or
  a converted prop disagrees with the cell it stands in.
- The engine gained vertex slot 6 (`unorm8x4`, `@location(6)`), and `vsRigid` mixes day → night by the same
  `frame.params.x` the world path uses — **before** the paint override, or a painted panel would wash out
  toward the unpainted material colour at midnight.
- `GEOM` gained a `night` section; a fixture written before it falls back to the day colours, which makes
  the mix a no-op rather than a black model.

**Field-checked** on a fresh full-map convert: six bench scenes at **120 fps**, `lateCreates 0`, and the noon
shot shows the rigid props (lampposts) sitting at the same light level as the welded cell geometry around
them instead of standing out bright.

**Phase 5g step 5 (2026-07-19) — the three things step 4 left, all closed after the user asked why not.**

1. **Clutter reads its night set.** The clutter shader had been GUESSING (`day × ambient` inline) on the
   stated grounds that "clutter carries no authored night set". Measured: **56 of 56 procobj species carry
   one**, and prelit too. The guess was overwriting art that ships with the model. Clutter gained the same
   `night` vertex buffer and the same blend; the builder still synthesizes where a species truly has none,
   so it is one formula everywhere.
2. **The rigid path emits.** `vsRigid` now runs the cell path's own heuristic — a vertex much brighter at
   night than by day IS a lit window — and `rigidShade` adds it exactly where the world fragment does. The
   cell path can also read a BAKED emissive mask; a per-model asset has no cell to carry one, so the
   luma-delta heuristic is the whole rule here. A car cannot trip it: no prelit means night == day means
   delta 0.
3. **The 11 "unparseable" TXDs were never broken.** Each is a valid `0x16` dictionary chunk in ONE
   2 048-byte IMG sector with nothing inside, and all 11 are **byte-identical in the stock and the modded
   game** — Rockstar's own convention, not a lock and not something our chain lost. The models are collision
   markers and debug leftovers: `faketarget`, `fake_mule_col`, `fuckknows`, `mine`, `od_copwindows`,
   `motel_toilet`, `cj_oyster`, `d5002whi`, `standblack04`, `lod_lopolbrij1`, `lodcj_bandit_6`. **Nine of
   them have no textured material at all** — their colour is the material's own, which is exactly what the
   game draws. Two (`mine` → `mine_64`, `lodcj_bandit_6` → `slot6LOD`) NAME a texture the empty dictionary
   cannot supply, and there the game paints a white stand-in so the material colour comes through.

   So the fix is to behave like the game, not to skip: `parseTxd` returns an EMPTY dictionary instead of
   claiming "not a TXD" (the message was also simply wrong — the chunk is there), and a model whose whole
   dictionary is empty plans its names as flat WHITE rather than the planner's loud missing-texture magenta.
   That exception is narrow on purpose: a texture missing from a NON-empty dictionary is still a real data
   gap and still comes out magenta. `mine.dff` + `mine.txd` are now fixtures, and the sweep went
   **14 285 → 14 296 of 14 296: 100 %**, with zero `not converted` warnings in a full convert (was 18).

**Field-checked** on a fresh full-map convert: six bench scenes at **120 fps**, `lateCreates 0`, night scene
unchanged in character (no runaway glow). What the bench does NOT isolate is a before/after of a single lit
window or a night bush — the scenes are urban and the effect is subtle; the arithmetic is covered by tests
instead.

**Phase 5g step 6 (2026-07-19) — the bulk convert, and the SHARED dictionary it forced.**

Measuring before wiring is what saved this step. A per-model dictionary for every map object comes to
**3 674 MB — 89 % of it `TEXS`** — against 1 320 MB of source `.dff` + `.txd`, because a TXD referenced by a
hundred models is stored a hundred times. The user chose the shared plan, and it is the right shape anyway:
the welded cells ALREADY hold a global, deduplicated plan of every texture the map uses.

So a map object plans into the WORLD planner — the same instance the cells use — and its `.osm` carries no
dictionary at all: `DESC` + `GEOM`, with GLOBAL array refs in the submeshes and `textureSource: 'world'` in
the fixture. **400 MB total (DESC 19 + GEOM 380), a 9.2× saving**, and it replaces 411 MB of `.dff`.

Timing forced the shape of the pipeline. That plan is complete only after every cell is welded, and open
only until `build()` seals it — one instant. `convertDistrict` grew an `onWorldPlanned` hook at exactly that
point, and the CLI's model stages moved into it. Order inside is load-bearing: the by-name classes run
FIRST so a model they own keeps its PRIVATE dictionary (a clutter species is one instanced draw and cannot
switch texture arrays mid-mesh), and map objects take only what is left.

Engine: a rigid model's bind groups are now built ON DEMAND and keyed by array, so a world-array model binds
the shared cell texture and never uploads one. A submesh whose array has not streamed in is **skipped, not
drawn** — it appears the frame its array lands. That path is unreachable from the bench scenes (nothing in
them draws a map object by name), so it is asserted through the recording device instead:
`engine.world-arrays.test.ts`.

Measured on the full modded map:

|                       | before   | after                                              |
| --------------------- | -------- | -------------------------------------------------- |
| models bundled        | 958      | **14 760**                                         |
| map objects converted | —        | **13 841, 0 failed** (455 already bundled by name) |
| dictionaries dropped  | —        | 2 243 (**240 kept**)                               |
| `gta3.img`            | 1 328 MB | **1 224 MB** (+12 858 −14 349 entries)             |
| convert wall-clock    | 141 s    | 314 s                                              |

`.txd` deletion follows the vehicle stage's rule — a dictionary goes only when no unconverted model still
needs it — plus one the map needs and cars do not: a dictionary that is a `txdp` PARENT of a kept one must
stay, or the child's unconverted models lose the textures they inherit.

**Field-checked**: six bench scenes at 120 fps, `lateCreates 0`, props and traffic intact with 14 349 archive
entries deleted under them.

A defect this surfaced and did NOT fix: at one point the archive passed 2 GB and `openGameDir` could not
read its own output (Node's file-read ceiling — it buffers the whole `.img`). The deletions brought it back
under, but the tool is one big mod away from the same wall; it should read entries through a file handle.

### Close-out row (2026-07-19)

The ritual sweep on the CONVERTED full map — every model class in our format, 14 349 archive entries deleted
under it — all six scenes at the frame cap with no late creates:

| scene         | fps   | p95 ms | draws | gpu pass / post / probe ms |
| ------------- | ----- | ------ | ----- | -------------------------- |
| ls-noon       | 120.0 | 9.3    | 1 090 | 1.74 / 1.14 / 0.44         |
| sf-fog-dawn   | 120.0 | 9.2    | 976   | 1.75 / 1.10 / 0.62         |
| lv-night      | 120.1 | 9.3    | 1 142 | 2.08 / 1.22 / 0.37         |
| country-dusk  | 119.9 | 9.3    | 515   | 2.23 / 1.04 / 0.30         |
| ocean-horizon | 120.3 | 9.3    | 9     | 2.02 / 1.14 / 0.25         |
| ls-rain-night | 120.3 | 9.2    | 1 017 | 1.81 / 1.10 / 0.44         |

`npm run lint`: 0 errors (30 style warnings, all pre-existing `explicit-function-return-type`).
Coverage: **89.35 % statements / 79.26 % branches / 91.15 % functions / 89.33 % lines**, against the
86/77/88/86 floors.

### Test-coverage audit (2026-07-19)

Floors hold: **88.5 % statements / 78.9 % branches / 90.5 % functions / 88.5 % lines** against 86/77/88/86.

Two things a green run does not tell you, both recorded rather than papered over:

1. **`tools/**`is not in the coverage lane at all.**`vitest.config.ts`measures`['apps/web/**/*.ts', 'packages/**/*.ts']`; the converter's tests RUN (they are in the test `include`)
but count toward no floor. The converter is exactly the half where a silent data loss lives, so its
tests are the ones to keep honest by hand — `no-data-loss.test.ts` is the anchor.
2. **`apps/web/src/ui/**` is excluded by the DOM rule**, whose stated condition is e2e coverage. Everything
this plan changed there (`engine-clutter`, `engine-props`, `engine-anim-objects`, `engine-player`,
`engine-debris`, `engine-vehicles`, `engine-canvas-host`) was verified by HEADLESS FIELD CHECKS with
   screenshots instead — which is what caught the flat-lying and knee-deep player. Worth knowing that those
   files rest on field checks, not on specs.

Gaps closed in the audit: `model-bundle.ts` (the accumulator that makes silent section loss impossible) and
`pack-vehicles.ts` (the TXD-deletion guard — the code that decides what gets ERASED from the archives) had
no tests at all and now do. Also fixed a FLAKE I had introduced: `vehicle-osm.test.ts` and
`no-data-loss.test.ts` rebuilt a real model per assertion, which under coverage instrumentation pushed a
test past vitest's 5 s timeout (it failed in one full-coverage run and passed in the next). Both memoize the
build now; worst single test 1.65 s.

Still untested, judged lower risk: `pack-clutter` / `pack-peds` roster enumeration (both exercised
end-to-end by real converts) and the lab's `pak-source.ts`.

### What the MODS carry, and what the per-model format still drops (audit, 2026-07-19)

The production input is not the stock game: `mods-src/original/mods` holds **57 mods (1.1 GB)** that mod-installer
bakes into the archives BEFORE opensa-pack runs, so `--game` already contains them. (I first mistook these
for `modloader/` runtime overrides and started making the resolver ask "is this modded" — wrong premise,
reverted. Runtime modloader is a different, later path.)

Audited every asset they ship — **1 328 DFFs (all parsed) and 1 795 TXDs / 26 561 textures (all parsed)**:

| DFF feature               | mod models | carried by the per-model `.osm`?               |
| ------------------------- | ---------- | ---------------------------------------------- |
| prelit vertex colours     | 1 265      | **yes** — `colors`                             |
| **night vertex colours**  | **1 243**  | **NO** — `buildVehicleModel` never reads them  |
| **material mask texture** | 429        | no — and neither does the CELL path; see below |
| authored normals          | 196        | **yes** — `normals`                            |
| **2dfx lights / coronas** | 104        | not in the container — the CELL carries them   |
| multi-frame clump         | 83         | **yes** — `SKEL` + `parts`                     |
| **2 UV layers**           | 26         | no — and neither does the CELL path; see below |
| RW breakable mesh         | 25         | **yes** — `SHAT`                               |
| 2dfx particles            | 18         | **NO**                                         |
| 2dfx roadsigns            | 4          | **NO**                                         |

Textures: dxt1 24 422 · dxt5 945 · dxt3 936 · rgba8888 258 (all decodable), sides up to 2 048, and
**95 % carry a mip chain** (deepest 12). `packModelOstex` writes `mipCount = 1`, so the phase-5 mip catch is
not an edge case — it is the norm.

**Scope of the damage, stated honestly:** the WELDED CELL path already handles all of this — the welder
reads `nightColors`, collects 2dfx (coronas, particles, roadsigns) by placement, and the world
`TexturePlanner` passes mip chains through. The static modded map is fine. The gaps are in the PER-MODEL
path, which today serves clutter, topple props, animated objects, breakables, peds and vehicles — and which
becomes the main path if the ~14 000 map objects are converted.

### The three audit gaps, measured (2026-07-19) — and none of them is a divergence

The table above compares the per-model container against the SOURCE DFF. The question that actually matters
is different: does an asset drawn BY NAME come out worse than the same asset through the welded CELL path?
Measured on the real modded game, the answer is no for all three, and each has a stated condition under
which that would change.

**Material masks — our renderer does not read them, anywhere.** `maskName` is parsed, and `mesh.ts` even
carries it into the `SHAT` section, but nothing consumes it: the weld never touches it, the rigid path never
touches it, and the debris baker reads only `texture` and `ambient`. So the 429 models are not a per-model
gap; masks are simply an SA feature we do not implement at all (39 of 56 clutter species and 57 of 252
breakables carry one, and they render the same on both paths — without it). **Condition**: if masks are ever
implemented, BOTH paths need them together, and the `SHAT` field is already there waiting.

**2dfx — carried by PLACEMENT, and the break path already knows it.** Coronas and particle emitters weld
into HD cells per placement, so a by-name model standing in the world still gets its 2dfx from the cell it
stands in. When that placement breaks or topples, `cells.ts:134-139` removes its lights with its geometry —
the lesson a smashed traffic light taught by leaving its coronas hanging in the sky. A toppled lamp going
dark is what the game does too. Of the by-name classes: **0 of 56 clutter species carry 2dfx at all**, and 23
of 252 breakables do — of which only **3 are never placed** (`mtraffic4`, `imy_track_barrier`, `mine`), and
an unplaced model is never drawn. **Condition**: a class that spawns models with 2dfx at positions no IPL
placed would need them in the container.

**Second UV layer — both paths read set 0.** The weld takes `atomic.uv`, which is `uvLayers[0]`; the rigid
builder takes `uvLayers[0]`. SA's own renderer uses set 0. **0 of 56 clutter species and 0 of 252 breakables
carry a second set**; the 26 that do are map objects, which already render from set 0 today and continue to
after conversion. **Condition**: the same one as masks — a renderer feature, needed on both paths at once.

**Ordered by how much they hurt** (user: record now, close later — the earlier queue comes first):

1. ~~**Night vertex colours (1 243 models)**~~ — CLOSED (phase 5g step 4): the rigid path reads prelit AND
   night sets now, and measuring first found the bigger half — the DAY prelit was being dropped too.
2. ~~**Mips in the per-model `.ostex` (95 % of textures)**~~ — CLOSED (phase 5g step 1): map objects plan
   from the RAW TXD through the shared world planner, which passes opaque DXT through byte for byte.
3. ~~**Material mask textures (429)**~~ — CLOSED: established, and the answer is that NOTHING in our
   renderer reads a mask.
4. ~~**2dfx in the per-model container (126)**~~ — CLOSED: confirmed rather than assumed, with the break
   path's light removal and the 3-model unplaced tail measured.
5. ~~**Second UV layer (26)**~~ — CLOSED: both paths read set 0, and no by-name model carries a second set.

### Mips belong to map-optimizer (user, 2026-07-18)

opensa-pack must **never generate** a mip chain: map-optimizer authors them upstream, and a second
generator downstream would silently overwrite its work. Measured on both inputs:

| Input                                       | map textures with a chain | deepest |
| ------------------------------------------- | ------------------------- | ------- |
| `game-src/original` (raw game)          | 23 / 1 177 — **2 %**      | 9       |
| `NO_COMMIT/optimized` (after map-optimizer) | 646 / 1 215 — **53 %**    | 11      |

**opensa-pack's production input is the chain output, after map-optimizer** (confirmed by the user) — so
the raw-game survey that suggested "SA has no mips" was measuring the wrong thing. In game the rule is:
map objects MUST have mips, vehicles must not, peds almost certainly not.

Consequence for the per-model writer: it emits ONE level, which is correct for vehicles and peds and is
**not yet correct for map objects** (phase 5). Those must PRESERVE what map-optimizer put in the TXD, and
this entry point structurally cannot — `VehicleTextures` decodes level 0 and drops the rest before the
writer sees the array. The map-object path has to plan from the RAW TXD, the way the world planner does
(`textures.ts:184-193`). Recorded as a phase-5 task rather than a flag, because a flag we cannot honour is
worse than no flag.

**Per-model `.ostex` (same day)** — and it surfaced a real cost:

| Model      | `.osm` | `.ostex`     | build | texture array                         |
| ---------- | ------ | ------------ | ----- | ------------------------------------- |
| `landstal` | 274 KB | **4 925 KB** | 44 ms | 14 layers @256², 9 mips, 3 with alpha |
| `infernus` | 236 KB | **5 980 KB** | 37 ms | 17 layers @256²                       |
| `cheetah`  | 206 KB | **5 276 KB** | 42 ms | 15 layers @256²                       |

**The textures are ~20× the model.** Cause: `buildVehicleModel` hands back RGBA8 — `VehicleTextures`
decoded the source DXT to feed the runtime — so the `.ostex` stores uncompressed texels plus a full mip
chain, where the source TXD was BC-compressed. At ~5 MB × ~210 vehicles that is ~1 GB against a 940 MB
`gta3.img`: converting cars alone would roughly double the build.

Note what it does NOT cost: VRAM. The runtime already uploads these as RGBA today, so this is a
delivery/disk regression only. Three ways out, none picked yet:

1. **Accept RGBA8** — simplest, and honest about what the runtime consumes; the build roughly doubles.
2. **Re-encode to BC** — an encoder exists (`tools/rw-codec/src/dxt-encode.ts`, used by the LOD tools), but
   decode→re-encode is generation loss on art we did not author.
3. **Pass the original DXT through** — what the WORLD planner already does for opaque, well-formed DXT
   (`textures.ts:184-193`): no loss, smaller on disk AND in VRAM. Costs planning from the raw TXD rather
   than from the built array, because the builder has already decoded by the time we see it.

**Decided (user, 2026-07-18): BC — size wins.** Option (3) did not survive the data: 85 % of vehicle TXDs
mix formats or sizes inside one dictionary, and `.ostex` carries one format for the whole array, so
pass-through would mean SEVERAL arrays per model — a runtime contract change, because a model's vertices
index one array through `meta.x`.

So the per-model writer re-encodes: **BC1 when every layer is opaque, BC3 when any layer needs alpha**
(in practice cars are always BC3 — glass and lamps). Measured after the change:

| Model      | `.osm` | `.ostex` | format | build  |
| ---------- | ------ | -------- | ------ | ------ |
| `landstal` | 274 KB | 896 KB   | BC3    | 170 ms |
| `infernus` | 236 KB | 1 088 KB | BC3    | 127 ms |
| `cheetah`  | 208 KB | 960 KB   | BC3    | 115 ms |
| `bullet`   | 267 KB | 832 KB   | BC3    | 85 ms  |

**4.07 → 1.16 MB per car; ~0.83 → ~0.24 GB across ~210 vehicles.** Build cost rose ~44 → ~120 ms per car
(the DXT encode), i.e. roughly 30 s added to a full-vehicle convert.

The generation loss was measured, not assumed: re-encoding the builder's RGBA through DXT5 costs a **mean
absolute error of ~1/255 (0.4 %)** per channel, worst single layer 2.8/255, max single-texel 90 (a lone
hard alpha edge). That is the expected cost of one BC round trip on already-DXT source art.

`bmyri` is a PED that the vehicle builder accepted without complaint — the writer does not check the asset
class, which is fine while callers pass a `vehicles.ide` roster but must not be relied on in phase 5.

**The `.col` sweep, measured 2026-07-19 — and the answer is to leave it alone.** Over the converted full
map: **261 libraries, 21 MB, 10 195 collision models, 54 ms** to parse the lot (Node; a browser pays more
for the reads, but this is a ONE-OFF at the first collider call, not per cell). **86 % of the parsed models
are referenced by a placed instance** — only 1 464 are parsed for nothing.

Both halves of the case for offline cell colliders fail on those numbers: the sweep is small, and it is
mostly USEFUL work rather than waste. If the one-off hitch ever shows up in a profile, moving the sweep to a
worker is a far smaller change than baking colliders per cell. Caveat kept honest: the ms is the Node parse
cost, so it bounds the work, not the browser wall-clock.

**`openGameDir` reads archives through a file handle now (2026-07-19).** It used to `readFileSync` the whole
`.img` — which Node refuses past 2 GB, exactly the wall the per-model convert hit before the deletions
brought the archive back under it. The directory is read up front and each entry sliced on demand, the way
the browser VFS has always done it (`parseVer2Directory` was already shared for this). Measured: opening the
full modded dir went from seconds and ~1.4 GB resident to **13 ms and 88 MB**, and the pak stayed
byte-identical.

Later phases record: IMG rebuild peak RSS, per-model `.osm` share of `--out`, the split spawn-path numbers
below, and boot/steady-state for the phase-4 container-vs-files gate.

Spawn-path numbers to capture BEFORE phase 2 changes anything, split by thread — the two are not the same
size and must not be reported as one:

- **main thread**, per new vehicle type: `parseDffCollision` + `toModelColliders` + `halfExtents`
  (`gta-sa-world.adapter.ts:612-632`). Expected small in absolute ms, but it lands on the frame thread.
- **worker**, per new vehicle type: `parseDff` + `parseTxd`/DXT + `buildVehicleModel` — the ~170 ms that
  plan 21 hid rather than removed. This is what `.osm` actually deletes.
- **first-collider call**: the whole-archive `.col` sweep (`collision-index.ts:32-38`), plus what share of
  the parsed libraries the district never references — the input to the offline-cell-collider decision.
