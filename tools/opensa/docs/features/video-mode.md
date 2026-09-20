# Video mode (self-directed showcase runs)

`apps/web/src/ui/engine-video-runs.ts`, `apps/web/src/ui/video/`, `packages/game/src/paths/`,
`packages/game/src/vehicle/path-follow.ts`. Plan [096](../plans/096-video-mode/readme.md).

`?video=1` boots the game into a bounded, seeded, self-directed showcase: a car is staged on a route out of
the game's own road graph behind a black overlay, an autopilot drives it while a director cuts between five
cameras, then the overlay comes back down and the next scene stages behind it. **The user
screen-records with OS tools and cuts the black gaps out by hand — nothing here captures anything**, by
design (D11/D14).

## Implemented

**Scenes and staging** (096/02):

- `?video=1&seed=N&scenes=100&car=<model>` — `seed` determinises the car, weather, hour, route
  AND the shot list; it is printed as `[video] seed=…` so a run that was not asked for one can still be
  replayed. What a seed does NOT fix is the frame clock: the shot LIST is reproducible, while an early guard
  cut (an empty frame, a blocked tripod) depends on how the frames actually fell, so two runs of one seed can
  differ in where a shot was cut short. That is a real-time property, not something a seed can own.
- One scene = a seeded route inside ONE region, a debugger hour slot (00/06/12/18/21), a weather from that
  region's own timecyc set, a spawn, an instant seating, and a fragment.
- The staging recipe is the phys laps' verbatim: `TELEPORT_NOTICE_SECONDS` before `pendingCells` means
  anything, then the ring drains, then a collision warmup, then the suspension settles — and last an fps
  stability gate (30 consecutive frames under 25 ms) so the cold-teleport spike is over before the overlay
  lifts. Measured cost: 248-252 ms.
- All UI hides through the photo camera's own path — the HUD clock and district label, the "Click to play"
  prompt, the Fullscreen button, the F2 overlay and the perf readout — exactly what K+M hides. The hide is
  announced on the `'fly-camera'` event AND held as state the chrome reads on mount (`HudGame.getFlyCamera`):
  video mode hides the UI from inside `boot()`, and React is not listening yet at that point (096/08; the
  rule is in `docs/restrictions/architecture.md`, the probe that checks it is `scripts/debug/video-chrome.ts`).
  The only progress protocol is the `[video]` console
  tag, one JSON line per scene (the `[phys]` protocol's twin, plus cross-track error and the shot ledger).
- `&diag=1` adds a second line per scene, `[diag]`, holding ONE ROW PER RENDERED FRAME (drawn car, both
  headings, eye, aim, screen position, cut flag). The `[video]` series is 10 Hz and judges a driven line; a
  camera complaint is a per-frame thing and is invisible at that rate. Read it with
  `scripts/debug/video-shiver.ts`, which reports each channel's high-frequency energy — that is how round 1's
  shiver was pinned on the damper rather than on the physics. Off by default.

**The sequencer** (096/05) — `apps/web/src/ui/video/presets.ts`, a table the runner reads:

- **The cycle** (D2): a drive scene in Los Santos → Las Venturas → San Fierro → Countryside → Desert, then
  two flythroughs and a walk (D3) — **all three kinds run since 096/07**; `sceneOfKind` dispatches them and
  nothing is skipped any more. The program is rebuilt each lap from that lap's seed, so a long run is not the
  same eight scenes over and over.
- **A run is a BOUNDED SEQUENCE, not an endless mode** (D2 as revised 2026-07-31): `?seed=47` means scenes
  1…100 of seed 47, and then the run stops on a black end card reading `sequence complete · seed 47 · N
  scenes`. `&scenes=N` takes a shorter one; 100 is the ceiling, not merely the default, so a longer sequence
  stays a decision rather than a URL. The chrome does NOT come back — handing it over would put the HUD into
  the last frame recorded.
  **`&scene=N` starts the sequence at N** rather than at 1, and `&scenes=` stays a COUNT, so
  `?seed=47&scene=57&scenes=1` is exactly scene 57 of seed 47 — the only way to reach the scene a field note
  named without playing the hour in front of it. It is the SAME scene the full run would have played: the
  identity is `(seed, index)`, and the lap's program is keyed on that lap's FIRST scene (`scene - at`), not on
  wherever the run happened to begin. Keyed on the latter, a mid-start would put the two flythroughs and the
  walk in different regions than the full run gives them (the drive spine is fixed order, so it is only ever
  those three) — 167 differing scenes over the 100 possible starts of seed 47, measured. Invisible until 07
  stops skipping them, which is exactly why it is worth being right about now. `PROGRAM_LENGTH` is a constant
  because the key has to be computable before a program exists; a test ties it to what `buildProgram` returns.
  **Every program entry consumes a scene index**, which is what let 07 fill the `fly`/`walk` entries without
  re-seeding a single scene after them: a scene's identity is `(seed, index)`, so scene 57 of seed 47 is the
  same scene it was when those entries were still being skipped.
- **The region token is the game's own**: `City` is what the zone data classifies a point into AND the suffix
  the timecyc weather rows carry, so one token drives the route filter and the weather pool. The pool is
  FILTERED out of the shipped names (`weatherPool`), never listed — a modded timecyc is followed.
- **Per-scene seeds** derived from the master seed and the scene index, so scene 7 is the same scene however
  the run reached it. Each staged scene prints one self-describing line:
  `[video] scene 7 seed=… region=VEGAS kind=drive car=infernus(mod) hour=21 weather=SUNNY_VEGAS route=412m …`.
- **The address bar names the scene now playing** (added 2026-08-03): each scene `replaceState`s `&seed=` and
  `&scene=` into the URL as it starts, so `?video=1` becomes `?video=1&seed=1712…&scene=6` while the reel
  runs. D12 keeps every piece of chrome out of the frame and the console line scrolls past, which left a live
  run with nowhere to say where it was; the bar is outside the recording, so it costs the footage nothing.
  **The seed is written with it** because a run given none derives it from the clock — a URL naming only the
  scene would name a different scene on reload, which is worse than naming none. Written at the START of the
  scene, so a scene that fails leaves the URL pointing at the one that failed. `&scenes=` is rewritten with it
  (it is a COUNT, so carrying it over unchanged would lengthen a bounded run on reload) and only when it was
  already in the URL. REPLACE, never push: a 100-scene run would otherwise bury the back button.
- **The car** (D10, revised 2026-08-03 — mod cars ONLY): the roster is `vehicles.ide`'s `car`-type rows whose
  `.osm` the build actually carries (`roadCarModels` — a slot with no model throws at spawn). If the build's
  ledger (`data/vehicle-mods.txt`, 096/06 — the only vehicle data file read at RUNTIME, written by
  `vehicle-installer` because nothing about a mod survives the merge) names even ONE slot in that roster,
  every scene of the run drives a mod car and the stock pool is not drawn from at all; with no drivable
  ledger slot, every scene takes a stock car. There is no share to tune. The boot line says which pool is in
  force and names the drivable slots, so a run that drives stock cars states why. Paint comes from the car's
  own `carcols` combos, seeded, so the same model twice in a run is not the same colour twice.
- **D15's tripwire**: a route is built inside one region precisely so `CityZoneSystem` never fires its 6 s
  weather rewrite on camera. A scene whose weather target moved anyway logs which scene and which region —
  the leak names itself instead of becoming a mystery fade in the footage.

**The director** (096/03) — `apps/web/src/ui/video/`:

- **Authority**: `resolveCamera`'s chain is `bench > video > flyEye > follow`. The director writes a
  `{eye, target, fovYRad?}` pose (engine Y-up) through `setVideoCamera(pose, cut)`, or `null` to give the
  frame back to the shipped follow rig.
- **The director is stepped BY THE HOST LOOP** (`setVideoStep`), between the car's render pose and the camera
  snapshot, so a car-mounted shot is composed from the frame it is drawn in. Stepped from the module's own
  rAF pass instead, the pose reached the screen a frame late and the pairing carried the car's whole travel
  for that frame — 0.33° of shiver at a cruise, the field bug of round 1b. The module keeps its own clock for
  everything that is not per-frame: staging, the fragment's seconds, the survey.
- **Shots are a table**, never a code path (`shots.ts`): `chase` (yields the frame to the rig — the shipped
  camera IS that shot), `nose`, `high`, `crane`, `top`, `wing-l`, `wing-r` (tracking: the eye rides the car's
  heading frame) and `flyby` (static: the eye is planted once and the car drives past it). Every offset is a
  multiple of the car's OWN half-extents, so the table fits whatever model is in the slot.
  `top` is overhead but deliberately **not** straight down: `screenBasis` takes its roll from the view
  direction's horizontal component, which vanishes at a perfectly vertical view, so a preset sitting on that
  singularity would have no defined roll — and would shiver for the same reason field round 1 did. It holds
  ~21° off vertical.
- **A scene is FIVE CAMERAS, and it is as long as they are** (D1/D4 as revised 2026-07-31). Nothing chooses a
  scene's length any more — `&from`/`&to` are gone:
  - a shot that RIDES the car runs a fixed **10 s** clip. It has no natural end (the car never leaves its
    frame), so where it ends is an editorial decision rather than a measurement;
  - a PLANTED shot (`flyby`, `station`) runs **until the car has driven out of its view**. Its number in the
    table is a watchdog (15 s) for the car that never arrives — a wedged autopilot, a route that turned away.
  - The five are DISTINCT: with nine presets to draw from, spending two of a scene's five slots on one camera
    only shows the same angle twice.
  - The route is sized from the list before it is walked (~936 m against the old 390), which is why long
    routes are now the common case and `ROUTE_TRIES` is 120: at that target San Fierro accepts only 10 walks
    in 120, and 40 tries would have failed ~3 scenes in 100.
- **Framing**: the look point is solved so the car lands on the shot's screen anchor, with **lead room** — the
  car sits on the side opposite its screen-space travel, so it drives into open frame. The table's `anchor.x`
  says how MUCH room the shot wants; the motion decides which side it goes on, by a share proportional to the
  crossing speed (full at 2 m/s, centred when the car is not crossing at all). It was a threshold once, and a
  threshold on a signal that hovers near it snaps the frame — see the restriction below. The aim and the eye
  are `smoothDamp`ed on per-shot time constants and the view direction's swing is capped at 60°/s (a whip pan
  reads as an error).
- **A tracking shot damps its MOUNT, not its world position**: the damper is re-based against the car each
  frame, so the car's own travel passes straight through and the smoothing eases only the heading the mount
  hangs off and the framing. Damped in world space it carried a ~1.1 m lag whose per-frame catch-up scaled
  with `dt`, and an uneven frame clock shook it — the field bug of round 1, now a restriction
  (`docs/restrictions/architecture.md`) and a director test. A PLANTED eye (`flyby`, `station`) is damped in
  the world, because it is not mounted on anything.
- **Cuts**: the scene's shot list is dealt up front from the seeded stream — weighted picks, no preset twice
  in a row, every shot ≥ 5 s, `chase` guaranteed at least once. Every cut is DECLARED for exactly one frame,
  which is the only thing the `[cam] jump` watchdog whitelists.
- **Empty-frame guard**: a clock, not a gate — and now TWO clocks, because "gone" and "hidden" are different
  verdicts. A car outside the safe frame (|s − 0.5| > 0.45) may simply be behind something and gets the
  patient 1.5 s; a car behind the eye or past the shot's distance ceiling has PASSED, which nothing an
  obstacle can fake, and gets 0.4 s. The short one is what ends a planted shot when the car drives away —
  waiting the patient clock would leave a second of empty road at the tail of every drive-past.

**Tripod stations** (096/04) — `station` is the sixth shot, and the only one whose eye comes from the world:

- **Candidates are derived from the road**: 8/11/14/18 m off the driven line, both sides, at a low kerb
  height, eye level or up on a roof — each ground-snapped by one cast. Order and heights come from the
  scene's seeded stream, so `?seed=` reproduces the survey too.
- **The survey is amortised**, ≤ 3 casts per frame during the shot BEFORE the tripod's: one ground snap plus
  a line-of-sight probe against each of five predicted car positions across the shot's window. A candidate
  passes on a soft COVERAGE score (4 of 5 clear — a lamppost may not veto a usable stand) plus a dwell test
  (the car must be within reading distance for the window), never an all-rays gate — that shape was built,
  field-rejected and rolled back in 080 (`docs/postmortem/080-cinematic-camera/multiray-collision.md`).
- **A slot the survey cannot fill plays a car-anchored stand-in** drawn at plan time from the same seed. A
  missing station costs variety, never a scene.
- **A `flyby` checks where it stands too** (096/09). It is the only other PLANTED shot, and until that phase
  its eye came from the car's geometry and nothing else — it could be planted inside a wall. It now walks
  three spots, best first (the authored one, the same one mirrored across the car, the authored one at twice
  the height) and takes the first with a clear line, using the tripod's own probe. Every rung is the shot's
  own offset re-signed or scaled, so it stays a multiple of the car's half-extents and a clear authored spot
  never moves. All three blocked gives the shot up to the fallback: filming from inside a wall is worse than
  not filming. **Three rungs is a budget, not a taste** — one cast each, all on the frame the shot starts,
  against 080's ≤ 5 casts/frame with the follow rig already spending 2.
- **The live check is one probe per second, and two blocked answers in a row cut away.** Occlusion never
  MOVES the camera — it only picks a stand before the shot and ends the shot after it. Hysteresis lives in
  the cadence and the debounce, never in a moving camera.
- **Prediction is scaled by the speed the car is actually keeping**, and a survey waits until the car is up
  to speed before predicting from it (a launching car's speed describes the launch, not the road ahead).
- `?at=x,y` pins every scene's route to the node nearest a point, so a hard street can be looked at
  deliberately — `scripts/debug/video-routes.ts --worst` prints the coordinates to paste in. A pin the route
  builder cannot walk out of is LOGGED and the scene takes a seeded route instead
  (`docs/edge-cases/route-graph.md` — a city grid is one such place).

**Measured.** Under the five-camera model (seed 47, five drive scenes, 2026-07-31): scenes ran **40.4-52.4 s**
and every one ended `shots-done` rather than on a clock; routes 937-967 m; **22 064 directed frames, safe
frame 98.21 %**, **0** undeclared `[cam] jump` lines, 20 cuts of which **4 were the empty-frame guard ending a
planted shot** — the mechanism, not a failure.

Under the model before it (25 scenes / 5 seeds, plus 4 pinned to the hardest LA start), which is what the
tripod and framing numbers were taken on: safe frame **99.2 %**, 0 jumps, 56 cuts; **12 of 12 tripod slots
played from a surveyed station**, ≤ 3 casts in every frame, survey verdict within 14 frames, station
prediction error median 1 m. Those station numbers have not been re-taken since scenes got longer.

**Walk scenes** (096/07) — a person, filmed by the same machinery:

- **The whole director is reused, with a SECOND preset table** (`WALK_SHOTS`): nine roles sized for a ped
  instead of a car — every `maxDist` about a third of its driving twin, because a walker at 40 m is a speck.
  The offsets are still multiples of the SUBJECT's own half-extents, so the rule did not change, only what it
  multiplies. `planShots` already took a table (05 built it that way), so this is not a second code path.
- **The gait**: `CharacterControllerSystem.runPath(points, gait)` gained a scripted tier — the shipped
  enter-vehicle approach keeps RUN by default, the video scene passes `walk`. The route's length is derived
  from the ped's own configured `walkSpeed`, never a number written here.
- **The route is a driving route pushed 6.5 m sideways.** SA's ped nodes are in `NODES*.DAT` and we do not
  parse them, so there is no pavement in the engine — see
  [`docs/hacks/pedestrian-route-on-a-vehicle-graph.md`](../hacks/pedestrian-route-on-a-vehicle-graph.md).
  Each waypoint inside the streamed collision ring is ground-probed and a miss rejects the whole route;
  furniture (benches, steps, lampposts) passes every check we have.
- Tripods use their own laterals (2.5-8 m, against the driving 8-18) and their own 26 m ceiling.
- Measured (SF, seed 47 scene 8): 160 m route, 62 of 82 waypoints probed, `safe: 1.000` over 3 844 judged
  frames, 4 cuts, 0 pan clips, 42 s.

**Flythrough scenes** (096/07) — five aerial passes over ONE neighbourhood:

- A fly scene is five cameras like every other scene: `low-pass`, `high-crane`, `descend`, `side-track`,
  `climb-out`, dealt without replacement, 10 s each, all over the same bounded stretch of city.
- **It does NOT use the director**, and that is deliberate: the director frames a SUBJECT (anchors, lead room,
  an empty-frame guard) and a flight has none — its eye is a spline sample and its look point travels the
  ground line ahead of it. `fly.ts` owns its own stepper.
- **The extent cap is the load-bearing rule.** Streaming follows the PLAYER, who stands at the route start
  out of frame for the whole scene, so the route is trimmed to 350 m before a pass is planned — the HD ring
  is 380 u, and a camera that outran it would film the empty world 094 exists to make impossible.
- **Clearance is a sphere, not a ray** (2 m): a ray threads a gap between two balconies and calls a pass clear
  that a drone would clip. Blocked at staging → the WHOLE pass lifts 10 m and is re-probed twice, then it is
  rejected rather than flown at "nearly clear". A local bulge around one tower would be the discrete dodge
  the multiray postmortem is about.
- Live, a probe fires once a second and its answer eases in at 8 m/s — discrete verdict, continuous response.
- Measured (COUNTRYSIDE + LA, seed 47 scenes 6-7): 5 of 5 passes flown in both, 35 staging casts each, **0 m
  of lift and 0 guard hits over 90 live probes**, 50 s a scene.
- **Over a longer sample the live guard DOES fire** (096/08's 40-scene soak: 10 flights, **50/50 passes flown,
  still 0 m of staging lift, but 6 guard hits over 450 probes** — 1.3 %). 07's zero was a two-flight sample,
  not a property: staging clears a pass against the city as PLANNED, and the guard is what covers the rest.
  A hit is the guard working, not the staging failing; what would mean the staging is wrong is lift at
  staging plus hits in the air, and the lift is still zero.

## Not implemented yet

- Interior/cabin camera, in-page recording, traffic and drift driving are out of scope for v1 (D14).
- Routes stay inside one region (D15) and the clock drifts ~16 game minutes over a fragment (D13).
- **Pedestrian paths.** The walk scene runs on the vehicle graph offset sideways; SA's own ped nodes are in
  `NODES*.DAT` and unparsed ([hack](../hacks/pedestrian-route-on-a-vehicle-graph.md)).

## Known gaps

- The autopilot's gains are a fitted set — [`docs/hacks/autopilot-gains.md`](../hacks/autopilot-gains.md).
- **The `flyby` pass is the one shot that costs frames**: in a scene where it is the only placed shot its own
  safe-frame share measured 76 % (the car sweeps out of frame over the last stretch of the pass). Averaged
  over a run it is under 1 %. Standoff and lead are the levers, and the next round on it is a FIELD look at
  footage, not another number.
- **The station prediction is only as good as the car's obedience to its own target speeds.** Median 1 m,
  worst 6.6 m over 12 takes — every large one is a window that still covers part of the car's acceleration.
  A resample at cut time is the plan's own lever if it ever matters.
- The road graph is `original`-only: a total conversion without `data/paths/nodes*.dat` gets a logged refusal,
  not a drive scene.
