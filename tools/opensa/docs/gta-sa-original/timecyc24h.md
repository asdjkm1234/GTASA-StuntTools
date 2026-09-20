# The 24-hour timecyc: two plugins, one format

**Measured 2026-08-22** against the files in this repo (plan
[104](../plans/104-timecyc24h-source/readme.md)). Subject: what the ORIGINAL game's 24h timecycle plugins
read, so a mod authored for either one is a fact we can rely on rather than re-derive.

## Why it looks like two formats and is not

Stock SA authors **8 keyframes** per weather (midnight, 5am, 6am, 7am, midday, 7pm, 8pm, 10pm) in
`data/timecyc.dat` and interpolates between them at runtime. A "24h timecyc" plugin replaces that table with
one authored **hour by hour**. Two such plugins exist in this project's mod tree:

| Plugin | Bytes | Where it lives here | The ONLY file name in the binary |
| --- | --- | --- | --- |
| `timecyc24h.asi` (Dante) | 107 008 | `mods-src/original/mods/sa/23. Timecyc 24h by Dante/modloader/timecyc24h/` | `timecyc24h.dat` |
| `timecycle24.asi` | 86 016 | `mods-src/original/debug/clean_map/` | `timecyc_24h.dat` |

`strings` over each binary returns exactly one `.dat` name and no other. **That is the whole difference
between them.** Install one plugin's data file and run the other plugin and nothing happens: the plugin does
not find its name, reports nothing, and the stock 8-keyframe table stays live. It reads as a format
incompatibility and is a file-name one.

The reference install runs only Dante's (`reference-install-config.md`, the `timecyc24h` row);
`timecycle24.asi` sits in the debug install and is not shipped.

## The format both of them read

Measured with our own parser over the `.dat` each plugin ships:

| File | Lines | Data rows | Tokens per row | Weather headers | Read failures |
| --- | --- | --- | --- | --- | --- |
| `timecyc24h.dat` (Dante) | 1 196 | **552 = 23 × 24** | **52** | 23 | 0 |
| `timecyc_24h.dat` (bundled with `timecycle24.asi`) | 1 174 | **552 = 23 × 24** | **52** | 23 | 0 |
| `timecyc.dat` (stock, for contrast) | 437 | 184 = 23 × 8 | 51 | 23 | 13 fields, 1 row |

- **27 field groups, in stock's order, plus one**: stock's 51 numbers end at `WaterFogAlpha`; both 24h files
  add a 52nd, **`DirMult`**. Everything before it is stock's layout unchanged (RGB = 3 numbers, the water
  column RGBA = 4, the rest scalars).
- **All 23 weathers**, `EXTRACOLOURS_1` and `EXTRACOLOURS_2` included, and the extracolours carry 24 rows
  that DIFFER hour to hour — they are authored, not one static row repeated.
- **Comments are the only cosmetic difference between the two files.** Dante marks hours `00AM…23PM` and
  names two groups `PostFx1ARGB` / `PostFx2ARGB`; the other file marks `0h…23h` and spells them
  `Alpha1 RGB1 Alpha2 RGB2`. Any reader that skips `//` lines cannot tell them apart.

## Two things about the authored CONTENT, not the format

- **Negative `FogSt` is normal and Dante leans on it hard.** Stock authors a negative fog start on 37 rows
  (min −200). Dante's table does it on **243 of the 504 time-weather rows, down to −1 700**, across 13
  weathers — 11 of them for all 24 hours (both smog weathers, `CLOUDY_LA`, `CLOUDY_SF`, `RAINY_SF`,
  `FOGGY_SF`, `CLOUDY_COUNTRYSIDE`, `RAINY_COUNTRYSIDE`, `SANDSTORM_DESERT`, `UNDERWATER`). What a negative
  start MEANS is recovered in [timecyc-fog.md](timecyc-fog.md) — a haze already partly opaque at the camera
  — and the field rejected his fog for OpenSA on 2026-08-22 while keeping every other column. Note the trap
  it sets for any corruption scan: the value `−1000.00` appears in this column as DATA, and `−1000` is also our parser's
  int-read failure default.
- **Dante's file fixes stock's corrupt line.** Stock's `RAINY_COUNTRYSIDE` 8PM keyframe is 49 tokens instead
  of 51 and fails 13 field reads; Dante's 552 rows fail none. That is what "Refixed" means in the mod name
  `[24H] Refixed Original Timecycle`.

**Where his verbatim file still is, in this repo**: the `sa` layer
(`mods-src/original/mods/sa/24. [24H] Refixed Original Timecycle 1.6/modloader/timecyc24h/timecyc24h.dat`),
which is what his asi reads on the real game, and the fixture `fixtures/original/data/timecyc24h.dat` taken
from it. The **opensa** layer's file is no longer his: the field rejected his fog and kept everything else,
so that copy is his table with `FarClp`/`FogSt` merged from stock (plan 104/04).

## What this means for OpenSA

Our engine is 24h by construction — it samples a fractional hour over 24 rows and has no 8-keyframe table to
patch — so **there is no plugin behaviour to port**, only the file name to accept. The loader order and what
a mod may ship is `docs/contracts/mods.md` §2.

One honest limit on the claim above: both asi files were read for STRINGS, not disassembled. That a plugin
only swaps the table, and does not also change how the game blends between entries, follows from its
interface rather than from its code.
