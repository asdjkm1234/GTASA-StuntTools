# 008 — IPL merge level 2: inst removal with lod rebase + binary-stream merges

> Numbering note: `1. SA Xbox Map Features` was renumbered (it is `5.` as of 2026-07-07 after several
> renumberings); this doc keeps the number it had at the time.

**Status: ✅ shipped & verified in-game (2026-07-07)** — full 40-mod build boots real SA, all mods present. Level 1 (plan 007) made everything ORDER-PRESERVING mergeable. Level 2 removes the
two remaining whole-file classes: text-IPL **row deletions** (auto-rebase of every lod index, in the text AND in
the area's binary streams) and **binary stream replacements** (instance-set merges). After this, mods 0 and 1
ship no whole-file data replacements and no whole stream entries at all — every edit stacks in mod order.

## What the field data says (2026-07-07 scoping, mods 0/1 vs vanilla)

- mod 1's `lae`/`lahills` streams differ from vanilla ONLY in lod fields (36/26/15/13 per stream, zero
  instance adds/removes) — exactly the author's manual rebase after deleting text rows. An automatic rebase
  reproduces them → those 10 shipped streams become redundant.
- mod 1's vegas/country streams differ by instance ADDS/REMOVES (features), lods untouched.
- mod 0's streams differ by instance adds/removes only (`law_stream5`: −101 instances; `lae_stream0`: −56 +26).
- Touched vanilla streams DO carry `CARS` sections (`vegasn_stream3`: 14) — any rebuild must carry them; all
  other header counts are 0 (guard on that).
- Stream instances are never index-referenced by anything → stream-side instance removal is safe. The only
  index coupling is stream→text and text→text `lod` values (the ghost-barriers invariant).

## Design

### 1. `remove from "inst"` for `.ipl` targets — now allowed, with rebase

`applyIdeMerge` performs the deletion the way mod authors do by hand:

- the row is matched by full canonical line (as `replace`); its ORIGINAL inst index K is recorded;
- every surviving text row with `lod > K` is decremented; `lod == K` → **error** (the merge must first
  re-point or sink the referencing rows — an orphaned link is a silent in-game corruption);
- the apply result now carries `removedInst: number[]` (original-index space, ascending).

The installer (`apply-mod`) then patches the area's binary streams in `--out/models/gta3.img`: for every
`<base>_stream*.ipl` entry, each instance's `lod` is shifted down by the number of removed indexes below it;
`lod == removed` → error. The patch is **byte-in-place** (40-byte INST records at `instOffset`) — CARS and
anything else stay byte-identical.

### 2. Binary stream merges — `gta3_img/<name>.ipl.merge`

A `.merge` file inside an IMG folder EDITS the existing archive entry instead of replacing it. Same directive
grammar; rows are the binary INST fields in text form:

```
add to "inst":
8620, 0, 2823.55, 1591.31, 10.9, 0, 0, 0, 1, 243        # id, interior, x, y, z, rx, ry, rz, rw, lod

remove from "inst":
8623, 0, 2790.14, 1750.99, 10.46, 0, 0, 0, 1, -1
```

- matching is canonical-numeric (6 significant digits — same rule as `merge-gen`), so float formatting noise
  can't break it; `remove`/`replace` match instances, `add` appends;
- apply = parse entry (`parseBinaryIpl`) → set ops → re-encode (`encodeBinaryIpl` extended to carry the raw
  CARS records); a nonzero unknown header count → refuse loudly;
- ordering inside one mod: text-data merges first (their stream lod-patches run against the CURRENT entries),
  then IMG folders (plain entries + stream merges). Stream-merge rows must therefore be written in the FINAL
  (post-rebase) index space.

### 3. `merge-gen` level 2

Text conversion becomes mapping-aware: align vanilla↔modded rows (canonical LCS), classify removes / edits /
adds; mid-file inserts are RELOCATED to section-end appends (game semantics don't care about row position —
only indexes do), with the added rows' own `lod` values remapped from the author's layout into the final
layout (vanilla minus removes, appends at end). The converter emits removes first, then pairs/adds, and
computes the vanilla→final index mapping.

Stream conversion: parse mod stream + vanilla stream, remap the mod instances' lods (author layout → final
layout via the text mapping), diff the instance sets, emit the stream `.merge`; roundtrip gate = simulate the
full apply (text rebase patch + stream merge on the vanilla entry) and compare instance sets exactly.

### 4. Conversion of mods 0/1 (the payoff)

- mod 1: `LAe.ipl`/`LAhills.ipl` → remove-merges (drop the 2 overlay merges and the 10 redundant rebase-only
  streams); `vegasN/W/E.ipl` → merges with relocated appends (drop the 3 whole files + 3 overlays); every
  remaining shipped stream → stream-merge.
- mod 0: every shipped stream → stream-merge (`LAw.IPL`, the one level-1 leftover, converts via remove).
- Gold check: capture the full-install output of the CURRENT (pre-conversion) mods first; after conversion the
  install must produce semantically identical text IPLs (canonical rows) and identical stream instance sets.

## Out of scope

- Mid-section inserts preserved at their original position (nothing needs them — relocation is semantically
  identical and keeps vanilla indexes stable).
- CARS-section merges (no mod edits cars yet).
- gta.dat directives (loader baking covers registration).

## Verification

Unit tests per piece (rebase math incl. the orphaned-link error, stream patch, stream merge ops, CARS
carry-over, converter mapping/remap, relocation); e2e: a text remove whose rebase patches a companion stream
in the img + a stream merge stacking on another mod's stream edit; the mods 0/1 gold check; full real install
with zero warnings.

## Measurements (2026-07-07, as shipped)

- **Texts**: all six remaining whole files converted — mod 1 `LAe.ipl` (1 remove, the author's ~48 hand-rebase
  pairs collapsed into NOTHING under the simulated rebase), `LAhills.ipl` (2 removes), `vegasN/W/E.ipl`
  (pairs + relocated appends; mod-0 same-area append offsets 1/7/52 threaded into the lod remaps); mod 0
  `LAw.IPL` (1 remove + pairs/adds). The five level-1 overlay merges in mod 1's folder are GONE — with no
  whole-file replacement left, mod 0's fixes survive on their own.
- **Streams**: of 148 shipped stream files, **133 → `.ipl.merge`** (≈5,000 rows of real ops — e.g. mod 0's
  `law_stream5` deletes 101 instances) and **15 deleted as redundant** — mod 1's `lae`/`lahills` streams were
  pure hand-rebase copies that the automatic rebase reproduces exactly. 0 kept whole.
- **Noise canonicalization mattered twice more**: instance identity = id+interior+position only (author tools
  re-export quaternions, −q ≡ q) with rotation tolerance 5e-4 (5-decimal exporter noise) —
  `countn2_stream0` dropped 432 → 14 merge rows.
- **Orphan policy**: a stream instance whose lod pointed AT a removed text row is unlinked (`lod -1`) with a
  warning instead of failing — the shipping pack's own stream merge deletes those instances right after
  (mod 0's law does exactly this).
- **Full install (40 mods): zero merge warnings.**
- **Gold check** (semantic, layout-independent: rows-minus-lod multisets + lod links resolved to target ROW
  CONTENT; streams compared as per-AREA instance unions since the author repartitioned instances between a
  same area's stream files): 17/18 texts match; the 18th (`vegasw`) is the REFERENCE being broken — the
  level-1 overlay's `add` rows carried vanilla-computed self-link lods that landed 3 rows off on top of
  mod 1's whole file (visagesign04 linked to road LODs; the exact plan-007 documented caveat). Level 2 links
  them correctly. Streams: 8/16 areas identical; the other 8 differ **exactly by the mod-0 edits the
  last-wins reference had silently LOST** (the 27 colliding stream files): law −101 instances restored,
  vegasw sinks (z −1000) restored, vegasn model swap 652→716 restored, etc. — the conflict fix doing its job.
  One follow-up from the check: both packs add the same visagesign04/lodagesign04 sign trio in vegasw
  (duplicated in the reference too) — left as-is, deduping mod 0's copy would break its self-link offsets.
- **Post-ship crash fix (same day)**: first real-SA boot crashed at `0x005B5209` (`CFileLoader::
LoadObjectInstance+0x29`) loading `law.ipl`. Root cause: the AUTHOR's original `LAw.IPL` last row ends in a
  bare `-` instead of `-1` (a truncated lod cell) — the conversion reproduced the mod's own defect faithfully
  (the gold reference carries the same `-`). Pre-conversion builds survived by luck: sscanf leaves the lod
  variable holding stack garbage, which happened to be benign under the old load path. Fixed the data
  (`-` → `-1` in the merge) and `merge-gen` now REPAIRS malformed lod cells to `-1` while converting
  (unit-pinned); scanned every `.merge` and every text IPL across all 40 mods — no other instance.
- Tests: +22 new across map-placement (CARS carry-over, rebuild guard), ide-merge (remove-with-rebase,
  orphan error, original-index reporting), stream-merge (patch, merge ops, CARS survival), merge-gen (remove
  conversion, mid-insert relocation with lod remap, author→final map, stream converter) and e2e (text remove
  rebases a companion stream + a stream merge stacks on top). mod-installer 88, four-package sweep 317, all
  green; tsc + eslint clean.
