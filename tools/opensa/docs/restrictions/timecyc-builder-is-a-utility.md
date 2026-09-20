# `timecyc-builder` is a utility, and no build stage may run it

**The rule** (the user's call, 2026-08-22, plan [104/03](../plans/104-timecyc24h-source/readme.md)):
`npm run timecyc` writes **one file, into `tools/timecyc-builder/merged/`**. It writes nowhere else — not
into `game-src/<game>/data/`, not into a build tree — and **it is not a step of `pmb` or of any other
build**. Getting its output into a game is a deliberate, separate act by whoever wants that table shipped.

**Whether anything catches you: NOTHING.** This is the silent kind twice over.

- A build stage that regenerated the table would exit 0 and simply produce a different sky. No guard, no
  test and no report line looks at where the sky came from. The one tell would be the boot line
  (`[timecyc] …`), and only if someone read it and knew what to expect.
- The tool writing into `game-src` is equally quiet: the file is not tracked (`game-src/` is gitignored
  whole), so it appears in no diff, and the build mirrors it into the tree without comment. It did exactly
  that until 2026-08-22 — `index.ts` wrote `game-src/original/data/timecyc_24h.dat` while the tool's own doc
  said the output went to `merged/`, and the code and the doc had disagreed for months.

## Why the rule, and what it protects

The three timecyc names resolve in a fixed order (`docs/contracts/mods.md` §2), and the builder's output
carries the **highest-priority** name. So a generated file sitting in a game tree outranks anything a mod
ships — including `timecyc24h.dat`, the file the `timecyc24h.asi` plugin format uses
([`gta-sa-original/timecyc24h.md`](../gta-sa-original/timecyc24h.md)). That is not a small preference: the
two tables differ by a mean |Δ| of 220.9 on `fogStart`, 154.4 on `farClip` and 73.9 on `lowClouds`, and their
`Alpha1`/`Alpha2` columns differ on every one of the 504 rows we sample.

A build that could regenerate the top-priority file would therefore be able to overrule every mod's sky
without anything saying so, and a rebuild would silently undo a mod author's work. Keeping the tool out of
the chain makes the winner a property of what is IN the tree, which a reader can see.

## Two related facts, so they are not re-derived

- **A build stage may still READ `game-src` freely.** The builder reads `game-src/<game>/data/timecyc.dat`
  as its base; the rule is about WRITING back, not about reading.
- **Our expansion is 21 weathers, and the format is 23.** `convertTo24h` skips `EXTRACOLOURS_1` /
  `EXTRACOLOURS_2` (they are not time-based), so `merged/timecyc_24h.dat` is 504 rows where both real 24h
  plugin files are 552. Our engine never reads weathers 21/22, so nothing is broken here — but the output is
  not a complete file of that format, and copying it into a real install would leave the two extracolour
  weathers unauthored. Recorded rather than fixed: we have no honest source for 24 hourly extracolour rows,
  and inventing them by repeating a keyframe would be a fabrication.
