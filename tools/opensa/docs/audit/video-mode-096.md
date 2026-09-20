# Audit — plan 096: video mode (2026-07-30/08-01, two days, eight phases, three field rounds)

`?video=1&seed=N` boots the game into a bounded, seeded, self-directed showcase: scenes 1…100 of the seed,
five distinct cameras each, a black overlay between them and an end card at the end. A scene drives a car
along a route built from the game's own `NODES*.DAT` graph, walks the player, or flies the camera over a
block. The user screen-records with OS tools and cuts the black gaps out by hand — nothing here captures
anything, by decision (D14).

This is the close-out audit the big-rework rule asks for. Its companion measurement record is
[`docs/benchmarks/opensa-engine/2026-08-01-headless-video-mode.json`](../benchmarks/opensa-engine/2026-08-01-headless-video-mode.json).

## What changed

- **A road-route capability in `packages/game`, which is not video-mode-specific.** The path graph SA has
  always shipped is now parsed with its link adjacency (it was being discarded at parse:
  `renderware/parsers/binary/paths.ts`), loaded into a `RouteGraph`, and walked by a seeded builder that
  produces a drivable line — offset, resampled at a uniform 2 m, smoothed, with per-point target speeds off
  curvature. 30 587 vehicle nodes over 73 area files, 0 unresolved links.
- **An autopilot**: `PathFollowSource implements InputState`, a pure-pursuit controller installed as a
  sibling in the host's existing `CombinedInput` — the same synthetic-input path the phys laps use, not a
  change to the player path. Cross-track p95 stayed ≤ 0.33 m across every measured run.
- **A camera director** (`apps/web/src/ui/video/`): nine shot presets, framing math with a safe frame and
  proportional lead room, tripod stations surveyed against real occlusion behind the overlay, an
  empty-frame guard, and a cut protocol that DECLARES every discontinuity to the shipped `[cam] jump`
  watchdog.
- **A sequencer**: region cycle, per-region weather pools, the debugger's own hour slots, and a car pick
  that prefers mod cars through a build-time ledger.
- **One new build-time artefact**: `data/vehicle-mods.txt`, written by `vehicle-installer` from the
  `Set<string>` of mod-installed slots it already collected and never wrote. Contract in
  `docs/contracts/vehicles.md`.
- **Four debug scripts** kept, with their `docs/debug/README.md` rows: `video-routes.ts` (offline route
  validation, no boot), `video-accept.ts` (the acceptance exam off a harness log), `video-shiver.ts`
  (camera-motion energy, both pairings), `video-chrome.ts` (is the chrome out of shot — with a control lane).

## What it cost

**Code.** 9 036 insertions / 75 deletions over 62 files against the pre-096 tree. The feature's own body is
7 763 lines over 33 files (module + route machinery + the four scripts + the installer's ledger), of which
**roughly a third is tests**. The engine (`packages/engine`) was not touched at all.

**The host's footprint is the number that matters**, because it is what a future subsystem inherits:
185 lines added across `engine-canvas-host.tsx` (172) and `camera/engine-camera.ts` (13 net) — one attach
block plus the accessors, and ONE new slot in the camera authority chain (`bench > video > flyEye > follow`).
That is the shipped attach pattern (`setupPerfRuns`/`setupPhysRuns`) holding for a third subsystem.

**Frame time: below the timer's resolution.** The module's entire per-frame footprint is one call — the step
the host runs between the car's render pose and the camera snapshot — and it was measured directly rather
than by a whole-frame A/B, because "video off" is a different workload (nothing drives, nothing streams, the
camera does not move) and its difference would be the scene, not the module. Measured over four LA→COUNTRYSIDE
drive scenes, 22 817 frames: **mean 0.0172 ms, worst-scene p95 0.1 ms, max 3.8 ms.** `performance.now()` is
coarsened to 0.1 ms in headless Chrome, so a single frame reads 0 or 0.1 and only the mean over thousands of
frames is a measurement — the honest statement is *under a fiftieth of a millisecond, i.e. under 0.2 % of a
120 Hz frame*. The occlusion probes it fires stay inside the 080 ground rule of ≤ 5 casts/frame (measured
≤ 3, always).

**Tests.** 3 379 → **3 431** over the chain (see the plan ledger per phase). The module's pure halves — shot
framing, the director, station supply, presets, fly, walk, the sequence loop — are unit-tested; the host glue
is not, by the standing division (`apps/web/src/ui/**` DOM glue belongs to the field lane), which is exactly
why field round 3's chrome bug existed and why its probe is kept.

## What it bought

A repeatable way to produce trailer footage of the game with no hand-flying and no editing beyond cutting
black. More usefully for the project: `?seed=47` NAMES a hundred specific scenes. A field note saying "scene
57 of seed 47" points at the same car, hour, weather, route and shot list on any machine, which is what turned
three vague reports into three measured fixes.

It also stress-tested the teleport → stream-settle → spawn → seat recipe at a volume nothing else does —
see the D16 evidence in `docs/open-issues/vehicle-enter-null-body.md`.

## What it deliberately did not do (D14, and the additions)

Interior/cabin camera, in-page recording, traffic, drift driving. Added to that list during the chain:
one-way streets (the link table is 100 % mutual and SA keeps lane direction in navi nodes we do not parse —
`docs/edge-cases/route-graph.md`), a typed query-param reader (the param count crossed the doc's own stated
threshold with this family; the decision was left as its own, not smuggled in here), and freezing the game
clock (D13 — ~16 game minutes of drift over a fragment, accepted).

## What the chain taught, and where the lessons live

Three of the four defects that mattered were found by a HUMAN watching footage, after headless numbers had
accepted the build. Each became a rule, because each was a case where a metric could not see the defect:

- **A metric computed from the input a fix was made in is blind to the frame the pose lands in.** The shiver
  measurement said "fixed" while the user still saw it: the director was stepped from its own rAF pass, so
  the screen paired this frame's car with last frame's camera. → `docs/restrictions/architecture.md`.
- **State the chrome must READ is state, not an event.** `setUiHidden(true)` was emitted inside `boot()`; the
  React shell subscribes only after boot resolves, so the emit went to an empty bus and every recorded frame
  kept the HUD. The perf readout obeyed because it reads a closure flag — which is why no console check ever
  noticed. → `docs/restrictions/architecture.md`.
- **A boolean over a continuous signal has no middle, and the middle is where the shot lives.** Hit three
  times over the chain (the empty-frame guard, the tripod sightline, the lead-room anchor threshold that
  stepped 0.24 of the frame's width in one frame).
- **A revision leaves stale code behind, silently.** After D1/D4 made a scene end on its shot list, the
  runner still tested `ended !== 'ran-out'` — the deleted clock-driven end — so every healthy scene logged
  itself as ending early. It survived two phases and was caught by reading 08's own benchmark log, because
  nothing asserts on log prose.
- **A number two different facts share cannot answer a question about either.** `scheduled` covered a riding
  shot's chosen 10 s clip and a planted shot's 15 s watchdog, so D4's own question — is the watchdog a safety
  net or a length nobody chose? — was unanswerable from any run: the 40-scene soak could only bound it at
  ≤ 10 of 30. Splitting the cause made it **1 of 9**. The close-out phase of a chain is where this shows up,
  because it is the first time anyone asks the aggregate a precise question.

The fourth is not a rule but a measurement habit that paid: `video-routes.ts` validated routes OFFLINE before
any frame existed, and caught two constraint bugs (a curvature read off unevenly spaced points reporting 2 m
"hairpins", and a per-junction ceiling that let five legal turns bend 125° in ten metres) that would have been
read as autopilot faults in the field.

## The last acceptance, and what it does not cover

Every number in 07 is an instrument, and the questions that remained were human ones: does the walk's 6.5 m
offset land on a pavement (it is a DRIVING route pushed sideways —
`docs/hacks/pedestrian-route-on-a-vehicle-graph.md`), and do five 10 s aerial passes read as editing.
**Answered 2026-08-01 by the user watching them: they look good.** The chain is closed.

What that verdict does not cover, and what stays a known gap: **`flyby` has no occlusion check at all**. Its
eye is derived from the car and can be planted inside a wall; a run in which it happened not to be is not
evidence that it cannot be. Standoff and lead in `shots.ts` are the levers if it ever shows.
