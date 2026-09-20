# The `sa` build stopped booting because the DELIVERY reverted the install's FLA ID pools

**✅ FIXED 2026-08-18, field-confirmed the same hour.** The bottle crashed at boot on every attempt with an
identical heap fault. Cause: the delivery copied the **whole tree root** into the bottle, so
`fastman92limitAdjuster_GTASA.ini` came from `mods-src`' copy of the adjuster mod — and that copy never
carried the field raise of 2026-08-10 (`TXD 6000 / COL 400 / IPL 1024`). The bottle went back to
`5000 / 280 / 256` while the build ships **5 177 `.txd` archives**. Restoring the captured configuration —
in the bottle AND in `mods-src`, so a build ships it — boots the game.

## Symptom

Every boot died ~14 s in, before the menu, with byte-identical registers across four attempts:

```
Unhandled exception at 0x7BF8F289 in ntdll.dll: 0xC0000005: reading location 0x84040008
    ESI: 0x84040000
    0x008241AA in gta_sa.exe   (CMemoryMgr free wrapper)
    0x0074E79A in gta_sa.exe   (inside _rpMaterialListStreamRead, 0x74E600)
```

`_rpMaterialListStreamRead` reads a DFF's material list; `0x8241AA` frees. A `free()` of `0x84040000` — a
value that is not a heap pointer at all next to the run's real ones (`0x1EEE6A44`, `0x0585FD50`) — is the
**late** symptom of a heap already damaged, which is exactly what CLAUDE.md's target rule predicts for an
exhausted FLA pool: *"exhausting one corrupts the heap at boot."*

Timeline from the bottle's own logs: launch → CLEO finishes loading scripts (~9 s) → 5 s of silence → exit.
modloader's last line is `Loading default shopping data "data\shopping.dat"`, which is where its verbose
startup logging ends — not where the game was.

## What it was

| | |
| --- | --- |
| Working install (captured 2026-08-10, `reference-install-config.md`) | `FILE_TYPE_TXD = 6000`, `FILE_TYPE_COL = 400`, `FILE_TYPE_IPL = 1024` |
| `mods-src/original/mods/sa/6. fastman92 limit adjuster 6.5 (stable)/…ini` | `5000` / `280` / `256` — the raise was never brought back into the repo |
| What the build needs (`models/*.img` of `build/original/sa`) | `.dff` 15 596 · **`.txd` 5 177** · `.col` 264 · `.ipl` 191 · `.ifp` 159 · `.dat` 64 of 64 |

The delivery that preceded the crash was the first to copy the tree ROOT (all 20 `.asi` + their `.ini`), not
just `models/` + `data/`. That is what put the repo's ini in the bottle — and it also deleted the bottle's
`logs/`, which is how the `--delete` was noticed.

**A second, independent signal was in the log all along**: FLA closes with `Number of memory changes made`, and
the crashed runs printed **3632** against the captured working install's **3712**. The adjuster was applying
LESS than the install is documented to apply, and that number is a one-line check.

## The false leads, in the order they were paid for

1. **The new `model_special_features.dat` block** (plan 011 shipped the same day). Cleared: the shipped-empty
   file crashed identically. Its arm was overwritten by the user's next re-delivery, so the arm was re-run.
2. **The rebake of the nine feature cars.** Cleared twice: all 794 entries of the `vehicles.img` family parse,
   the nine DFFs are byte-identical to their mod sources, and a from-scratch rebuild produced **byte-identical
   archives** (see below).
3. **A corrupt model in the tree.** Cleared: `gta3.img` 16 996 entries, `gta_int.img` 2 485, `player.img` 542,
   `vehicles` family 794 — zero parse failures.
4. **`lodtrees.txd` at 78.7 MB / 40 295 sectors** (it sizes SA's whole streaming buffer). Not new — plan 078
   records the same size.
5. **SA's `EXTRA_DIR_SIZE = 550` extra-objects directory**, whose overflow (`CDirectory::AddItem` drops the
   entry and `RequestSpecialModel` then reads an uninitialised position) is a perfect match for the crash
   site. Our archives contribute only **76** DFFs with no IDE row, so the 90 `Too many objects without
   modelinfo structures` lines in modloader's log are its own imports, not ours.
6. **The build itself.** A full `sa` rebuild at HEAD (11 m 28 s) into a separate `--out` produced
   `gta3.img`, `gta_int.img`, `player.img`, `cutscene.img`, `vehicles.img` and `vehicles2.img` **byte-identical**
   to the delivered tree. The pipeline is deterministic, the tree was not damaged, and the mods-folder
   renumbering of session 23 is proven to change nothing in the install result.
7. **modloader.** Disabling it as an arm did not reach the crash — it produced a DIFFERENT, real defect instead
   ([mod-inst-rows-folded-before-their-ide.md](./mod-inst-rows-folded-before-their-ide.md)).

## Why nothing caught it

`checkImgIdBudgets` (pmb) is the guard for exactly this, and it compares against **constants**:
`{ .txd 6000, .col 400, .ipl 1024 }` — the values the FIELD was raised to, not the values the tree it just
built will run under. 5 177 of a claimed 6000 passes; 5 177 of a real 5000 is a heap fault. Its own doc
comment already tells this story about TXD once before ("**And TXD was never 6000 here**"), which is how the
constant came to be right about the bottle and wrong about `mods-src`.

**The build ships the ini** (the adjuster is a mod, `mods-src/…/6. fastman92 limit adjuster 6.5 (stable)`), so
a pool raised only in the bottle survives exactly as long as nobody delivers the root. And `mods-src/` is
**gitignored** — the mod library is local by design — so raising it there fixes every future build on this
machine but is NOT a record anyone else (or a fresh checkout) inherits. The committed record is
`reference-install-config.md`; the only thing that can ENFORCE it is the guard below.

## The fix as applied

1. `FILE_TYPE_TXD = 6000`, `FILE_TYPE_COL = 400`, `FILE_TYPE_IPL = 1024` in the bottle, in both built trees
   and in **`mods-src`** so every future build ships them. Boot confirmed by the user the same hour.
   `mods-src/` is not committed, so this half of the fix lives on the machine, not in the repo.
2. Recorded as a delivery rule in [`reference-install.md`](../../gta-sa-original/reference-install.md) and as a
   rule a design must satisfy in [`docs/restrictions/sa-target.md`](../../restrictions/sa-target.md).

## The class is closed too (same day)

`checkImgIdBudgets` no longer carries pool constants: `flaIdPools()` reads `FILE_TYPE_TXD/COL/IPL` off the
adjuster ini **this build ships into the tree root**, and every log line and failure names the file it read.
Three things are not a value and fall back to FLA's own defaults (5000/255/256), each said out loud — a
`#`-disabled line, an ini whose `Apply ID limit patch` is off (every raise in it is inert), and a tree with no
adjuster ini. Falling back DOWN is the safe direction: it can only make the guard stricter, never silently
laxer. On `build/original/sa` it now reads `6000 / 400 / 1024` from the ini and reports
`5177 of 6000` · `264 of 400` · `191 of 1024`; on a tree without the ini the same build fails, which is the
behaviour that would have caught this crash before the delivery. Six tests pin it (raised ini, shipped-5000
ini, `#`-disabled line, patch-off, no ini, and the pools-with-source reader).
