# 2026-08-18 — Cutscene Converter 0.4.0: the first Windows runs

**Tool:** `apps/cutscene-converter` (plan 002), a facade over `@opensa/vehicle-cutscene` forked as a child
process. **Build:** `63bf6fc4` for the Windows figures, `99c8595a` for the released artifact (same code path;
the difference is the loose-file verdict, the footer link and the tutorial).
**Machines:** the user's Windows 11 box (the two figures that matter) and the dev Mac (Darwin 25.6, Node
24.15) for everything measurable here.

## Windows 11 — the two numbers the chain was designed around

| | |
| --- | --- |
| Cold start, double-click → window | **~5 s** (stopwatch — see below) |
| Conversion, whole fleet | **~2 s** |

**Why the cold start is a stopwatch and not an instrument.** The portable exe unpacks ~85 MB into a temp
folder and only then starts our process, so `process.getCreationTime()` → `ready-to-show` cannot see the
unpack. That half IS logged (`window shown N ms after this process started`, visible when the exe is run
from a terminal); the whole figure has to be taken by hand. The conversion is timed properly, spawn to exit,
and printed by the app itself ("Conversion finished in N s").

## macOS — the halves that can be measured here

| | |
| --- | --- |
| Conversion, 23/23 slots (23 cutscene models, full fleet) | ~3.1 s, output 579 MB (`cutscene.img` 321 MB + `cuts.img` 257 MB + `txdcut.ide`) |
| Conversion, 2 donor cars (bobcat + bravura) | **0.9–1.1 s**, output 283 MB — the `cutscene-converter-drive.ts` run |
| Portable exe | 89 008 404 B (84.9 MiB), sha256 `bbef5d2fc4621aa19195b15899ff3d60f76e957e431cf71befb650cf41b2e950` |
| asar inside it | 199 198 B — 18 112 416 B before `!node_modules/**` (electron-builder packs the workspace ROOT's runtime deps by default) |
| Embedded plugin | `perfect-cutscene.asi` 18 944 B, sha1 `6f98053010ba0295ee867ddcbf18efb57512b5c0` |
| Renderer bundle | 196.6 KB (62.1 KB gzip) |
| App unit tests | 20, ~150 ms |
| `pack:win` (build + electron-builder, warm electron cache) | ~90 s |

## Reading

The conversion is not the cost — **the cold start is 2.5× the work it starts**. Both halves of that are the
portable format: the unpack of an 85 MB self-extracting exe, and Electron's own boot. A conversion an
`opensa-pack` engineer would call instant (2 s for a fleet the pipeline spends ~50 min on) sits behind five
seconds of getting the window up, and that is the number to attack if anyone ever complains about speed —
an installed build (NSIS) instead of a portable one removes the unpack, at the price of an installer.

Output size is the other honest figure: 283 MB for TWO cars, because `cutscene.img` and `cuts.img` are
rewritten whole rather than patched. `--no-base-copy` already cut what the run writes from 1.4 GB (a full
game-tree copy) to the three files; below that is a different design, not a tuning knob.
