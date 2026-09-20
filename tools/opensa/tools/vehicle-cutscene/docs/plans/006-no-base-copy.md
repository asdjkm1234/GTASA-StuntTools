# 006 — `--no-base-copy`: emit only what changed

**Status: DONE 2026-08-15**, steps 1–4. Measured numbers below and in
[`docs/benchmarks/tools/2026-08-15-vehicle-cutscene-no-base-copy.md`](../../../../docs/benchmarks/tools/2026-08-15-vehicle-cutscene-no-base-copy.md).

The tool copies the whole `--game` tree into `--out` and then rewrites
three files inside it. That is right for the pmb pipeline, where the output IS a game, and wrong
everywhere else — most sharply on Windows, which is where
[`apps/cutscene-converter`](../../../../apps/cutscene-converter/docs/plans/001-architecture.md) will run.

## Why (measured)

| | |
| --- | --- |
| `--game` tree copied on every run | **1.4 GB** |
| what the run actually writes | `models/cutscene.img` 337 MB · `anim/cuts.img` 270 MB · `data/txdcut.ide` 514 B |

On macOS the copy is nearly free — APFS is copy-on-write, which is why nobody noticed. **NTFS has no
copy-on-write**, so on the standalone app's target platform every conversion physically copies 1.4 GB
before doing 5 s of work. The flag is not a convenience for the facade; it is what makes the app
usable at all.

It is also exactly the shape of the field delivery we have been doing by hand all along: those three
files are what gets dropped into the bottle.

## The name

**`--no-base-copy`, not `--strip`.** `--strip` is already taken by three tools
(`vehicle-installer`, `ped-installer`, `lod-trees-generator`) for a different idea — "keep only what
was installed". A flag that carries behaviour may not be ambiguous across the repo
(`docs/contracts/` exists for exactly this reason).

## Design

Default behaviour does not change — pmb keeps getting a full game tree. With the flag:

1. **No wipe, no copy.** `rmSync(out)` + `cpSync(game → out)` are skipped. **`--out` is never wiped
   under this flag** — the whole point is that it is a folder of the user's choosing, possibly not
   empty, and destroying it would be the worst thing this tool could do.
2. **Read from `--game`, write to `--out`.** Today the run opens `models/cutscene.img` out of the
   COPY; it must open it from the game tree. `patchTxdcut` likewise reads the game's `data/txdcut.ide`
   and writes the patched row set to `--out`. `patchCutsceneAnims` already reads from the game, so it
   needs nothing.
3. **Create the three parent folders** (`models/`, `data/`, `anim/`) and nothing else.
4. **Refuse `--out` == `--game`.** Writing into the live game is a different feature ("install"), not
   this one, and doing it by accident is unrecoverable. `guardOut` grows this case.
5. **Everything else is identical** — same conversion, same TXD route, same two scene-value passes,
   same summary. The flag decides only what lands on disk.

## Steps

- [x] **1. The flag and the emit split.** `--no-base-copy` in `cli.ts`, `noBaseCopy` in
      `CutsceneInstallOptions`; `installCutscene` takes its inputs from `--game` and writes only the
      three outputs. Verification: unit test over a temp tree asserting the output contains EXACTLY
      `models/cutscene.img`, `data/txdcut.ide`, `anim/cuts.img` and nothing else; a second asserting
      a pre-existing unrelated file in `--out` SURVIVES the run.
      **Done**: both assertions live in one test (`--no-base-copy` emits the three written files and
      leaves the rest of `--out` alone), and the `notes.txt` planted in `--out` comes back unchanged.
      Both modes now READ from `--game` — in the copy mode the copy is the game byte for byte, so one
      read path serves both and they cannot drift apart. The one design call the plan did not
      anticipate: `anim/cuts.img` is written even when neither scene pass touched it, because the copy
      mode always leaves one in `--out` and a delivery set that is sometimes three files and sometimes
      two cannot be checked.
- [x] **2. The refusal.** `--out` == `--game` (after `resolve`, case-insensitively on win32) throws
      with a message naming the risk. Verification: negative test first, per the repo's test order.
      **Done, one layer down**: the tool adopted `@opensa/tool-kit/game-dir`'s shared `guardOut` (whose
      own doc invited exactly that) instead of importing `vehicle-installer`'s private copy, and the
      case folding went in THERE — unconditionally, on every platform, so the guard behaves and tests
      the same everywhere. The asymmetry is the argument: a false refusal costs a rename, a missed
      match overwrites the user's install, and under this flag there is no wipe to warn anybody first.
- [x] **3. Byte parity with the copy path.** The three emitted files must be byte-identical to what a
      full-copy run produces from the same inputs. Verification: a test that runs both modes over the
      same fixture game and diffs the three outputs — this is the load-bearing check, because it is
      what lets the app and pmb share one converter.
      **Done twice over**: the unit test (fixture tree seeded with a real `synd_4a.ifp` so both scene
      passes run), and the real 23-car fleet — all three SHA-256s match, recorded in the benchmark. The
      unit test was itself checked against a deliberate lean-only mutation and failed as it should.
- [x] **4. Docs.** `docs/commands.md` row, the tool's `001-architecture.md` output section (it already
      says the tool writes three outputs; say when it writes ONLY them).

## Numbers, measured 2026-08-15 (macOS/APFS, `game-src/original` + `mods-src/original/vehicles`)

| Measure | Base copy | `--no-base-copy` |
| --- | ---: | ---: |
| Wall-clock (two runs) | 4.556 s · 3.426 s | **2.633 s · 2.353 s** |
| Bytes in `--out` | 1.72 GiB | **579 MiB** |
| Files in `--out` | the whole game tree | **3** |

Both runs: 23 converted, 0 errors, `cutscene.img` 25.7 → 321.5 MB, 4 wheel stashes sunk, 2 actors
seated — and the three files byte-identical (SHA-256s in the benchmark).

**The Windows figure is still missing, and it is the one that matters.** APFS copy-on-write keeps the
base copy cheap here, so ~1.1–1.9 s is a lower bound on what the flag saves; NTFS has no such thing.
The standalone app's first real run supplies it.

## Risks

- **The tool currently derives some state from the copied tree.** Step 3's byte-parity test is what
  catches any read that silently depended on `--out` being a game.
- A user pointing `--out` at a folder inside their game (`.../GTA San Andreas/out`) gets a correct
  result and a confusing tree. Not an error, worth a line in the app's UI rather than a guard here.
