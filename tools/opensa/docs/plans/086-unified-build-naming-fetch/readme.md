# 086 — one build, consistent names, pak-based fetch

**Goal (user, 2026-07-23):** the pmb build is THE build for every surface. Consistent naming across the
three roots — `game-src/<id>` · `mods-src/<id>` · `build/<id>` — with `<id>` doubling as the fetch game
id. The legacy `build-game.ts` chunker (raw-game partitioning) dies; a thin FINISHING tool packs the
pmb output into content-hashed chunks for the fetch loader, so both modes ship from one build:

```
game-src/<id> + mods-src/<id>  →  pmb  →  build/<id>/{sa,opensa}  →  fetch-pack  →  static/games/…
                                              ↑ local play (http-dir / folder)        ↑ hosted fetch
```

Game ids: `original` (stock SA; renamed from `non-modified`) · `gostown` (demo) · `carcer` · `anderius`
(test TCs). `original-extend` is deleted (npm script only — never in the UI's `GameId`).

## Facts established before this plan (2026-07-23 audit)

- The fetch loader is LIVE and must stay: `use-asset-boot.ts` fetches
  `games/<game>-<APP_VERSION>/manifest.json`, `asset-fetch-loader` downloads content-hashed zip chunks
  with cache-store + invalidation. Its chunk CONTENT is the raw game — which the own engine no longer
  consumes; repacking the PAK OUTPUT into the same chunk shape keeps the client mostly intact.
- No model-name hardcode blocks TC games: pmb/map-optimizer/opensa-pack/opensa-lod-generator are
  data-driven (gta.dat/IDE/IPL of the actual build; sway by IDE flags; `peds.ide` missing → stage
  skips; `vehicles.ide` missing → loud throw, but every TC has one). The ONE curated list is
  `sa-lod-generator/src/lod.config.ts` `holeFillModels` (~30 SA names) — harmless elsewhere
  (skip-with-warning) but belongs in per-game data.
- `mods-src/` is already restructured by the user: `mods-src/{non-modified→original,gostown,carcer,anderius}`,
  each the pmb `--in` root (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `lod-exclude.json`,
  `broken-prelight.json`); the TC folders are near-empty and that is a valid pmb input.
- `scripts/lib/game.ts` `gameArg()` already DEFAULTS to `original` — broken today (no such folder); the
  rename fixes every dev script's default.
- `timecyc` stays as-is (own command, out of scope by user decision).

## Phase 0 — the rename + the full audit (DONE 2026-07-23, `cd14e4b`)

Filesystem (both roots are gitignored user data): `mv game-src/non-modified game-src/original`,
`mv build/perfect build/original`, `mv mods-src/non-modified mods-src/original`.

Repo sweep — every reference goes, none survive (user's explicit bar, paraphrased: "a FULL audit of the code,
the tests and ALL the documentation"), historical plan texts included (git history remains the true record):

- code/test defaults: `scripts/test-fixtures.ts`, `scripts/build-viewer-assets.ts`, debug scripts'
  `--game` docs, `dump-cell.ts`/`crosstxd-fix.ts` pak defaults, pmb default `--out` (→
  `./build/original`), tools' readmes/tests that spell either path, `apps/engine-lab` +
  `packages/loaders` test paths, `serve-static` docs;
- docs: `commands.md`, `debug/README.md`, `development/`, `benchmarks/` (schema + rows keep saying
  WHICH pak build a run read — reword to the new name with an "(ex build/perfect)" note in the
  benchmarks README so old rows stay interpretable), `architecture/`, `features/`, `plans/`;
- skills: `/crosstxd-fix` (modsDir default → `mods-src/original/mods`), `/renumber-mods` (path →
  `mods-src/original/mods`);
- memory: canonical-build-folders + roadmap + harness notes (AFTER=`./build/original/opensa`,
  BEFORE=`./game-src/original`).

Verify: repo-wide grep for `non-modified` and `build/perfect` returns nothing (outside git history);
lint + unit tests green; one smoke boot via `?loader=http-dir&src=…/build/original/opensa`.

## Phase 1 — opensa-pack manifest identity (DONE 2026-07-23)

`manifest.json` (the pak one) gains `game` (= the `--game` folder's basename — after phase 0 the
folder name IS the id, no mapping table) and `appVersion` (root `package.json` version, read
module-relative so cwd never matters; omitted outside the repo). Stamped in `packGameDir` beside
`buildTime` (the deterministic `buildOspak` core untouched). pmb passes `gameId =
basename(--game)` explicitly — its own `gameDir` at the pack stage is a work intermediate;
standalone runs take `--game-id` (default: basename of `--game`). Old readers ignore the fields.

## Phase 2 — the finishing tool (DONE 2026-07-23)

`tools/fetch-pack` (own tool, `docs/plans/001-architecture.md` inside): input = a pmb `--out`'s
`opensa/` game dir, output = `static/games/<game>-<version>/` chunks + the legacy-shaped manifest.
`chunkByHash` moved into the tool; `build-game.ts` and all raw-game partitioning DELETED; npm
`build:game:*` became pmb aliases (user's spec), `original-extend` deleted, `fetch:pack` added.
Group mapping: data = data/text/loose · models = models/ + opensa/ · others = rest · textures = EMPTY
(pak textures live in world.ospak; shape kept for the client). Oversized files slice into
`<path>#<index>` parts (phase 3 reassembles). First real run: 3.6 GB → 407 files, 74 chunks, ~2.5 min;
pre-086 pak identity falls back loudly.

## Phase 3 — the fetch client boots the pak (DONE 2026-07-23 — code; e2e smoke owed with phase 4)

Established: post-flip fetch mode filled the VFS with raw-game chunks and streamed the WORLD from the
dead `public/pak-map` fallback (`engine-canvas-host` picks `pakSource ?? '/pak-map'`; only loaders
with `openWorld` become the world source). The fix rides the existing seam:

- `Vfs` reassembles fetch-pack SLICES on first touch (`<name>#0..#N` — parts land in DIFFERENT chunks
  by design of the name-hash buckets; the concat replaces the parts, joined once). `has()` sees a
  chain by its `#0`.
- `AssetFetchLoader` gained `openWorld(name)` — serves `opensa/<name>` from the delivered files via a
  read-back `files` view of its sink (wired through `createAssetLoader`; use-asset-boot passes the
  VFS). Same contract as the folder loaders: absent ⇒ null ⇒ streaming fails LOUDLY — the silent
  `public/pak-map` fallback is unreachable in fetch mode now (a legacy raw-game chunk set no longer
  half-boots).
- `use-asset-boot`'s `pakSource` needed no change — any loader with `openWorld` is the world source.

URL scheme kept (`games/<game>-<version>/`, matches `__APP_VERSION__`); entry-hash reuse = later
refinement. Unit-verified (VFS slice chains incl. the no-`#0` negative; openWorld null/lowercase
paths). **E2E smoke owed**: run with the small gostown build once phase 4's trial runs produce it —
a 3.6 GB original download in headless is not a smoke test.

## Phase 4 — npm aliases + TC trial runs

```
build:game:original  = pmb --game ./game-src/original  --in ./mods-src/original  --out ./build/original
build:game:gostown   = pmb --game ./game-src/gostown   --in ./mods-src/gostown   --out ./build/gostown
build:game:carcer    = pmb --game ./game-src/carcer    --in ./mods-src/carcer    --out ./build/carcer
build:game:anderius  = pmb --game ./game-src/anderius  --in ./mods-src/anderius  --out ./build/anderius
(+ NODE_OPTIONS=--max-old-space-size=12288; original-extend deleted; each then runs fetch-pack)
```

Trial runs for the three TCs go `--until pack` first (the `lod` stage waits until the base passes).
Failures are triaged loudly per the 085 rule — a swallowed error is a hole in the world.

## Phase 5 — per-game LOD hole list (DONE 2026-07-23)

`sa-lod-generator` `holeFillModels` moved from `lod.config.ts` (default now empty — a TC must not
inherit SA's list) to `mods-src/<id>/lod-holes.json`, loaded by pmb like `lod-exclude.json`
(`loadLodHoles`, `--in` root or its `mods/`); standalone runs pass `--holes <json>`. `original`
carries the 28 curated names; the TC folders none.

**Addendum 2026-07-23 (phase-4 field find):** the list now ALSO feeds the **opensa cell bake** —
listed instances are exempt from the reduction tracks (drop-transparent · budgeted-decimate ·
visibility-cull · coplanar) and merge into the cell VERBATIM (`concatMeshes` after the modifier
chain). Found on gostown's `gp_paradisebridgea`: a 44 784-vert suspension bridge of trusses/cables
that the tracks reduced out of the far view (`lod_5_-7` kept 15 621 verts for its whole cell) — the
first `mods-src/gostown/lod-holes.json` entry. opensa-lod CLI grew the same `--holes <json>`.

## Phase 6 — viewer fixtures rename (DONE 2026-07-23)

`scripts/build-viewer-assets.ts` → `scripts/test-viewer-fixtures.ts` (it only builds e2e fixtures;
the name says so now). `test:fixtures` chain + every reference updated; paths point at
`game-src/original` since phase 0.

## Phase 7 — the pak leaves the game dir (DONE 2026-07-23)

User decision after the first phase-4 field run: the `opensa/opensa` nesting confused every reader
(twice mis-documented on 2026-07-23 alone), so the pak products (`world.ospak`, `manifest.json`,
`water.bin`, `report.json`) now land in the `<out>/opensa-pack` SIBLING of the converted game dir —
`build/<id>/{sa, opensa, opensa-pack}`. `packGameDir` gained `pakDir` (default `<outDir>-pack`,
CLI `--pak-out`); pmb passes it explicitly. Every consumer probes the new layout FIRST and falls back
to the legacy nested pak (and raw game dirs stay untouched): the install-source core rebases a served/
picked BUILD ROOT (`opensa/` prefix stripped for game files, `opensa-pack/*` kept, `sa/**` dropped),
`openWorld` tries `opensa-pack/<name>` then `opensa/<name>` (folder/http-dir AND fetch loaders),
engine-lab's `resolvePakSource` probes root → legacy → bare, fetch-pack walks both roots and ships pak
files as `opensa-pack/<name>` VFS entries, and the debug scripts/crosstxd defaults probe both. Surfaces
now point at the BUILD ROOT: `?src=…/build/original`.

## Phase 8 — TWO independent builds (DONE 2026-07-23, supersedes phase 7's layout)

Phase 7's field trial surfaced a terminology split: for the user, "the pack" is the DOWNLOADABLE fetch
package, and the folder-mode game dir must stay one self-contained pick — a build root holding
`opensa/ + opensa-pack/` siblings satisfied neither. Final scheme (user decision):

- `build/<id>/opensa` — **build #1, the game dir**: self-contained, the engine pak inside at `pak/`
  (the clean name kills the old `opensa/opensa` confusion). Folder mode picks it, http-dir serves it
  (`?src=…/build/<id>/opensa`) — nothing outside it is needed.
- `build/<id>/opensa-pack/<game>-<version>/` — **build #2, the fetch build**: fetch-pack's output
  (download manifest + ~50 MB deflate chunks, `world.ospak` sliced into `#index` parts). Deploy =
  upload the folder as `games/<game>-<version>/`; `--out ./static/games` stages a local fetch test.
- Every `build:game:*` alias chains fetch-pack after pmb — one command, both builds (the phase-4
  chaining finally lands).

Probe chains keep every older layout loadable: `openWorld` tries `pak/` → `opensa/` (nested legacy) →
`opensa-pack/` (the one-day phase-7 sibling); fetch-pack, engine-lab, and the debug/crosstxd scripts
probe the same three homes.

## Order & risk

0 → 1 → 2 → 3 → 4 → 5/6 (5 and 6 are independent). Phase 0 is wide but mechanical and unblocks
everything; phase 3 carries the unknown (state of the current fetch boot); phase 4 carries the TC
risk (unproven pipelines — but loud).

## Post-plan audit (2026-07-23, head `c4bce83`)

Full docs+tests sweep of the plan's fragment. Measured:

- Coverage floors pass: statements 89.75 % · branches 79.94 % · functions 91.45 % · lines 89.71 %
  (floors: statements 86 · branches 77 · functions 88 · lines 86); fetch-pack suite 16/16 after
  adding the missing chunk-stability tests
  (remove/resize with N unchanged, one-file byte-change → untouched chunks byte-identical).
- Phase 4's first TC trial runs surfaced two build bugs, fixed: VER2 names are 24 bytes
  (`9602cab`, Carcer City ships one) and pmb skips `mods`/`trees` on an empty source folder
  (`c4bce83`, gostown has no `vegetation/`); carcer verified through the vehicles stage. Phase 4
  itself stays open — fetch-pack chaining after `build:game:*`, the TC runs and the fetch-mode e2e
  smoke are still owed.
- Stability caveat documented (tool plan 001): a group total crossing a 50 MB multiple changes `N`
  and reshuffles that whole group's chunks.
- Stale-doc sweep fixed: `docs/development/{scripts,getting-started,build-flags}.md`,
  `docs/features/{README,img-archive,asset-loader}.md` (README's fetch-pack table row was
  malformed), `deploy/README.md`, `docs/improvements/character-material-maps.md`,
  `docs/architecture/perfect-map-builder.md` (+ pmb-pipeline diagram) now carry the
  pmb → fetch-pack chain; `cli.ts` runners stay untested repo-wide by convention (only
  tool-kit has a cli test), and `tools/**` sits outside the coverage floors by config.

## Field find, 2026-08-03 — fetch mode carried no archive contents at all

`gostown` was switched to `assetLoader: 'fetch'`, uploaded, and died at boot on
`player model bmycg.osm not found`. The ped installer had done its job (`bmycg.osm` is inside the built
`models/gta3.img`, and `data/peds.ide` carries row 144) — the pack was the problem.

**The runtime resolves by BARE name and the fetch VFS holds exactly the keys a chunk delivered.** The
folder/http-dir loaders satisfy that by reading the IMG directory and ingesting each entry
(`install-source-loader.ts`'s `filesForGroup`); the fetch loader pushes chunk bytes in verbatim. fetch-pack
packed `models/gta3.img` as a FILE, so the whole archive landed as one opaque key (sliced `#0`/`#1`) and
every name inside it was unreachable — the player ped first, but equally the vehicles and the collision
libraries. Of the 77 entries in the gostown pack exactly ONE was a bare name, and it was `parked.json`.

It shipped unnoticed because gostown was the only fetch-served game and it was DISABLED, and because the
live `original-0.3.0` pack predates the ped moving into the archives (`engine-player.ts` still records that
the player used to be fetched as `/ped/ped.json`). Now a restriction:
[`restrictions/build-vs-runtime.md`](../../restrictions/build-vs-runtime.md) — whatever the loaders disagree
about, the game disagrees about, and NOTHING catches it.

**The fix** is `tools/fetch-pack/src/expand-img.ts`: expand every `models/*.img` into its entries under bare
lowercased names, on the local loader's own precedence (gta3 → gta_int → the rest alphabetically, first owner
wins), each entry bucketed by its extension so `.col` stays in the cacheable `models` group. The tool stays
content-ignorant — an archive directory is a container index, not content. The pack ships every entry where
the local loader ships the IDE-referenced selection; a superset is the safe direction and costs no bytes,
since the container form already carried them. Entries keep the archive's 2 KiB sector padding, because a
VER2 directory records a size in SECTORS and the exact byte length is not recoverable — the local loader
hands over the same padded bytes.

**Two more defects fell out of measuring it.**
- `models/gostown6.img.bak` — 180 MB of the installer's own rollback copy — was being walked and uploaded.
  `*.bak` and `.DS_Store` are now skipped.
- **A re-pack never removed the chunks it replaced.** Chunk names carry a content hash, so a new set is
  written BESIDE the old one; one gostown re-pack left 502 MB of dead chunks in the deploy dir, and it made
  the first size comparison of this very change read as a regression (912 MB "after" against 526 MB
  "before" — both figures counting two chunk sets). The output dir is now pruned to the manifest.

**Then the same asymmetry a second time, in the LOOSE paths.** With the archives expanded the game booted,
the map drew — and the player fell through it while every car reported `no ground ... yet`. The collision
libraries were in the pack (54 `.col`, indexing to 930 models) and parsed fine, so the data was reachable;
what was missing was the PLACEMENTS. `resolveMap` over the pack returned **384 instances / 503 catalog**
against **3 970 / 1 352** over the built tree.
The local loader lowercases every loose path (`install-source-core.ts`: "Loose file paths, lowercased") and
the runtime looks a data file up by the lowercased path `gta.dat` names; fetch-pack kept the on-disk
spelling. A total conversion names its files as it likes — gostown ships `data/maps/Gostown6/Gp_City.IPL` —
and **32 of that build's 67 files carry an uppercase letter**, so most of its map was invisible in fetch mode
while the world still RENDERED off the pak. The packed name is lowercased now; the read keeps the on-disk
spelling, or a case-sensitive filesystem would fail to open it.
**The lesson is that the restriction was written one case too narrow.** Expanding the archives lowercased the
entry names because the archive directory already stores them that way; the loose paths were left as the
filesystem spelled them, and nothing in the change said "the KEY SPACE has to match", only "the containers
have to be opened". Same defect, same silence, one hour apart.

**Measured, gostown, `build/gostown/opensa`:** 4 archives → **1 328 entries by name**; the pack is
**410.0 MB in 12 chunks / 1 392 entries** against **526 MB in 14** before, with `bmycg.osm` and `bmycg.txd`
present and no container or backup packed. After the case fix the pack resolves **3 970 instances / 1 352
catalog — identical to the built tree** — with collision on 3 651 of them (the 319 without are props and
`gp_seabed_lo`, which carry none by design). `.osm`/`.ostex` are STORED rather than deflated now that they ride
as their own entries (they used to sit inside a stored `.img`, and they carry BC-compressed blocks).
