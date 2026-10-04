# 005 — A peds folder may be layered `common/` + `sa/` + `opensa/`

**Status: ✅ Implemented 2026-08-17.** `mods-src/<game>/peds` reads like a mods folder (mod-installer plan
011) through the shared planner `@opensa/tool-kit/layers`: `common/` then the target's layer, ped folders
alphabetical inside each layer, so a later layer's ped of the same model is the last writer of its archive
entries and its `peds.ide` row. `install({ …, target })`, CLI `--target sa|opensa`; the pipeline passes its
resolved target and refuses a layered peds folder in a both-target run at config time (the same guard as
mods and vehicles). A flat folder is unchanged; a layered one read without a target is refused; a ped folder
beside the layers (a misspelled layer) is refused. `original`'s peds are not migrated — nothing needs a
per-target ped yet. Tests: `install.e2e.test.ts` (+2).
