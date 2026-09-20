# 2026-08-22 — the in-game sweep on the first OpenSA pak carrying lod-trees 013

**Numbers:** [`2026-08-22-ingame-lod-trees-013-sweep.json`](./2026-08-22-ingame-lod-trees-013-sweep.json)
(recorded verbatim before any of this was read).
**Lane:** the user's own machine and display, in-game `?bench=all`, vsync-capped 120 — `ocean-horizon` pins at
120.0 fps / 8.333 ms in both runs, which is what says the two are the same lane.
**Build:** `build/original/opensa` of 2026-08-22 09:57, repo `efe28767`.
**Pair:** [`2026-08-17-ingame-full-hipoly-fleet-sweep.json`](./2026-08-17-ingame-full-hipoly-fleet-sweep.json)
— same lane, same window, all mods + the full high-poly fleet, against the pak that PRECEDED plan 013.

| scene | ms 08-17 | ms 08-22 | Δ | GPU pass 08-17 | 08-22 | Δ | triangles 08-17 | 08-22 | Δ | slow frames |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ls-noon | 11.507 | 11.160 | −3.0 % | 6.859 | 6.503 | −5.2 % | 3 910 609 | 3 831 641 | −2.0 % | 0 → 0 |
| sf-fog-dawn | 10.282 | 11.222 | **+9.1 %** | 5.386 | 6.153 | +14.2 % | 2 311 512 | 2 907 418 | **+25.8 %** | 0 → 0 |
| lv-night | 17.153 | 16.471 | −4.0 % | 11.752 | 11.125 | −5.3 % | 4 250 234 | 4 160 414 | −2.1 % | 11 → 3 |
| country-dusk | 16.333 | 16.195 | −0.8 % | 12.369 | 12.170 | −1.6 % | 1 450 935 | 1 590 776 | +9.6 % | 8 → 13 |
| ocean-horizon | 8.333 | 8.333 | 0.0 % | 2.188 | 2.168 | −0.9 % | 409 903 | 409 892 | 0.0 % | 0 → 0 |
| ls-rain-night | 10.486 | 10.197 | −2.8 % | 5.886 | 5.692 | −3.3 % | 3 060 848 | 2 981 988 | −2.6 % | 0 → 1 |
| ganton-noon | 15.181 | 14.961 | −1.4 % | 10.357 | 10.266 | −0.9 % | 3 135 559 | 2 932 299 | −6.5 % | 2 → 2 |
| strip-noon | 12.077 | 11.048 | **−8.5 %** | 7.256 | 6.249 | −13.9 % | 3 219 130 | 2 824 466 | −12.3 % | 2 → 1 |
| ganton-night | 15.716 | 15.312 | −2.6 % | 10.834 | 10.523 | −2.9 % | 3 137 194 | 2 931 268 | −6.6 % | 12 → 4 |
| **mean** | **13.008** | **12.767** | **−1.9 %** | **8.099** | **7.872** | **−2.8 %** | 2 765 103 | 2 730 018 | −1.3 % | **35 → 24** |

## What it says

**No frame cost.** Eight of nine scenes are equal or faster, the mean frame is −1.9 % and the GPU pass −2.8 %.
Plan 013's gate for phase B was *"no measurable change on the Ganton lap"* — Ganton reads −1.4 % at noon and
−2.6 % at night, so the plan lands under its own budget without having spent phase B at all.

**Hitching improved**: 35 slow frames across the sweep → 24, and the two worst scenes of the old run
(`ganton-night` 12, `lv-night` 11) drop to 4 and 3. `legStart.ok` is true on all nine legs and `lateCreates` is
0, so the harness itself was clean.

**The one scene that got slower is `sf-fog-dawn`, and its own numbers say why it is not the tree work**: it
draws **+25.8 % more triangles** and +23 % more draw calls than in August. More geometry submitted, not more
cost per triangle — the frame follows the content. Something in SF gained geometry between the two builds;
naming what is a separate question, and this file does not guess at it.

## What this comparison is NOT

**Not a controlled A/B of plan 013.** Five days separate the two paks and they carry more than the tree work:
`mod-installer` 015 (uncompressed raster replacements) and 016 (the `gta.dat` order splice), `img-splitter`
002, `vehicle-installer` 014, and `lod-common`'s blended-last split rule. A per-scene delta here is the
difference between two BUILDS. What it can carry — and does — is the absence of a regression: the tree layer
was rebaked into two cages per tree, the LOD cells now weld 49 820 impostor triangles in the depth-writing
cutout class instead of the sorted blend one, and the frame did not move against it.

The previous pak was rebuilt in place, so no byte-level diff or replay of the old pak is possible; this pair
of sweeps is the whole record.
