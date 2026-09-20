# Benchmarks — the measurement record

**Standing rule: every measured number gets committed here, immediately, in the format of its family.** Not
summarised into a plan doc, not left in chat. A number that exists only in a conversation is gone the moment
the session ends, and a regression cannot be diagnosed without the run it regressed from.

**Three families live here**, because the repo measures three different things and their schemas do not
mix:

- **Performance** — what a frame COSTS (fps, frame/GPU ms, draws, residency). Everything below is this
  family; it was consolidated into this folder on 2026-07-20, split by renderer.
- **Vehicle physics** — what a car DOES (stopping distance, roll, slip, flips). Its own schema and
  chronology: [`vehicle-physics/`](vehicle-physics/) (plan 081, the `[phys]` capture protocol).
- **Tool builds** — what a build tool PRODUCES and how long it takes (run wall-clock, input/output
  sizes, per-item tables). Its own chronology: [`tools/`](tools/).

The performance family, split by renderer:

- [`opensa-engine/`](opensa-engine/) — the own WebGPU engine: the run JSONs plus four written analyses —
  [`2026-07-18-series.md`](opensa-engine/2026-07-18-series.md) (the annotated engine-vs-prod narrative,
  tables also extracted as JSON alongside), [`2026-07-21-http-dir-sweep.md`](opensa-engine/2026-07-21-http-dir-sweep.md),
  [`2026-07-21-scale-ladder.md`](opensa-engine/2026-07-21-scale-ladder.md) and
  [`2026-07-21-layer-decomposition.md`](opensa-engine/2026-07-21-layer-decomposition.md).
- [`three-engine/`](three-engine/) — the three.js/WebGL prod line, kept for the before/after record.

Chronology, with the conditions each run was taken under: [index.md](index.md). **Read that before
comparing any two numbers** — the runs come from two different harnesses and several different paks.

How to produce a run: [`../development/benchmarks.md`](../development/benchmarks.md) (`?bench=all`, the
`[bench]` console protocol, the headless harness at `tools-debug/bench-harness/`).

## File naming

`<engine>/YYYY-MM-DD-<surface>-<what>.json` — e.g. `opensa-engine/2026-07-20-ingame-regression.json`.
`surface` is `ingame` (the in-game `?bench=all` sweep), `drive`/`city`/`map`/`teleport`/`whip` (headless lab
paths) or `headless`; `what` is why the run was taken.

## Format

```jsonc
{
  "note": "Why this run exists, WHO ran it, on what machine, and anything that makes it non-comparable.",
  "runs": [
    {
      "key": "ls-noon", // bench scene id
      "avgMs": 9.66,
      "p95Ms": 24.0, // the number that catches stutter — never drop it
      "fps": 103.5,
      "frames": 1554,
      "avgDrawCalls": 1202,
      "gpuMs": { "pass": 4.841, "post": 1.087, "probe": 1.154, "submit": 1.417 },
      "residency": "cellIndex 41 · cellVertex 172 · target 424 · texture 1181 · uniform 1",
      "lateCreates": 0,
      // The VEHICLE slice of ONE fixed step (081/07 §3's budget), and the car count that produced it:
      // the raycast controllers plus the vehicle system's fixed update, apart from the solver and from
      // the per-frame visual tick. Present from 2026-07-27; older runs have no such field.
      "vehicles": { "live": 80, "meanMs": 0.604, "maxMs": 1.1 },
    },
  ],
}
```

Copy the `[bench]` JSON lines verbatim; add `note` by hand. If a run came from a chat paste rather than a
file, **say so in `note`** — pastes lose fields, and a later reader must not mistake one for a full capture.

## What makes two runs comparable

A perf comparison is worthless without these held equal, so record them in `note` when they are not obvious:

- **machine and DPR** (the series is M3 Pro @2× retina)
- **a regression report names the LANE of both sides before it names a suspect.** On 2026-08-17 the user's
  display sweep (`target 422`) was tabled against Claude's headless capped row (`target 345`) and read as a
  GPU-pass ×2.5–3.3 on the new pak; four in-game arms and an issue file later, the same-lane delta was ×1.1
  on the scene that "tripled" (`country-dusk`) — his display had cost 2–3× the headless canvas on that scene
  since 08-09. The tell was already in the record: an in-game row from BEFORE the suspect change on the same
  lane. Look for one first
  ([the closing](../open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md))
- **a single DISPLAY-lane run is not a measurement.** On 2026-08-09 one `?bench=all` sweep came back with
  every scene's `p95` 2–3× worse (`lv-night` 16.4 → 50.0) on unchanged content; a re-run of the same pak and
  the same code matched the earlier numbers to the millisecond. Something outside the app had the machine.
  **The tell was `ocean-horizon`** — no cars, identical `avgTriangles`, untouched by the change under test,
  and its `p95` doubled anyway: a scene that CANNOT have been affected moving with the rest means the cause
  is session-wide. Keep one such scene in view as the control, and re-run before reporting a regression
  ([the anomaly](opensa-engine/2026-08-09-ingame-user-display-102-before-after.json))
- **the road-car population** (`[bench] road cars registered: N` — the series ran 841)
- **the pak** the run read. Converter output changes what the world contains; a pak that is missing far
  LODs benchmarks faster than one that has them, and the numbers look like a code regression when nothing
  in the code moved. **Name the pak build.** Naming note: `build/original` was called `build/perfect`
  until 2026-07-23 (plan 086) — rows recorded before that date read the same folder under its old name.
- renderer flags (`?scale=`, `?draw=`, `?engine=`)

## Mobile runs: a different schema, and never a comparable one

A phone is not a small desktop for measuring purposes, and the difference is structural rather than a matter
of degree.

**`gpuMs` does not exist there.** The 2026-08-04 Mali-G51 adapter carries no `timestamp-query`, so the HUD
falls back to CPU timings by design — which means the one column the desktop series is read by is simply
absent. A mobile row that fabricates it, or that is compared against a desktop row on the strength of
`avgMs` alone, is worse than no row.

So a mobile run reports what it can actually observe, and states the rest:

```jsonc
{
  "note": "Why, WHO ran it, and what could not be measured. Say if the browser needed a flag.",
  "device": {
    "adapter": "ARM Mali-G51 / Bifrost", // navigator.gpu adapter info, verbatim
    "browser": "Yandex 26.6.2 (Chromium 148)",
    "os": "Android 10",
    "features": ["texture-compression-astc", "texture-compression-etc2"], // what it HAS
    "missing": ["texture-compression-bc", "timestamp-query"], // what it does NOT — this decides the schema
    "featureLevel": "core", // "core" | "compatibility" — a compatibility adapter has REDUCED limits
    "css": "360x800",
    "dpr": 2,
  },
  "world": {
    "pak": "10:53 29-07-2026", // manifest buildTime — or "synthetic (?demo=1)" when there is no pak
    "platforms": ["mobile"], // report.json's `platforms.satisfies` for that pak
  },
  "runs": [{ "key": "…", "avgMs": 24.1, "p95Ms": 41.0, "fps": 41, "avgDrawCalls": 162, "residency": "…" }],
}
```

**The `device` block is emitted, not typed by hand.** A `?bench=` sweep prints `[bench] device {json}` once
at the start (it does not vary by scene) — `engine.deviceReport`, i.e. the adapter's own feature list, what it
is missing, its feature level, and the CSS size and DPR the run was taken at. Copy it verbatim like the
per-scene lines; `world` and `note` are still yours to fill in.

Three rules, all learned from the one mobile row this record has:

- **A mobile row and a desktop row are never compared** — the same rule that already separates the lab and
  in-game families, for a stronger reason.
- **`device` is not optional.** The 08-04 row exists because a developer flag lifted Chromium's adapter
  blocklist; without that stated, it reads as a shipping configuration and it is not one. A run taken behind
  a flag measures HARDWARE CAPABILITY, never reach.
- **`world.platforms` closes the loop with the build.** `opensa-pack` records which GPU families a build's
  textures allow; a mobile row that does not name it cannot be reproduced, because the pak is the variable
  that decides whether the world loads at all.
**And check `avgTriangles` BEFORE reading any `gpuMs.pass` delta.** Two arms of the same scene must draw the
same world; when the triangle count moves by more than the content change can explain, the row is measuring
the harness, not the build. Earned 2026-08-08 on the 07/04 density A/B: three of nine scenes disagreed — the
control scene `ocean-horizon`, which no map layer moves, by **+107 %** — while `lateCreates` stayed 0 and
every report looked normal. The cause is a live defect
([`open-issues/bench-scene-transition-collision.md`](../open-issues/bench-scene-transition-collision.md)):
collision is missing across a scene teleport, so what streamed in differs run to run. Until it is fixed, a
scene-to-scene A/B on this harness cannot resolve anything smaller than its own drift.

## Runs

See [index.md](index.md) — the full chronological table with conditions.

## RESOLVED: the 2026-07-20 "regression" is the cost of a complete map

**It was never a code regression.** A four-point bisect on a fixed pak settled it in one sitting, and the
user's own account of the map confirmed the cause.

Against the 07-18 baseline ([JSON](opensa-engine/2026-07-18-ingame-preflip-baseline.json)):

| scene         | fps 07-18 → 07-20 | draws       | GPU pass         |
| ------------- | ----------------- | ----------- | ---------------- |
| ocean-horizon | 120.0 → **120.0** | 11 → 19     | 1.85 → **1.78**  |
| ls-rain-night | 120.2 → 117.5     | 1046 → 960  | 2.59 → 4.29      |
| ls-noon       | 120.1 → 112.1     | 1036 → 1202 | 2.48 → 4.97      |
| lv-night      | 120.0 → 75.6      | 1065 → 1680 | 3.14 → 8.77      |
| sf-fog-dawn   | 120.3 → 105.4     | 842 → 1019  | 2.85 → 4.21      |
| country-dusk  | 119.6 → 60.6      | 526 → 917   | 4.09 → **12.45** |

### The bisect (all four points on the same pak)

| point | commit    | ls-noon                                                  | sf-fog | lv-night | country-dusk | ocean | rain-night |
| ----- | --------- | -------------------------------------------------------- | ------ | -------- | ------------ | ----- | ---------- |
| A     | `3f354b0` | — could not load this pak at all (the map never came up) |
| B     | `95bd544` | 113.6                                                    | 107.6  | 78.0     | **64.6**     | 120   | 118.8      |
| C     | `52b4ec9` | 110.1                                                    | 107.4  | 75.9     | **64.7**     | 120   | 118.2      |
| D     | `03f05b1` | 109.6                                                    | 105.3  | 74.9     | **60.4**     | 120   | 117.5      |
| HEAD  | `436d2f2` | 112.1                                                    | 105.4  | 75.6     | **60.6**     | 120   | 117.5      |

Draw counts are identical to the unit across all four (1202 / 1019 / 1680 / 917 / 19 / 959), and the frame
times sit inside run-to-run noise. **The slowdown is already fully present at the earliest code that can
read this pak** — so nothing in the 07-19…07-20 window caused it.

### The cause

The pak is the **improved map**: it carries our generated LODs, vegetation and procobj. The 07-18 baseline
was measured before those existed in the output (user-confirmed). **2026-07-21 then localised it to ONE of
the three — the `trees` stage; procobj (≤ +0.38 ms) and lods (+0.22 ms) are retired as suspects**
([layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md), rows #21/#22). The evidence lines
up exactly:

- **`ocean-horizon` did not move at all** (pass 1.85 → 1.78). It is the one scene with no LODs, no
  vegetation and no procobj — the control, and it is flat.
- **`country-dusk` moved most** — draws +74 %, pass ×3. Countryside is where vegetation and procobj are
  densest.
- Cost per draw rose too, not just draw count, which is what added geometry and alpha-tested foliage do.
  (Superseded 2026-07-21: the controlled A/B put the cost **per-pixel**, not per-draw — draw calls did not
  move at all, 1255 → 1258, while the pass fell 44 %. See row #22.)

**So the old 120 fps was not an engine achievement — it was the cost of an incomplete world.** This is an
optimisation problem against real content, not a hunt for a broken commit — and 2026-07-21 named the
content: mod vegetation swapped in by the `trees` stage.

### What the bisect did find

- **Point D (`03f05b1`) costs ~5 %** on the two heaviest scenes (country-dusk 64.7 → 60.4 fps, pass
  11.43 → 12.52). Small, real, and worth a look — that commit carries the map-viewer work and plan-078
  rows 7/8/10.
- **HEAD is neutral against D**: removing the Show Faces STORAGE flags and adding the hemispheric ambient
  both cost nothing measurable. Both are closed out as suspects.

### CLOSED 2026-07-21 — it is the trees stage

Ganton in free play read ~40 fps by day, worse than any bench scene reported. The first attempt to chase it
was invalid and the runs were deleted (the folder picker did not select the world —
`engine-canvas-host.tsx:264` always fetched the pak from `public/pak-map`, so no run measured the pak it
named). After that was fixed, a six-layer rebuild of the map answered it:

**`trees` is ~90 % of the regression** (ganton-noon pass 5.36 → 13.72 ms), and **one placement-only mod,
"39. Green Piece 1.47", was 73 % of that** — removing it took the pass to 7.63 ms and 53 → 82 fps, with six
control scenes flat. The cost is per-pixel foliage fill, not triangles and not draws. The mod was deleted
on 2026-07-21 and all other foliage work is parked. Full analysis and asset audit:
[2026-07-21-layer-decomposition.md](opensa-engine/2026-07-21-layer-decomposition.md) (rows #21/#22).
