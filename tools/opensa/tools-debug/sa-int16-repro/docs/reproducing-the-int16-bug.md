# Reproducing the int16 "ghost barriers" bug — the full plan

The deterministic reproduction of the SA `IplDef` int16 truncation bug. It is the pass/fail **oracle** for the
[perfect-map ASI project](../../../asi/perfect-map/docs/plans/readme.md) — the RE ([001](../../../asi/perfect-map/docs/plans/001-reverse-engineering.md)),
the patch ([004](../../../asi/perfect-map/docs/plans/004-limit-patches.md)), and the pipeline flip ([006](../../../asi/perfect-map/docs/plans/006-pipeline-integration.md))
are all measured against it. You cannot confirm a fix you can't reliably trigger. **Status: shipped** as
`@opensa/sa-int16-repro` (this tool) + a `--allow-text-row-overflow` full-build path in perfect-map-builder;
in-game flip confirmation is the only piece left, and it needs the user's Wine install.

## Context

The ghost-barriers post-mortem ([ghost-barriers.md](../../../docs/open-issues/fixed/ghost-barriers.md)) reproduced this
the hard way: the full perfect-map build (~22k rows) flips the bug at **exactly 2^15 = 32,768** total permanent
text-IPL instances map-wide (bisected: **31,300 rows → clean; 33,210 → bug**). Symptom: script-gated
`barriers2.ipl` roadblocks appear permanently at the Hampton Barns bridge on any save, and teleport-then-save
near the bridge crashes. Root: `CIplStore::IncludeEntity` (0x404C90) truncates the building-pool index to int16;
`RemoveIpl` then deletes entities by that wrapped range.

Two problems make the full build a poor day-to-day oracle:

1. **Slow** — a full map build takes minutes; we'll rebuild the repro dozens of times while bringing up the patch.
2. **Entangled** — the full build stresses all FOUR unbounded structures at once (int16 `IplDef`,
   `gpLoadedBuildings` 4096/scene, `IplEntityIndexArrays` 40 slots, FLA×OLA `LinkLods`). Any of them can crash
   first, so a crash isn't attributable to int16 without controlling the other three.

The dial fixes both: **fast, deterministic, and it isolates the int16 ceiling as the ONLY variable**, with the
full build kept as the guaranteed-correct fallback.

## How it works (shipped)

The `@opensa/sa-int16-repro` dial (see the [tool README](../README.md)) copies a **built** SA game dir and tops it
up to a chosen total `N` permanent text-IPL rows:

- **Row-count dial.** `--rows N` inflates the map-wide total with trivial dummy instances, so we build just below
  and just above 2^15 on demand. This is the acceptance instrument for 004: patched → no flip at ANY `N`.
- **Isolation, logged not assumed.** Filler rows go into dense text IPLs of ≤ 4000 rows each (under SA's 4096
  `gpLoadedBuildings` per-file boot buffer); the 39-slot `IplEntityIndexArrays` ceiling is asserted
  (`--allow-slot-overflow` to force past it); the single-adjuster requirement is documented (the operator's
  responsibility). So a crash past 2^15 is attributable to int16 alone.
- **Hygiene traps dodged.** The dummy model id is **harvested from the base build's own IPLs** — guaranteed
  loadable, so the id-match trap (an IDE whose ids don't match its IPL silently skips all instances → false
  "clean") can't fire. No seeded stream cluster is needed: the stock binary streams already corrupt once `N` >
  32,767 (**confirmed in-game — the bug reproduces from the row count alone**).

The full-build fallback: since 2026-08-09 `perfect-map-builder` needs no flag for this — the int16 row guard
and `--allow-text-row-overflow` were both deleted (the `sa` target always runs the asi that lifts the
ceiling), so an intentionally over-2^15 full build is just a build.

## Worked example (no perfect-map-builder needed)

Stock `game-src/original` = **9,268 rows / 30 slots** (measured); topping to 33k adds 6 filler areas → 37/39
slots, inside the isolation bound.

```sh
# buggy build (crosses 2^15) — expect the ghosts / crash
npx tsx tools-debug/sa-int16-repro/src/cli.ts --game ./game-src/original --out ./NO_COMMIT/repro-33k --rows 33000
# clean control (stays below 2^15) — expect no ghosts
npx tsx tools-debug/sa-int16-repro/src/cli.ts --game ./game-src/original --out ./NO_COMMIT/repro-32k --rows 32000
```

## In-game procedure (Wine) & detection oracle

Full checklist in the [tool README](../README.md). In short: fresh install + fresh save, exactly one limit
adjuster, modloader `CINFO.BIN`/`CColAccel` caches disabled; load → teleport to the Hampton Barns bridge → save →
reload. **Buggy** = ghost `barriers2` at the bridge on an all-bridges-open save OR a teleport-save crash;
**clean** = neither over K cycles. Cross-check: the buggy build + real `ProperFixes.asi` → clean (bounds the fix).

## Status / what's left

- [x] Row-count dial (`@opensa/sa-int16-repro`, `--rows N`), isolation logging + slot-cap assert.
- [x] Full-build safety-net path (`perfect-map-builder --allow-text-row-overflow`).
- [x] **Confirmed in-game as the oracle:** the 33k build reproduces the ghost barriers with FLA/OLA, and the
      `asi/perfect-map` fix makes it clean — this dial is what proved the fix works (plan 004).

## Measurements / notes

**Tooling shipped (2026-07-09).** `@opensa/sa-int16-repro` (the row-count dial) + the `--allow-text-row-overflow`
guard bypass in perfect-map-builder. Green: tsc + eslint + 5 unit tests; end-to-end proven on the real 1.4 GB
stock base (9,268 → 33,000 rows exact, 37/39 slots) in ~4 s (APFS copy-on-write). The bug reproduces from the row
count alone — no seeded stream cluster needed. **Used as the acceptance oracle for the int16 fix (works in-game).**

- exact flip point re-confirmed on this install: **pending Wine bracket** (expect 2^15 = 32,768).
- dial time vs full build: base copy + IMG rebuild ≈ seconds, vs a full map build ≈ minutes.
- isolation counts: logged per build (base/added/final rows, slots `/39`); filler ≤ 4000 rows/area keeps
  `gpLoadedBuildings` clear; single adjuster is the operator's responsibility (documented, not auto-checked).
- **open:** the ideal fast base is one already near 2^15 (few filler areas → few new slots). The full ~22k/37-slot
  perfect build can't be topped to 33k inside 39 slots — use a leaner base (stock is ideal, above) or the
  `--allow-text-row-overflow` full-build path.
