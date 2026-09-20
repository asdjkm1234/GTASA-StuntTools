# Vehicle special abilities are hardcoded to MODEL IDs — and how the reference install re-points them

**Recorded 2026-08-18** (vehicle-installer plan 011). What SA does, and what the install we ship into does about it.

## The original

Every "special" vehicle behaviour in SA is a branch on the model id inside `CAutomobile`/`CVehicle` (the
reversed source: `docs/links.md` → gta-reversed): pop-up headlights (`zr350`), advanced hydraulics
(`hotknife`, `bandito`), the BF Injection engine (`bfinject`), the dozer bucket, the cement cistern, the packer
platform, the tow-truck / tractor / trailer hooks (`towtruck`, `tractor`, `linerun`/`petro`/`rdtrain`/`artict3`),
the baggage trailers (`bagboxa`/`bagboxb`), the tug stairs (`tugstair`), the two turret kinds (`rhino`/`swatvan`,
`firetruk`) and the water jets (`firetruk`, `swatvan`). A model REPLACING one of those slots inherits the
ability; a model in any other slot cannot acquire it, however its mesh is authored. That is the whole reason
the VSA Editor (2008) and the IVF/Modloader `features.txt` convention exist.

## The reference install

`6. fastman92 limit adjuster 6.5 (stable)` (the `sa` layer, `docs/gta-sa-original/reference-install.md`) carries
a **model special feature loader**: `data/model_special_features.dat`, `CustomModelName StandardModelName`
per line — the custom model behaves like the standard one. Its ini has `[SPECIAL] Enable model special
feature loader = 1` in the shipped configuration (verified in `mods-src/original/mods/sa/6. …/fastman92limitAdjuster_GTASA.ini`
line 695 and in the built `build/original/sa/` copy). The separate `[VEHICLE SPECIAL FEATURES]` section
(`Enable special features = 0`, "Number of hydra vehicles", "ZR350 1 = 477") is a DIFFERENT mechanism — a
per-class id LIST — and is off; we use the loader, not the list.

The mod ships the `.dat` with one commented example (`#new_hydra hydra`) and NOTHING mapped, so a mod car's
`features.txt` had no effect on the `sa` target until the installer started writing this file (plan 011).

**Measured in the field 2026-08-18** (nine stock slots mapped by `vehicle-installer`, the user's bottle):

- **The loader DOES remap a stock model id.** `bullet hotknife`, `feltzer zr350`, `infernus bfinject` and the
  six others are all stock slots, and the abilities work on them. The adjuster's own example being an added
  model (`new_hydra`) is a documentation choice, not a limit.
- **Read per boot.** The verdict came from a boot after the file was written; treat a rewritten block as
  needing a restart, which is what a `--rebake` delivery does anyway. Nothing suggests a later re-read.
- The loader logs `Model special features loader enabled.` and, per unmatched line,
  `Model special features loader: model with name %s does not exist.` — a name typo is visible there and
  nowhere else. It also refuses to work at all unless `[ID LIMITS] Apply ID limit patch = 1` (its own message
  says so), and its strings carry `Vehicle special features are incompatible with model special features.`,
  so the `[VEHICLE SPECIAL FEATURES]` id-list mechanism must stay off — as it is here.
