# Session 32 (2026-08-20) — the defect our own decoder could not see

Two tasks, both named by the user at the close of session 31, both closed the same day: **built, delivered to
the reference install, and accepted in the field.** 7 commits, suite **4 839 → 4 852** green, `tsc` + `eslint`
clean, 0 broken links across 751 doc/plan markdown files.

Its subject is not the fix. It is that **the fix was for a class of defect none of our instruments can see**,
and that two of the three things that slowed the session down were my own measurements lying quietly.

## 1. `mod-installer` 015 — a PNG that REPLACES follows the raster it replaces

**The report** (2026-08-20, screenshot): the number plates render as green blocky garbage with
`9. Car Plates HD [vehicle]` installed.

**The cause**: `pngToTextureNative` had ONE policy for every image a texture folder ships — DXT5 with alpha,
DXT1 without, plus mips. Right for a PNG that ADDS a texture; wrong for one that takes an existing texture's
place, because a number plate is composed at RUNTIME: `CCustomCarPlateMgr` LOCKS `platecharset`'s raster and
copies glyph PIXELS into the 64×16 plate it makes per car. Hand that path DXT blocks and it copies compressed
data as colour.

**The rule shipped**: a PNG that replaces a texture is encoded in the **compression class of the raster it
replaces**; one that adds keeps today's policy. Derived from the data, not from a list of names — the census
below is why that mattered.

**The mip half went the other way, on the user's call.** Stock ships every one of its 867 uncompressed
rasters single-level, so there was no precedent to copy; but these mods upscale what they replace 4–16×, and
a 512² texture with no mips shimmers. So the chain stays and the header declares it (`0x1106`) — keeping
stock's `0x1101` would have made them point-sampled, a downgrade against the DXT path being replaced.

### Measured

| | before | after |
| --- | ---: | ---: |
| the 18 replaced uncompressed rasters, mip chains included | 2 673 KB | **18 264 KB** |
| `models/generic/vehicle.txd` in the built tree | 11 274 188 B | **22 237 184 B** |
| mod pixels vs the source PNG (worst channel difference) | DXT1-quantised | **0** |

The exposure was measured before the policy was chosen, not after: **80 PNGs in 33 folders — 56 ADD, 24
replace, and only 18 of those replace an uncompressed raster**, every one of them in `models/generic/
vehicle.txd` or `models/particle.txd`, the two dictionaries stock keeps uncompressed end to end. The map
dictionaries a texture folder patches are DXT in stock and are untouched.

**+15.2 MB was a decision, not a side effect.** The narrow alternative — compress everything except the
rasters the engine reads back on the CPU — costs ~27 KB and needs a name-keyed list of the original's CPU-read
rasters, which we can only write for what somebody has already recovered. The user took the general rule.
The lever is on the shelf with its price: `docs/performance/deferred-optimizations/compress-sampled-png-replacements.md`.

### What only the field could say

`scripts/debug/plate-render.ts` composes plates from a real dictionary. Run against the BROKEN build it
produced a readable plate — mottled and blocky, but readable — because our decoder decompresses DXT before
composing. So did the suite. So would the viewer. **Every offline instrument we own was structurally blind to
this defect**, and the one that was not is the user looking at a car. That is now a restriction with its
blindness stated, not a war story: `docs/restrictions/uncompressed-rasters-stay-uncompressed.md`.

## 2. `scripts/cars-server` 003 — an added car is drawn under the slot it varies

Plan written first (his rule), then built. An added car is now a **smaller card inside its base's card**, the
base being the `(base)` suffix of its folder name — the same relation `tools/add-vehicles` installs on. The
id comes from the BUILT tree's ledger and nowhere else; no row reads `ID — not built yet`, and a row whose
bases disagree with the folder is shown as stale rather than picked over it.

Measured on the real tree: **327 cards in 19 sections, 115 alternatives under 101 bases**, `freibox` carrying
**8** (the layout case), page 388 228 → 392 707 B — the added cars moved rather than multiplied.
`npm run cars:opensa` now shows **none** of them: `add-vehicles` refuses every target but `sa`, so that page
had been listing 115 cars the build never installs.

**The request's premise was wrong, and the code said so in one grep.** The file written at session 31's close
said the added fleet was invisible to the page; it had been a section of its own since add-vehicles 102. A
request written down at a close is a claim like any other — the plan corrects it in its first paragraph.

## The build and the delivery

One full `sa` build, **11 m 27 s** (mods 90.7 s, vehicles 8.3 s, peds 10.8 s, optimize 90.2 s, trees 83.4 s,
procobj 2.9 s). Delivered per `docs/gta-sa-original/reference-install.md`: `models/` (102 files, 21.9 s) and
`data/` (317 files) with **no `--delete`**, plus one file outside them —
`modloader/Model_Variations/ModelVariations_Vehicles.ini`, which had been session 31's HAND edit and whose
built version differs from it only by `### <slot>` comment headers (0 substantive lines). Three files changed
content: `models/generic/vehicle.txd`, `models/particle.txd`, `data/cargrp.dat`.

Verified after the delivery, because session 31 was bitten by exactly this: `Dummys = 100000`,
`Buildings = 150000`, `EntitiesPerIpl`/`EntityIpl` `unlimited`, FLA `TXD 6000 / COL 400 / IPL 1024` — intact,
and the tree now ships the same numbers, so the mine that took a session to find is defused on both sides.

## What it cost, and what it bought

**Cost:** one build (11.5 min), one delivery, +15.2 MB resident in two always-loaded dictionaries, and a
codec function (`encodeUncompressedStruct`) that duplicates a little of what `encodeRgba8888Struct` does —
kept apart deliberately, since one writes a raster from scratch and the other re-encodes an existing header.

**Bought:** the plates back; a general rule that will catch the next CPU-read raster nobody has recovered
yet; the mod authors' pixels arriving byte-exact on 18 textures R\* deliberately kept uncompressed; and the
DXT-alignment trap (`docs/restrictions/dxt-raster-dimensions.md`) lifted for any PNG that replaces an
uncompressed raster, since only DXT needs its sides to be multiples of 4.

## Three method lessons

1. **A defect can be invisible to every instrument you own, by construction.** Ours decode; the game does
   not. When a report survives an offline check that says it is fine, ask whether the check is capable of
   failing.
2. **A failed fetch leaves the LAST result on disk.** `curl -o` timed out twice while I verified the page I
   had just changed, and I read the previous run's HTML as the new one — twice — concluding my own change had
   not taken. The third fetch with `-w "http=%{http_code}"` showed `http=200` and the correct page. An
   instrument that writes to a file must report whether it wrote.
3. **A number I wrote down yesterday is not a measurement.** The census I ran said 18 uncompressed
   replacements; I had written 19 in four documents from a count done by eye. Corrected in the same change —
   and the reason the promoted script exists is so the next person runs it instead of counting.

## What shipped, by file

- `tools/rw-codec/src/texture-native.ts` — `encodeUncompressedStruct`, `isCompressedRaster` (+5 tests).
- `tools/mod-installer/src/{png-texture,txd-folder}.ts` — the replace rule (+2 tests), `./png-decode` exported.
- `scripts/cars-server/src/{catalog,server}.ts`, `views/index.hbs` — the nested alternatives (+6 tests).
- `scripts/debug/png-folder-census.ts` — the census that priced the decision, with its row in `docs/debug/`.
- Plans: `tools/mod-installer/docs/plans/015`, `scripts/cars-server/docs/plans/003`.
- Rules and facts: `docs/restrictions/uncompressed-rasters-stay-uncompressed.md`,
  `docs/gta-sa-original/uncompressed-rasters.md`, `docs/contracts/mods.md`,
  `docs/performance/deferred-optimizations/compress-sampled-png-replacements.md`,
  `docs/open-issues/fixed/png-folder-merge-imposes-dxt.md`.
