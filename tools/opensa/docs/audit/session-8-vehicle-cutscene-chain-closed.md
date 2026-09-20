# Session 8 (2026-08-13) — the vehicle-cutscene chain closed: four steps + the plate plan, one day

The session picked up the chain the cutscene-override instrument (session 7) was built FOR, and
closed all of it that can close without a full-pipeline build: plan 002 steps 8–11 (bike, boat,
fleet numbers, pmb integration) and plan 003 (readable plates) — with TWO first-round field passes,
both armed and disarmed through the override ini in minutes instead of story progression. 11
commits; suite 4 175 → **4 203** green; the tool's plans:
[`002`](../../tools/vehicle-cutscene/docs/plans/002-implementation.md) ·
[`003`](../../tools/vehicle-cutscene/docs/plans/003-plate-bake.md); the numbers:
[`docs/benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md`](../benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md).

## What shipped

- **Step 8 — the bike branch, FIELD-PASSED first round.** `extractBikeTemplate` + `rig/bike.ts`: the
  vanilla bike rig has no wheel corners — every part is a mesh bone in the chassis subtree. The real
  MTB (Smooth Criminal 3.0) ships template parts as meshless DUMMIES (`chassis`/`wheel_rear`/
  `forks_front`) — the bone emits meshless and its subtree meshes ride the channel. The variant
  policy was decided ON the real file and recorded in `docs/contracts/vehicles.md` §3 (which also
  paid gate-7's missing-contract debt): `f_extras:<n>`/`f_class:<n>` adopt the first meshed child
  SUBTREE whole (the b-handlebar set keeps its brake levers + grips), `+` containers are additive;
  cars keep their field-frozen one-mesh rule. Field: scene `STRP4B2` — the ONLY scene in all 148
  IFPs that plays csmtbike92, static except its 67-frame root channel — so BIKE wheel/pedal
  animation (and with it the adopted-mesh spin path) is exercised by no scene in the game; CAR
  wheels do spin in scenes (42-frame `KR00`s in the intro) and were field-verified at gates 4/7.
  (Scoped 2026-08-13 — an earlier phrasing over-generalized this to all cutscene wheels.)
- **Step 9 — the boat branch, structurally verified.** The bike part-loop generalized into the
  shared parts-rig pass (`emitPartsRig`/`analyzePartsRig` in `rig/emit.ts` — bike golden tests green
  through the move); `rig/boat.ts` is the thin `boat_hi` + transom-flaps vocabulary. NO vertical
  shift by design: nothing anchors a waterline, and the stock golden pair (donor and vanilla author
  identical positions — ZERO shims) confirms shift 0 reproduces vanilla. The field gap is named:
  no stock scene plays csdinghy, so nothing in the game can display the converted model —
  structural verification is that slot's ceiling.
- **Step 10 — fleet numbers + a NEW benchmarks family.** `docs/benchmarks/tools/` (build tools fit
  neither the frame-cost nor the physics family): **23/23 converted, 0 errors, 3.55 s wall-clock,
  cutscene.img 25.7 → 310.8 MB**, per-model table. The structural gate is kept as
  `scripts/debug/cutscene-fleet-verify.ts` — its first draft over-asserted two non-requirements
  (name-unique bone ids; vanilla-id order) and was corrected to the honest invariants: the FIRST
  frame per vanilla name carries the vanilla id (anims bind to the first match; template bones emit
  before adoption), ids unique, indexes contiguous. The fleet's 20 adopted duplicate names were
  recorded as bind-safe — **falsified the same day by plan 004 round 1** (DESERT9's floating door
  glass: a duplicate of a vanilla name still binds and double-transforms; gate 7 simply never
  animated one). Fixed by the `_ad` adopted-rename; the fleet now measures 0 duplicates and the
  verify script fails on any.
- **Step 11 — pmb `cutscene` stage** (the user's call: stage, not manual step). Sits right after
  `vehicles` — same source folder, same populated-check — reading the INSTALLED game, so the
  empty-TXD route finally runs where it was designed to (~40 B per slot vs 148 MB self-contained).
  A slot error FAILS the build; the summary is a fragment in every target report;
  `--exclude vehicles` drops the stage too, loudly (no installed parents = every slot fails closure
  — `build:game:original:sa` excludes vehicles today). Found on the way:
  `tools/vehicle-cutscene` was missing from the root `workspaces` list — the enumerate-everything
  trap, this time in package.json; nothing could import the tool across packages until now.
- **Plan 003 — readable plates, FIELD-PASSED first round.** Vanilla cutscene cars show BLANK plates
  (`CCustomCarPlateMgr` runs only for gameplay). The bake REUSES the engine's recovered formula
  (plan 082/01 `plate-raster.ts` — step 1 closed by reuse, the standing rule's best case; the
  plan's LS/SF/LV town guess corrected to the measured `eCarPlateType` order, plateback1=SF,
  plateback3=LS), composes a deterministic `LLDD DLL` text per slot, and encodes the pair in the
  stock plate art's EXACT TextureNative shape (D3D9, X8R8G8B8, BGRX — fields measured off
  `generic/vehicle.txd`). Baked only where the model wears the placeholder quads (21/21 cars;
  bike/boat carry none — derived from the asset, never the branch), ~12.5 KB per slot. The offline
  PNG of the baked pair read "YI08 OSJ" over LOS SANTOS before the field confirmed it.

## What it cost / what it bought

- **Cost:** one day, 11 commits, +28 tests, two field rounds of the user's time (both first-round
  passes — the override instrument turned each into an ini edit instead of story progression, which
  is exactly what session 7 built it for).
- **Bought:** the ENTIRE 23-model cutscene fleet converts and ships through the build pipeline
  automatically; cutscene cars carry readable plates vanilla never had (the demonstrated
  improvement); the shared parts-rig pass makes any future wheel-less branch a vocabulary file;
  the conversion's frame-name behaviour is now a CONTRACT mod authors can read.

## Still open (all the user's)

- **Plan 004 (opened at session close, the user's order): the full scene field review** — all 35
  vehicle scenes swept via the override, per-scene verdict ledger, blanket approval closes it
  (3 rows pre-passed; 32 to run).
- 002 step 11 field acceptance: a full-pipeline build with vehicles + cutscene stages (the stock
  `:sa` script excludes vehicles — which npm script carries it is a packaging call), then story
  progression across LS-era cutscenes.
- Deferred from earlier sessions: 101-escalators audit, 098 timing, the three gates.

## Plan 004's first scene already paid for the sweep (post-close, same day)

DESERT9 — the sweep's first new scene — found TWO emit-model defects in two rounds, both fixed the
same day (the plan's round records carry the ledger): anim binding is NOT first-match-only (the
GMC's nested door-glass duplicate bound the door channel and floated midair — the step-10
"bind-safe" claim above is corrected in place), and scenes drive channels for frames NO vanilla
model has (`windscreen_ok`), so EVERY adopted frame is now renamed `_ad`; plus the extras policy
(vanilla extras are posed scene furniture; a mod's spawn variants never match — one adopted, like
SA's own at-most-one rule). Field re-check passed: "glass with the door, one rack".

## Session-close audit sweep (docs + tests)

Coverage re-run at close: **91.92 / 82.6 / 92.09 / 92** vs floors 86 / 77 / 88 / 86 — floors hold.
Two doc defects found and fixed in the same sweep: `gta-sa-original/cutscenes.md`'s scene-coverage
count was 22/23 (an exact-name scan shows `cscopcarla` appears in no scene either — 21/23; the first
count read `cscopcarla92` hits as covering both slots), and this audit's own wheels claim was
over-generalized (scoped above). The plates TXD delta was appended to the benchmarks record.
