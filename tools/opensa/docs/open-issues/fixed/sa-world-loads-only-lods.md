# The real game loads the world as LODs only (2026-08-10)

## FIXED 2026-08-10 — field-confirmed the same day

**One mod: `60. Pacific Park Rotating Ferris Wheel`.** The user narrowed it himself — every mod before it
installs and plays perfectly, adding it produces the symptom — and handed over both complete installs
(`NO_COMMIT/gta_sa` working, `NO_COMMIT/gta_sa_bug` broken), which made the rest measurable.

Its `gta3_img/Remove original/` folder was read by the installer as a **delete list**. It is not one: the five
files are one 653-byte empty RW clump each, meant to REPLACE the stock geometry (Modloader has no delete
mechanism at all). Deleting the entries left five stock models declared by `LAw2.IDE`/`LAxref.IDE` and placed by
**23 inst rows** with no archive entry — a streaming request that can never complete. Declared-but-absent went
1 → 6 between the two installs; of those, placed went **0 → 5**.

Fixed in [`mod-installer/010`](../../../tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md):
the folder now injects as replacements, and `install()` THROWS on any model that is declared, placed and
unloadable. The guard reads 0 on the working install and 5 on the broken one.

**Confirmed in the field:** he rebuilt `sa` with the fix, installed it, and the game plays as it should —
no slowdowns, the world loads. The two loose ends of the diagnosis are recorded at the bottom.

Everything below is the record as it stood before the cause was known — including its own worst moment: the
"5 object definitions with no DFF" line under *Related, real, and NOT this symptom* **was this defect**, measured
and mis-ranked while the day went to pools and entity counts.

---

**Symptom, in the user's words:** after installing our build over his GTA:SA, leaving an interior takes a very
long time to load the world; at first there is nothing, then only LOD geometry appears. HD models may arrive
eventually. Two screenshots: missing ground with floating palms and a lone door, then a district rendered
entirely as flat LOD boxes.

**The repro is TIGHT, and it is not about the map layers we spent the day on:** a clean game plus **only
`.work/1-mods`** — the mod-installer's output, before optimize/trees/procobj/LODs — already reproduces it,
with the install's BASE ini (`FILE_TYPE_TXD = 5000`, `COL = 280`, `IPL = 280`). Everything downstream of the
mods stage is exonerated.

## What is measured

| | clean game | after the mods stage |
| --- | --- | --- |
| `gta3.img` | 897 MiB · 16 316 entries | **1 185 MiB** · 16 389 entries |
| DFF payload | 307 MiB | 345 MiB (+12 %) |
| **TXD payload** | **557 MiB** | **805 MiB (+45 %, +248 MiB)** |
| ID pools at this stage | — | TXD 4000/5000 · COL 261/280 · IPL 190/280 |

The archives are structurally clean in both: **no duplicate entry names, no zero-size entries, none past EOF,
no overlapping spans, no fragmentation.** The growth is authored, not ours — the mods ship those textures at
exactly those sizes (`windfarm.txd` 5.33 MiB, `neonobj.txd` 4.13, `churchlite.txd` 3.00, byte-identical to
their source files), so the installer is not inflating them.

## Ruled OUT, each by measurement

- **ID pools** — nothing is near its cap at the mods stage (table above).
- **Duplicate model ids** — 0 across all IDEs.
- **A mod deleting stock content** — the two emptied stock interior IPLs (`gen_int1` 206 → 0 rows,
  `int_cont` 8 → 0) are **our own intentional, lossless slot compaction** (`ipl-slot-merge.ts`): an inst-less
  IPL takes no `IplEntityIndexArrays` slot, so their rows move into a stream-backed host. Counted on the real
  map: 399 placements of those models before, 400 after (+1 from a mod). Now pinned by a test.
- **`StreamingObjectInstancesList`** — raised 30 000 → 60 000 by the user, no change.
- **Our procobj layer, in every form we tried** — the symptom reproduces without it entirely.

## Still untested, and it is the cheapest next step

**`StreamMemoryForced = 1024` in `ImprovedStreaming.ini` has never been raised**, while the texture set the
streamer must hold grew 45 %. That is the one axis with a measured basis and an unmeasured knob. `MaxRAM` is
already 3200 there. One line, one launch, and the answer is one bit:

- world loads normally at 2048 → the budget is the constraint;
- no change → the axis is dead.

## Four axes that were WRONG, recorded so nobody re-walks them

Each looked compelling and each was falsified by measurement, in this order:

1. **ID pools.** Real on the FULL build (FLA's IPL pool fired at 522 of 280 and was raised to 1024) — but not
   at the mods stage, and not this symptom.
2. **Stream FILE count.** 217 285 instances at `STREAM_MAX_INST = 512` shipped 533 binary IPL files against
   ProperFixes' zero. Cut to 46 files (11.6×) — **no effect whatsoever.**
3. **Entity count.** Our layer carries 2 entities per object (HD + a separate LOD) against ProperFixes' 1 —
   182 184 vs 57 583, a 3.2× that the object counts (91 092 vs ~57 600, 1.6×) hide. A build at PF's entity
   scale was made but overtaken by the tighter `1-mods` repro.
4. **A mod corrupting the map.** Bisected to `0. Map Fixes Pack` — and then a trivial mod shipping one
   `readme.txt` reproduced the marker identically. **The bisection had no negative control; every arm was
   positive from the start**, and the marker was a feature.

## Related — one of these WAS the cause

- **5 object definitions with no DFF** after the mods stage (`LAw2.ide` ×3, `LAxref.ide` ×2) against 1 in the
  clean game — defined, placed, no geometry. **This was the defect**, written down and filed as a side-finding.
  What made it look harmless was the clean game's own count of 1: that one (`carupg_int_rays`) is placed
  NOWHERE, so a dangling declaration read as a thing SA tolerates. Placement was the discriminator, and it was
  one query away.
- **11 `IDE` lines land after the first `IPL` line in `gta.dat`**, and 137 placements reference ids those
  late IDEs define (`stadint` 135, `vegasE` 2). `gta.dat` loads top-down; our own `patchGtaDat` inserts before
  the first IPL for exactly this reason, but mods append their own lines at the end. **Still open, still real,
  and NOT this symptom** — the working install has the same late lines (`Missing Smokes Fix.ide` at 153) and
  plays fine.

## Loose ends left after the close

- **The two seat models keep their collision, and nobody has looked at the beach yet.** The 08-10 restore of the
  mod's `laxref.col` to a full library undid the author's deliberate removal, so 10 stubbed seats on Santa Maria
  may be invisible obstacles. Unobserved, not resolved — the confirming run did not go there. The trade and the
  coherent fix are in
  [mod-installer/010](../../../tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md).
- **The late `IDE` lines** above are untouched.
- **The ProperFixes-shaped placement restructure was never needed for this** and is not owed by it. If it is
  ever wanted for its own reasons, the shape is in
  [`gta-sa-original/reference-install-config.md`](../../gta-sa-original/reference-install-config.md) (6 files,
  ~9 600 rows each, every row `lod = -1`, zero binary streams, range from the IDE at 299) and the constraint is
  the 40-slot ceiling in [`restrictions/sa-target.md`](../../restrictions/sa-target.md).
