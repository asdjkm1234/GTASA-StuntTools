# Session 11 — cutscene glass: two defects wearing one symptom (2026-08-14)

The close of the arc that session 10 handed over: build `asi/perfect-cutscene`, retire the
pane-suppression hack, get cutscene cars showing their glass AND their actors. What actually happened
is that the symptom had **two independent causes**, one in the engine's render path and one in a mod's
own data, and each explained about half of what the field reported — which is why four hypotheses died
before either was found.

## What changed

| Change | Where | State |
| --- | --- | --- |
| Entity-level deferral for cutscene cars | `asi/perfect-cutscene` (new ASI, 2nd consumer of `asi/sdk`) | field-accepted on RIOT_4B + SYND_3A |
| `rpGEOMETRYMODULATEMATERIALCOLOR` on translucent geometries | `tools/vehicle-cutscene` `materials.ts` / `rig/emit.ts` | field-accepted on PROLOG3 |
| Pane-suppression hack retired | `census.ts` list emptied; doc moved to `docs/hacks/retired/` | two slots stop shipping unglazed |
| `WriteCall` primitive | `asi/sdk` `hook.hpp` | the only SDK change the new plugin needed |
| `sa-name-key.ts` | `scripts/debug/` | decodes a runtime `m_nKey` log into model names |

Suite 4222/4222 (vehicle-cutscene 92/92, ASI catalogue 5/5). Fleet 23/23, structural gate green.
Merged to `main` fast-forward, 15 commits.

## Cause 1 — the draw-order roulette (engine; needed the plugin)

`CRenderer::RenderEverythingBarRoads` (`0x553AA0`) **does not render gameplay vehicles in its
visible-entity loop at all**: it hands each one to `CVisibilityPlugins::InsertEntityIntoSortedList`
(`0x734570`) and `CRenderer::RenderFadingInEntities` draws that list back-to-front after the whole pass.
A `CCutsceneObject` is an OBJECT, so it falls through to the inline `RenderOneNonRoad` call at
`0x553C52` and takes its luck with the sector-scan order; its glass z-writes and erases every actor
drawn after it.

The fix repoints that one call. The classifier is the engine's own actor test —
`GetAnimHierarchyFromSkinClump` (`0x734A40`) is non-null only for a skinned clump — because model TYPE
cannot separate a cutscene car from a cutscene actor: they share the CUTOBJ slots and all report 5.

Two payloads were built on the way and **removed after the field rejected them**, both recorded in the
plan rather than left behind a flag:

- **the blessed-six force-pipe skip** — made every other window worse and changed nothing it aimed at;
  the runtime pipe is what makes that car's glass look right, the opposite of the premise.
- **the outdoor alpha-test ref patch** — restoring ref 140 for parity deletes the tint outright, because
  mod cutscene glass sits at alpha 102–125 and the outdoor pass discards it.

## Cause 2 — a bit nobody had read (data; no plugin involved)

PROLOG3's sheriff car was matte from every angle with the plugin REMOVED — the user's own control, and
the thing that turned the hunt data-side. Everything measurable came back clean and byte-faithful to the
mod: material `102,102,102` alpha 115, identical texture, default pipeline, no prelit, one sheet not two,
nothing covering the pane (a plane test found only the interior, behind it, at 64 %).

What differed was the geometry flags word: `windscreen_ok` and `body_windows` carry `0x10037` — **no
`rpGEOMETRYMODULATEMATERIALCOLOR`** — while the door glass carries `0x200f7`. Without that bit RW's
default pipeline never reads the material colour, so the authored alpha is not applied and the pane
renders solid. Gameplay hides it completely: SA's vehicle pipe takes material alpha itself.

A fleet scan closed it: of 23 models, `copcarla` (both slots) is the **only** one with translucent
geometries missing the flag, and they are exactly the panes the field called matte. The emit now sets it
on any geometry carrying a translucent material and leaves opaque geometries as authored.

## What it cost, and the method lesson

Roughly a dozen field runs, four falsified hypotheses (alpha-test ref, env map on a raked pane, a
two-layer pane, the rear-window sheet), one ASI payload built and deleted, one design fork re-decided
after its premise was replaced. The two decisive controls were both the user's: **remove the plugin
entirely**, and **look at the same modded car in gameplay**. Neither was mine to propose late — they
were the cheapest experiments available from the start.

The rule that came out of it, now in the measurement-lessons memory: when a defect is invisible in every
viewer and the data measures clean, the difference is in a RENDER PATH — find something that renders the
same asset correctly and ask what the two paths read differently. Here the answer was a flag only one of
them consults.

## Left open

- **Step 6, the full 35-row re-sweep** — every row of plan 004 re-opens: the draw path of every cutscene
  car changed, the modulate rule changed one model's glass, and the hack that shaped two slots is gone.
  Sixteen rows had never been run at all.
- **Step 7, pmb packaging** — the fleet and the plugin are now coupled and the failure is silent
  (`restrictions/sa-target.md`).
- **`defrost_ad`** — transparency in the texture alpha with an opaque material converts as opaque; a
  black plate over that car's rear window (`edge-cases/converter-pipeline.md`). Real, recorded, not the
  defect being chased.
- **No benchmark was taken.** The deferral moves a handful of cutscene objects into a list the frame
  already flushes, so no frame-time claim is made either way; if one is ever needed it belongs to the
  step-6 sweep, not here.
