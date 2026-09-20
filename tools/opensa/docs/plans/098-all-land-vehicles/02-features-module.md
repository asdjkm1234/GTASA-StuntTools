# 098/02 — Vehicle features module (one home for special abilities)

**Goal:** the special-ability surface — token vocabulary, build-time part identification, fixture fields,
runtime drivers — moves into ONE module with a registry shape, so an ability is added by data + one
driver, not by another hand-wired chain. Pop-up lights migrate as the first citizen with **zero behaviour
change**. No new abilities land here (that is 06); this plan is the extraction and the contract.

## What exists (recon 2026-08-04) — the template to generalise

The shipped chain for the ONE live token, `UP/DOWN_LIGHTS`:

1. Mod declares: `features.txt` in the mod folder — `parseFeatures` (`tools/vehicle-installer/src/
   features.ts:28-40`), tokens upper-cased, unknown tokens carried and ignored (the documented extension
   point, `docs/contracts/vehicles.md:59-65`).
2. Install collects: `data/vehicle-features.txt` (`install.ts:10,54-86`; rebake merges,
   `rebake.ts:97-127,203-214`). **Build-time only** — the restriction file records that a declaration
   reaches a car only through the build.
3. Bake resolves: `pack-vehicles.ts:58,72-74` turns the token into `popUpLights: true` for the builder;
   detection itself is geometric — `popUpLights()` (`build-vehicle-model.ts:851-885`) finds the `misc_*`
   pod whose head-lamp normals pitch down, 5°-100° band, angle from the mesh; the token only relaxes the
   lamp-marker requirement. Result `{ angle, part }` lands in the `.osm` DESC.
4. Runtime drives: `vehicle-rig.ts:149,223-232` eases 0→1 at `POPUP_SPEED = 1/0.7`
   (`docs/hacks/popup-travel-time.md`), `engine-vehicle-handle.ts:212-219` applies
   `setPartRotation(part, axisAngle(0, open·angle))`; `vehicle-lamp.system.ts:121-143` gates lamps on
   `popUpTravel >= 1`.

Also relevant: `misc_a`-`misc_h` are SA's generic moving components (41 stock models carry one that is
NOT a pod — dozer blade, forklift mast, tow crane, lowrider hydraulics, per the comment at
`build-vehicle-model.ts:859-860`); `setPartRotation`/`setPartTranslation` on `RigidEntity`
(`packages/engine/src/entities/rigid.ts:99-114`) is fully generic transport; and there is a second,
IFP-driven mechanism for authored clips (`engine-anim-objects.ts` + `frame-clip.ts`) not yet used for
vehicles.

## Design

- **Vocabulary = the VSA catalogue, normalised — and since 2026-08-18 it is IN THE REPO as data, not in
  `NO_COMMIT`.** The 15 tokens with their stock carriers are the table in
  [`tools/vehicle-installer/docs/plans/011-model-special-features.md`](../../../tools/vehicle-installer/docs/plans/011-model-special-features.md)
  (`ADV_HYDRALICs` hotknife/bandito · `BAGBOXA` · `BAGBOXB` · `BF_ENGINE&HYDRALICS` bfinject · `BUCKETs`
  dozer · `CISTERNs` cement · `PACKERs` packer · `TRACTOR_HOOKs` tractor · `TRAILER_HOOKs`
  linerun/petro/rdtrain/artict3 · `TRUCK_HOOKs` towtruck · `TUGSTAIR` tugstair · `TURRETs_1` rhino/swatvan ·
  `TURRETs_2` firetruk · `UP/DOWN_LIGHTS` zr350 · `WATER_JETs` firetruk/swatvan). **One module serves both
  targets**: `VEHICLE_FEATURE_TOKENS` in `packages/renderware`'s `vehicle-features.parser.ts` (011 step 1) —
  the `sa` build translates a token into FLA's `model_special_features.dat` line, the OpenSA build hands the
  same token to the detector registry below. The corpus plugin (`NO_COMMIT/all-veh/1`,
  `VSAConfig.ini`) enumerates the same 15 classes and stays the provenance. Tokens keep the Modloader/IVF-family
  spelling where one exists (`UP/DOWN_LIGHTS` stays). The vocabulary table in `docs/contracts/vehicles.md`
  is the single source; unknown tokens keep flowing through untouched. **VSA's ID→ability mapping is not
  imported** — identification derives from the asset (geometry, dummies, flags), the token only forces or
  suppresses, exactly like the pop-up precedent.
- **Build side:** one identification registry in `packages/renderware/src/vehicle/` — per ability a
  `(scratch, forced) → fixture field | undefined` detector, each writing its OWN optional DESC field
  (the `popUpLights` shape). Existing `.osm` files stay valid byte-for-byte; new fields are optional.
- **Runtime side:** `packages/game/src/vehicle/features/` — a driver registry keyed by fixture field.
  Each driver gets the rig's articulation channel (a generalisation of the pop-up ramp: target + speed +
  `setPartRotation`/`setPartTranslation`) and whatever game signals it declares (headlight state, input,
  speed). `VehicleRig` keeps owning per-fixed-step easing; drivers own policy.
- **Corpus into the repo:** the VSA vocabulary (the ini's class list + stock IDs as a REFERENCE table,
  clearly marked non-authoritative) and the glendale control car become committed fixtures — the chain
  must not depend on an uncommitted folder (the 097 rule).

## Steps

- [ ] Fixture the corpus: glendale as a vehicle-installer test fixture. The vocabulary reference is
      011's table + the shared `VEHICLE_FEATURE_TOKENS` module, and **that module SHIPPED 2026-08-18**
      (011 step 1: `VEHICLE_FEATURE_TOKENS`, `saCarrierFor`, `vehicleFeatureToken` in
      `packages/renderware/src/parsers/text/vehicle-features.parser.ts`) — this step is now the glendale
      fixture only; the stock-carrier list is the detectors' ORACLE, never a runtime key.
- [ ] Extract the build-side detector registry; `popUpLights()` moves in unchanged (same tests, same
      `.osm` output — byte-compare a re-bake of a pod car and of glendale as the no-features control).
- [ ] Extract the runtime driver registry + rig articulation channel; the pop-up driver reproduces
      today's behaviour exactly (same easing constant, same lamp gate; the hack file stays put).
- [ ] Token plumbing: `parseVehicleFeatures` exposes the full token set to the bake; per-token wiring
      becomes one registry entry instead of `pack-vehicles.ts` special-casing.
- [ ] Contracts: vocabulary table restructured for growth (token → detector → fixture field → driver →
      what a misspelling does: carried and ignored, visible in the install log).
- [ ] `docs/features/vehicle-special-abilities.md` created (state: module extracted, one ability live) +
      README row.

## Verification

Headless: full vehicle suite green; byte-identical `.osm` re-bakes for a pod car (zr350 or the atlas
Starion case from 084) and for glendale; install log shows carried-unknown tokens unchanged. No field
session needed — this plan must be invisible from the driver's seat.

## Ledger

(rebake byte-compare results, suite timings, module size)
