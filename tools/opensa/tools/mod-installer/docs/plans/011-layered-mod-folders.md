# 011 — layered mod folders: `common` → `<target>`

**Status: DONE 2026-08-15**, steps 1–5. Numbers below and in
[`docs/benchmarks/tools/2026-08-15-mod-installer-layered-flat-path.md`](../../../../docs/benchmarks/tools/2026-08-15-mod-installer-layered-flat-path.md).
No game has been split yet — the mechanism is in, the migration is the user's call.

A mods folder may be split into layers — `common/`, `sa/`, `opensa/` —
applied in that order: everything in `common/` first, then the layer of the target the run is building
for. A folder without those layers is FLAT and behaves exactly as it does today. Every layer is
optional.

## Why

The two targets are two different hosts, and some mods only make sense on one of them. Today one flat
`mods-src/<game>/mods` feeds both, so a mod that belongs to the real game (a stock-limit workaround, an
ASI-side fix, a model shaped for RenderWare streaming) also lands in our engine's build, and the reverse
too. The only lever available is to add or remove the mod for everyone, and both builds read the same
tree, so "for everyone" is the only granularity there is.

The split is a build-time decision, which is the right place for it: the target already selects every
knob whose right value is a fact about the HOST rather than about the source data
(`@opensa/tool-kit/target`), and the mod set is exactly such a fact.

**Nobody has to migrate.** `mods-src/original/mods` is 62 flat mod folders and stays that way until
someone chooses to split it. The layered shape is opt-in per game, and a game may adopt it with only a
`common/` layer.

## The shape

```
mods-src/<game>/mods/            FLAT (today):  every immediate subfolder is a mod
  0. Map Fixes Pack/
  1. Pre Light Fixes Pack/

mods-src/<game>/mods/            LAYERED:  the layer folders are not mods
  common/                        applied first, to every target
    0. Map Fixes Pack/
    1. Pre Light Fixes Pack/
  sa/                            applied second, only when building the `sa` target
    0. Stock-only workaround/
  opensa/                        applied second, only when building the `opensa` target
    0. Something our engine wants/
```

Apply order is **layer first, number second**: `common/50. X` applies BEFORE `sa/0. Y`, because the
target layer must be the last writer — that is the whole point of having it. Numbering restarts inside
each layer and each layer's own numeric-aware order is unchanged (`1. x` < `2. y` < `10. z`).

Overriding a `common` mod is expressed by shipping the same files in the target layer, not by matching
its folder name. Two mods with the same name in two layers are simply two mods; the later one wins the
files it touches, like any other pair.

## Decisions

- **The layer names come from `BUILD_TARGETS`**, plus the literal `common`. One source of truth: a third
  target would bring its layer with it rather than needing a second list to be remembered.
- **Detection is by name, at the top level of `--in` only.** An immediate subfolder named (case-folded)
  `common`, `sa` or `opensa` makes the tree layered. Case-folded because those are one folder on the two
  filesystems this repo runs on, so a `Common/` that silently became a mod would be a trap rather than a
  distinction.
- **A MIXED tree is refused, loudly.** Layer folders plus a mod folder side by side has no honest answer
  — there is no order that mod can have relative to the layers — so the install throws and names the
  offending folders. This is also what catches a misspelled layer (`commons/`, `open-sa/`): in a layered
  tree it is a stray mod folder, and the guard fires instead of the mod quietly applying to both targets.
- **Layered without a target is refused.** `install()` takes `target?: BuildTarget`; a layered tree and
  no target cannot pick a layer. A flat tree ignores the target (there is nothing to pick) and is not an
  error — every existing caller keeps working unchanged.
- **A missing or empty layer is normal, not an error** — a game with only `common/` is the expected first
  step, and a `sa`-only tree built for `opensa` legitimately applies zero mods. Every one of those cases
  gets a LOG line with its count, because a silently skipped layer is the failure this whole design has
  to avoid.
- **A both-target run over a layered tree is refused at CONFIG time** (see below), not by a guard three
  stages later.

## The one real complication: the common chain is shared

`perfect-map-builder` resolves ONE target per run and the `mods` stage lives in the chain both targets
share (`resolveBuildTarget`: a run that excludes neither target resolves to `sa`, precisely because the
shared chain has to satisfy the host that still has ceilings). A layered mods folder makes that stage
target-DEPENDENT, and a single run cannot produce two different installs out of one shared chain.

So: **a run that builds both targets over a layered tree is refused**, with a message naming the fix —
build them one at a time (`--exclude opensa`, then `--exclude sa`). The refusal follows the precedent
already in `resolveBuildTarget`, which refuses `--target opensa` while `sa` is still being built rather
than letting the mismatch surface later.

This costs today's builds nothing: all four `build:game:*` scripts already exclude one target, so every
build the repo actually runs resolves to a single target. The alternative — running the common chain
twice, once per target — is a much larger change to the builder for a case nobody currently runs, and it
is recorded here as the option if that ever stops being true.

## Steps

- [x] **1. Layer resolution, as a pure function.** New `src/layers.ts` (**moved to `@opensa/tool-kit/layers` on 2026-08-17** — vehicle-installer plan 010 and ped-installer plan 005 read their folders through the same planner): given the immediate subfolders of
      `--in` and an optional target, return the ordered mod ROOTS to walk plus a strategy label
      (`flat` / `layered`) and the per-layer counts for the log. No filesystem writes, no install logic.
      Verification: unit tests, negative first per the repo's order — mixed tree throws naming the stray
      folder, layered-without-target throws naming the layers it found; then positive — flat is
      unchanged, `common` only, target layer only, both layers in the right order, absent layer, empty
      layer, and a case-variant (`SA/`) resolving as the layer rather than as a mod.
- [x] **2. `install()` walks the roots.** `InstallOptions` grows `target?: BuildTarget`; the mod loop
      iterates the resolved roots in order, per-mod behaviour untouched (bake vs overlay, sorting, the
      IPL fold, `checkDanglingModels` — all of it is per-mod or over the finished tree and does not care
      where the mod came from). The summary line states the strategy and each layer with its count.
      Verification: every existing flat test passes unchanged; a new e2e over a layered temp tree proves
      (a) `common` applies before the target layer, (b) the target layer WINS a file both layers ship,
      (c) the other target's layer contributed nothing, (d) switching the target flips which layer's file
      is in the output while the `common` half stays identical.
- [x] **3. The CLI.** `--target <sa|opensa>` on `mod-installer`'s CLI via `parseBuildTarget` (a typo must
      fail loudly, which that helper already does). Verification: a layered tree converts from the CLI
      for each target; omitting `--target` over a layered tree prints the refusal.
- [x] **4. The builder.** `perfect-map-builder` passes its already-resolved target into the `mods` stage,
      and refuses a both-target run over a layered tree at config time — before any stage runs, with the
      two-command fix in the message. Verification: pipeline tests for the refusal and for a flat tree in
      a both-target run being unaffected; then a real run over `mods-src/original/mods` to prove the flat
      path did not move (the numbers below). **Done differently, and better**: the real check ran the
      mod-installer CLI itself rather than a full `build:game:original:sa`, which let the BEFORE and AFTER
      trees be diffed byte for byte instead of compared by stage timing.
- [x] **5. Docs + the renumber skill, in the same change.**
      `docs/contracts/mods.md` — a new section for the three reserved TOP-LEVEL names, what each does,
      what happens when one is misspelled (it becomes a stray mod and the mixed-tree guard throws), and
      an amendment to §7, which currently says a mod folder's name is ordering only: that stays true for
      mods and is no longer true for those three names at the top level.
      `docs/restrictions/architecture.md` — one line: the `mods` stage is shared by both targets, so a
      target-dependent mod set may not be built in a single run (CAUGHT, config-time throw).
      `docs/commands.md` + the tool readme — the two strategies and the flag.
      `.claude/skills/renumber-mods` — renumber each layer independently (numbering is per layer now,
      exactly as it is per game today); the skill must detect a layered tree rather than renumbering
      `common`/`sa`/`opensa` themselves into `0. common`.

## Numbers, measured 2026-08-15 (`game-src/original` + `mods-src/original/mods`, 62 flat mods)

**The flat path did not move: `diff -rq` between a BEFORE-code and an AFTER-code install reports no
differences** — 393 files, 1 892 164 KiB, 62 mods (13 baked), 3 434 entries merged, 10 mod IPLs folded
(634 rows), 2 stock inst blocks compacted (848 rows), on both. The only difference anywhere is the one new
log line, `mod-installer: flat mods — 62 mod(s)`.

**No wall-clock claim** — the machine was busy during the window (a mod folder was added to `mods-src` at
17:21, mid-measurement) and same-code repeats spread 68 s / 88 s while CPU time stayed flat at ~18 s user
+ ~25 s sys in every complete run. The full record, including the run that came back in 15.9 s with a
short tree, is in the benchmark file. A stage timing for this tool wants a quiet machine and the mod count
recorded beside it.

Still to record **when a set is actually split**: mods per layer per target, and a diff of the built `sa`
tree across the migration — the split changes what ENDS UP in a build, and that is what has to be checked,
never the folder layout. Build-time only; there is no per-frame cost here.

## Risks

- **A mod moved into the wrong layer is silent in the build and loud in the field.** Nothing downstream
  can tell "this mod was not meant for this target" from "this mod is missing". The mitigation is the
  per-layer log line and the before/after tree diff on the first split, not a guard — the tool cannot
  know where a mod belongs.
- **Layer names collide with the mod namespace.** A mod genuinely called `sa` at the top level of a flat
  tree would silently turn that tree layered. Today no game has one (checked, 2026-08-15: `original`,
  `gostown`, `carcer`), and the contract entry makes the three names reserved — but this is the one case
  where an old tree could change meaning without anyone touching it, so it belongs in the contract and
  in the log line, which always states which strategy was chosen.
- **The other stage folders stay flat.** `vehicles/`, `peds/`, `vegetation/`, `procobj/` are NOT part of
  this plan. If per-target vehicles turn out to be wanted, the same resolution function serves them —
  but doing it unasked would spread a convention before it has been used once.
