# 005 — Node API (programmatic entry)

**Status: ✅ Implemented.** Expose the installer as an importable function so `perfect-map-builder` can chain it
in-process.

## What exists

`install(options: InstallOptions): void` in `src/install.ts`:

```ts
export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** Reduce the output to ONLY the installed vehicles (gta3.img + the four data files). Default off. */
  strip?: boolean;
}
```

Wipes `outPath`, `cpSync`-mirrors the whole `gamePath` tree, then installs each vehicle (dff/txd → gta3.img;
settings → handling.cfg / vehicles.ide / carcols.dat / carmods.dat). Full passthrough (the pipeline runs it
**without** `strip`, so the complete tree is carried forward).

## Change

- Add package.json `exports`: `"./install": "./src/install.ts"` → `@opensa/vehicle-installer/install`.
- `cli.ts` unchanged (still calls `install`).

No behaviour change. The orchestrator **skips** this stage when `mods-src/vehicles/` is empty.

## Testing

Existing install tests cover the function; add an export-resolves smoke test if the repo convention has one.
