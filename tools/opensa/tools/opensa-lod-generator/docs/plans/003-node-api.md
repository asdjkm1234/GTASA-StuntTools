# 003 — Node API (programmatic entry)

**Status: ✅ Implemented.** Expose a one-call build function so `perfect-map-builder` can run the OpenSA cell-LOD
stage in-process.

## What exists

`createGtaSaLodAdapter(game, gameDir, config)` returns `{ resolveCells, bakeCell, finalize }`; `stripOldLods(outDir)`
strips the stock `lod*` layer. `cli.ts main()` runs the loop inline: `resolveCells()` → `bakeCell()` per cell →
`finalize(outDir, baked)` → optional `stripOldLods(outDir)`. `finalize`'s `writeBuild` `cpSync`-mirrors the whole
game tree (full passthrough).

## Change

- Add a wrapper `buildOpensaLods(options)` (e.g. `src/build.ts`) that runs the whole loop:
  ```ts
  export interface BuildOpensaLodsOptions {
    gameDir: string;
    outDir: string;
    cellSize?: number; // pipeline uses 256
    stripLods?: boolean; // pipeline passes true (cell LODs replace the stock lod* layer)
    config?: Partial<LodConfig>;
  }
  export function buildOpensaLods(options: BuildOpensaLodsOptions): void;
  ```
  Internally: build adapter → `resolveCells` → bake all cells → `finalize` → `if (stripLods) stripOldLods`.
- `cli.ts` becomes a thin wrapper over `buildOpensaLods` (keeps `--game`/`--out`/`--cell`/`--strip-lods`).
- **Publish** package.json `exports`: `"./build": "./src/build.ts"`.

No behaviour change — the existing cell-bake + strip flow behind one function.

## Testing

Existing cell/merge/finalize/strip units cover the logic; add a unit asserting `buildOpensaLods` forwards
`cellSize`/`stripLods`.
