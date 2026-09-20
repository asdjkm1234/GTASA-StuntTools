# 096/06 — Build-time mod-car ledger

**Priority P1, independent — can run any time before 05 consumes it. A tool + pack + one runtime reader;
no engine surface.**

## Why a ledger (and not a heuristic)

No provenance survives the build: mods are merged by `vehicle-installer` and their rows are
indistinguishable from stock (verified against a built `carcols.dat` — no marker, no residue). The old
runtime-modloader `moddedAssets` is gone with its postmortem. The alternative — inferring "mod" from
vertex count / `index16 === false` in the `.osm` DESC — is honest but is a heuristic standing in for a
fact the build KNOWS and throws away. The build already collects the fact:
`tools/vehicle-installer/src/install.ts:52` keeps `models: Set<string>` of every mod-installed slot and
never writes it. Write it.

## Tasks

1. **Emit** `data/vehicle-mods.txt` from `vehicle-installer` exactly the way `vehicle-features.txt` is
   emitted (`install.ts` / `FEATURES_TABLE` pattern): one lowercase model name per line, `#` comments,
   sorted; written on every install run (including `--rebake`), empty file when no mods — absence and
   emptiness mean the same thing downstream.
2. **Ship it**: confirm the pmb/opensa-pack `data` chunk carries it into `build/<game>/opensa/data/`
   (the same route `vehicles.ide` travels); if the data packer whitelists files, add it there — in the
   same change.
3. **Runtime reader**: a tiny parser next to the other text parsers
   (`packages/renderware/src/parsers/text/` — mirror `vehicle-features.parser.ts`), consumed by the
   video module through the VFS at setup (app layer reads it; no engine system needs it). Missing file →
   empty set, no warning (stock installs are legitimate).
4. **Contract row** in `docs/contracts/vehicles.md` (the same-change rule for name-carrying files): the
   file name, the format, who writes/reads it, and the misspelling behaviour — a wrong name silently
   degrades video mode's car preference to "no preference", nothing else in the game reads it.
5. Tests: installer emits the set (extend the existing install test fixture); parser round-trip;
   negative first (absent file, malformed line skipped).
6. **Rebuild note**: existing builds do not have the file until re-run through the installer/pmb `mods`
   stage — record which build the first field check read (the standing which-pak rule).

## Acceptance / verification

- `vehicle-installer` over `mods-src/original` emits the 12 known mod-car slots; gostown/carcer/anderius
  emit their 2 each (the corpus counted in research).
- The built `build/original/opensa/data/vehicle-mods.txt` exists and matches; the video module logs
  `(mod)` on those models in its scene lines.
- Ledger numbers: per-game ledger counts; installer runtime delta (should be ~0).

## Risks / notes

- `--strip` and partial `--only` rebakes must not TRUNCATE the ledger to the subset they touched — the
  emit must reflect the full installed set (read-modify-write or regenerate from the mods dir), and a
  test pins it.
- Do not put the ledger in the pak manifest — "nothing about a vehicle lives in the pak" is a standing
  restriction (`docs/restrictions/build-vs-runtime.md`); the TEXT `data/` route is the sanctioned one.

## What shipped differently (2026-07-31)

- **The runtime reader (task 3) had already shipped with 05**, so this phase was the tool, the format and
  the contract row. Nothing about it changed on arrival.
- **The ledger is written on EVERY install run, including one that installed nothing** — task 1 asked for
  that and it is worth restating why it survived review: present-and-empty says "this build looked and found
  no mod cars", absent says "this build predates the ledger". Downstream the two mean the same; to a
  diagnosis they do not.
- **Task 2 (the pack) needed no change at all**: the built tree copies `data/` whole, which
  `vehicle-features.txt` already proves. It was confirmed rather than implemented.
- The formatter lives in its own `tools/vehicle-installer/src/mods-table.ts` rather than beside
  `formatFeatureTable` — that file is about a MOD's `features.txt`, and a ledger of slots is a different
  subject.
