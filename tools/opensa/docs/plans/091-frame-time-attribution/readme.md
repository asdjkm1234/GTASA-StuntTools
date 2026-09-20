# 091 — Frame-time attribution: giving `other` a name

**Status: SHIPPED 2026-07-28 (all three phases). CLOSED 2026-08-02 — both branches answered, neither built.**
It took two field drives on the same day: the first found the world empty of cars, the second was run after
that was fixed. See [The field verdict](#the-field-verdict--2026-08-02) and
[the re-drive](#the-re-drive-on-a-populated-map--2026-08-02).

No fix was written — the plan only makes the frame's unaccounted time say what it is, and phase 3 names the
next step from the numbers rather than assuming it.

## Why

Slow frames of 19–225 ms have been reported since 2026-07-27 with the whole cost landing in one bucket:

```
other = dt*1000 − (fixed + collision + anim + vehicles + ped + stream + camera + render + blob)
```

`apps/web/src/ui/engine-canvas-host.tsx` — a **residual**, not a measurement. Its own comment admitted it: *"it
used to be most of a slow frame's length with nothing to name it"*.

The leading suspect used to be `vehicle-model-builder`, whose promise resolved straight out of a worker
`onmessage`. **That suspect no longer exists** — the builder and its worker were deleted with the runtime DFF
fallback ([postmortem](../../postmortem/runtime-modloader-overlay.md)), for correctness reasons, not because
anything was measured. **The spikes remained** (measured below), so the deletion answered nothing about them.

The standing rule this plan exists to obey: **measure first, fix second** — fixing the unmeasured cost a whole
session in 081/02.

## The finding that shapes the whole plan

`dt` is wall-clock between the **starts** of consecutive rAF callbacks. So `other` contains two very
different things:

1. untimed work **inside** the loop — small, and closable;
2. everything the browser did **between** frames — GC, worker `onmessage`, promise continuations, upload
   callbacks, event handlers.

**No timer placed inside the loop can see (2).** It is outside the region any in-loop timer spans. Since (2)
is where a resolved spawn is paid, a phase-1-only plan would produce a tidy breakdown that is silent about the
actual hole. Both phases were needed; phase 2 is the one that answered the question.

## Restrictions checked (per `CLAUDE.md`)

- [`restrictions/architecture.md`](../../restrictions/architecture.md) — the recorder is `type:engine`
  (`packages/engine`), so `apps/web` (`type:app`) may import it and so may the game layer. **This plan added a
  restriction of its own** to that file: a span may only wrap SYNCHRONOUS work that runs BETWEEN frames.
- The recorder is CPU-side only; nothing here touches WGSL, so
  [`restrictions/gpu-and-shaders.md`](../../restrictions/gpu-and-shaders.md) does not apply.
- `CLAUDE.md`: every figure produced went into
  [`docs/benchmarks/opensa-engine/2026-07-28-headless-091-frame-attribution.json`](../../benchmarks/opensa-engine/2026-07-28-headless-091-frame-attribution.json)
  before it was analysed, with the pak build recorded.

## Phase 1 — close the in-loop gaps ✅

Four named groups in `engine-canvas-host.tsx`: `props` (felled props), `world` (weather / environment driver /
zones / city / the time emit), `pose` (`viewOf`, the seated/riding lookups, the render-pose lerp) and `paused`
(the pause housekeeping).

**Measured, headless `?bench=all`, 2026-07-28:** all four are **0.00–0.20 ms** on every slow frame in the run,
including the 576 ms boot frame. They were never the residual — which is what phase 1 exists to establish.

**Two defects in the line itself came out of this phase, both of which had to be fixed before `other` meant
anything:**

- **The breakdown mixed two intervals.** `dt` is the interval that ENDED at this frame's start (the previous
  body plus the gap after it), while every block timer was this frame's. On steady frames the two are
  interchangeable; on the frames that matter they are not. It printed a **25.1 ms `stream` block inside a
  21.6 ms frame, and a residual of −7.2 ms**. The line now describes ONE interval: a `past` snapshot of the
  previous body, the spans drained at the top of this frame (that gap's own work), and this frame's blob time
  (the worker handler ran in that same gap).
- **`dt` is clamped at 250 ms** (`Math.min(0.25, …)` — the simulation must not integrate a hitch), and the line
  printed the clamp. The worst frame in the whole record read `250.0` when it was **576.1 ms**: a third of it
  was hidden inside a number that looked merely bad. The line now prints the real elapsed interval and names
  the clamp (`frame 576.1 (sim dt 250)`).

## Phase 2 — named spans for out-of-loop work ✅

`packages/engine/src/debug/frame-spans.ts` — a shared recorder (`frameSpans`): async work times its
SYNCHRONOUS segments into a named span, and the loop **drains** the totals at the top of the next frame, which
is the frame that paid for them. Nested spans keep their own self-time so nothing is counted twice; a span
that throws is still recorded.

The spans that exist, and where they had to be opened:

| Span | Where | What it is |
| --- | --- | --- |
| `vehicle-osm:<model>` | `GtaSaWorldAdapter.loadVehicleData` | the `.osm` section read + parse |
| `vehicle-model:<model>` | `engine-vehicles.buildModel` | `createVehicleModel` — the GPU upload |
| `vehicle-spawn:<model>` | `engine-vehicles.spawnVehicle` | the per-instance tail: physics body, rig, plate |
| ~~`cell-collision-read`~~ | ~~`GtaSaWorldAdapter.loadCellColliders`~~ | **REMOVED 2026-08-02** — it double-counted the `collision` block (§3 of the field verdict) |
| `cell-collision-bodies` | `CollisionStreamingSystem.load` | `createStaticColliders` in the `.then()` |

Two entries from the plan's original list are **not** there, deliberately: `cell-create` and `texture-upload`
run INSIDE `driver.update()` and are already inside `stream`; a span there would be subtracted twice. `pak-read`
is already timed as `blob` (the worker handler times itself, since 2026-07-27). `ped-load` has no runtime path
at all — peds are not streamed; the player's model is built once at boot.

The line now reads (a class with more than one member collapses to its total and its worst member — a boot
frame opens ninety spans and ninety names is a line nobody reads; nothing is dropped):

```
other 482.8 (vehicle-model ×43 97.9 (worst sadler 7.2) · cell-collision-read 78.3 ·
             vehicle-osm ×43 63.2 (worst vincent 7.8) · cell-collision-bodies 21.2 · unattributed 222.2)
```

### Measured — before / after, same pak (`buildTime 08:41 24-07-2026`), same host

| Frame | before 091 | after 091 |
| --- | --- | --- |
| boot | `frame 250.0 · other 223.6` — one anonymous number | `frame 576.1 (sim dt 250) · other 482.8` = model 97.9 + COL 78.3 + osm 63.2 + bodies 21.2 + **unattributed 222.2** |
| teleport (lv-night) | not decomposable | `frame 222.1 · other 194.8` = osm 59.2 + model 30.2 + COL 19.0 + bodies 7.5 + **unattributed 78.9** |
| boot settle | `other 14.7` | `other 12.2` = `vehicle-spawn ×49 8.2` + unattributed 4.0 |

The intermediate run with only three spans left **163.8 ms unattributed** on the boot frame; adding the two
adapter-side spans (`vehicle-osm`, `cell-collision-read`) took it to 49.0 on the equivalent frame. That is the
whole method in one line: every span was written because the previous run said where the hole was.

All three runs — before, intermediate, after — are recorded in the benchmark file (`priorRuns` carries the
first two), same pak and host, so the progression is checkable rather than narrated. **`250.0` in the before
row and `576.1` in the after row are the SAME frame**: the first printed the clamp.

| Run | boot-frame `other` | named | `unattributed` |
| --- | --- | --- | --- |
| before (no spans) | 223.6 (of a frame reported as 250.0) | — | all of it |
| three spans | 223.6 | 59.8 | 163.8 |
| five spans (final) | 482.8 (of the real 576.1) | 260.6 | 222.2 |

**The averages of the same sweep**: all eight scenes at the headless 120 Hz cap (8.33 avgMs, p95 9.2–9.3,
`lateCreates` 0), gpu pass at or below the 07-27 row — the instrumentation costs nothing measurable.

## Phase 3 — decide, having measured ✅

**1. The spikes are NOT the deleted builder.** They survived its removal unchanged; the plan's premise held.

**2. The gameplay-relevant cost is per NEW CAR TYPE, and it has two halves**, both one-off per type:

- `vehicle-osm` — reading and parsing the `.osm`: typical 0.4–2 ms, **worst single 20.5 ms (`bus`)**
- `vehicle-model` — the GPU upload: typical 0.5–2 ms, **worst single 18.2 ms (`tahoma`)**

A single unlucky type can therefore cost ~25 ms in one frame — a visible hitch, on a frame budget of 8.3.
That is the actionable number this plan was written to produce.

**3. The teleport/boot shape (27–43 types at once, 200–576 ms) is a BENCH shape**, not a play shape: the sweep
changes city in one frame. Its usefulness is as an amplifier — it is where the per-type costs were measured.

**4. `unattributed` is still 40–55 % of a spike** (78.9–222.2 ms), and it is **100 %** of the two frames that
FOLLOW a teleport (68.2 and 38.9 ms with no span open at all). Nothing is running there that the game asked
for — that is the GC signature, paid after ~30 car models and a city of cells were allocated and freed. It is
an answer, as the plan said it would be, not a failure.

### What the numbers name as the next step (not started, not pre-written)

- **If the field says a new car type hitches**: the lever is a BUDGET on the per-type work, the same shape the
  texture-upload fix took (`UPLOAD_BUDGET_MS`) — spread `vehicle-osm` + `vehicle-model` over frames instead of
  paying a whole type in one. The numbers say the ceiling is ~25 ms for the worst type, ~4 ms for a typical one.
- **If the GC tail is what is felt**: the question is allocation, not scheduling — what a spawn and a cell
  create allocate per unit — and it needs an allocation profile, not another span.
- **Neither is worth doing on a bench frame alone.** The measured windows of all eight scenes are clean
  (p95 9.2–9.3 ms, `lateCreates` 0). The next input is a FIELD verdict on a drive that meets new car types.

## The field verdict — 2026-08-02

One continuous human drive, `comet`, Ganton → Downtown LS → city centre → the freeway overpass → the whole
countryside → the desert → the whole of Las Venturas. The route was picked to cross the popcycle zone-types
that actually differ: `CITY_POPCYCLE_ZONE` maps **LA, SF and VEGAS all to `RESIDENTIAL_AVERAGE`**, so only
`COUNTRYSIDE` and `DESERT` reshuffle the random map cars — an LS→SF drive would have tested nothing new.
Census of the game's own `[slow]` lines (every frame over 20 ms, `perfLogs = IS_DEV`):
[`benchmarks/opensa-engine/2026-08-02-drive-091-field-verdict.json`](../../benchmarks/opensa-engine/2026-08-02-drive-091-field-verdict.json).

**The driver felt no hitch.** 223 slow frames, p50 **21.9 ms**, p90 25.0, and only **four** frames above
30 ms in the whole drive (two of them boot).

### 1. Branch A is UNTESTED, not dead — and finding out why was the drive's real yield

**Zero of the 223 slow frames carried `vehicle-osm`, `vehicle-model` or `vehicle-spawn`**, which reads like an
answer and is not one. The driver's own account is what exposed it: *across the whole route they met parked
cars exactly once*, on one lot in LS. The world was empty because of two defects, both found by chasing that
sentence:

- **`parked.json` is the only car population that exists** — 212 placements, **24 distinct models**, all
  spawned at BOOT. Every type it can ever cost was therefore paid before the drive began.
- **The map car generators are not wired.** `GtaSaWorldAdapter.mapCarGenerators()` — plan 059's ~1043
  generators, including the ~740 random ones resolved through `popcycle`/`cargrp` — is implemented, unit
  tested, and **called by nothing but its own test**. 059's readme claims the runtime wiring ("`canvas-host`
  hands them to the vehicle LOD system") and that wiring does not exist. `vehicles.register()` has exactly one
  caller in the repo: the BENCH runner.

So the drive could not meet a new car type, and the count of zero measures the world's emptiness, not the
cost of a spawn. **The per-type budget lever stays unbuilt and the question stays open.**

Both defects were fixed on 2026-08-02 — the generators are wired again (1043 of them: 742 random, 301 specific
across 83 model ids) and `parked.json` is registered lazily rather than spawned at boot. The re-drive that made
possible is below, and it is what actually answers branch A.

**The method lesson, which is the transferable part:** a count of zero is only evidence if the thing being
counted had a chance to happen. Nothing in the log said the world was empty — the drive looked clean, the
census looked clean, and the verdict written from them was wrong. It took the driver saying *"I only saw cars
once"* to turn a null result into two defects.

### 2. Branch B is dead — `unattributed` on a real drive is the GPU, not the GC

217 of 223 slow frames are dominated by `other`, with no span open at all, which is the signature phase 3
read as GC. The drive says otherwise: on those same frames **the GPU pass averages 13.73 ms (max 19.79) while
the CPU render block is 0.1–0.6 ms** — 204 of 223 are above 8 ms of GPU. The CPU has nothing to do; the frame
interval stretches because the GPU has not finished, and rAF charges that stretch to the gap between frames,
where no in-loop timer can see it. **`unattributed` is not one thing.** On the bench shape (teleports, 30+ car
models allocated and freed in a frame) it was allocation. On a drive it is GPU backpressure. Anyone reading a
future `unattributed` number must check `gpu` on the same line before naming it.

The driver's own observation is the same finding from the other end: in LV with no other cars, **~50 fps at
top speed and 70–80 fps under braking**. That is the speed camera, and it is a GPU cost — see
[`performance/deferred-optimizations/vehicle-speed-camera-framing.md`](../../performance/deferred-optimizations/vehicle-speed-camera-framing.md).

### 3. A defect in this plan's own instrumentation: `unattributed` can go NEGATIVE

Three frames printed a negative `unattributed`, worst **−65.9**:

```
frame 118.7 · collision 76.0 · other 30.0 (cell-collision-read 75.7 · cell-collision-bodies 20.2 · unattributed -65.9)
```

`collision 76.0` and `cell-collision-read 75.7` are the same work. `loadCellColliders` is `async` but has no
`await` in it, so its whole body runs **synchronously inside `collision.update()`**, which the loop already
times as the `collision` block — and the span subtracted it a second time. Exactly the trap phase 2 avoided
for `cell-create` and `texture-upload`, and a violation of the restriction this plan itself added (*a span may
only wrap SYNCHRONOUS work that runs BETWEEN frames*). **Nothing catches it**: the only symptom is a minus
sign in a line a human has to read, which is how it survived this plan's own close-out.

**FIXED 2026-08-02 by deleting the span** (`GtaSaWorldAdapter.loadCellColliders`), with the reasoning left at
the site so it is not re-added. The cost is not lost — the `collision` block already reports it, and on all
three offending frames the block and the span were the same number to within 3 ms, so the span was telling
nobody anything new. The plan's phase-2 span table loses `cell-collision-read`; `cell-collision-bodies` stays,
because that one really does run in a `.then()`. The other caller (`refreshCollision`, the debug
collision-lines viewer) is out-of-loop but off by default, and a span that exists only under a debug toggle is
worse than none.

## The re-drive, on a populated map — 2026-08-02

Same day, same host, after the map got its cars back. Route: LS → countryside → SF → the countryside near
Mount Chilliad → back to LS → Las Venturas at dusk, in a `comet`. The world now holds ~1255 cars against the
first drive's 212, and 100+ models against 24. Census:
[`benchmarks/opensa-engine/2026-08-02-drive-091-populated-map.json`](../../benchmarks/opensa-engine/2026-08-02-drive-091-populated-map.json).

**Branch A is answered, and the answer is: do not build the budget lever.**

- **`vehicle-spawn` spans appeared for the first time** — 14 frames over 12 models (`elegant`, `peren`,
  `bravura`, `solair`, `picador`, `sunrise`, `fortune`, `bf400`, `blade`, `vincent`, `clover`, `pcj600`) — at
  **0.2–0.3 ms each**. The per-instance tail is free; those frames were slow for GPU reasons and a spawn merely
  happened during them.
- **`vehicle-osm` and `vehicle-model` are STILL zero** — and this time the zero is evidence, not an empty
  world. Types were demonstrably arriving throughout the drive across four popcycle zones. The per-TYPE cost
  simply never coincides with a frame the game calls slow.

Why that does not contradict phase 3's ~25 ms ceiling: those figures came from a **teleport bench where 27–43
types landed in a single frame**. Arriving one at a time, ahead of the player at the streaming radius, the same
work never crosses 20 ms. The ceiling is real and the shape that produces it is not a play shape — which is
exactly what phase 3 suspected and could not confirm.

**The frame distribution got TIGHTER with five times the cars**: p50 21.3 ms and p90 24.1 against the empty
map's 21.9 / 25.0. (The raw slow-frame count went 223 → 1004, but neither run recorded its duration, so only
the distribution is comparable.) What the cars did cost is GPU: **pass mean 13.73 → 15.64 ms**, max 19.79 →
21.89, draws p50 1049 → 1113 and max 1999 → 2193. Same GPU-bound shape as before, more of it.

Two field notes worth keeping:

- **The worst frame of the drive, 237.2 ms**, carried no span at all (gpu 11.53, `unattributed` 235.3) — the
  GC/browser signature again, one event in a state-wide drive, and the one place the driver felt anything
  (near `1089.7, -1848.6`). It also tripped the `[cam] jump` tripwire at `dt 237.2 · dist 5.90`, which is a
  **consequence** of the stall: the car really did move 5.9 m in that frame. Do not read that line as a camera
  defect.
- **A lot full of taxis with three coaches on screen** (`1806.3, -1893.1`, LS airport) ran at **9.66 ms /
  104 fps, 1502 draws**. Cars on screen are not the problem; a wide lens at speed is
  ([the framing lever](../../performance/deferred-optimizations/vehicle-speed-camera-framing.md)).

**Zero negative `unattributed` frames** — the double-counted span really is gone. **Zero
`has failed to spawn` warnings** — no entry got stuck, which is the first time that could have been seen at
all.

## Out of scope (held)

- Any change to how work is scheduled. This plan added measurement and nothing else.
- The GPU-side timings (`gpuPassMs`/`gpuPostMs`/`gpuProbeMs`) — already reported and not part of the residual.

## Harness note

`tools-debug/bench-harness/drive.js` clicked its run button before React had rendered the menu, so `count()`
read 0, the click was silently skipped and the run timed out 240 s later on a canvas nobody had asked for.
It now waits for the button. Any harness run before 2026-07-28 that "hung at boot" was probably this.
