# 006 — mod-installer: `*.merge` data-file edits (shipped)

**Shipped 2026-07-05** (`ide-merge.ts`, wired into `applyMod`). A mod can **edit** a stock data file instead of
replacing it wholesale: it ships `<target>.merge` at the target's game path with explicit
`remove from` / `add to` section directives. The installer applies the edits to the **current `--out` state**
of the target (base + earlier mods), so merge-mods stack with each other and with earlier whole-file
replacements, and never clobber other mods' lines.

## Why

The motivating mod (now `mods-src/original/mods/42. Animated Radars`) turns the airport radar into an animated object.
That is a **section move** inside `data/maps/generic/multiobj.ide`:

```
objs:  1682, ap_radar1_01, ap_misc1bit, 100, 2097152     ← must go away
anim:  1682, ap_radar1_01, ap_misc1bit, radar, 600, 0    ← must appear
```

It cannot be an additive standalone IDE: an IDE **ID cannot be defined twice** (the stock `objs` line would
still load — duplicate-ID UB in SA). So the author shipped a whole-file `multiobj.ide` replacement with the
old line commented out — which conflicts with any other mod touching that popular generic IDE and silently
drops their edits. The `.merge` file expresses only the intent (2 lines), and the whole-file conflict class
disappears.

## Format

`data/maps/generic/multiobj.ide.merge`:

```
# Animated airport radar: ap_radar1_01 moves from a static objs entry to an anim object.
remove from "objs":
1682, ap_radar1_01, ap_misc1bit, 100, 2097152

add to "anim":
1682, ap_radar1_01, ap_misc1bit, radar, 600, 0
```

- **`remove from "<section>":`** — deletes the following entries from that section, matched **by ID** (first
  cell). Never byte-matched: tools reformat floats (`1e-008` vs `1e-08`), byte-matching would silently miss.
  The full line under `remove` is deliberate documentation — AND the exact line a later mod (or an optional
  variant) can `add to` back to restore the stock object.
- **`add to "<section>":`** — appends the entries to that section, **creating the section** at the end of the
  file when absent. An entry whose ID already exists in that section is **replaced** — stacking two merge-mods
  or re-running the install stays deterministic.
- `#` / `//` comments and blank lines are ignored. Directives run in file order.
- Errors are loud: a malformed directive header, an entry outside any directive, an entry without a numeric
  ID, or a missing target file **fail the install**. A `remove` ID that isn't present only **warns**
  (`mod-installer: <file>: remove from "objs": id 9999 not found — skipped`) and continues — the mod it was
  guarding against may simply not be installed.

## Semantics & ordering

- Collected during the mod's overlay walk (never copied as a file), applied **after** the mod's own file
  copies — so a target the same mod ships is in place first.
- Applied to the file in `--out` **as left by earlier mods** (priority = folder number, later wins). A later
  whole-file replacement still beats an earlier merge — as with any other file.
- Untouched lines are preserved **verbatim** (whitespace, comments, ordering); CRLF/LF of the target is kept.

## Example mod (shipped): `42. Animated Radars`

```
42. Animated Radars/
  data/maps/generic/multiobj.ide.merge   # the 2-directive edit above
  gta3_img/ap_radar1_01.dff              # replaces the stock model (animated frame hierarchy)
  gta3_img/ap_misc1bit.txd               # replaces the stock TXD
  gta3_img/radar.ifp                     # NEW gta3.img entry — the anim clip the IDE line references
```

Verified: applying the merge to the stock `multiobj.ide` produces the same 121 definitions as the original
author's whole-file replacement (semantic set-compare via `parseIde`), with `1682` an `anim` def
(`radar`, draw distance 600). OpenSA's engine plays IDE `anim` objects natively (plan 041), so the radars
rotate in both real SA and the browser build.

## Scope notes

- Section-based `key = first numeric cell` covers every IDE flavour (objs/tobj/anim/txdp/2dfx…). **Text IPLs
  turned out to need different semantics** — inst IDs repeat and row ORDER is data (binary-stream lod
  indexes); plan 007 added the `replace in` directive + order-preserving `.ipl` rules and the `merge-gen`
  converter. Non-sectioned keyed files (handling.cfg, carcols.dat) remain OUT of scope until a mod needs
  them — the directive grammar leaves room (`remove from "handling":` could map to a file region).
- `bake-mod` (Modloader-style loader.txt mods) does not process `.merge` files — third-party Modloader mods
  don't ship them; the convention is ours, for `mods-src/original/mods` overlay mods.
