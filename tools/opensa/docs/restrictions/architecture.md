# Architecture restrictions

What may depend on what, and the constants separate tools have to agree on. Violating one of these does not
produce a wrong picture — it produces a build that cannot be reasoned about.

## The runtime may never reach for the converter

`type:engine` may not depend on `type:tool` (`@nx/enforce-module-boundaries`, `eslint.config.ts:284`). The
tags allow `app → engine`, `engine → engine`, `tool → engine|tool`, and nothing else.

The consequence bites when writing TESTS, not features: a test that needs both the writer and the runtime
cannot live in `packages/game`. It goes in the tool (`tools/opensa-pack/src/vehicle-osm.test.ts` is the
worked example, and its header says why). Two tests have already been moved for this reason.

**Caught:** yes — ESLint fails the lint lane.

## A `type:engine` package must be Node-free — and the TAG decides the layer, not the folder

`type:engine` is what the browser bundle is made of, so an engine package may not import `node:fs`,
`node:crypto` or any other `node:*` builtin. `packages/cell-weld` says this in its own header ("Node-free by
construction") because `sa-map-viewer` welds cells in the browser; the rule is general.

The consequence for a NEW package: `packages/` is not automatically `type:engine`. `packages/validation`
reads `node:fs` and imports `@opensa/asi-sdk`, so it is tagged `type:tool` and only the folder puts it beside
the engine — the tag is what `@nx/enforce-module-boundaries` reads, and `scripts/arch-graph.ts` reads it too
(by folder alone the runtime diagram drew a `node:fs` package inside the browser runtime). Decide the tag
from what the package IMPORTS, then pick a folder.

**Caught:** partly. Importing a `type:tool` from a `type:engine` fails ESLint; a bare `node:fs` import in an
engine package does NOT — it lints, it typechecks, and it fails when a browser bundle finally pulls that
module in. Nothing compares a tag against a folder either.

## The game layer touches renderware only through `adapters/` or `mods/`

`packages/game/**` may not import `@opensa/renderware` outside those two folders
(`no-restricted-imports`, `eslint.config.ts:248`). The engine must never learn what a `.dff` is.

**Caught:** yes — ESLint.

## The repo's lint is stricter than `CLAUDE.md`

Where the two disagree, ESLint wins: it requires `interface` over `type` (the opposite of the project
guideline), forbids the renderware import above, sorts module members and Set literals, and caps cognitive
complexity at 20. `commitlint` accepts `ci · chore · docs · feat · fix · perf · refactor · revert · style` —
**there is no `test` type**; a test-only change is `chore`.

**Caught:** yes — lint + the commit hook.

## One cell size, agreed by four places

The cell-LOD bake, the pack's render grid, the engine's streaming grid and the runtime config must all be
**250**. `tools/perfect-map-builder/src/config.ts` (`lodCellSize`), `tools/opensa-lod-generator/src/lod.config.ts`
(`cellSize`), `packages/cell-weld/src/cell-size.ts` (`CELL_SIZE` — the one declaration, imported by
opensa-pack and by sa-map-viewer), `apps/web/src/ui/game-runtime-config.ts`.

A mismatch puts an object's HD and its LOD in **different streaming slots**, and at spawn neither loads. This
is not hypothetical: the pre-087 bake ran at 256 and gostown's bridge main span had HD in slot 5,−7 and LOD
in 5,−6.

Collision streaming and procobj scatter keep their own `GAME_CELL_SIZE` (256) — that knob is unrelated and
must not be "unified" with this one.

**Caught:** no — nothing compares the four. The symptom is missing geometry in the field.

### Anything BAKED per cell is baked on the grid its consumer streams on

The two grids above are two different tessellations of one world, so "per cell" is ambiguous the moment a
converter starts precomputing per-cell data. Render content (`.oscell`, far LODs, texture plans) is keyed on
**250**; **collision and procobj are keyed on 256**, because that is the grid
`CollisionStreamingSystem` asks for a cell with.

A collision bake keyed on the render grid therefore hands the runtime the wrong cell's colliders — not
missing ones, *wrong* ones, drawn from a rectangle offset by up to 6 units and growing with distance from
the origin. `bakeCellCollision` (`tools/opensa-pack/src/pack-collision.ts`) takes the regions the caller
already resolved for exactly this reason: the grid choice belongs to whoever called `buildCellColliders`,
and it must be the same one the key is written with.

**Caught:** partly, since 2026-08-05. The pak states the grid its collision entries are keyed on
(`collisionCellSize`, written beside the entries and required by `validateOspakManifest`), the engine's
`PakCollisionSource` publishes it, and `GtaSaWorldAdapter` **throws** when it does not equal the grid
collision streams on. That catches the mismatch that has actually happened — a bake keyed on the render
grid handed to the game — at construction, not in the field.

What is still **silent**: a bake written with the right cell SIZE but the wrong cell coordinates (an
off-by-one rect, a converter reusing the render rect's numbers). Nothing compares a baked cell's contents
with the world at that key, and the symptom is unchanged — the world renders correctly and the player falls
through some of it while standing on nothing elsewhere, which reads as a physics bug rather than a bake bug.

## A frame-time span may only wrap synchronous work that runs BETWEEN frames

The recorder is `packages/engine/src/debug/frame-spans.ts` (`type:engine`, so the app, the game layer and the
engine may all report into it). Two rules bound what may open a span:

- **Synchronous segments only.** Timing across an `await` measures the wait too, and two overlapping waits
  each claim the same milliseconds — the totals then exceed the gap they are attributed to.
- **Never wrap work the frame loop already times.** The loop subtracts both its own block timers and the
  drained spans from `dt`; a span inside a timed block is subtracted twice.

**Caught:** no. Both failures produce a plausible-looking breakdown — a negative or shrinking `unattributed`
rather than an error. The check is structural: a span belongs in a promise continuation, a worker handler or
a callback, never in the loop body. Detail + the measured shape: [`edge-cases/browser-runtime.md`](../edge-cases/browser-runtime.md).

**The rule was VIOLATED for five days and it took a field drive to notice** (found and fixed 2026-08-02):
`cell-collision-read` wrapped `loadCellColliders`, which is `async` but has no `await`, so its body ran
synchronously inside `collision.update()` — already timed as the loop's `collision` block. Three frames of the
drive printed a negative `unattributed`, worst **−65.9**, on a line reading
`collision 76.0 · … (cell-collision-read 75.7 …)`. The span is gone; the reasoning is left at the site so it
is not re-added. Note what "caught: no" costs: the defect shipped on 2026-07-28 and survived the close-out of
the very plan that wrote this rule, because the only symptom is a minus sign in a diagnostic line.
Write-up: [091's field verdict](../plans/091-frame-time-attribution/readme.md#the-field-verdict--2026-08-02).

**`async` is not evidence of being out-of-loop** — that is the trap in one line. Check where the function is
CALLED from, not how it is declared.

## A dynamic body may only be CREATED where its static collision already exists

`streaming.collisionDrawDistance` (150) is shorter than the vehicle LOD ring (`lodDistance` 250). A rigid body
spawned in the band between them has nothing under it and free-falls — and if anything downstream then
measures that body's distance from its LIVE position, the fall is permanent, because the position it is
measured at and the position it would be recreated at have silently diverged.

**Any streamer that materialises physics by distance must gate on the collision radius, not on its own.** The
vehicle LOD system spawns within `min(lodDistance, collisionDrawDistance)`; the ground probe in
`spawnVehicle` throws when its cell has not arrived, and that throw is a DEFERRAL, not an error.

**Caught:** no — and the cost of that is on record. Parked cars fell out of the world for a whole session in a
way that produced a plausible frame: the lot simply looked empty, the console said nothing, and a field drive
across four zones met parked cars exactly once without anyone suspecting the world was broken. A spawn that is
allowed to be rejected must also be able to REPORT that it keeps being rejected
([`open-issues/fixed/parked-cars-do-not-respawn.md`](../open-issues/fixed/parked-cars-do-not-respawn.md)).

## Nothing may read or solve against a physics body before the world has stepped it

A Rapier body's mass properties are not live at creation — they are computed at the next `world.step`, so a
fresh body reads mass 0 and zero inertia no matter what its descriptor said
([`edge-cases/physics-runtime.md`](../edge-cases/physics-runtime.md) carries the measurement). Our fixed step
updates the raycast vehicle controllers BEFORE stepping the world, which puts every object created between two
steps — in a streaming world, all of them — on the wrong side of that boundary.

**Any system that creates a body mid-session and then touches it in the same frame must force the state it
needs first** (`recomputeMassPropertiesFromColliders` for mass), or defer its first read to after a step. This
applies to whatever is added next: a controller, a joint, a query that assumes an inertia tensor.

**Caught:** now yes, and only now. `physics-world.test.ts` asserts a car is born with its authored mass, and
`physics-world.car-generator-churn.test.ts` drives the streaming case. Before those existed the violation was
silent in the worst way available: solving a suspension against a massless body returns NaN, the NaN panics
Rapier inside wasm with a bare `unreachable`, and the panic never releases wasm-bindgen's borrow — so the
session then dies in whichever innocent reader touches the body set next, arbitrarily far from the cause. It
cost a full session of field rounds and produced a confident, wrong verdict about which car population was to
blame ([`open-issues/fixed/map-car-generators-poison-physics.md`](../open-issues/fixed/map-car-generators-poison-physics.md)).

## Every population of the world announces its size at boot

A map with no cars, no clutter or no props renders exactly like a full one. Nothing in a frame time, a draw
count or a screenshot distinguishes "the feature is off" from "the feature found nothing to place" — so any
system that materialises world content from data must print how many placements it took, once, at boot.
`[vehicles] parked placements registered: N` and `[vehicles] map car generators registered: N` are the shape.

**Caught:** no, and this is the rule's whole reason for existing. Plan 059's 1043 map car generators were
implemented, unit tested, and called by nothing for six weeks: the registration loop went out with the
three.js host in `a312f0d` (074/13) and the own-engine host never received it. Nothing failed, no test could
see it — a unit test proves the producer works, never that anyone consumes it, and `engine-canvas-host` has no
test at all. It took a field drive across four popcycle zones, and a driver saying *"I only saw cars once"*,
to notice. A census line would have said it in one second.

**The consequence for a plan:** if a new population source is added, it prints its count. If a count is zero
when it should not be, that is a bug report the log writes for you.

## A field run reads the built game dir and nothing else

`build/<game>/opensa` — its `data/` included. The built `data/*` is the MERGED result with mods installed and
can differ from `game-src/<game>/data/*` completely. Diagnosing against the source tree cost a whole session
(plan 081/02: a shivering car chased against a `handling.cfg` row the game was not running).

`scripts/debug/handling-diff.ts` defaults its baseline to the BUILT table for this reason.

**Caught:** no. The check is one command: confirm which folder is being served before forming a hypothesis.

### …so a stage writing a PERSISTENT `--out` wipes it before mirroring

`build/<game>/sa` and `build/<game>/opensa` outlive a build. A stage that mirrors its input over them with a
bare `cpSync` leaves everything an EARLIER run wrote and this one does not — in a tree whose whole authority
comes from being what the game reads. Found 2026-08-16: 23 mod IPLs from a failed run were still sitting in
`build/original/sa/data/maps`, unreferenced by `gta.dat`. Dead weight that time; the same mechanism keeps a
stale model or a retired data file alive the next.

The convention is `copyGameDir` (`@opensa/tool-kit/game-dir`) — wipe, then mirror — with `guardOut` in front
of it. Every installer already used it; `sa-lod-generator` and `opensa-lod-generator`'s finalize did not, and
now do.

**Caught:** partly. `copyGameDir` is tested to replace whatever `--out` held, and `opensa-lod-generator`'s
finalize is tested against a planted stale file — but nothing stops the NEXT tool from writing a persistent
`--out` with a bare `cpSync`, and the symptom is silent by construction (the build succeeds; the tree just
carries a file nobody asked for).

### …and `gta.dat` may not register a file the tree does not have

SA opens what its `gta.dat` lists **without checking**, so a line pointing at nothing is an access violation
during the data load — and all the field ever sees is `0xC0000005` in `ntdll.dll`, with the path buried in a
stack dump. Two ways to create one: a stage that registers a file it then does not write (or stops writing —
`salod-txdp.ide` on 2026-08-16, when the `txdp` parent was retired), and a hand-copied install whose `data/`
and `gta.dat` came from different builds. **Caught:** yes, since the same day — `assertGtaDatFiles` fails the
`sa` build and names every dangling line.

## A build asks for a target, not for the whole pipeline

`sa` and `opensa` are independent targets of the same source tree. Which STAGES run is pmb's `--exclude`
(`build:game:<id>:opensa` / `build:game:original:sa`); which HOST they are built for is pmb's `--target`,
derived from `--exclude` when it is omitted. They write disjoint subtrees of the same `--out` and only the
run's own `<out>/.work-<target>` is cleared (pmb plan 005), so an excluded target keeps whatever an earlier
run left — including its kept work dir; each target that runs writes its own `report-<target>.json`.

The two are not interchangeable, and the common chain is why: the stages before the split are SHARED, so a
run that still builds `sa/` cannot carry an `opensa` profile — pmb refuses that pair at config time. The
reverse (an opensa-only build priced for `sa`) is merely conservative, and is logged as leaving headroom.

A plan that says "rebuild the game" has to say **which target**, because they no longer carry the same
content: the `:sa` script excludes `vehicles` and `peds`, so the real-game build ships the stock roster.

**A stage in the COMMON chain may not produce different content per target in one run.** The mods, vehicles
and peds folders may each be layered per target (`common/` + `sa/` + `opensa/` — mod-installer plan 011,
vehicle-installer plan 010, ped-installer plan 005; ONE planner, `@opensa/tool-kit/layers`), and the stages
that read them run before the split — so a run that would build both targets out of a layered folder is
refused at config time and has to be run once per target. Anything else that wants to vary by target belongs after
the split, or in a source folder that does not.

**Caught:** partly — an unknown `--exclude`/`--target` name is a hard error, the resolved target is printed
at the top of every run, and a layered mods/vehicles/peds folder in a both-target run throws before any stage runs; but a
STALE target left by an older run is indistinguishable from a fresh one.

## One SOURCE folder, one reader — a tool may not re-derive which mods a folder holds

`mods-src/<game>/vehicles` decides its own contents (a flat tree, or `models/` overridden per SLOT by
`new/` — vehicle-installer plan 007), and **every tool that reads it goes through
`resolveVehicleSources`** (`@opensa/tool-kit/vehicles-dir`): the installer, its rebake, `vehicle-cutscene`'s
census, and any debug script that names a car. **Since 2026-08-19 there are TWO such roots** —
`mods-src/<game>/add-vehicles` holds the ADDED cars (`tools/add-vehicles`, central plan 102) with the same
grammar and the same one reader; the rule is per ROOT, not per folder name, and a second root is a second
call, never a second implementation. The cutscene census deliberately reads only the first. A second reading is not a duplicate implementation, it is a
DIFFERENT FLEET — the cutscene set stops matching the cars the player drives, and nothing in the build
compares the two. The same holds for `mods-src/<game>/mods` and `layers.ts`.

**Caught:** NO — this is the silent one. A private `readdirSync(inPath)` over the restructured tree returned
three "cars" called `models`, `new` and `screenshots`, found no `.dff` in any of them, and installed nothing;
a folder with no `.dff` is a legitimate skip, so no warning exists to fire. Measured on the real tree before
the fix: `vehicle-cutscene --inspect` reported **0 of 23 slots ready** and exited 0. What catches it is the
resolver being the only door: it throws on a stray or mis-cased folder instead of guessing.

## A build's SOURCE may not live inside its own output

The run's own `<out>/.work-<target>` (plus the legacy shared `.work`) is wiped at the top of every run,
before any stage reads `--game` or `--in`. So the obvious fast path for re-running one stage —
`--game <out>/.work-sa/5-trees --out <out>` — deletes the intermediate it was about to read when it sits in
the SAME target's dir. Copy the stage build out, point `--out` somewhere else, or read the OTHER target's
kept dir (plan 005 made that safe: it is never touched). The same applies to `--in`.

**Caught:** yes, since 2026-08-09 — pmb refuses the overlap by name before the wipe
(`pipeline.ts`, tests in `pipeline.test.ts`; segment-aware since plan 005, so `.work-opensa` no longer reads
as inside `.work`). Before that it was silent in the worst way: the run died on a missing `gta3.img` several
seconds AFTER the intermediates were already gone, so the error named the symptom and never the cause. It
cost a full rebuild that day.

Detail: [`architecture/perfect-map-builder.md`](../architecture/perfect-map-builder.md).

## A debug view has exactly ONE owner of what it shows

A tool that renders a chosen subset — the map inspector's cell set, a layer list, a filtered entity list —
must have a single writer of that subset. Plan 094 broke this twice, in opposite directions:

- phase 1's camera-follow and phase 2's panel both wrote the cell set, so the grid's checkboxes and the
  camera disagreed about what was on screen (fixed by giving the panel sole ownership);
- phase 6 then found the other half: with `?panel=0` there IS no panel, so nothing wrote the set at all and
  **every scripted capture rendered an empty world** — for four phases, while the tool looked like it worked
  (the phase 2/3 numbers happened to be taken with the panel up). The host now seeds the set itself in
  capture mode, and only there.

The rule for a new design: name the owner for every mode the tool has, including the headless one, and make
the ownerless mode impossible rather than merely unlikely.

**Caught:** no, and it is the worst kind of silent — the failure renders. A tool whose subset can be empty
must SAY it is empty (the viewer prints its resident cell count on every set change).

## Scripted control commands what a PLAYER commands, never what the systems compute

Anything that drives the game from outside — a scripted timeline, an autopilot, a future CLEO opcode — speaks
the `InputState` a player speaks, and reads the derived numbers back through an accessor the owning system
publishes. It may not recompute them.

Steering is where this bites. `move.x` is not an angle: `drive()` multiplies it by the authored
`fSteeringLock` **and** by `steerLimit()`, which needs the adhesion under the front wheels (four rays, once
per step), the traction, the speed and the sway (`enter-vehicle.system.ts`'s `drive`). A controller that
reconstructs that has a second adhesion probe and a second chance to disagree with the tyres — which is the
same class of bug as the 081/09 limiter running on a different number than the wheels. 096/02 therefore added
`EnterVehicleSystem.steeringModel()` (granted lock, current angle, slew rate, wheelbase off the car's own hub
placements) rather than a copy of the limiter.

The corollary: a new control input is a SIBLING source in `CombinedInput`, not a change to the driving path.
Note that `CombinedInput` **sums** move vectors, so a live keyboard adds to a scripted source's command.

**Caught:** no. A recomputed lock is silent — the car simply steers a fraction of what was asked, and looks
like an under-tuned controller. The limiter itself, with the reversed-source derivation, is documented in
`packages/game/src/vehicle/steering.ts`.

## A diagnostic tripwire is whitelisted per DECLARED event, never per mode

A watchdog exists to report the discontinuity nobody planned. The moment a new owner of the watched channel
is exempted wholesale — "the camera jump watchdog ignores video mode" — the tripwire is gone for everything
that owner does, including the jumps it did not mean to make. The exemption has to be as narrow as the event
that justifies it: the OWNER declares the frame, and the watchdog forgives that frame only.

096/03 is the shape to copy. Video mode's director owns the camera for whole scenes and cuts between shots
several times a scene; `watchCameraJump` accepts a one-frame `videoCut` flag the module raises and the host
loop clears after reading it, so a cut is legitimate and everything between cuts is still watched. The same
discipline is what makes the module's own tests able to assert continuity BETWEEN cuts (`director.test.ts`'s
pan-rate exam) — the flag is a contract, not a suppression.

The corollary for the test side: a per-frame continuity assertion that measures ACROSS a declared cut is
measuring the cut. Both 096/03 and 096/04 lost a round to exactly that.

**Caught:** no, and worse than silent — a muted watchdog looks like a clean run. The only signal is the
absence of lines you were not going to get anyway. Grep for what a whitelist covers before trusting a
"0 warnings" field report.

## A framing decision taken on a THRESHOLD will be taken again next frame

Any rule of the shape "if the signal exceeds X, compose it this way" is a step function, and the shots that
sit near X are the ones it ruins. It has bitten the camera three times now: 080's all-rays collision gate
(built, field-rejected, `docs/postmortem/080-cinematic-camera/multiray-collision.md`); 096's empty-frame
guard, which was designed around the lesson and is a CLOCK rather than a gate; and 096's lead room, which
mirrored the framing anchor at `|screenMotion| ≥ 2 m/s` and so stepped **0.24 of the frame's width** in one
frame — on `nose`, the one shot whose geometry parks that signal right on the line (~0.11 × speed).

The three answers, in order of preference: make the quantity CONTINUOUS in the signal (lead room is now a
smoothstepped share, so no speed is a cliff); make the decision DISCRETE but rate-limited (the tripod's
sightline: one probe a second, two blocked answers to cut); or put the hysteresis in the CLOCK (the
empty-frame guard's 1.5 s). Never in a moving camera.

**Caught:** now yes for this one — `shots.test.ts`'s "never steps the anchor across a crossing speed" sweeps
the range and holds the per-step move under the ramp's own slope. In general no: a threshold renders fine in
every screenshot and only shows in motion, at the speeds nobody happened to drive.

## A camera pose is composed IN the frame it is drawn in, and measured against the pairing that renders

A pose written from a module's own `requestAnimationFrame` pass reaches the host's loop one frame later, so
the screen pairs THIS frame's subject with the PREVIOUS frame's camera. For a camera that stands still that is
a shrug. For one MOUNTED on the subject it is the whole defect: the pairing carries the subject's entire
travel for that frame (`speed × dt`), and frame-clock jitter modulates it — **0.33° of horizontal wobble on a
5 m side-on shot at a 12 m/s cruise, about 7 px**, which is what 096 shipped and a human saw immediately.

The rule: anything composed against a per-frame render pose is stepped FROM the loop that draws it, between
the subject's render pose and the camera snapshot (`engine-canvas-host.tsx`'s `stepVideo`). The module still
owns its own clock for everything that is not per-frame — staging, the fragment's seconds, the survey.

**The measurement half of the rule, which is the part that actually cost a round:** a metric that judges the
pose against the subject it was COMPUTED from measures the intent, and is blind to the pairing by
construction. 096's mount fix moved that intent metric 0.311° → 0.032° and the shiver on screen did not
change at all (0.332° → 0.305°) — the reported bug survived a measurement that said it was fixed, and only a
second field report caught it. `scripts/debug/video-shiver.ts` now reports BOTH pairings side by side, and
the `frame-late` column is a regression tripwire rather than history.

**Caught:** no. Nothing in the type system or the tests can see which frame a pose lands in; the director's
own unit tests are pure and correct either way, and every headless acceptance number stayed green through it.
The only signals are the `frame-late`/`same-frame` split above and a human watching motion.

## A camera MOUNTED on a moving subject is damped in the SUBJECT's frame, never the world's

`smoothDamp` (and any spring, any lag filter) tracks a moving target with a steady-state error proportional
to the target's speed. Point one at a car's world position and the camera inherits a permanent lag — measured
**~1.1 m at a 12 m/s cruise** with the shot table's own 0.18 s constant — and closes it a little each frame by
an amount proportional to `dt`. The frame clock is not uniform (a healthy 120 fps headless scene measured
**3.1 ms RMS of jitter, 16-19 ms spread**), so every irregular frame moves the eye by a different distance and
the mount BUZZES along the direction of travel.

The rule: damp what actually changes. Re-base the damper against the subject — read the current pose relative
to where the subject stood last frame, write it back relative to where it stands now — and a constant-speed
drive leaves it nothing to do. The smoothing then eases only the heading the mount hangs off and the framing,
which is what it was put there for. A PLANTED camera (a tripod, a flyby) re-bases against the world, because
it is not mounted on anything and its lag behind a passing car is the shot.

The corollary a screenshot cannot show: **this only reaches the screen where the lag axis is perpendicular to
the view.** In 096 the same 0.034 m of eye jitter was 6.0 px/frame² of shiver on the side-on `wing` shots and
0.5 px on `nose`, whose eye rides 10 m ahead and whose lag merely changes the distance. Judging a mount from
the shot that happens to hide the defect is how this shipped.

**Caught:** now yes, by `apps/web/src/ui/video/director.test.ts` ("does not let an irregular frame clock shake
a car-mounted shot") — it drives a constant cruise on a deliberately uneven clock and holds the mount's spread
under a millimetre; the world-damped version wanders 2.2 mm on that same test and ~0.2 m in the field. It was
SILENT before that: every headless acceptance number 096/03 and /04 collected (99.1 % safe frame, 0 `[cam]
jump` lines) was blind to it, because a mount that buzzes 6 px still frames its car perfectly and never jumps
far enough to trip a watchdog. It took a human watching the footage. `scripts/debug/video-shiver.ts` over a
`?video=1&diag=1` capture is the instrument that names the guilty channel.

## A camera the STREAMING does not follow must cap its own travel against the anchor that is followed

Streaming runs off the PLAYER, not the camera: `driver.update(playerEngine)` in the host loop is the only
thing that grows the HD ring, and the ring is 380 u (`streaming.ts`). Every design that moves a camera away
from the player — a flythrough, a cutscene, a replay, an establishing shot over a skyline — is therefore
travelling through a world that is only loaded near somebody else.

The rule: a camera-only scene states its extent as a NUMBER against the anchor's position and is built to
respect it, rather than trusting a path to stay local. 096/07's flythrough trims its ground route to 350 m of
the anchor **before it plans a pass**, so no pass can be planned outside the ring in the first place; the five
passes then overlap one neighbourhood instead of walking the city. Sizing the other way — pick the flight,
then hope — is what puts the camera over unloaded ground.

The corollary that decides the shape of such a scene: **at a normal speed the cap is quickly binding.** Five
10 s passes at a cinematic 12 m/s is 600 m of travel, which no ring holds. That is not a tuning problem, it is
the reason a flythrough is passes over one place rather than a journey between two, and any future design that
wants a long traverse needs a moving anchor (teleport the player under the flight, behind a cut), not a bigger
cap.

**Caught:** partly. `fly.test.ts` holds the planner to the cap ("never plans a pass beyond the streaming cap,
however long the route is"), so this particular design cannot regress. Nothing catches the general case: a new
camera path that ignores the anchor produces an EMPTY WORLD ON CAMERA, which no acceptance number in the
`[video]` ledger measures — the shot is perfectly framed, perfectly smooth, and shows nothing. It is the
failure mode plan 094 exists to make impossible and the reason this is a restriction rather than a note.

## A map camera's FRAME may not reach past the world around its focus, however the streaming follows it

The neighbouring rule above is about a camera the streaming does not follow. The dispatch console is the
other case and it is not exempt: there the ring **does** follow the camera (`world.follow(state.target)` in
`apps/dispatch/src/world/boot.ts`), and the failure survives anyway — because a ring is a radius around the
FOCUS and a frame is a shape that grows with zoom and tilt. Tilt shallow enough, or zoom out far enough, and
the top of the picture lands outside the ring while the focus sits comfortably in the middle of it.

The rule: **a map camera's bounds are derived from how much world there is around the focus, and re-taken
every time the frame moves** — not written as constants. The console's two bounds (201/7-02,
`map/map-camera.ts`):

- the widest view is `reach / tan(fovY/2)` of distance, because at the top-down limit the frame's half-span
  IS `distance × tan(fovY/2)`;
- the shallowest tilt is the one whose top edge lands exactly `reach` from the focus — solved per frame,
  since it is a function of the distance the wheel just changed as much as of the tilt itself.

`reach` is the world's number, not the camera's: the LOD ring for a streamed world, its own extent for the
synthetic demo, nothing at all for plan mode (which draws no world).

**SILENT, and it looks like a content bug rather than a camera one.** Nothing throws, no counter moves: the
cells beyond the ring were never requested, so the map simply ends in mid-air and reads as a broken pak or a
half-built district. The old constants (`PITCH_MIN = -0.35`, `MAX_DISTANCE = 7000` against a 2200 ring) let
exactly that be reached with one drag. **Caught since 2026-08-22** by `map-camera.test.ts` for the two
bounds; nothing catches a NEW surface that lifts a camera over a streamed world and writes its own limits.

## A path's per-vertex speeds belong to the SUBJECT that travels it, not to the builder's default

`walkRoute` writes a target speed at every vertex from its `cruiseSpeed`, and those numbers are not decoration:
anything predicting where the subject will be later walks THEM (`predictAlong` — the station survey's whole
horizon). A route built for a subject that does not travel at that speed produces a prediction wrong by the
ratio of the two, and every consumer of the prediction inherits the error silently.

Measured 2026-07-31 (096/07, the walk scene's first headless run): a walk route left at the driving default of
12 m/s while the ped walked at 2 predicted a 15 s tripod window covering ~180 m of pavement instead of ~30.
All 8 station candidates were rejected on dwell, the tripod never filled, the slot played its fallback, and 48
casts were spent finding that out. Passing the ped's own `walkSpeed`: 2 filled, 0 rejected, 14 casts.

The rule for a new subject (a boat, a bike, a chased ped): give the builder that subject's own speed, taken
from the config or the data that owns it, and never let the route's speeds and the thing walking them come
from two different places.

**Caught:** no, and it cannot be by a unit test — the survey behaves correctly on the numbers it is handed, and
the route builder is correct about the speeds it was asked for. The only signal is a scene report's
`stations.rejected.dwell` against `stations.filled`, which is why both fields are in the ledger. Detail and
before/after in `docs/edge-cases/route-graph.md`.

## An input source reaches the game through TWO wires, and the camera one is separate

`CombinedInput` is not the whole contract. A source's `move()` and `isActive()` reach the systems through the
combiner, but its `consumeLook()` / `consumeZoom()` reach NOTHING on their own: in the engine host the camera
is host-owned — the director steps over `pendingInput`, which the host's own DOM handlers fill — so look and
zoom only arrive if the host drains that source into them as well (`foldTouchCamera`). The old three-host had
one wire, because its `CameraController` read the InputState itself; the engine host has two.

So a new source (a gamepad, a remote driver, a replay) is wired in two places or it is half-wired, and the
half-wired shape is the confusing one: the player walks, jumps and gets in cars, and the view does not move.
The zoom has a second trap on the same wire — the director counts WHOLE notches (`Math.trunc`), so a source
that emits fractions must carry its remainder across frames or contribute nothing at all.

Found 2026-08-03, restoring the touch overlay that plan 055 shipped: the mount and both wires went with
`canvas-host.tsx` in the engine migration (074/13 phase 5a+5b, which listed four surfaces it knowingly
dropped — this one it did not notice), and 0.4.0 released with no mobile controls at all.

**Caught:** no. Nothing type-checks a source into either wire, `apps/web/src/ui/**` is off the unit lane by
design, and the e2e lane drives the overlay against a standalone harness (`/controls-harness.html`) that has
no game behind it — every touch test stayed green through a release with no controls in the product. The
check is `scripts/debug/touch-controls-check.ts`, which boots the real game with `hasTouch` and drives the
overlay's own pixels.

## State the chrome must READ is state, not an event — the UI mounts after boot

The React shell subscribes to the game's `EventBus` only once `boot()` has RESOLVED (`hudGameRef` reaches
React through `booted.then`, and `<Hud>` mounts after that). Anything the boot closure announces WHILE it is
still booting is emitted to an empty bus: the event is not queued, not replayed, and nothing later asks.

So a mode that changes the chrome from inside boot must expose its state on the `HudGame` surface and be
READ on mount, with the event carrying only what changes afterwards. `getFlyCamera()` is that read;
`getTime()` and `getZone()` were already the same shape, which is what makes this a convention rather than a
special case.

Measured 2026-07-31 (096/08): video mode calls `setUiHidden(true)` inside `setupVideoRuns`, which runs in
boot — so every recorded frame kept the HUD clock, the "Click to play" prompt and the Fullscreen button,
while the perf readout (a plain closure flag, not an event) correctly went away. The photo camera (K+M) was
never affected: a keypress happens long after the subscription exists.

**Caught:** no, and not by this repo's unit lane — `apps/web/src/ui/**` is excluded from coverage by design
(DOM glue lives on the Playwright lane). The check is `scripts/debug/video-chrome.ts`, a DOM probe that
samples inside a fragment; run its `--control` lane too, or an all-hidden reading is equally consistent with
a probe looking for the wrong selectors.

## The per-frame collision-cast budget is ONE allowance, shared by every consumer

080 fixed the ceiling at **≤ 5 casts per rendered frame for the whole game**, and the follow rig already
spends 2. Everything else — a station survey, a planted shot's occlusion check, anything a future camera or
AI wants to ask the physics world — divides the remaining 3 between them.

The rule a new consumer has to satisfy is therefore not "am I cheap" but **"what is left after the others"**.
Concretely: take what remains of the frame's allowance rather than your own nominal share, and be the thing
that yields if you can wait a frame. A survey can always wait; a shot that is starting THIS frame cannot,
because its eye has to exist before it is drawn.

Measured 2026-08-01 (096/09): `stepSurvey` was called with the module's full `SURVEY_CASTS_PER_FRAME` (3)
regardless of what the frame had already spent, so adding a 3-cast plant check to the frame a shot starts on
would have cost 3 + 3 + the rig's 2 = **8**. It now takes `max(0, SURVEY_CASTS_PER_FRAME − frameCasts)`. The
same arithmetic is why a planted shot's candidate ladder is three rungs and not five: the rungs are casts,
they are all spent on one frame, and three is what fits.

**Caught:** partly, and only after the fact. Nothing refuses a cast — `frameCasts()` and the ledger's
`castsMax` merely RECORD what was spent, so an over-budget frame ships and is visible only if somebody reads
a scene capture afterwards. `station-supply.test.ts` now pins the yield ("yields the rest of the frame budget
to a plant that already spent it"), but that is one consumer pair, not a guard: a third consumer added
tomorrow would go over budget silently again. Read `stations.castsMax` in a `[video]` capture before
believing a new probe is free.

## A non-game surface reaches the game layer through the environment driver and nothing else

`apps/dispatch` is the engine's second consumer and its smallest complete embedding example: the renderer,
the streamer, and one shared config→`Environment` driver
(`@opensa/game/adapters/engine-environment-driver`) for lighting and timecyc. No ECS, no Rapier, no peds, no
vehicle physics, no weather sim. That is what makes it evidence that the engine layer stayed an engine
(`docs/project-goals.md`, directive 7).

Nothing enforces it. The Nx tags allow `type:app → app|engine`, and `packages/game` is tagged `type:engine`,
so the whole game layer is importable from the console with a green lint. The boundary is a convention held
up by one paragraph in `apps/dispatch/readme.md`.

The failure is not a crash, it is a slow loss of the property: the first `packages/game` import is always
reasonable (zone names, a pick helper), and after three of them the "engine embedding example" pulls in a
physics world to draw a map. When a console feature genuinely needs game-layer data — district names from
`map.zon`/`info.zon` + GXT is the live case — the decision is to MOVE the lookup to a layer both consumers
reach, or to take the import and write down why, in `docs/architecture/`.

**The live case was taken on 2026-08-21 (201/5-03), and the answer was neither option**, which is worth
recording because the question was posed wrong. The console does not need the game layer's zone code: what
`packages/game` owns there is `ZoneNameSystem`, an ECS system that tracks a PLAYER across frames, and this
surface has neither. What it needs is one pure question — what is at this point — and that is a property of
`info.zon`'s FORMAT (the nested boxes; the smallest containing one wins), so it moved to `zoneAt` beside the
parser in `@opensa/renderware`. The game layer now reaches the same function through
`adapters/named-zones`, because [the boundary above](#the-game-layer-touches-renderware-only-through-adapters-or-mods)
allows renderware from there and nowhere else — a lint that caught the first attempt.

**The second case, 2026-08-26 (201/5-04), moved as well — and it says where a moved rule LANDS.** Drawing a
unit as a car needs `readModelOsm`, which lived in `packages/game/src/adapters/`. It is not game logic: no
ECS, no player, no frame, just the inverse of `packVehicleFixture`. The obvious destination was
`@opensa/engine-formats`, which owns the `.osm` container — and it was the wrong one, on the container's own
words: *"sections are opaque byte ranges here; what is inside each one is the asset class's business"*, plus
a zero-dependency promise a reader needing the fixture type would break. It went to `@opensa/loaders` instead,
beside `openLazyVer2` — the primitive that gets those bytes out of an archive in a browser — and
`packages/game` re-exports it, so its fourteen existing hosts did not change and there is still one copy of
the format knowledge. **A rule moves to the package that already owns the neighbouring step, not to the one
whose name matches the file extension.**

**Before asking "may the console import this?", ask what it actually needs.** A game-layer type is often a
per-frame system wrapped around a rule, and it is the rule both consumers want. Moving the rule leaves both
better off; taking the import would have dragged an ECS system into a surface with no entities.

**Caught:** no — ESLint permits it by construction. The only check is review. (The renderware half of it IS
caught, by the `no-restricted-imports` rule above.)

## A map surface draws the fix it was sent, and corrects NOTHING about it

The dispatch console shows units that are players on a running server. Their positions arrive from PCAD — a
position and a heading, published every 4 s while the unit is in a vehicle
([202 §4](../plans/202-pcad-dispatch/readme.md)) — and they are already physically correct, because **the run
that produced them had collision**: the game held the car on the road, which is why `pos_z` is a road height
and not a hole. That work is done, once, where it belongs.

**On this surface a unit is a model drawn ON the map, not an object in a world** (the user's framing,
2026-08-26, and the reason 201/5-04 settles units as kinematic). The map has no physics, runs no simulation,
and reads no collision. So a fix is applied verbatim: the position, the height and the facing are the
server's numbers, converted between coordinate systems and nothing else.

**What may not be designed here, however reasonable each one sounds:**

- **snapping a unit to the ground** — a raycast, a height grid, a "the car looks like it is floating" fix;
- **reading collision for units** — the one thing that would put the baked collision back in the map
  profile's pak, which [201/1-03](../plans/201-dispatch-console/1-the-map-profile/readme.md) is now free of;
- **smoothing, interpolating or extrapolating between fixes** — already ruled out for its own reasons
  ([201/8-02](../plans/201-dispatch-console/8-the-time-axis/readme.md)); this is the same rule seen from the
  other side;
- **deriving an ORIENTATION the packet does not carry** — a roll or pitch computed from consecutive fixes,
  so cars lean on hills. At a 4 s publish rate the two fixes are ~110 m apart and the slope between them is
  noise; a map may not invent a facing any more than a position. The visible consequence of NOT doing it is
  recorded instead ([edge-cases/dispatch-console](../edge-cases/dispatch-console.md));
- **any correction at all** applied because the picture looks wrong.

**What breaks when it is violated:** the map stops agreeing with the game. A dispatcher sends a unit to a
place, and the operator's whole job is taken on the belief that what is on the map is where the server says
the unit is. A corrected position is a *better-looking* map that answers a different question — and the
error is largest exactly where it matters (a bridge, a multi-storey car park, a hill), because that is where
a ground correction has the most to move.

**Caught:** **no, and worse than silent** — a correction presents as an improvement (cars stop floating,
nobody sinks) while it quietly moves every unit off the place it was reported at. The one half that IS
pinned by a test is the pairing that makes the rule usable: `gtaRootMatrix` must place a car exactly where
`engine-vehicle-handle` places the same GTA position (`[x, z, −y]`, height verbatim), and SA's z-angle must
turn into this map's clockwise bearing through `headingFromZAngle` — feeding it in raw mirrors every unit's
facing about the north–south axis and looks entirely plausible (`apps/dispatch/src/map/coords.test.ts`).

**Where the picture may legitimately change:** in what is drawn AROUND the fix, never in the fix. A marker
that widens as its fix ages (202 §4's option 2) says the truth about uncertainty; a car quietly moved onto
the nearest road does not.

## A production surface may not stand on a `debug*` switch

The dispatch console's central interaction — click a building, get the model and TXD names the pak was built
from plus GTA coordinates — resolves through `CellStore.pick`, which returns nothing unless
`engine.cells.debugPicking = true` was set **before the first cell loaded**, and unless the pak carries the
placement mapper (minor 6).

So a product feature is gated on a flag named for debugging, at a moment (pre-first-cell) that no error
reports. A build that starts defaulting `debug*` off in production — the sort of change nobody would think
twice about, and `build:prod` already sets `OPENSA_DEBUGGER_HIDE=true` — turns click-to-inspect into a click
that selects nothing. There is no throw, no warning, and no missing pixel: the map just stops answering.

Either the capability gets an honest name and an owner outside the debug surface, or every consumer of it is
listed where the flag is defined. See `docs/plans/201-dispatch-console/5-symbology-and-picking-as-product/`.

**RESOLVED 2026-08-12 by taking the first option** (201/5-01). The flag is `CellStore.picking`, a named
capability with no `debug` in it, and the three hosts that arm it — the console, the map viewer and the game
shell's debug overlay — now say which capability they are asking for rather than which mode they think they
are in. The rule itself stays, because the shape recurs and the next one will not be picking.

The half that made it worth more than a rename: **a capability with no stated price is one nobody can budget
against, and this one had none.** What picking retains is CPU-side — the placement mapper's rows and the cell
index bytes a cell would otherwise drop after upload — and `Engine.ledger()` counts GPU residency, so every
instrument in the repo reported the cost as zero. `CellStore.pickingBytes` now counts both halves, the
console reports it in `?inventory=1`, and a test pins each half separately (both verified by reintroducing a
half-count, which the older single-assertion test did not catch).

**Caught:** the NAME, now, by being a name — a `debug*` sweep no longer hits a production feature. The COST is
caught by test rather than by review. Before this, both were silent, and the flag was worse than silent at
review: it read as debug-only, so a change disabling it looked safe.

## A camera at city height must push the fog cut out, or the world renders EMPTY

The engine culls any cell lying entirely past `fogCutDistance` (2400 by default). A map camera sits a
kilometre up looking at a whole city, so **every** cell is past the cut and the frame comes back with nothing
in it — a correct, fully-streamed world drawn as an empty canvas.

`pushFogOut` (`apps/dispatch/src/world/boot.ts`) ties the cut to `CAMERA_FAR` (12000, `map/map-camera.ts`)
and is **re-applied inside `applyHour`**, because the environment driver rewrites both distances every time
it applies a timecyc row — set it once at boot and the next hour change empties the map. `?fog=1` restores
the game's own fog for comparison.

This has now been discovered twice, independently, by the two surfaces that lift the camera: `sa-map-viewer`
and `dispatch`. Any third one — a map editor, an overview mode, a spectator view — will hit it in the same
way, and the symptom (a black screen with healthy streaming counters) points at everything except the fog.

**Caught:** no. The counters say the cells loaded; only the eye says they were not drawn.

## A raster ground layer on the 2D canvas is exact under the PLAN projection and under no other

The 2D overlay is where everything that is not the streamed world is drawn — symbology, sketches, and (since
201/6-02) the flat map's tiles. For a picture pinned to the GROUND the projection decides whether that is
even possible: under an **orthographic** projection the ground plane maps AFFINELY to the screen at any
heading and any tilt, so three projected corners give `setTransform` the exact placement of a whole tile.
Under **perspective** the same map is a homography, and canvas 2D has no homography: an affine per tile bends
every straight road at the tile seams, and the error grows with the tilt.

So a design that puts a raster — tiles, a baked overview, a heat layer, a floor plan — under the symbology
either holds the plan view while it draws (what `tile-layer.ts` does: it refuses under perspective and the
status bar says why) or subdivides each tile into affine patches and pays for the seams. Vector symbology is
unaffected: a point is projected exactly under both.

**Caught:** partly. Our own layer refuses by name, but nothing stops the next one from drawing a skewed
quad — and a skewed raster under a tilted view reads as a rendering artefact rather than as a category
error, which is how it survives review.

## The PC/mobile difference is a BUDGET, not a branch

One engine runs on the desktop and on a phone. The difference between them is expressed in numbers the frame
reads — ring sizes, cadences, residency ceilings, render scale — and never in branches the frame executes:
no second renderer, no "mobile shader path", no parallel shader set, no per-platform pass list.

The reason is cost that never comes back. A forked path is a second codebase every future rendering plan has
to implement and verify twice, and the divergence is invisible until a look change lands on one platform and
not the other. The repo already refused the neighbouring shape once: an automatic quality-tier ladder was
measured and rejected (`docs/performance/deferred-optimizations/render-scale-tier.md`), leaving `?scale=` as
the one knob (`docs/restrictions/gpu-and-shaders.md`).

Where a device genuinely cannot do something, that is a **content** decision taken at build time — a world's
texture format decides which GPUs can display it (`docs/restrictions/assets-and-data.md`) — not a runtime
branch bolted into the frame.

**Caught:** no. A platform branch lints clean, tests clean on whichever platform CI runs, and is only found
when somebody compares the two screens.

## The GPU feature a payload demands is read from the format table, never re-derived

`OSTEX_FORMAT_FEATURE` (`packages/engine-formats/src/ostex.ts`) maps every `.ostex` format to the WebGPU
feature it requires, or to `undefined` when it uploads anywhere. That table is the rule. Anything that needs
to know whether a device can read a payload — the manifest gate, the per-array upload, a future backend —
reads it, and computes nothing of its own.

The reason is a bug that shipped and cost a field session. `requireFormatSupport`
(`packages/engine/src/core/ostex-upload.ts`) derived the demand itself:

```ts
const isBc = format !== OstexFormat.RGBA8;
```

True while BC was the only compressed format we wrote, and a lie the day `opensa-pack --textures astc`
shipped. `requireWorldSupport` already read the table, so an ASTC pak **passed** the manifest gate and was
then refused **per array** by this second copy, on a Mali-G51 that carries `texture-compression-astc`. All 20
world arrays were rejected, `cellsTotal` stayed 0, and the error told the operator to rebuild the pak with
textures the device could read — which it already was. Measured 2026-08-12; the capture VOIDed itself and the
pak was innocent (`texture-budget.ts` read it back as ASTC4x4, and `report.json`'s recipe said `astc`).

The shape is the same one [the cell size](#one-cell-size-agreed-by-four-places) has: a rule with more than one
owner. It differs in how it fails — a second copy does not diverge when the world changes, it diverges when a
NEW MEMBER is added to the set, and the copy that was never taught about it keeps answering for the old set
without knowing it is wrong.

**Caught:** now yes, by `ostex-upload.test.ts` in both directions (ASTC refused where there is no ASTC, ASTC
accepted on a GPU with ASTC and no BC) — and both were verified by reintroducing the defect. Before that,
**silent**: the manifest gate passed, the build's `--platforms mobile` gate passed, every test passed, and
only a real GPU said otherwise.

## A counter that runs is READ, never summed — and the same struct carries both kinds

`StreamStats` (`packages/engine/src/stream/streaming.ts`) is returned once per `update()` and mixes two
different kinds of number in one flat object:

| Kind | Fields | How a host reads it |
| --- | --- | --- |
| **per-update** | `blobMs` (reset each update), `uploadMs` (assigned each update), `pendingCells`, `loadedCells` | sum it, or average it over the window |
| **running total since construction** | `created`, `evicted`, `lateCreates`, `worstBlobMs`… (`worstBlobMs`/`worstCreateMs` are running maxima) | read the latest, or difference two readings around a leg |

Summing a running total is the failure, and it produces a number that looks like a finding. The dispatch
console's inventory collector added all five up per frame, so the 2026-08-12 phone capture reported
**`cellsCreated` 2454 against 4 resident cells and 0 evictions** — four creates counted again on every one of
685 frames. It read as streamer churn, it was filed as an open question that blocked the capture from being
cited, and nothing else in the capture agreed with it (`blobMean` 0.02 ms, `uploadMean` 0.18).

`apps/web` had the pattern right the whole time and it is the one to copy — `engine-perf-runs.ts` takes
`lateCreates` before a leg and subtracts, because a *delta over a window* is the only meaning a running total
has inside a measurement.

**Caught:** now yes, in `apps/dispatch/src/world/inventory.test.ts` — a 101-frame window of a settled world
must still report 4 creates, and the defect was reintroduced to prove it fails (`expected 400 to be 4`). The
field is documented on the interface itself, which is where a host looks. Before that, **silent, and worse
than silent**: the wrong number is plausible, self-consistent across a whole window, and grows with window
length, so a longer capture makes it *more* convincing rather than obviously broken.
## A rate over a loop that may SKIP is a rate for the loop, never for the frames

A render-on-demand loop (`apps/dispatch/src/world/boot.ts`, 201/4-01) wakes on a timer when nothing has
changed and returns without drawing. Its per-pass `dt` is therefore two different quantities wearing one
name: between two drawn passes it is a frame interval, and around a skipped one it is a *wake interval* —
the 100 ms the console spent asleep. **A statistic that mixes them is a statistic about the scheduler.**

The console reported `fps` as `1000 / mean(dt)` over the last sixty passes, drawn or not. Six seconds of rest
is sixty 100 ms wakes, so the readout said **10 fps** on a console that was drawing nothing at all, and then
climbed back to the truth over the next sixty frames as the idle samples aged out of the window. The same dt
was printed as a frame time, so the first frame after a rest "cost" the length of the rest.

The rule has two halves and both are needed:

- **count what was DRAWN.** A frame rate on a gated loop is a COUNT — frames drawn in the last second — not
  the reciprocal of a mean. On a console at rest the honest answer is a low number, and it is low because the
  frames were not drawn rather than because they were slow.
- **an interval is a frame time only if BOTH ends drew.** The one that follows a skipped pass is dropped, not
  averaged in. `FrameClock` (`apps/dispatch/src/world/frame-clock.ts`) does both and is the one place either
  is computed; `plan-mode.ts` had the identical defect and takes the same clock.

**It reached the CAPTURE too, and there it was most of the window rather than a tail.** The inventory
collector is only ever called on a drawn frame — the call sits behind the gate — but a skipped pass arms the
next loop entry with `setTimeout(IDLE_WAKE_MS)`, so **the frame drawn after one carries a 100 ms `dt` that
is 99 % sleep**. On a live 150-unit board the console alternates draw/skip continuously: measured 2026-08-31
on the phone, **706 of 835 samples were that interval**, so `dtP50Ms` read the idle poll (100.6 ms) and
`shareOfFrame` (2.3 %) described a resting loop rather than a busy frame. Every capture from 2026-08-22 to
that date had its moving half derived from the histogram **by hand, in the row's own prose**.

Fixed the same day, and the shape of the fix is the rule's third clause: **one owner decides, everybody else
is told.** `FrameClock.drew()` returns the interval's kind and the collector takes it as an argument — the
status bar and a filed capture cannot disagree about which gaps were frames. The frame fields are the paced
population, a `rest` block carries the other one rather than dropping it, and `shareOfFrame` divides by the
same population its numerator came from. The CPU block goes with it, and that half was found by the field run
rather than argued: `cpu.bodyMs` is paired one pass late on purpose (the body that ran inside the interval
being reported is the previous pass's), so after a SKIPPED pass it carries the render gate's own ~0.2 ms.
The 2026-08-31 after-row read `bodyMeanMs` **1.48 ms against a real 13.84**, with every segment ~11× low.
What does NOT move is everything measured on the frame itself — the streamer, the engine timings, the spans,
the world — because those are not paired to the pass before them.

**Caught:** both halves are now — `apps/dispatch/src/world/frame-clock.test.ts` for the readout and
`inventory.test.ts` for the capture, each written against the numbers the phone actually produced. Before
that, **silent, and in the shape that costs the most**: every
sample is a real measurement, the arithmetic is right, and the number is only wrong about what it is a
number OF. It is also wrong exactly when it is read — a person looking at a still map to judge the frame
rate is looking at the case that produces the worst answer. Measured cost of getting it wrong on the screen:
the console reported **9–10 fps** where it was drawing **17**, and read **21** when the moving frames were
derived properly ([2026-08-31](../benchmarks/opensa-engine/2026-08-31-mobile-honest-frame-counter-150u.json)).

## An effect that depends on a PROP the host recreates is a subscription that never runs

An interval, an observer or a listener started inside `useEffect(…, [callback])` is torn down and rebuilt
every time `callback` changes identity. When that callback is an inline arrow in the host's JSX — the normal
way a getter is passed down — it is a new function on every render of the host, so the effect restarts on
every render. If the host re-renders faster than the effect's own period, the work inside it **never happens
once**.

Measured 2026-08-25: `InventoryPanel` polled the collector every 500 ms with `[read]` as its dependency,
while the console pushes a readout four times a second — so the interval was rebuilt every 250 ms and fired
only in the gaps. The capture the operator copied after flying the map for minutes contained ONE frame, from
just after boot, and every other capture of a moving map had been the same. The panel looked alive the whole
time, because it had a report; it was simply the first one.

The fix is the shape the rest of this app already uses: the callback lives in a ref (`readRef.current = read`
on every render) and the effect depends on **nothing**, so it is started exactly once.

**Caught:** no, and worse than not caught — it is INVERTED. The failure happens while the surface is busy and
disappears the moment it goes idle, so every check made "at rest" passes: `use-operations.ts` had the ref
shape from the start and the panel next to it did not, and the difference showed up only as a measurement
that had been quietly wrong for two days.

## A field capture names the pak it read — it must name the APP too

A capture off a device measures what the device is RUNNING, which is not the same thing as what was pushed.
The dispatch capture stated the PAK's `buildTime` from the manifest and said nothing at all about the app, so
"is this a measurement of the change?" was answerable only by argument.

Measured 2026-08-26: **three captures in a row were taken of the same pre-change app, twice while everyone
involved believed otherwise.** The first was caught only by an accident — that change happened to ADD fields
(`boot.openMs`, `boot.overlapMs`), and their absence gave it away; a change that only alters a number would
have been invisible. The second time the cause was upstream of the app entirely: `git pull` printed
`Your configuration specifies to merge with the ref '…' from the remote, but no such ref was fetched` —
the device's branch still tracked a branch name the remote no longer has — **and exited 0**, so the `&&`
chain behind it happily re-extracted the archive that was already in the tree and served it.

So: anything that will be compared across builds carries the build identity of the thing being compared.
`__APP_BUILD__` (the commit, `+` when the tree was dirty — [`scripts/app-build.ts`](../../scripts/app-build.ts))
reaches the report as `app`, beside the pak's `build`.

**Caught:** no, and it is the worst shape of silent — nothing errors, the capture is complete,
self-consistent and plausible, and every number in it is a real measurement of the wrong build. A green run
and a stale run look identical. The check is the `app` field, and the half that lives outside this repo is
the device's git state: a `git pull` that fetches without merging is a NO-OP with a zero exit code.

## An effect's RETURN VALUE is its cleanup — a shorthand body must return a cleanup or nothing

React calls whatever `useEffect` returns as the effect's cleanup function. A concise arrow body returns the
expression it evaluates, so

```ts
useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [lines.length]);
```

hands React a non-function, and React unmounts the WHOLE tree the moment that cleanup runs. The window goes
black at the end of the work it was doing, with everything the run produced already correct on disk — which
is what it looked like when it shipped to Windows in `cutscene-converter` 0.4.0 (`f1f65b7b`): the conversion
finished, the files were in the output folder, the app showed nothing.

**The shorthand is not the defect.** Returning a subscription's unsubscribe function from it is the correct
idiom and reads well:

```ts
useEffect(() => game.events.on('city', ({ city }) => setCity(city)), [game]);
```

Only a VOID expression is the trap. So: braces around the body unless the expression IS the cleanup.

**Caught: NOTHING catches this**, and both instruments were tried and measured (2026-08-18):

- **tsc cannot.** The callback's type is `void | Destructor`, and `void` fits.
- **A syntactic lint rule** (`no-restricted-syntax` on a shorthand effect body) fires on all four occurrences
  in this repo, and **three of them are the legitimate unsubscribe idiom** above. A rule that is wrong 75 %
  of the time trains people to disable it.
- **The type-aware rule** (`@typescript-eslint/no-confusing-void-expression` with `ignoreArrowShorthand:
  false`) is correct in principle — it separates a void expression from a returned function — but it flags
  **128 places across `apps/`**, nearly all of them ordinary JSX handlers (`onClick={() => setX(1)}`). The
  price is a repo-wide rewrite of correct code.

What exists instead is damage control, not prevention: the renderer's error boundary turns the blank page
into a message naming the failure (`apps/cutscene-converter/src/renderer/error-boundary.tsx`), and
`scripts/debug/cutscene-converter-drive.ts` reproduces the class in seconds by driving the built app. Read
an effect's body before you shorten it.

