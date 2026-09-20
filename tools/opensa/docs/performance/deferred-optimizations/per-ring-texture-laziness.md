# Per-ring texture laziness (the ~767 MB world-array floor)

**Status:** in reserve — the last untouched item of the streaming/residency arc
([plan 074/05](../../plans/074-opensa-engine/05-streaming-runtime.md),
[074/21](../../plans/074-opensa-engine/21-fog-draw-distance.md)).

**Impact: VERY LOW on frame time, HIGH on memory — and the axis is the whole point.** The entry says it
outright: this buys nothing on frame time directly. What it buys is up to several hundred MB under the
**~767 MB world-array floor**, the largest single residency item left after the streaming arc. That is not
speed, it is the ability to raise draw distance, keep more districts warm, or run on a smaller GPU without
thrashing. The 30-minute soak shows residency FLAT at 1805 MB, so nothing is being wasted per frame today —
only held. **Do not reach for this one when a frame is slow.**

**Effort: high.** It is not a runtime-only change: the arrays are a converter product, so splitting their
packing by ring means a re-pack and giving up the map-wide content dedup that packing depends on. On the
runtime side it re-opens the residency race the whole streaming arc was spent closing (`lateCreates`,
pop-in), which means the late-create counters have to be watched through every field round. **The two cheaper
things at the bottom (`?draw=`, lowering the vehicle LRU floor) are very low effort** and sit on the same
axis.

## What we do today

A district's texture ARRAYS are resident as a block. Range-read IO already stopped the multi-GB pak from
living in memory (full-LS startup transfer 1.15 GB → ~212 MB) and the vehicle-model cache became LRU-bounded
by a 256 MB texture budget (end-of-sweep texture bucket 2657 → 1161 MB, −1.5 GB). What is left underneath
all of that is a **~767 MB world-array floor** — every idle vehicle type evicts down to it and it does not
move.

## The lever

Make the world arrays lazy per LOD RING: a texture only becomes resident when a ring that samples it is
streamed in, and leaves with it. The cells already stream this way; their dictionaries do not.

## What it would win

Headroom under the floor — up to several hundred MB on a district, the largest single residency item left.
It buys nothing on frame time directly; it buys the ability to raise draw distance, keep more districts warm,
or run on a smaller GPU without thrashing.

## What it would cost

- Residency becomes ring-dependent, so a fast approach to a district can miss a texture the frame needs —
  the class of bug the streaming arc spent the most time closing (`lateCreates`, pop-in). Any version of this
  needs the late-create counters watched.
- The world planner's array packing is content-deduped across the whole map; splitting it by ring cuts that
  dedup, so the SUM of the parts is bigger than the whole even as the resident subset shrinks.
- A re-pack (the arrays are a converter product), i.e. it is not a runtime-only change.

## What would have to be true to pull it

- Memory is what actually hurts: OOM, eviction thrash, or a target device with less VRAM than the floor.
- Soak evidence that the working set really is a subset of the district — the 30-minute headless soak
  (index row #20) shows residency FLAT at 1805 MB, so today nothing is being wasted per-frame, only held.

## Cheaper things to try first

- `?draw=` (fewer rings resident at once).
- Lower the vehicle LRU floor below 256 MB before touching the world arrays — same axis, no format work.
