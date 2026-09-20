# Session 20 (2026-08-17): cars-server follows the vehicle layers, and the first REAL killed-and-resumed build

**On `main`, 26 commits after `550e6a3a` (2 this session), tree clean, suite 490 files / 4 458 green, tsc +
eslint clean.** His order for the session: one vehicle-installer task (context from him — it was cars-server,
the reader the layering had left behind), close the pmb/tools leftovers, audit. Both closed; the leftovers'
close found two real bugs the e2e had not.

## What changed

| area | change | commit |
| --- | --- | --- |
| `tools/tool-kit` | `resolveVehicleSources` returns `layers` — the build layers APPLIED, in apply order, each with its folder as spelled on disk (a flat/structured tree is one layer rooted at `--in`); the resolver's readers of the layers' side folders overlay in the same order | `6db01626` |
| `scripts/cars-server` (plan 002) | screenshots follow the layers: `<layer>/screenshots/` per layer, and **a car's picture is read from its OWN layer only** (his call — a first cut overlaid the folders by slot, and a `sa` car with only the `common` picture would have worn the displaced car; the same lie plan 001 refuses for a `new/` candidate); `npm run cars:sa` / `cars:opensa`; the page carries the target as a badge + the screenshot folders per layer, or "not layered (target does not apply)"; **cars without a screenshot are a warning at the top** — slot, the filename to SAVE (`<folder>.png`; `.jpg`/`.jpeg`/`.webp` read too), the folder (`sa/models/…`), each linking to its card (`#car-<slot>`); `new/` candidates excluded | `6db01626` |
| `tools/perfect-map-builder` | **`--resume` refused a real killed build**: the chain deletes each stage dir as the next consumes it, so of a finished chain only the LAST dir survives, and `skipDone` demanded EVERY recorded dir (`1-split`, long gone). A recorded dir is now checked at its point of USE — the next stage that reads it, the split, the `sa` deliverable — never for a consumed intermediate | `5fa0a5ee` |
| `tools/perfect-map-builder` | **a TC without `models/cutscene.img` (gostown) died on the raw ENOENT after the vehicles stage** — the first gostown build since the cutscene stage was added; the stage is now skipped with a line saying why, and `planChain` no longer calls a cutscene stage dropped for another reason "vehicles/ empty" | `5fa0a5ee` |
| `tools/opensa-pack` | the `resume: N/M chunks taken from checkpoints` log line says the model classes after the weld are NOT checkpointed and re-run, and names the in-reserve card | `5fa0a5ee` |
| docs | `docs/contracts/vehicles.md` (`screenshots/` per layer, own layer only, root of a layered tree = stray → refused), `docs/commands.md` (cars:sa/opensa; `--resume`: dirty tree allowed by design, model classes re-run, field-exercised), `docs/development/scripts.md`, cars-server readme + plan 002, pmb plan 006 (field exercise + the dirty-tree decision), `docs/in-reserve/opensa-pack-model-class-checkpoints.md` + README row, `docs/edge-cases/converter-pipeline.md` (no cutscene.img → no cutscene stage), benchmark `docs/benchmarks/tools/2026-08-17-pmb-resume-killed-build.md` + index row | both |

## What it cost / what it bought

- Builds: three gostown opensa runs (~2 min each; `build/gostown-resume-{test,ref}` — deleted after): one
  killed at weld chunk 6/21, its resume, and an unbroken reference. Zero `original` runs.
- Bought: a cars page that tells the truth per target and per layer and flags what is missing at the top
  instead of 150 cards down; a `--resume` that actually resumes a real dead build (before this session it had
  only ever resumed the e2e's one-stage chain and a standalone pack); a pipeline that survives a TC without a
  cutscene archive.
- Tests: cars-server 17 → 22, tool-kit vehicles-dir `layers` asserted (+0 files), pmb pipeline 86 → 88
  (both new tests fail on the old code — checked by swapping the file). Suite 4 452 → 4 458.

## Verified by measurement

- Resume, real data (gostown): killed run resumed at chunk 7/21 (`resume: 6/21 chunks taken from checkpoints
  (116 cells)`), 122 s total vs 197 s unbroken; **`world.ospak`, `water.bin` and all four archives
  byte-identical** to the unbroken run — the manifest differs in `buildTime` only.
- cars-server: the real `mods-src/original/vehicles` (structured, 212 cars, 212/212 screenshots — no warning);
  a synthetic layered tree with `--target sa`: header `layered: common + sa`, `/shot/admiral` → `200
  image/jpeg` from `sa/screenshots`; with the sa picture removed the page opens on the warning naming
  `admiral - B - y.png` even though `common/screenshots` holds a picture under the same slot.

## Decisions taken (do not re-derive)

- **A layered car reads its own layer's screenshot only.** The overlay-by-slot variant was built and replaced
  the same hour; plan 002 records why.
- **A dirty working tree does not refuse a `--resume`** — the identity is git HEAD + config + sources. That is
  the dev loop the feature exists for (the pack dies on a bug, the bug is fixed uncommitted, the run resumes);
  the commit boundary is the reproducibility gate.
- **Per-model-class pack checkpoints stay unbuilt** — in reserve with a named trigger; on gostown the classes
  are 6 s of a 100-s pack, on `original` ~9 of ~55 min, and a resume already never spends the ~50 min before.

## Open after this session

- His field verdict on the OpenSA lab (`?src=/build/original/opensa-lab`, `burger01_law`).
- The GPU-pass regression (`docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md`) — untouched this
  session; next = the UNCAPPED headless sweep on the 08-17 pak.
- `packages/validation` 001 → `apps/cutscene-converter` 001/002 (decisions settled in the standalone-app
  chain).
- `mods-src/original/vehicles` is not layered (so `cars:sa` and `cars:opensa` show the same page there);
  nothing needs a per-target car yet.
- The `procobj=0` arm's draws/tris did not move at all — whether the knob applied on that path is unverified.
