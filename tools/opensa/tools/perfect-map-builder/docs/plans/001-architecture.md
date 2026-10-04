# 001 — perfect-map-builder architecture

**Status: ✅ Implemented.** One command that chains **every** map tool we built into a single "perfect map" build,
then splits the result into the two runtime targets. Replaces the manual multi-command flow in
`mods-src/commands.md` (where each tool was run separately against the **original** game) with a true **linear
pipeline** — each step's output is the next step's input, so mods + optimizations + LODs **compound**.

```sh
tsx tools/perfect-map-builder/src/cli.ts --game ./game-src/original --in ./mods-src --out ./build/original
# → ./build/original/sa      (real game, fastman92)
# → ./build/original/opensa  (OpenSA)
```

## Inputs

- `--game <path>` — the clean base game (`gta.dat` + `data/` + `models/`).
- `--in <mods-src>` — a folder of source assets, one subfolder per stage:
  - `mods/` → mod-installer · `vehicles/` → vehicle-installer · `peds/` → ped-installer
  - `vegetation/` → lod-trees-generator (+ `vegetation/prelight.json` if present) · `procobj/` → sa-procobj-placement
- `--out <path>` — output root; the builder creates `<out>/sa` and `<out>/opensa`.

`vehicles/` and `peds/` are **skipped** when their source subfolder is missing/empty (output = the previous
stage's, untouched). `trees/` and `procobj/` always RUN: their subfolder is an optional HD-swap source, so a
missing `vegetation/` / `procobj/` — or one holding no `.dff` — is normalised to "no swap" and the stage bakes
the built-in SA tree roster / converts every `procobj.dat` species from the game's own `gta3.img`.

## Pipeline (each step's output = the next step's `--game`)

| #   | Tool                                            | `--in`        | Key options                                                                                                            |
| --- | ----------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | mod-installer                                   | `mods/`       | —                                                                                                                      |
| 2   | vehicle-installer                               | `vehicles/`   | (skip if empty)                                                                                                        |
| 3   | ped-installer                                   | `peds/`       | (skip if empty)                                                                                                        |
| 4   | map-optimizer                                   | —             | **all passes on** (textures + weld-seams + prelit + add-normals; stitch-gaps/refine retired — shared config, plan 018) |
| 5   | lod-trees-generator                             | `vegetation/` | non-modloader (**full mirror**), `prelight vegetation/prelight.json`, `tex 512`                                        |
| 6   | sa-procobj-placement                           | `procobj/`    | non-modloader (**full mirror**), `prelight` (bare), `tex 128`                                                          |
| —   | **split** from step 6 (the common baked build): |               |                                                                                                                        |
| 7a  | sa-lod-generator                                | —             | `--game step6 --out <out>/sa`                                                                                          |
| 7b  | opensa-lod-generator                            | —             | `--game step6 --out <out>/opensa`, `cell 256`, `strip-lods`                                                            |

lod-trees / lod-procobj run in **non-modloader** mode so their output is a **complete game dir** (they gain
full-tree mirroring — their plans 009 / 005) and works for both targets. The only per-target divergence is the
**final LOD generator** (per-object HD clones for real SA vs decimated cell LODs for OpenSA).

## Passthrough guarantee (why the chain never loses data)

Every stage must emit a **complete** game dir (verified): installers `cpSync` the tree + layer the mod;
map-optimizer mirrors the tree + rebuilds each `models/*.img`; sa-/opensa-lod-generator `cpSync` the tree. The two
LOD generators (`lod-trees`, `lod-procobj`) currently emit **only their own files** in non-modloader mode — their
API plans add a **full input→output mirror** so the chain carries `player.img`, `gta_int.img`, `anim/`, `text/`,
and every other file forward.

## How it calls the tools — Node API (no CLI shelling)

Each tool exposes a programmatic entry so the builder imports and calls it in-process (per-tool API plans):

- installers — `install({ gamePath, inPath, outPath })` (already exists; just add package.json `exports`).
- map-optimizer — `runOptimizer({ gameDir, outDir, passes })` (plan 018: lift the flag→plugin composition out of `cli.ts`).
- lod-trees — `buildTreeLods({ gamePath, inPath, outPath, prelightInfo, textureSize, mirror })` (plan 009).
- lod-procobj — `buildProcobjLods({ gamePath, inPath, outPath, prelight, textureSize, mirror })` (plan 005).
- sa-lod-generator — `buildSaLods({ gameDir, outDir, config })` (plan 004).
- opensa-lod-generator — `buildOpensaLods({ gameDir, outDir, cellSize, stripLods })` (plan 003).

## Working dirs + disk

Intermediate stages are ~1 GB each. The builder uses a scratch area (e.g. `<out>/.work/stepN`) and **deletes each
intermediate once the next stage has consumed it**, keeping at most two live — except **step 6 is kept** until both
`sa` and `opensa` have been generated from it, then removed. Only `<out>/sa`, `<out>/opensa` and
`<out>/report.json` (the pack report, mirrored from `<out>/opensa/pak/report.json` — 086 phase 8) remain.

## Config

A single builder config: the map-optimizer pass toggles (all on by default), `treeTex` (512), `procobjTex` (128),
`cellSize` (256), draw distances, and the mods-src subfolder names. Overridable; sensible defaults match
`commands.md`.

## Shape (mirrors the other tools)

```
cli.ts  --game --in --out
  core/       stage list + the run report; the orchestration loop (game-agnostic where possible)
  pipeline.ts the ordered stage calls + working-dir lifecycle + the sa/opensa split
  config.ts   pass toggles + tex/cell/draw knobs + subfolder names
```

## Testing

- **Unit:** stage-skip logic for vehicles/peds (empty subfolder → passthrough) and the trees/procobj fallback
  (absent or `.dff`-less subfolder → no swap, not a throw — `swapFolder`/`hdFolder`), working-dir lifecycle (intermediate cleanup, step-6
  retained for the split), config defaults.
- **Integration:** a tiny synthetic `--game` + `--in` through the whole chain, asserting `<out>/sa` and
  `<out>/opensa` each contain a complete game tree (no dropped files) + the expected per-target LOD artifacts.
  Full real-data run is a manual/`test:fixtures` job (multi-GB, minutes).

## Prerequisite

**fastman92 Limit Adjuster** for the `sa` target (raised stream/model/TXD budget; new model ids from the hole-fill
phase). `opensa` needs none.

## Deferred

- Per-target divergence earlier than step 7 (e.g. modloader packaging for `sa`) if a single baked `gta3.img` hits
  real-game limits — start unified, split the packaging later if needed.
- `vehicles/` and `peds/` are wired now but may be lightly populated; more content lands later.
