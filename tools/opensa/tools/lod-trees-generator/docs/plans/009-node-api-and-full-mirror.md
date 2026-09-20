# 009 — Node API + full-tree mirror (pipeline passthrough)

**Status: ✅ Implemented.** Two changes so `perfect-map-builder` can chain this tool without losing data.

## Problem

1. **No reusable entry** — `cli.ts main()` builds the adapter (`createGtaSaTreeLodAdapter(options)`) and calls
   `run(adapter, config)` inline; a programmatic caller must duplicate that wiring.
2. **Non-modloader output is partial** — the default `--out` mode writes only the tool's own files (repacked
   `models/gta3.img`, modified `data/maps/*` IPLs/IDEs, patched `gta.dat`). It does **not** mirror the input game,
   so chaining `game → lod-trees → next` would drop `player.img`, `gta_int.img`, `anim/`, `text/`, etc.

## Change

1. **Full-tree mirror (non-modloader only).** Before writing its files, `cpSync(gamePath → outPath)` so the
   `--out` build is a **complete** game dir (its repacked `gta3.img` + edited data then overwrite the copies).
   **Also fixed:** non-modloader `emitImg` wrote the repacked img to `<out>/gta3.img` (root) — with the mirror in
   place the game loaded the plain `models/gta3.img` copy instead (no HD swaps / no impostor LODs). Now writes
   `<out>/models/gta3.img`, overwriting the copy.
   **`--modloader` mode is unchanged** — it deliberately emits only the `lod/` + `hd/` mod files (per the user: with
   `--modloader` we want just the modified files; without it, a full copy of the input). Mirrors the discipline of
   the installers / sa-lod-generator (`cpSync` the tree).
2. **`buildTreeLods(options)`** wrapper (e.g. `src/build.ts`) combining adapter construction + `run`:
   ```ts
   export interface BuildTreeLodsOptions {
     gamePath: string;
     outPath: string;
     inPath?: string; // HD tree folder (mods-src/vegetation); absent path or no .dff ⇒ built-in SA roster
     modloader?: boolean; // default false → full mirror
     prelight?: boolean;
     prelightInfo?: PrelightInfo; // parsed from vegetation/prelight.json
     config?: Partial<TreeLodConfig>; // textureSize (512 in the pipeline), cards, drawDistance, aspectThreshold
     debugPng?: boolean;
     strip?: boolean;
   }
   export function buildTreeLods(options: BuildTreeLodsOptions): void;
   ```
3. **`cli.ts`** becomes a thin wrapper over `buildTreeLods`. **Publish** package.json `exports`:
   `"./build": "./src/build.ts"`.

## Testing

- Unit: `buildTreeLods` maps options → adapter config (textureSize, prelight, modloader) correctly.
- Integration: a synthetic `--game` run in non-modloader mode → assert the output contains a **non-LOD** input file
  (e.g. a dummy `models/player.img` / `text/foo`) carried over verbatim **and** the `lodtrees.*` additions
  (mirror + own-files). Modloader mode still emits only `lod/`+`hd/` (no mirror).
