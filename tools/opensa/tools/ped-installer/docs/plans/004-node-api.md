# 004 — Node API (programmatic entry)

**Status: ✅ Implemented.** Expose the installer as an importable function so `perfect-map-builder` can chain it
in-process.

## What exists

`install(options: InstallOptions): void` in `src/install.ts`:

```ts
export const DEFAULT_PLAYER = 'BMYPOL1';
export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** Player ped model to always keep when stripping (default {@link DEFAULT_PLAYER}). */
  player?: string;
  /** Reduce the output to ONLY the installed peds (gta3.img + peds.ide) + the player ped. Default off. */
  strip?: boolean;
}
```

Wipes `outPath`, `cpSync`-mirrors the whole `gamePath` tree, installs each ped (dff/txd → gta3.img; new line →
peds.ide). Full passthrough (the pipeline runs it **without** `strip`).

## Change

- Add package.json `exports`: `"./install": "./src/install.ts"` → `@opensa/ped-installer/install`.
- `cli.ts` unchanged.

No behaviour change. The orchestrator **skips** this stage when `mods-src/peds/` is empty.

## Testing

Existing install tests cover the function; add an export-resolves smoke test if the repo convention has one.
