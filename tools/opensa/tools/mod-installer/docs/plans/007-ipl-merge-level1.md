# 007 — IPL merge convention (level 1) + `cutscene_img`

> Numbering note: `1. SA Xbox Map Features` was renumbered (it is `5.` as of 2026-07-07 after several
> renumberings); this doc keeps the number it had at the time.

**Status: ✅ shipped (2026-07-07). Superseded in part by [plan 008](008-ipl-merge-level2.md) (level 2)** —
inst removals and binary-stream merges landed the same day; the whole-file packages and the overlay-merge
workaround described below no longer exist in mods 0/1. Extend the `.merge` data-edit convention (plan 006) from IDE files to IPLs, add the
`cutscene_img/` IMG folder, and convert the two whole-file-replacement packs (`0. Map Fixes Pack`,
`1. SA Xbox Map Features`) to the merge format so they stop clobbering each other and stack in mod order.

## Motivation

Mods 0 and 1 are the only two in `mods-src/original/mods` that replace stock `data/maps` files whole (31 and 14 files;
diffs are line-scale: flags, sunk objects, appended instances). Whole-file replacement is last-wins: today mod 1
silently erases mod 0's fixes in 9 shared files (verified line-by-line — mod 1's copies do NOT contain mod 0's
edits). Every other mod is already conflict-free: modloader-style additive (`loader.txt` + own IDE/IPL, baked by
plan 004), `.merge` (plan 006, mod 38), or img-only.

Mod 0 also ships `cutscene_img/csburgerbox.txd`, a convention the installer doesn't know — the folder is
currently copied verbatim into the game root (dead weight).

## Why IPLs need different merge semantics than IDEs

1. **IDs are not unique in `inst`** (id 710 appears 7× in lae.ipl) and `occl`/`cull` rows have no IDs at all —
   the plan-006 id-keyed grammar cannot address IPL rows.
2. **Row order IS the data**: binary IPL streams (`<area>_streamN.ipl` in gta3.img) reference text-IPL rows by
   index, and text rows reference each other via the `lod` column (the ghost-barriers coupling). Any operation
   that shifts existing row positions corrupts those links in-game with no error at install time.

Level-1 rule: **only order-preserving operations**. Replace-in-place and append-to-section-end never move an
existing row, so every pre-existing lod index — in text and in companion binary streams — stays valid **by
construction**; no runtime stream validation needed. True row deletion (with lod rebase in text + stream
patching) is level 2, out of scope here.

## Design

### Grammar (extends plan 006; one parser, semantics keyed by target extension)

New directive, valid for `.ipl` and `.ide` targets:

```
replace in "inst":
- 710, vgs_palm01, 0, 2110.671875, -977.734375, 66.1328125, 0, 0, 0, 1, -1
+ 710, vgs_palm01, 0, 2110.671875, -977.734375, -300.0, 0, 0, 0, 1, -1
```

- Strict `-`/`+` pair alternation; any number of pairs per directive.
- The `-` line is matched **whitespace-normalized, full-line, within the section**; replaced in place (the row
  keeps its index). First match wins; a warning is emitted when several rows matched (duplicated stock rows —
  write the pair twice to hit both). No match → warning, pair skipped.

Extension-keyed semantics for the existing directives:

| target | `add to`                                    | `remove from`                                                                                                                          |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `.ide` | unchanged (plan 006: same-id row replaced)  | unchanged (by id)                                                                                                                      |
| `.ipl` | append before the section's `end`, verbatim | full-line match; **FORBIDDEN for `inst`** (throws, suggests the sink idiom) — allowed for `occl`/`cull`/… which have no index coupling |

The "sink idiom" (what Map Fixes Pack itself does): to delete an inst row, `replace` it with a copy at
`z = -300` — the row survives, indexes hold, the object is gone.

Constraint documented for `add to "inst"`: appended rows should carry `lod -1` or reference a _pre-existing_
row's index; a lod link between two appended rows is only stable if no other mod appends to the same IPL earlier
in the order (true for our fixed set — the converter warns when it happens).

### `cutscene_img/`

`IMG_FOLDERS` in `apply-mod.ts` gains `cutscene_img → models/cutscene.img`. `mergeImgDir` already handles
add/replace-by-name and seeds a missing archive.

### Converter (`merge-gen`)

`tools/mod-installer/src/merge-gen.ts` — library + tiny CLI. Given a vanilla file and a modded file, emits the
`.merge` text or a "not convertible" verdict with the reason:

- sections must match by name and order; edits outside sections → not convertible;
- equal-length replace hunks → `replace` pairs; insert hunks at section end → `add`;
- `.ide` deletions → `remove` by id (id must be unique in the section); brand-new ids → `add`; a modified row
  whose id also lives elsewhere untouched → `replace` pair (never id-keyed `add`, which would eat the other row);
- `.ipl` `inst` deletions or mid-section inserts → **not convertible** (keep the whole file);
- **roundtrip gate**: the generated merge applied to the vanilla text must reproduce the modded text exactly
  (modulo line endings / trailing whitespace) or nothing is written.

### Converting mods 0 and 1

Driver walks both mods' `data/` files, runs the converter, and for every convertible file writes `<file>.merge`
and deletes the whole-file original (only after its roundtrip passed). Expected outcome:

- **mod 0**: all 12 IDEs + the equal-row-count IPLs (lae, lan, lan2, lae2, lahills, law, sfe, vegasn, countrys …)
  - append-only IPLs + `occluveg.ipl` (single `occl` remove; the file was mis-shipped at `data/occluveg.ipl` and
    is now moved to `data/maps/`) → `.merge`. Stays whole-file: `levelmap.ipl` (78 → 367 rows — a rewrite, not a
    patch) and `vegass.ipl` (true row deletion) with their binary streams.
- **mod 1**: IDEs + vegasN/W/E + seabed + gen_int3 → `.merge`. Stays whole-file: `lae.ipl` + `lahills.ipl` —
  row-deletion packages hand-rebased by the author against his rebuilt binary streams (level-2 material).
- **the 9-file conflict**: after conversion the only remaining clobber is mod 1's whole-file `lae.ipl`/
  `lahills.ipl` erasing mod 0's sink-merges of the same files. Level-1 fix: the driver re-emits those few sink
  pairs as `.merge` files **inside mod 1's folder** (a mod's merges apply after its own overlay), with the `-`
  lines matched against mod 1's file content. Documented cross-reference in the merge header comment.

Binary streams stay plain img entries; the 27 stream-name overlaps between mods 0 and 1 remain last-wins
(level 2: instance-set stream merge).

## Out of scope (level 2)

- `remove from "inst"` with automatic lod rebase of the text file + patching of the binary streams present in
  the img at apply time (turns mod 1's lae/lahills packages into merges).
- Binary-stream `.merge` (diff instance sets against the vanilla stream, apply as add-instances).
- gta.dat merge directives (modloader `loader.txt` baking already covers registration).

## Verification

- Unit: grammar (pair parsing, replace-in-place preserves row index, inst-remove throws with the sink hint,
  ambiguous/missing match warnings, `.ide` semantics unchanged); converter (replace-only, append-only,
  not-convertible verdicts, id-collision guard, roundtrip gate); `cutscene_img` routing in apply-mod.
- e2e: fixture install where an `.ipl.merge` stacks onto another mod's whole-file replacement of the same IPL.
- Real conversion: driver report for mods 0/1 (files converted / kept and why), spot-check in-game after the
  next full rebuild.

## Measurements (2026-07-07, as shipped)

Conversion driver run (every file roundtrip-gated before the original was deleted):

- **mod 0 (Map Fixes Pack)**: 31 stock replacements → **29 `.merge`** + 1 identical file deleted
  (`counxref.ide` — dead weight) + **1 kept whole**: `LAw.IPL` (true inst-row deletion, level 2). Notables:
  `lae.ipl` = 20 sink pairs, `LAhills.IPL` = 11, `levelmap.ipl` = one `add` directive with 289 appended rows
  (78 → 367 — a pure append, convertible after all), `occluveg.ipl` = a single `occl` line remove (also fixed:
  the file was mis-shipped at `data/occluveg.ipl`; the real target is `data/maps/occluveg.ipl`).
- **mod 1 (SA Xbox Map Features)**: 14 → **9 `.merge`** + 5 kept whole (`vegasN/W/E.ipl` — mid-inst feature
  inserts; `LAe.ipl`/`LAhills.ipl` — row-deletion packages hand-rebased against their rebuilt binary streams)
  - **5 overlay merges** re-applying mod 0's fixes on top of those whole files (all directives verified to
    match mod 1's file content — every mod-0 pair touches `lod -1` rows the rebase didn't move).
- **Float-noise canonicalization earned its keep**: `vegass.ipl` 378 → 28 replace pairs, `countN2.IPL` 47 → 1,
  `vegasW.IPL` 109 → 2 (the pack author's exporter reformats floats to 6 significant digits — byte comparison
  reads the whole file as edited).
- **Full real install (40 mods, 10 baked)**: zero merge warnings after dropping one duplicate pair (both packs
  fixed `by_fuelfence` identically — the first pack's edit made the second's pair a no-match). Verified in the
  out tree: `lae.ipl` carries mod 0's 20 sinks AND mod 1's row deletion; `vegasn.ipl` keeps mod 0's `bin1` fix
  under mod 1's whole file; `countn2.ide` has both packs' adds; `cutscene.img`'s `csburgerbox.txd` replaced
  byte-exact.
- Tests: +25 new (12 grammar incl. the inst-remove ban and pair-alternation guards, 11 merge-gen, 2 e2e —
  `cutscene_img` routing + the merge-over-whole-file stacking case) — mod-installer suite 75 tests, all green;
  tsc + eslint clean.
