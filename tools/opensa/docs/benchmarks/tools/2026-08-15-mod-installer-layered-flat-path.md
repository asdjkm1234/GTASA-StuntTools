# mod-installer — the flat path across plan 011 (layered mod folders)

**Run 2026-08-15, the user's macOS machine (APFS).** Plan 011 taught `install()` to walk mod LAYERS; this
run answers the only question that mattered for the existing games: **does the FLAT path still produce the
same install?** It does, byte for byte.

## Conditions

- `npx tsx tools/mod-installer/src/cli.ts --game game-src/original --in mods-src/original/mods --out <dir>`
- BEFORE = `0b3e0b7c~1` (the tool's `src/` checked out at the commit before the layer walk), AFTER = the
  layer walk, run back to back over the same inputs.
- `mods-src/original/mods` was **flat, 62 mod folders** for both runs of the A/B below. It held 61 earlier
  the same afternoon — the user added `8.1 SPC Cars [vehicle]` at 17:21, mid-session, which is also what
  makes the timings below unusable (see the last section).

## The result that matters: identical output

`diff -rq <before-tree> <after-tree>` → **no differences**, over 393 files / 1 892 164 KiB. Both runs
report the same work:

| | |
| --- | --- |
| Mods applied | **62** (13 baked) |
| Entries merged into `gta3.img` / loose `.txd` | **3 434** |
| Mod IPLs folded into a stock host | 10 (634 rows) |
| Stock inst blocks compacted | 2 (848 rows) |
| Output tree | 393 files · 1 892 164 KiB |

The AFTER run adds one line of output and nothing else: `mod-installer: flat mods — 62 mod(s)`, printed
before anything is applied. Every other log line is identical (verified by diffing the two logs with that
line removed).

## Wall-clock: NOT usable from this session, and why

| Sample | BEFORE | AFTER |
| --- | ---: | ---: |
| 1 | 68.48 s | 91.98 s |
| 2 | 68.98 s | 81.81 s |
| CPU (user + sys), every complete run | 18.4 + 25.0 … 18.5 + 26.4 s | 18.2 + 23.9 … 19.6 + 26.9 s |

**The CPU time is flat across both versions and the wall-clock is not, which is the signature of a busy
disk rather than of a code change** — the machine was writing a mod folder into `mods-src` during the
window, and a same-code repeat pair spread 68 s / 88 s on its own. One same-code run even came back in
15.9 s with a short 1.78 GB tree, i.e. it did not do the same work at all.

So: no wall-clock claim is made here in either direction. The change adds one directory listing of a
62-entry folder to a run that copies 1.8 GB, and the byte-identical output is the check that was actually
needed. If a timing figure is ever wanted for this stage, take it on a quiet machine and record the mod
count with it — the mod set changed under this very measurement.
