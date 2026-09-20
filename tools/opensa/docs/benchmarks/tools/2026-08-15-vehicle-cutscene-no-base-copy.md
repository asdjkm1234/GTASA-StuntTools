# vehicle-cutscene — `--no-base-copy` vs the base copy (plan 006)

**Run 2026-08-15, the user's macOS machine (APFS).** The same 23-slot fleet built twice from identical
inputs, once into a full game tree and once into the three files the tool actually writes. The point of
the run is the byte comparison; the wall-clock is the secondary figure and macOS flatters it.

## Conditions

- Base: `game-src/original` (stock 1.0 tree, 1.4 GB). Mods: `mods-src/original/vehicles` (2.9 GB, the
  census donor set). Both runs read the same trees, back to back, warm cache.
- Flags: `--self-contained-txd` on both — the standalone-measurable configuration and the delivery
  shape the standalone app will use (over a stock base the txdp parents are stock).
- Tool: `npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in
  mods-src/original/vehicles --out <dir> --self-contained-txd [--no-base-copy]`, source at `9229f379`
  plus this plan's working tree.
- Both runs: **23 converted, 0 skipped, 0 errors**, 694 paint materials on 23 models, 21 plates,
  149 092 025 B of cs TXDs, `cutscene.img` 25.7 MB → 321.5 MB, 4 wheel stashes sunk, 2 actors seated.

## Headline numbers

| Measure | Base copy | `--no-base-copy` |
| --- | ---: | ---: |
| Wall-clock, run 1 | **4.556 s** | **2.633 s** |
| Wall-clock, run 2 | **3.426 s** | **2.353 s** |
| Bytes on disk in `--out` | **1 806 064 KiB (1.72 GiB)** | **592 956 KiB (579 MiB)** |
| Files in `--out` | the whole game tree | **3** |

The three emitted files, identical in both modes:

| File | Bytes |
| --- | ---: |
| `models/cutscene.img` | 337 084 416 |
| `anim/cuts.img` | 270 096 384 |
| `data/txdcut.ide` | 514 |

## The load-bearing check: byte parity

`shasum -a 256`, copy-mode output vs `--no-base-copy` output:

| File | SHA-256 | |
| --- | --- | --- |
| `models/cutscene.img` | `d3443ef9dc92d2a28e979ce71c59bae29a6b182b1b1198c2a693f2a1048a3db4` | MATCH |
| `anim/cuts.img` | `042264dc525aa780503e0701f20c6e7096fcc6c6bcb9fa487feaa696abbc56f9` | MATCH |
| `data/txdcut.ide` | `98ed471dcefbe05be6460a862e13d17f1478cb6464945876f945790148835a24` | MATCH |

`anim/cuts.img` is the same SIZE as the vanilla input (the passes edit values in place) but not the same
file — vanilla is `28d9b900…`. So the parity above is over patched content, not over an untouched copy.

## What this run does NOT measure

**Windows.** The whole reason the flag exists is that NTFS has no copy-on-write, so the 1.4 GB base copy
is a real 1.4 GB of writes there, while APFS makes it cheap enough that the delta here is ~1.1–1.9 s.
Treat the macOS wall-clock as a lower bound on what the flag saves and let the standalone app's first
real run on Windows supply the figure that matters.
