# 005 — Node API + full-tree mirror (pipeline passthrough)

**Status: ✅ Implemented.** Two changes so `perfect-map-builder` can chain this tool without losing data.

## Problem

1. **Not published** — `run(options: BuildOptions): void` exists in `src/build.ts` but isn't exported via
   package.json, and `cli.ts main()` parses flags inline before calling it.
2. **Non-modloader output is partial** — the default `--out` mode writes only its own files (repacked
   `models/gta3.img`, `data/maps/lod_procobj.{ide,ipl}`, stripped `procobj.dat`, patched `gta.dat`). It does **not**
   mirror the input game, so chaining would drop everything else (`player.img`, `gta_int.img`, `anim/`, `text/`, …).

## Change

1. **Full-tree mirror (non-modloader only).** `cpSync(gamePath → outPath)` before writing, so the `--out` build is
   a **complete** game dir. **`--modloader` mode unchanged** (emits only `lod/` + `hd/` mod files — per the user:
   with `--modloader` just the modified files; without it, a full copy of the input).
2. **Publish** the existing entry: package.json `exports` `"./build": "./src/build.ts"`, so callers use
   `run(options: BuildOptions)`:
   ```ts
   export interface BuildOptions {
     gamePath: string;
     outPath: string;
     inPath?: string; // HD procobj folder (mods-src/procobj); absent path or no .dff ⇒ treated as omitted
     modloader?: boolean; // default false → full mirror
     prelight: boolean; // the pipeline runs bare prelight (no info file)
     prelightInfo?: PrelightInfo;
     config: ProcObjLodConfig; // textureSize 128 in the pipeline, tris, drawDistance, procObjMax, procObjHeight
   }
   ```
   (Optionally add a thin `buildProcobjLods(options)` alias matching the trees tool's naming for symmetry.)
3. **`cli.ts`** stays a thin flag-parsing wrapper over `run`.

## Testing

- Integration: a synthetic non-modloader run → assert a non-procobj input file is carried over verbatim **and** the
  `lod_procobj.*` additions exist. Modloader mode still emits only `lod/`+`hd/`.
