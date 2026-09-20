# 096/04 — Tripod stations: survey, occlusion, cuts without flicker

**Priority P1. Ships alone: world-anchored tripod shots join the 03 rotation — the "camera on a stand
films the car driving past" look that carries most trailer language. This phase owns the plan's second
field risk.**

**SHIPPED 2026-07-30.** Numbers in the plan readme's ledger. What the phase did differently from this doc,
and why:

- **Station offsets are 8-18 m, not 4-12.** 03 measured what a close pass does to the pan cap (the angular
  rate at closest approach is speed ÷ standoff), and 4 m at a cruise is 3 rad/s against a 1.05 rad/s cap.
  The range still comes from the road and nothing is written against a place.
- **The survey waits for the car to be up to speed.** Not in this doc, and the single biggest number the
  phase moved: predicting from a launching car put stations 13.5 m off. The plan's own remedy (resample at
  cut) is still unspent and stays the lever if the residual ever matters.
- **A scene that OPENS on a tripod is surveyed behind the black overlay.** This doc assumed a preceding shot
  to amortise over; four of twelve slots had none and played fallbacks.
- **The `[cam] jump` watchdog needed a second protocol in the harness** — `ALSO='[cam]'` (added in 03) is how
  the acceptance reads it while collecting `[video]`.
- **The colonnade street the acceptance asks for does not exist as a ROUTE.** Downtown LS is a grid the
  route builder rejects outright, so the hard case was driven at the tightest accepted LA start instead. The
  finding is `docs/edge-cases/route-graph.md`, and it is the reason a pin is always logged when it fails.
- **Not built: `sphereCast` sightlines.** The risks section offers them if thin rays thread visual occluders.
  Thin `pathClear` rejected 10 candidates in 25 scenes and cost half as much; there is no field evidence yet
  that a threaded fence ever survived one, so the cheaper probe stays until footage says otherwise.

## The trap this phase is built around

Station choice is a DISCRETE gate over raycasts, and the 080 postmortem
(`docs/postmortem/080-cinematic-camera/multiray-collision.md`) is explicit about that shape: a hard
all-rays/none boolean over a moving fan "has no continuous middle, so it cannot ease" — it was built,
field-rejected, and rolled back. The design below never lets an occlusion boolean steer a LIVE camera:
occlusion decides only (a) which station is picked BEFORE its shot starts, and (b) whether to CUT AWAY
(a declared, discrete act) — never to slide the camera.

## What exists

- `pathClear(from, to)` — line-of-sight boolean (`physics-world.ts:901`); `sphereCast` (`:1293`);
  `raycast` (`:962`). GTA Z-up; the director's math is engine Y-up — convert at the boundary
  (`gtaFromEngine`, the `camera-collision.ts:46` idiom).
- Cast budget ≤ 5/frame total; the shipped rig spends 2 → the module has ~3/frame.
- The route polyline with per-vertex target speeds (01) — future car poses are PREDICTABLE:
  `poseAt(tAhead)` by integrating target speed along the route is cheap and good enough for framing.

## Tasks

1. **Candidate generation** (`apps/web/src/ui/video/stations.ts`): for the next shot window
   `[t0, t0 + dur]`, sample the route at the predicted midpoint; generate station candidates DERIVED
   from the road data: lateral offsets 4–12 m both sides of the polyline, heights 1.2–2.5 m above
   ground (`groundBelow` snap, one cast per candidate at survey time), plus a low-angle variant
   (0.6 m) and a high variant (6–9 m) for variety. Seeded pick order (D9).
2. **Survey (amortised, off the live frame)**: candidates are validated DURING the preceding shot, ≤ 1
   candidate per frame (inside the 3-cast headroom: ground snap + 2 sightline probes). A candidate
   passes when `pathClear(station, predictedCarPos(t))` holds for ≥ 4 of 5 samples across the shot
   window (start / ¼ / ½ / ¾ / end) — the one allowed miss absorbs a lamppost without rejecting a
   usable station (a SOFT coverage weight, not a hard all-rays gate). First passing candidate above a
   coverage score wins; if NONE passes by cut time, the scheduler falls back to a car-anchored preset
   (03) — a missing station degrades variety, never breaks the scene (the "ownerless mode impossible"
   discipline applied to shot supply).
3. **Live shot execution**: the tripod is FIXED (eye static); only the look target tracks the car
   (damped, pan-rate-capped from 03). One `pathClear(eye, carPos)` probe per SECOND (not per frame)
   during the shot; two consecutive misses → declared early cut to the next shot. Hysteresis lives in
   the probe cadence + the two-miss debounce + the ≥ 5 s dwell (D4) — the camera itself NEVER moves in
   response to occlusion.
4. **Full empty-frame guard** (upgrades 03's v0): combine screen-anchor exit (car left frame), distance
   ceiling (car beyond `maxDist` for the preset), and the occlusion debounce into one early-cut policy
   with a single priority order, unit-tested.
5. **Shot-length adaptivity** (D4): expected dwell computed at pick time from predicted closing speed —
   a station too close to a fast segment (would hold the car < 5 s in frame) is rejected at survey, not
   discovered live.
6. Tests: candidate generator respects offsets/heights and the seeded order; survey scoring (4-of-5,
   fallback path) on a stubbed probe; early-cut debounce timing. Negative cases first.

## Acceptance / verification

- Headless 5-seed run on a colonnade/canyon street (the HARD case — picked with `video-routes.ts`
  through downtown LS): 0 undeclared `[cam] jump` lines; early-cut rate recorded; ≥ 60 % of tripod
  slots filled by a surveyed station (rest fell back to car-anchored) — the number is recorded, the
  threshold negotiated after the first run.
- Frame-cost check: the module's cast count per frame logged and ≤ 3 in every frame of the run
  (`[video] casts p99=…` in the ledger).
- Field look: tripod shots hold steady while the car passes; nothing flickers; occlusion cuts read as
  editing, not as malfunction.
- Ledger: station accept/reject stats per region, survey latency (frames from request to verdict),
  early-cut counts by cause.

## Risks / notes

- Facade recesses and stoops are exactly where 4-of-5 will be argued — if the field round shows misses,
  tune the sample count/threshold as CONFIG (one table), never per-street exceptions (the
  no-slot-specific-values rule).
- `sphereCast` (radius ~0.35, the rig's own) instead of thin `pathClear` for the sightline probes if
  thin rays thread fences that visually occlude — measure first; thin rays are half the cost.
- Prediction error grows if the autopilot deviates from target speed — the ¼-window samples make the
  survey tolerant; if p95 prediction error at cut time exceeds ~4 m, resample the midpoint once at cut
  (one extra cast, budgeted).
