# 005 — Node API (programmatic entry)

**Status: ✅ Implemented.** Expose the installer as an importable function so `perfect-map-builder` (and any other
tool) can chain it in-process, not only via the CLI.

## What exists

`install(options: InstallOptions): void` already lives in `src/install.ts` and does the whole job:

```ts
export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
}
```

It wipes `outPath`, `cpSync`-mirrors the whole `gamePath` tree, then layers the `inPath` mods alphabetically — a
**complete** drop-in build (full passthrough, safe to chain).

## Change

- Add a package.json `exports` entry so it's importable as `@opensa/mod-installer/install`:
  ```json
  "exports": { "./install": "./src/install.ts" }
  ```
- `cli.ts` keeps parsing flags and calling `install(...)` — no logic moves.

No behaviour change; this is purely publishing the existing API.

## Testing

Existing install tests already cover the function. Add a one-liner asserting the package export resolves (import
path smoke) if the repo has an export-surface test convention.
