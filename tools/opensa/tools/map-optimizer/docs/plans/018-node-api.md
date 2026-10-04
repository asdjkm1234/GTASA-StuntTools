# 018 — Node API + shared pass config

**Status: ✅ Implemented.** Lift the CLI's flag→plugin composition into a reusable function + a shared config so
`perfect-map-builder` can run the optimizer in-process with **all passes on by default**.

## Problem

Today `cli.ts main()` builds the plugin list inline from flags (`--textures`, `--weld-seams`, `--stitch-gaps`,
`--refine`, …) and then calls `runPipeline(adapter, config, outDir)`. The composition is not reusable — a
programmatic caller would have to duplicate it. `runPipeline` + `createGtaSaAdapter` exist but aren't published.

## Change

1. **Shared pass config** (`run.ts` `DEFAULT_PASSES`): a typed `OptimizerPasses` object with a flag per pass. The
   base weld/dedupe/prune/normals/prelit/night pipeline always runs; on top of it **textures + stitchGaps +
   weldSeams default on**, and the experimental **`refine` defaults off** (opt in with `--refine`). Individual
   passes stay toggleable (`--no-<pass>`).
2. **`runOptimizer(options)`** wrapper (e.g. `src/run.ts`) that composes the plugin list from `OptimizerPasses`,
   builds the adapter, and awaits `runPipeline`:
   ```ts
   export interface RunOptimizerOptions {
     gameDir: string;
     outDir: string;
     game?: string; // label, default derived from gameDir basename
     passes?: Partial<OptimizerPasses>; // defaults: all on
     concurrency?: number;
   }
   export function runOptimizer(options: RunOptimizerOptions): Promise<RunReport>;
   ```
3. **`cli.ts`** becomes a thin wrapper: parse flags → `runOptimizer(...)`. A bare run (no pass flags) now enables
   everything; a flag like `--no-refine` can opt a pass out (keep the existing positive flags as aliases if simpler).
4. **Publish** in package.json `exports`: `"./run": "./src/run.ts"` (plus keep `./codec`, `./ir`).

Passthrough is already correct (the adapter mirrors the whole tree + rebuilds each `models/*.img`).

## Testing

- Unit: `runOptimizer` composes the expected plugin list from `OptimizerPasses` (all-on default; each toggle
  drops/adds its plugin). Reuse the existing pipeline/plugin tests for behaviour.
- The CLI keeps its current integration coverage.
