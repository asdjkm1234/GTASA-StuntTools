# 096/08 — Polish, docs, benchmark, audit (close-out)

**Priority P2. The phase that makes the chain DONE by the workflow rules: a big feature without its
audit + benchmark is unfinished (CLAUDE.md standing rule).**

## Tasks

### A. Polish (each item is a field-report consumer, not speculative work)

1. **Shot-length adaptivity pass** (D4 final form): re-derive dwell from ACTUAL closing speeds measured
   in 03–05 runs; freeze the config table. Any value still being argued stays a config knob — nothing
   video-mode ships as a magic number outside `video-presets.ts`.
2. **Scene variety audit over one full seeded cycle**: no two consecutive scenes share car AND hour AND
   weather; if the seeded picks collide too often, add the cheap de-dup (reroll once) — measured first.
3. **Stability sweep**: 30-minute unattended run (soak-style), watch for the leak/perf drift the soak
   judge already measures; the module must not accumulate DOM nodes, listeners, spawned cars (teardown
   audit), or route-graph garbage per scene.
4. **Error paths on camera**: every `[video]` failure (no route, spawn retry exhausted, stuck) ends
   behind the overlay with a console line and ADVANCES the program — a hundred-scene sequence must be
   unkillable by one bad scene (D2 as revised: bounded, but still far longer than anyone watches live). Verify by fault injection in tests (deny spawn, empty region).
5. **The chrome hide, which never reached React** — DONE 2026-07-31, field-reported: video mode's
   `setUiHidden(true)` runs inside `boot()`, and the shell subscribes to `'fly-camera'` only after boot
   resolves, so the event was emitted to an empty bus. Every recorded frame kept the HUD clock, the "Click to
   play" prompt and the Fullscreen button; only the perf readout (a closure flag, not an event) obeyed. Fixed
   by holding the last emitted state and READING it on mount — `HudGame.getFlyCamera()`, the shape
   `getTime`/`getZone` already had. Verified by a DOM probe with the overlay clear (seed 47, scene 1):
   `{capture:false, clock:false, fullscreen:false, perfHud:false}` against a no-video control run of the same
   probe reading `true` on all four. Now a restriction (`docs/restrictions/architecture.md`) — nothing catches
   it: `apps/web/src/ui/**` is off the unit lane by design, so the probe is kept as
   `scripts/debug/video-chrome.ts` (+ its `docs/debug/` row).
6. **`vehicle-enter-null-body` disposition** (D16): if it never fired through 02–07's runs, close the
   issue at its 2026-08-30 recheck citing this chain as the stress evidence; if it fired, the guard
   already shipped (02's rule) — either way the issue file gets its closing block.

### B. Documentation (the same-change debts, collected)

6. `docs/features/video-mode.md` (+ README row): what it does, the decisions table, the accepted v1
   limitations (keyboard sums with autopilot; sidewalk offset jank; clock drift; no interior shots —
   pointer to the view-presets plan (now roadmap 0.6.0·07) and the cabin open issue; recording is OS-side).
7. `docs/development/query-parameters.md`: final rows for `video`/`from`/`to`/`seed` — and a note in
   the "why no flags.ts" section that the count crossed its own threshold with this family (the doc
   asked to be told; whether the typed reader happens is its own tiny decision, not smuggled in here).
8. `docs/debug/README.md` row for `video-routes.ts`; `docs/commands.md` if any script/param surface
   changed; `docs/architecture/` touch-up if the module diagram warrants a box (it is an app-layer
   module — likely one line in the web-app doc, not a new diagram).
9. Restrictions/edge-cases sweep: anything 02–07 discovered the hard way gets its entry in the same
   closing change (candidates from the phases: the fly streaming cap, the cut-declaration contract).

### C. Benchmark + audit (the big-rework rule)

10. **Benchmark** (`docs/benchmarks/` per its schema, BEFORE analysis): frame cost of video mode ON vs
    OFF on the same scene/seed — director + autopilot + probes are all frame-loop work; expected ≪ 1 ms
    but MEASURED, plus the staging timeline (teleport → overlay-up) distribution across a full cycle.
    Record which pak build ran.
11. **Audit** (`docs/audit/video-mode-096.md`): what changed (module files, the one resolveCamera slot,
    the parser adjacency, the installer ledger, the runPath threading), what it cost (LOC, new tests,
    frame ms), what it bought (the feature), and what it deliberately did not do (the D14 list + the
    typed-params question).

## Acceptance

- The 30-minute unattended run completes with zero throws and flat memory/frame trends (numbers in the
  ledger + `docs/benchmarks/`).
- Every doc row above exists in the closing commit(s); the plans README row flips to SHIPPED with the
  one-paragraph story.
- The user has recorded at least one real clip they kept — the only acceptance that actually matters.

## SHIPPED 2026-08-01

Every task above is done; the numbers live in the plan readme's ledger and in
[`docs/benchmarks/opensa-engine/2026-08-01-headless-video-mode.json`](../../benchmarks/opensa-engine/2026-08-01-headless-video-mode.json).
What this doc records is what the phase had to CHANGE to answer its own questions — three of its tasks turned
out to be unanswerable against the code as it stood.

### The three instruments this phase had to build

1. **A per-frame cost that means something.** Task 10 asked for "video ON vs OFF". That comparison is not
   available: with video off nothing drives, nothing streams and the camera does not move, so its difference
   is the scene. The module's whole per-frame footprint is one call (`setVideoStep`), so that call is timed
   instead (`video/step-cost.ts`), per scene, reported as `stepMs` in every capture. **Read it knowing
   `performance.now()` is coarsened to 0.1 ms headless** — a single frame reads 0 or 0.1, and only the mean
   over thousands of frames is a measurement.
2. **`hour` and `weather` in the capture.** Task 2 (variety) compares car, hour and weather between
   neighbouring scenes, and a scene report carried only the car — the other two were in the log prose. A
   capture that cannot say what world it was shot in also breaks the self-describing-capture rule, so this was
   owed anyway.
3. **A cut cause for the planted watchdog.** Task 1 (freeze D4's table) asks whether a planted shot's 15 s
   clock is a safety net or a length. It could not be answered: `scheduled` covered both a riding shot's
   chosen clip and a planted shot's watchdog. The soak could only BOUND it (≤ 10 of 30 planted shots). With
   the causes split, the answer is **1 of 9** — a safety net. `isPlanted` came out of the same change; the
   predicate had been written inline in four places.

### The two defects the phase found in its own outputs

- **Every healthy scene logged itself as "ended early".** The runner still tested `ended !== 'ran-out'`, the
  clock-driven end condition D1/D4 deleted on 2026-07-31; the normal end has been `shots-done` since. It
  survived two phases because nothing asserts on log prose — it surfaced from READING the benchmark log.
- The capture gap in (2) above.

### The acceptance no run could give — closed the same day

**Field verdict (user, 2026-08-01): the walk and flythrough scenes were watched, and they look good.** That
is acceptance line three, the one that actually matters, and it is the only one a headless run could never
answer. The 07 checklist it closes: the walk's pavement offset (a DRIVING route pushed sideways — the hack
holds in the field), whether five 10 s aerial passes read as editing, `top`/`crane`, and the cuts in and out
of `chase`.

What the verdict does NOT retire is `flyby`'s missing occlusion check (`docs/features/video-mode.md`, "Not
implemented yet"): it can still plant an eye inside a wall, and a run that did not happen to do so is not
evidence that it cannot. That stays a known gap with standoff and lead as its levers.

### Not done, deliberately

The 07 note suggesting `engine-video-runs.ts`'s three `runXScene` functions might want their own files was
looked at and left alone: the staging around them is genuinely shared, and splitting it would trade one
coherent module for three files plus a shared fourth. Revisit if a fourth scene kind lands.
