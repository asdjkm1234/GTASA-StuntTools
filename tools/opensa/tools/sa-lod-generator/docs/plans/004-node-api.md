# 004 — Node API (programmatic entry)

**Status: ✅ Implemented.** Expose a one-call build function so `perfect-map-builder` can run the SA per-object LOD
stage in-process.

## What exists

`createSaLodAdapter(game, gameDir, config)` returns `{ resolvePairs, report, finalize }`; `cli.ts` calls
`adapter.finalize(outDir, adapter.resolvePairs())`. `finalize`'s `writeBuild` already `cpSync`-mirrors the whole
game tree (full passthrough).

## Change

- Add a wrapper `buildSaLods(options)` (e.g. `src/build.ts`) that composes the current CLI flow:
  ```ts
  export interface BuildSaLodsOptions {
    gameDir: string;
    outDir: string;
    config?: Partial<LodConfig>; // texScale, holeFillModels, holeLodDraw — defaults from lod.config.ts
  }
  export function buildSaLods(options: BuildSaLodsOptions): BuildStats;
  ```
  It builds the adapter, resolves, and finalizes — returning the `BuildStats` (cloned/filled/excluded counts).
- `cli.ts` becomes a thin wrapper over `buildSaLods` (keeps `--game`/`--out`/`--tex-scale`).
- **Publish** package.json `exports`: `"./build": "./src/build.ts"`.

No behaviour change — this is the existing Phase 1 + Phase 2 pipeline behind one function.

## Testing

`resolve` / `fill-holes` / `report` units already cover the logic; add a unit asserting `buildSaLods` threads
`config` (e.g. `texScale`) into the adapter.
