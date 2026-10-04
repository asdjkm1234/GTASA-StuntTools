# 011 — `model_special_features.dat` for the `sa` target (a mod car's `features.txt` reaches the real game)

**Status: DONE 2026-08-18 — steps 1-4 built and verified headless, step 5 FIELD-ACCEPTED the same day: the
user's verdict is "features работают" (they work). Both open questions are answered below.** The OpenSA half of the same declaration is
[`docs/plans/098-all-land-vehicles/`](../../../../docs/plans/098-all-land-vehicles/readme.md) (02 + 06) —
this plan is the REAL-GAME half, and the two share one vocabulary table (step 1).

## What this is about

A vehicle mod declares what its model can DO beyond geometry in a `features.txt` (the Modloader/IVF
convention — `docs/contracts/vehicles.md` §1). Nine of the original's 212 mod cars ship one today
(`ADV_HYDRALICs` ×2, `BF_ENGINE&HYDRALICS` ×3, `UP/DOWN_LIGHTS` ×4). The installer already READS it
(`apply-vehicle.ts` → `parseFeatures`) and writes `data/vehicle-features.txt` — **an OpenSA file the real game
never looks at**. On the `sa` target the declaration therefore evaporates: a mod SL-Class in the `feltzer` slot
has pop-up pods and no way to open them, because in SA every special ability is hardcoded to a MODEL ID.

The real install has exactly one lever for that, and it is already on: **fastman92's limit adjuster (mod
`6. fastman92 limit adjuster 6.5 (stable)`, `sa` layer) ships `data/model_special_features.dat` and its ini sets
`[SPECIAL] Enable model special feature loader = 1`.** The file is `CustomModelName StandardModelName`, one
pair per line: the named model behaves like the standard one — a `feltzer zr350` line gives whatever sits in
the `feltzer` slot the ZR-350's pop-up lights (`docs/gta-sa-original/vehicle-special-features.md`). The mod
ships it EMPTY (one commented example), so today nothing maps.

The user's worked example of the file we should be producing (2026-08-18):

```
bullet hotknife        # ADV_HYDRALICs
cheetah zr350          # UP/DOWN_LIGHTS
feltzer zr350
hotring hotknife
infernus bfinject      # BF_ENGINE&HYDRALICS
oceanic bfinject
rumpo bfinject
turismo zr350
uranus zr350
004veh bfinject        # added (non-slot) cars follow the same rule by their MODEL name
```

## The vocabulary (token → the stock models that natively carry it)

The FLA file wants a STANDARD MODEL, the mod declares a TOKEN — so there is a table between them, and it is
the same table 098/02 wanted from the VSA corpus. It is data, it is small, and it goes into the repo ONCE:

| Token | Stock carriers (any one of them is a valid `StandardModelName`) |
| --- | --- |
| `ADV_HYDRALICs` | `hotknife`, `bandito` |
| `BAGBOXA` | `bagboxa` |
| `BAGBOXB` | `bagboxb` |
| `BF_ENGINE&HYDRALICS` | `bfinject` |
| `BUCKETs` | `dozer` |
| `CISTERNs` | `cement` |
| `PACKERs` | `packer` |
| `TRACTOR_HOOKs` | `tractor` |
| `TRAILER_HOOKs` | `linerun`, `petro`, `rdtrain`, `artict3` |
| `TRUCK_HOOKs` | `towtruck` |
| `TUGSTAIR` | `tugstair` |
| `TURRETs_1` | `rhino`, `swatvan` |
| `TURRETs_2` | `firetruk` |
| `UP/DOWN_LIGHTS` | `zr350` |
| `WATER_JETs` | `firetruk`, `swatvan` |

Spelling is the IVF/Modloader one — the tokens keep their odd case and characters (`ADV_HYDRALICs`,
`BF_ENGINE&HYDRALICS`) because that is what mods in the wild write; `parseFeatures` upper-cases, so the
table is matched upper-cased. **The carrier list is a REFERENCE for the real game and a TEST ORACLE for
OpenSA's detectors (098/06) — never an ID list our own runtime keys on** (`docs/restrictions/assets-and-data.md`:
derive from the asset, not the slot).

## Steps

- [x] **1. One vocabulary module, shared by both targets.** DONE 2026-08-18. `packages/renderware/src/parsers/text/vehicle-features.parser.ts`
      already exports `UP_DOWN_LIGHTS`; it grows `VEHICLE_FEATURE_TOKENS` — the table above as
      `{ token, saCarriers: string[] }` rows, plus `saCarrierFor(tokens: string[]): { model: string; covers: string[]; dropped: string[] } | null`.
      Resolution: prefer ONE carrier that covers EVERY declared token (`swatvan` for `TURRETs_1` +
      `WATER_JETs`); otherwise the carrier covering the most tokens (ties → table order, deterministic), the
      uncovered tokens returned as `dropped`. Unknown tokens are neither an error nor covered — they flow
      through as today. Tests: full cover, best-partial with `dropped`, unknown-only → null, case folding.
- [x] **2. The `sa` writer.** `install.ts` (and `rebake-sa.ts`, which re-merges settings in place) call
      `writeModelSpecialFeatures(outPath, features)` when the target is `sa`: read `data/model_special_features.dat`
      from the game tree (the FLA mod's copy, installed by mod-installer BEFORE the vehicle stage — pmb order
      `mods → vehicles`), keep every line that is not ours, and append/replace ONE marked block:
      `# --- vehicle-installer (features.txt → standard model), do not edit: rewritten on every install ---`
      followed by `<model> <carrier>` lines sorted by model, so a rebuild is byte-identical and a `--rebake
      --only <car>` MERGES (drops that car's old line, writes the new one) instead of rewriting the world.
      Model = the built model name — the slot for a replacement, the model name for an added car when
      add-vehicles arrives (the writer never asks WHY a name exists).
- [x] **3. What is warned about, loudly, in the install log** (each is silent in the real game otherwise):
      - a car declares tokens but the tree carries no `data/model_special_features.dat` → the FLA mod is not
        installed for this target: warn once, naming the mod, write nothing (a file the adjuster does not read
        would lie about being applied);
      - the FLA ini in the tree has `Enable model special feature loader = 0`/absent → warn once (the file
        would be written and ignored);
      - a car's tokens are only PARTLY covered by one carrier → warn with `dropped`;
      - the SLOT itself is a stock carrier of some token the car does NOT declare (a mod in `firetruk`
        declaring only `UP/DOWN_LIGHTS` → `firetruk zr350` would REMOVE the truck's water jets and turret) →
        warn: remapping a stock special model loses its native abilities;
      - the slot already natively carries every declared token (`hotknife` + `ADV_HYDRALICs`) → no line, no
        warning (nothing to do).
- [x] **4. Contracts, in the same change as step 2** (`docs/contracts/vehicles.md`): §1 `features.txt` — the
      table becomes the full vocabulary (token → meaning → what the `sa` build writes → OpenSA state, per
      098); §2 gains `data/model_special_features.dat` (`sa` target only; FLA's file, our marked block; a
      misspelled token is carried and IGNORED on both targets — visible only in the install log; a
      misspelled CARRIER cannot happen, the table owns them). `docs/gta-sa-original/vehicle-special-features.md`
      is written with this plan (the fact about the adjuster).
- [x] **5. Field checkpoint (the user, CrossOver bottle):** DONE 2026-08-18 — deliver the built `data/` (`data/model_special_features.dat`
      + the ini as installed) and check ONE car per mechanism — `feltzer` (pop-up lights open with the
      headlights), `bullet` (hydraulics respond), `infernus` (BF engine + hydraulics). Two things a desk check
      cannot answer, recorded here whatever the answer: does FLA remap a STOCK id (`bullet`) or only added
      ids (its own example is `new_hydra`), and does the loader read the file per boot or per model load
      (a `--rebake` delivery may need a restart). Verdicts into the ledger; a NO on the first turns this plan
      into an `add-vehicles`-only feature and says so at the top.

## Verification

Headless: `install.e2e.test.ts` +3 (sa target writes the block into a fixture FLA file, opensa target writes
nothing, rebake `--only` merges), `features.test.ts` for the resolver, tsc + eslint; `docs/contracts/vehicles.md`
diff reviewed. Field: step 5. Every field verdict goes into the ledger below with the build it read.

## Ledger

**Step 1, 2026-08-18** — `VEHICLE_FEATURE_TOKENS` (15 rows) + `saCarrierFor` + `vehicleFeatureToken` in
`packages/renderware/src/parsers/text/vehicle-features.parser.ts`, exported from the text-parser barrel;
14 tests in `vehicle-features.parser.test.ts` (vocabulary guard, case folding, full cover, best-partial with
`dropped`, unknown-only → `null`, a real declaration through `parseVehicleFeatures`); `tsc` clean, the
renderware text parsers + vehicle-installer suites 38 files / 258 green.

Two decisions the resolver's callers stand on:

- `dropped` carries only VOCABULARY tokens the chosen carrier cannot cover. A token outside the vocabulary is
  in neither `covers` nor `dropped` — it is carried and ignored as everywhere else in the chain, so step 3's
  partial-cover warning reports a real loss of ability instead of every mod's typo.
- Ties are broken by TABLE order (the first row that mentions the carrier), so the written block is
  reproducible; the search stops early only on a full cover, so a later carrier that covers everything still
  beats an earlier one covering a subset.

**The resolver census over the nine cars that ship a `features.txt` today** (run against
`mods-src/original/vehicles/models`, single-token declarations throughout, nothing dropped) reproduces the
user's worked example line for line:

```
bullet hotknife     [ADV_HYDRALICS]
cheetah zr350       [UP/DOWN_LIGHTS]
feltzer zr350       [UP/DOWN_LIGHTS]
hotring hotknife    [ADV_HYDRALICS]
infernus bfinject   [BF_ENGINE&HYDRALICS]
oceanic bfinject    [BF_ENGINE&HYDRALICS]
rumpo bfinject      [BF_ENGINE&HYDRALICS]
turismo zr350       [UP/DOWN_LIGHTS]
uranus zr350        [UP/DOWN_LIGHTS]
```

**Steps 2-4, 2026-08-18** — the writer is `tools/vehicle-installer/src/special-features.ts`
(`writeModelSpecialFeatures(targetPath, features, authoritative?)` + `SPECIAL_FEATURES_DAT`), called from
`install.ts` when `options.target === 'sa'` and from `rebake-sa.ts` (target `sa` by construction) with the
rebaked models as `authoritative`. 14 unit tests in `special-features.test.ts`, +2 in `install.e2e.test.ts`
(sa writes `admiral zr350` and keeps the adjuster's lines; opensa leaves the file byte-identical), +1 in
`rebake-sa.test.ts` (a `--only zr350` rebake keeps `feltzer`'s mapping and drops its own stale line).
Installer + renderware text-parser suites 39 files / 277 green, `tsc` + eslint clean. Contracts:
`docs/contracts/vehicles.md` §1 is now the full 15-token vocabulary with the `sa` carrier and the OpenSA state
per token, and §2 carries the `data/model_special_features.dat` row.

Three decisions the plan did not fix, taken while building it:

- **The block is TERMINATED** (`# --- end vehicle-installer ---`), not just opened. Our block is written last,
  so without an end marker anything appended after it by a later tool or by hand would be swallowed by the
  next run — the block is parsed by markers, and an unterminated one is read to end-of-file (the honest
  reading: guessing where it stops would adopt the adjuster's own lines).
- **A self-mapping line is never written.** Beyond the planned "slot already carries every declared token",
  the same silence covers the carrier-by-another-name case (`bandito` declaring `ADV_HYDRALICs` resolves to
  `hotknife`, but bandito HAS hydraulics) — a line would remap a model onto abilities it already has.
- **A sixth warning, unplanned and silent otherwise**: the adjuster's file already mapping a model we also map
  (an author's own line outside our block). Both lines name the model and only one wins in the game.

The file's own conventions are preserved rather than normalised: CRLF as the adjuster ships it, the mod's
comment block verbatim, and no growth on a re-run. Dry run over the real built tree (`build/original/sa`'s
`data/model_special_features.dat` + `vehicle-features.txt` + `fastman92limitAdjuster_GTASA.ini`, copied to a
scratch dir — the shipping tree was not touched): 9 lines, 0 warnings, 503 -> 980 B, 23 of 23 line endings
CRLF, and the second run byte-identical (md5 `9b36bafa61cdcb36ca41b79f5eb6854d`). The block it produced is
exactly the user's worked example:

```
bullet hotknife
cheetah zr350
feltzer zr350
hotring hotknife
infernus bfinject
oceanic bfinject
rumpo bfinject
turismo zr350
uranus zr350
```

**Delivered into the built tree, 2026-08-18** — `--rebake original --kind sa --only bullet,cheetah,feltzer,
hotring,infernus,oceanic,rumpo,turismo,uranus` (the user's go-ahead; the nine cars that declare anything, so a
full `sa` build was not spent). Report: 9 rebaked / 203 skipped, 153.0 MB of dff/txd, no warnings.
`build/original/sa/data/model_special_features.dat` is now 980 B, md5 `9b36bafa61cdcb36ca41b79f5eb6854d` — the
same bytes the scratch dry run produced. Nothing else moved: `vehicles.img` 1 869 164 544 B and
`vehicles2.img` 1 231 806 464 B unchanged, `data/img-layout.json` and `data/vehicle-features.txt` md5
unchanged (the settings re-merge is idempotent). The bottle needs `models/` + `data/` synced from this tree
before the field check.

**Step 5, field-accepted 2026-08-18 (the user's bottle, the tree above + the block).** Verdict: the special
features WORK. Both questions the desk could not answer:

- **Does FLA remap a STOCK id?** **YES.** All nine mapped slots are stock (`bullet`, `cheetah`, `feltzer`,
  `hotring`, `infernus`, `oceanic`, `rumpo`, `turismo`, `uranus`) — the adjuster's own example (`new_hydra`)
  being an ADDED model was not a restriction. So this plan stays a feature of the ordinary fleet, not an
  `add-vehicles`-only one.
- **Per boot or per model load?** The verdict came from a fresh boot after the delivery, so **per boot is
  proven and is what a delivery should assume**: after a `--rebake` that rewrites the block, restart the game.
  Nothing observed says the loader re-reads the file later, and nothing needs it to.

Recorded in `docs/gta-sa-original/vehicle-special-features.md` (the fact about the adjuster).

**The delivery cost a boot-crash hunt that was NOT this plan's fault** — the same delivery reverted the
install's FLA ID pools, because the whole tree root was copied and `mods-src`' copy of
`fastman92limitAdjuster_GTASA.ini` never carried the 2026-08-10 field raise. Written up in
[`docs/open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md`](../../../../docs/open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md);
the `.dat` block was cleared as arm 1 of that hunt and exonerated before the real cause was found.
