# Removing the runtime modloader overlay + the vehicle DFF fallback

**Date:** 2026-07-28. **Baseline:** head `09575a3` (3064 tests green). The direction and its reasoning are in
[`postmortem/runtime-modloader-overlay.md`](../postmortem/runtime-modloader-overlay.md); this file records
what the removal actually changed, cost and bought.

## What changed

| Area                | Before                                                                            | After                                          |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Packages            | 9 (`packages/modloader` among them)                                                | 8 — the package is deleted                     |
| Boot                | `withModloader(vfs)` wrapped the VFS at `warmup` in `use-asset-boot.ts`             | the VFS reaches the game unwrapped             |
| Vehicle spawn       | `.dff`-first resolution → `.osm` OR a runtime RW parse (`vehicleCommon`)            | `.osm` only; no `.osm` ⇒ a named throw         |
| Off-thread build    | `vehicle-model-builder.ts` + `vehicle-model.worker.ts` (074/21)                     | deleted — nothing left to move off-thread      |
| Mixing rule         | `isModdedAsset` + `warnAsset` + the `onAssetWarning` config/host wiring             | deleted with the overlay that fed it           |
| Build-time helpers  | `loader.ts` / `data-merge.ts` / `mergeGtaDat` lived in the runtime package          | moved into `tools/mod-installer/src/`, their only caller |

**47 files, +189 / −1816 lines.** The deleted product code is 436 lines of overlay (`index`/`scan`/`settings`/
`merge`) plus 108 lines of worker handoff; the rest is their tests and the adapter's two dead methods.

## What it cost

- **A build with an unconverted car now fails loudly at spawn** instead of quietly loading a worse version of
  it. opensa-pack already names every car it failed to convert in its report, so the information was there —
  it just was not acted on. `vehicle-installer --rebake --only <model>` fixes one car in ~3.6 s.
- **Two tests moved rather than died**, because they needed the writer and the nx boundary forbids
  `type:engine → type:tool`: the whole-`handling.cfg`-row pin (081/02) and the converted-spawn gate now live in
  `tools/opensa-pack/src/vehicle-osm.test.ts`. `modloader-paths.test.ts` was deleted outright — its only claim
  not about the overlay (a `txdp` child inherits from its parent) is covered by
  `packages/renderware/src/archive/txd-chain.test.ts`.
- **In-browser modding is gone as a shipped capability.** It had no field use in this project and the
  postmortem records the shape a revival would have to take.

## What it bought

**Tests:** 3064 → 3022 green (the deleted package's own suite plus the four overlay-path cases; the two above
were moved, not lost). `tsc -b` and `eslint` clean.

**Coverage** (`npm run test:coverage`, floors 86 / 77 / 88 / 86):

| metric     | before (floors re-armed 07-18) | after      |
| ---------- | ------------------------------ | ---------- |
| statements | 88.18 %                        | **90.62 %** |
| branches   | 78.57 %                        | **81.19 %** |
| functions  | 90.72 %                        | **92.32 %** |
| lines      | 88.12 %                        | **90.57 %** |

**Bundle** (`npm run build:prod`, same machine, HEAD `09575a3` vs the change):

| chunk                | before                    | after                     | delta                |
| -------------------- | ------------------------- | ------------------------- | -------------------- |
| `vehicle-model.worker` | 39.13 kB                | **gone**                  | −39.13 kB            |
| `main`               | 275.33 kB / 90.36 kB gzip | 268.97 kB / 88.18 kB gzip | −6.36 kB / −2.18 kB  |
| `engine-canvas-host` | 2765.39 kB / 1025.24 kB gzip | 2763.71 kB / 1024.67 kB gzip | −1.68 kB / −0.57 kB |

The overlay was in `main` (it ran at boot); the RW vehicle parse stays in `engine-canvas-host` because props,
clutter and animated map objects still build from DFF clumps at runtime — which is why that chunk barely
moves. The worker chunk disappearing is the honest headline: a whole build path, and a request the frame loop
had to be protected from, no longer exists.

**Not measured:** in-game frame time. Nothing was expected there and nothing was claimed — on a converted
build the removed path never ran. The one runtime behaviour that changed is the throw, which is covered by a
test rather than a benchmark.

## Note for the next reader

This closes roadmap item 2 (`vehicle-model-builder`'s unattributed worker handoff, 19–225 ms of `other` on
boot/spawn frames) **by deletion rather than by measurement** — the door it was going to open is walled up.
If those `other` frames persist, the cause is elsewhere and the benchmark note in
`docs/benchmarks/opensa-engine/2026-07-27-ingame-after-texture-upload-fix.json` now points at a suspect that
no longer exists.
