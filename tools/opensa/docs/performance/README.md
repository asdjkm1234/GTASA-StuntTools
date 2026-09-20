# Performance reserve

Work we **deliberately did not do**, each of which would buy frame time or memory if we ever need it. This
is the plan-B list: when a build comes back too slow, read this before inventing anything, because the
cheapest wins are usually already written down here with their price attached.

Most entries have the same shape — **the same result, computed earlier**. We keep choosing the runtime side
of that trade for good reasons (one code path across asset classes, no format churn, no re-convert to see a
change), and every one of those choices leaves a precomputation on the table. That is what this rubric
collects.

**Maintenance rule** (also in `CLAUDE.md`): when a change picks the runtime path over a precomputed one — or
takes any deliberate cost for correctness, simplicity or moddability — add the alternative here in the same
change, with what it would save, what it would cost, and what would have to be true to pull it.

An entry is not a plan and not a promise. It is a lever with a measured price, so the decision at 30 fps is
a lookup rather than a redesign.

## The impact scale — read this one first

Every entry carries an **Impact** line: **how much frame time pulling this lever would actually buy.** That
is the question at 30 fps, and until now it was spread across each entry's prose in whatever units the
measurement happened to use.

| Rating | What it means |
| --- | --- |
| **very low impact** | Nothing you would see. Noise against the frame, or a win on an axis that is not frame time at all. Pull it for a reason other than speed, or not at all. |
| **low impact** | A real but small share — roughly a few tenths of a millisecond, or a win that only appears in a narrow situation. |
| **medium impact** | Around a millisecond, or several on the scene class it targets. Worth doing when that class is what is slow. |
| **high impact** | Multiple milliseconds, or a measured frame-rate change. These are the ones that answer a blown budget. |

Two things the scale deliberately does not hide:

- **Measured vs inferred.** Some numbers here come from an A/B (foliage: 13.72 → 7.63 ms); others are
  arithmetic that agrees with the field but was never isolated (the speed camera). The line says which, and
  an inferred rating is a reason to run the A/B first, not to skip it.
- **The axis.** A lever can be very low impact on frame time and the biggest item on the list for memory
  (per-ring texture laziness) or for looks (the clutter floor). Frame time is what the rating means unless it
  names another axis.

Each entry also carries an **Effort** note — what the work would cost — because the two are independent and
the cheap-and-useless combination is common: the clutter floor is two config values and buys 0.34 % of one
target's object count. Impact decides whether to want it; effort decides what it costs to get.

| Rating | Effort means |
| --- | --- |
| **very low** | A config value or a constant. No new code path, nothing to re-convert. |
| **low** | A contained change inside one system — no format, no build product, no shared invariant. |
| **medium** | Several files or a subsystem, or a converter change that needs a re-convert to judge. |
| **high** | A format or pipeline change, a new build product to version, or an invariant other systems are built on. Expect a plan chain. |

Where an entry holds several levers (foliage, the speed camera), the line gives the range and names which
lever sits at each end — **the cheap end is what to try first, and it is usually not the one the title
describes**.

Distinct from the neighbouring rubrics (a restriction is what a design MAY NOT do — [`../restrictions/`](../restrictions/README.md)):

- `docs/benchmarks/*` — measured runs, the evidence any of this would be judged against.
- `docs/improvements/*` — nice-to-have enhancements, parked; about features, not about cost.
- `docs/edge-cases/*` — limits we live with today, not levers we could pull.
- `docs/ideas/*` — design directions not scheduled yet.

Entries live in [deferred-optimizations/](deferred-optimizations/), one file per lever. A lever that gets
pulled moves to [applied/](applied/) with its outcome recorded in the entry's status line (its row below
stays, pointing at the new home).

| Lever | Axis | Est. win | Status |
| --- | --- | --- | --- |
| [Bake vehicle sky-occlusion in opensa-pack](deferred-optimizations/vehicle-ao-baking.md) | spawn hitch | 8–78 ms per model, once per model, spawn path only | in reserve — not needed |
| [Automatic render-scale / quality-tier ladder](deferred-optimizations/render-scale-tier.md) | GPU pass | 0.4–1.4 ms (measured ceiling), targets 345 → 88 MB | measured and refused |
| [MSAA sample count as a budget number](deferred-optimizations/msaa-sample-count.md) | memory (render targets) | ~22 MB on a phone — 65.7 % of the `target` category, 29 % of the whole 74.9 MB residency measured 2026-08-12 | in reserve — residency does not press yet, and the cost is aliasing on a view made of silhouettes |
| [The idle console still wakes ten times a second](deferred-optimizations/idle-loop-stop.md) | wakeups (battery) | stopping the loop entirely at rest removes ~36 000 timer wakes an hour, against the 100 ms poll that keeps *nothing changed* a STATE rather than an event somebody has to remember to raise | in reserve — an event-driven wake is one forgotten `wake()` away from a map that looks frozen, and the battery delta that would justify it is 4/01's unpaid number |
| [A unit's `_vlo` mesh at city zoom](deferred-optimizations/unit-model-lod-band.md) | triangles (the fleet) | unmeasured — every converted car already ships the low-detail mesh in the same buffers, and the console draws the full body at every zoom | in reserve — 201/5-04's own number (150 units with models, on a phone) is unpaid, and switching first would spend the honest worst case the first capture is for |
| [The radar redraws a city outline that never changes](deferred-optimizations/radar-outline-cache.md) | 2D canvas calls | 160 of the radar's 914 calls a repaint are a static district outline; an offscreen cache makes it one blit, and the saving grows with the world's zone count rather than with the board | in reserve — the repaint is already conditional (a still console draws nothing), and nothing here has been timed on a device |
| [WGSL ships as written — comments and indentation](deferred-optimizations/wgsl-source-text.md) | download bytes | 50.6 kB raw / **22.1 kB gzip — 13.2 % of the dispatch download**, for a build-time text transform that changes no shader | in reserve — the download budget does not bind, and it moves every shader-error line number |
| [Per-ring texture laziness](deferred-optimizations/per-ring-texture-laziness.md) | memory | under the ~767 MB world-array floor | in reserve |
| [Compress UV-animation keyframes in the `.osm` DESC](deferred-optimizations/uv-anim-keyframe-encoding.md) | pak bytes · spawn parse | 19 312 B on the one animated model — 94 % of its DESC, 0.49 % of its file | in reserve — noise until animated models are common |
| [One draw per visible vehicle submesh](deferred-optimizations/vehicle-submesh-draw-batching.md) | draw count | unmeasured; the axis the pass floor lives on | in reserve |
| [One texture array per vehicle, at its largest texture's size](applied/vehicle-texture-array-buckets.md) | build size · VRAM · spawn hitch | 220 → 34 MB by size buckets, → 26 MB with BC1; comet.osm 136.6 → 20.3 MB measured | **PULLED 2026-08-04** — forced by the VER2 128 MB entry ceiling, not by frame time; a shared dictionary stays REFUSED (8 %) |
| [Env-probe cadence and resolution](deferred-optimizations/env-probe-cadence.md) | GPU pass | 0.2–1.9 ms observed, ~5.8 ms worst seen | in reserve |
| [Foliage fill](deferred-optimizations/foliage-fill.md) | GPU pass (fill) | the 07-21 case was 13.72 → 7.63 ms | parked by decision |
| [Per-wheel surface probe vs surface-tagged colliders](deferred-optimizations/surface-probe-per-wheel.md) | fixed-step CPU | ~free today (driven car only); ~0.6 ms/step if ever run on all 80 cars | in reserve |
| [Bake video-mode camera stations instead of surveying them live](deferred-optimizations/video-station-survey.md) | per-frame casts | ~free today (≤ 3 casts/frame, one shot in four); the win is HEADROOM for several tripods at once | in reserve |
| [The speed camera's framing cost (FOV kick + distance gain)](deferred-optimizations/vehicle-speed-camera-framing.md) | GPU pass (fill) | ~×1.47 screen-projected world area at top speed; the field reads 50 fps flat-out vs 70–80 braking. Floor of the ladder: a STATIC framing, config-only, gives it all back | in reserve |
| [Convert only the map objects a district places](deferred-optimizations/district-map-object-subset.md) | build time (phone) | the dominant share of a district convert — 14 269 models walked for a 2x2 rect; ~90 % of the 2026-08-06 phone run's tail | in reserve — the failure mode is a CRASH on the target device, not a slower build |
| [Bake the procobj scatter, the way collision is now baked](deferred-optimizations/procobj-scatter-bake.md) | cold-cell main thread | unmeasured in isolation; it is the last per-cell COL work left on the collision path (and what keeps a whole-archive COL parse alive) | in reserve — opened by 200/3-01 |
| [Camera position render interpolation](deferred-optimizations/camera-position-render-interpolation.md) | correctness (camera feel) | unlocked the 080/02 position weight + killed the run "doubling" | **PULLED 2026-07-25** |
| [Budgeted texture-array uploads](applied/texture-upload-budget.md) | frame time (hitch) | one 85 ms stall → ~1.5 ms/frame | **PULLED 2026-07-27** — applied |
| [Budgeted static-collider builds](applied/collider-build-budget.md) | frame time (hitch) | a 5.6–28.1 ms per-cell spike → ~1.5 ms/frame — **estimated, not measured** | **PULLED 2026-08-04** — applied, measurement owed |
| Lever | Impact | Axis | Est. win | Status |
| --- | --- | --- | --- | --- |
| [Bake vehicle sky-occlusion in opensa-pack](deferred-optimizations/vehicle-ao-baking.md) | **very low** | spawn hitch | 8–78 ms per model, once per model, spawn path only | in reserve — not needed |
| [Bake the procobj clutter into the pak](deferred-optimizations/procobj-baked-into-the-pak.md) | **very low** (costs, not buys) | contact AO on clutter · per-cell scatter at stream-in | would cost 91 092 vertex-DUPLICATED instances in a pak already at 105.8 M HD verts (its AO bake: 1.01 G rays / 21 min), and take density back off the runtime knob | deferred 2026-08-10 — the runtime path is the cheaper side of both trades |
| [Turn the clutter species-roster floor back off](deferred-optimizations/procobj-species-roster-floor.md) | **very low** | `sa` object count · `opensa` per-cell CPU | 312 permanent rows of 91 379 (0.34 %) on `sa`; **nothing measurable** on `opensa` (the floor swaps a placement, never adds one) | cost TAKEN 2026-08-11 — very low effort to give back (two config values), and 17.7 % of clutter cells lose a species if you do |
| [Automatic render-scale / quality-tier ladder](deferred-optimizations/render-scale-tier.md) | **low** frame · **medium** memory | GPU pass | 0.4–1.4 ms (measured ceiling), targets 345 → 88 MB | measured and refused |
| [Dedupe the clone-LOD textures into a `txdp` parent again](deferred-optimizations/salod-txdp-parent-dedup.md) | **none per frame** | archive bytes | 10.4 MB against the 45.9 MiB the self-contained dictionaries measure today | **KEPT** — dropping the parent was tried on 2026-08-16 and reverted the same day: the field saw no difference and the self-contained shape cost 45.9 MiB against 10.4 MB. 49 % of 4 050 clone LODs depend on the parent, so the chain is worth proving in EITHER direction one day |
| [Per-ring texture laziness](deferred-optimizations/per-ring-texture-laziness.md) | **very low** frame · **high** memory | memory | under the ~767 MB world-array floor | in reserve |
| [Compress the PNG replacements the game never reads back](deferred-optimizations/compress-sampled-png-replacements.md) | **none** frame · **low–medium** memory | memory (`sa` target) | 15.2 MB resident, minus ~27 KB for the plate charset | in reserve — needs a list of the original's CPU-read rasters |
| [Compress UV-animation keyframes in the `.osm` DESC](deferred-optimizations/uv-anim-keyframe-encoding.md) | **very low** | pak bytes · spawn parse | 19 312 B on the one animated model — 94 % of its DESC, 0.49 % of its file | in reserve — noise until animated models are common |
| [One draw per visible vehicle submesh](deferred-optimizations/vehicle-submesh-draw-batching.md) | **medium**, inferred | draw count | unmeasured; the axis the pass floor lives on | in reserve |
| [One texture array per vehicle, at its largest texture's size](applied/vehicle-texture-array-buckets.md) | **high** (build/VRAM) | build size · VRAM · spawn hitch | 220 → 34 MB by size buckets, → 26 MB with BC1; comet.osm 136.6 → 20.3 MB measured | **PULLED 2026-08-04** — forced by the VER2 128 MB entry ceiling, not by frame time; a shared dictionary stays REFUSED (8 %) |
| [Env-probe cadence and resolution](deferred-optimizations/env-probe-cadence.md) | **low**, **medium** when hot | GPU pass | 0.2–1.9 ms observed, ~5.8 ms worst seen | in reserve |
| [Foliage fill](deferred-optimizations/foliage-fill.md) | **HIGH** on the axis | GPU pass (fill) | the 07-21 case was 13.72 → 7.63 ms | parked by decision |
| [Per-wheel surface probe vs surface-tagged colliders](deferred-optimizations/surface-probe-per-wheel.md) | **very low** | fixed-step CPU | ~free today (driven car only); ~0.6 ms/step if ever run on all 80 cars | in reserve |
| [Bake video-mode camera stations instead of surveying them live](deferred-optimizations/video-station-survey.md) | **very low** | per-frame casts | ~free today (≤ 3 casts/frame, one shot in four); the win is HEADROOM for several tripods at once | in reserve |
| [The speed camera's framing cost (FOV kick + distance gain)](deferred-optimizations/vehicle-speed-camera-framing.md) | **HIGH**, inferred | GPU pass (fill) | ~×1.47 screen-projected world area at top speed; the field reads 50 fps flat-out vs 70–80 braking. Floor of the ladder: a STATIC framing, config-only, gives it all back | in reserve |
| [Camera position render interpolation](deferred-optimizations/camera-position-render-interpolation.md) | n/a — a FEEL lever | correctness (camera feel) | unlocked the 080/02 position weight + killed the run "doubling" | **PULLED 2026-07-25** |
| [Budgeted texture-array uploads](applied/texture-upload-budget.md) | **high** (hitch) | frame time (hitch) | one 85 ms stall → ~1.5 ms/frame | **PULLED 2026-07-27** — applied |
| [Budgeted static-collider builds](applied/collider-build-budget.md) | **high** (hitch) | frame time (hitch) | a 5.6–28.1 ms per-cell spike → ~1.5 ms/frame — **estimated, not measured** | **PULLED 2026-08-04** — applied, measurement owed |

## How to use it when the frame budget is blown

1. Find the stage that is actually slow (`docs/benchmarks/readme.md` has the harness and the schema).
2. Scan this list for a lever in that stage — spawn hitches, streaming, GPU pass, memory.
3. **Sort what is left by the Impact column, and stop at the first "very low".** Most of this list cannot fix
   a frame and says so with numbers: five entries are noise on frame time and two of those are not frame-time
   levers at all. Today's honest shortlist is **foliage fill** and **the speed camera's framing** (both
   multi-millisecond, one measured and one only inferred), with **env-probe cadence** behind them.
4. Read the entry's **cost** section next. Every lever here was refused for a reason, and the reason does not
   disappear because the frame rate dropped; it just gets weighed against a real number.
5. If the rating says **inferred**, run the A/B the entry names before doing any work — an arithmetic that
   agrees with the field is not an attribution.
6. If you pull one, record the before/after in `docs/benchmarks/` and move the entry to a plan.
