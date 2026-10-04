# @opensa/sa-int16-repro

The fast, deterministic **repro dial** for SA's int16 building-pool truncation — the "ghost barriers" bug
([post-mortem](../../docs/open-issues/fixed/ghost-barriers.md)). It is the pass/fail **oracle** for the
[perfect-map ASI project](../../asi/perfect-map/docs/plans/readme.md): you cannot confirm a fix you cannot
reliably trigger. Full reproducing plan: [docs/reproducing-the-int16-bug.md](./docs/reproducing-the-int16-bug.md).

## The bug in one paragraph

SA stores building-pool indexes as **int16** in `IplDef::firstBuilding/lastBuilding`
(`CIplStore::IncludeEntity` @0x404C90). Permanent **text-IPL** instances fill the pool's low indexes at boot.
Once there are **more than 32,767** of them (2^15), every binary-streamed instance lands above int16 range,
the recorded ranges wrap negative, and stream-out (`RemoveIpl`) deletes/keeps arbitrary entities — the ghost
`barriers2` roadblocks at the Hampton Barns bridge, plus teleport-save crashes. Bisected to the exact flip:
**31,300 rows → clean; 33,210 → bug.**

## What the dial does

Given a **built** SA game dir and a target total row count `N`, it copies the build and tops it up to `N`
permanent text-IPL rows with trivial dummy instances, so you can build **just below** and **just above** 2^15
on demand. It keeps the other three placement structures **in-bounds** so a crash past 2^15 is attributable
to int16 alone:

- **filler rows** go into dense text IPLs of ≤ 4000 rows each (under SA's 4096 `gpLoadedBuildings` per-file
  boot buffer), placed far outside the map — pure pool-index ballast, never rendered.
- the **39-slot** `IplEntityIndexArrays` ceiling is asserted (`--allow-slot-overflow` to force past it).
- the dummy model id is **harvested from the base build's own IPLs** (guaranteed loadable) — sidesteps the
  id-match hygiene trap.

The bug reproduces **from the row count alone** — the stock binary streams corrupt once the map-wide total
crosses 2^15, so no seeded stream cluster is needed (confirmed in-game).

## Usage

```sh
# buggy build (crosses 2^15) — expect the ghosts / crash
tsx tools-debug/sa-int16-repro/src/cli.ts --game ./build/original/sa --out ./NO_COMMIT/repro-33k --rows 33000

# clean control (stays below 2^15) — expect no ghosts
tsx tools-debug/sa-int16-repro/src/cli.ts --game ./build/original/sa --out ./NO_COMMIT/repro-32k --rows 32000
```

Flags: `--rows N` (target total), `--model-id`/`--model-name` (override the dummy), `--allow-slot-overflow`.
The command logs the isolation numbers (base/added/final rows, slots `/39`, whether 2^15 was crossed).

> **Pick a base already near 2^15.** Filler areas cost one text-IPL slot each. Topping the full ~22k/37-slot
> perfect build up to 33k needs ~3 filler areas → ~40 slots and the tool will refuse (slot overflow would
> mask int16). Point `--game` at a leaner base, or use the full-build safety-net path below.

## Full-build safety-net repro

The full over-budget build is the guaranteed-correct fallback (it is how the bug was found). Since 2026-08-09
it needs no flag — pmb no longer guards the int16 row count at all (the target always runs `perfect-map.asi`,
which lifts it), so an over-budget build is simply a build:

```sh
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in <over-budget-mods-src> --out ./build/original
```

## In-game procedure (Wine) & detection oracle

1. **Fresh install, fresh save.** Copy `--out` over the SA install (Wine prefix). Ensure exactly **one** limit
   adjuster (FLA **or** OLA, not both — a double `LinkLods` patch is its own crash). Disable modloader
   `CINFO.BIN`/`CColAccel` caches. Start from an **uncontaminated** save — a contaminated one is a false signal.
2. **Load, teleport to the Hampton Barns bridge**, save near it, reload.
3. **Oracle — buggy** if EITHER: the `barriers2` props (STOP signs / cones / "DANGER NO ACCESS ACROSS BRIDGE")
   appear at the bridge on a save where all bridges are open, OR the teleport-then-save crashes.
   **Clean** if neither over K save/teleport cycles.
4. **Cross-check** the buggy build with the real `ProperFixes.asi` installed → should be clean (bounds the fix).

Run the clean control build through the same steps: it must NOT ghost. Same `--rows` → same result
(deterministic).
