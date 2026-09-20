# Scripted physics laps (`?phys=`) — driving the real game for numbers

The behaviour twin of [benchmarks.md](benchmarks.md). That harness measures what a frame COSTS; this one
measures what a car DOES — how long it takes to stop, how far it rolls, whether it goes over, how long the
yaw takes to answer the wheel.

**It drives the shipping game.** The timeline goes through the same `InputState` the keyboard feeds and the
same `drive()` the player's throttle reaches, so a capture describes the car that ships, not a model of it.
Built for plan 081 (vehicle physics), but it is the repo's general instrument for anything that only happens
while a car moves — two engine bugs were found in its first day of use, both invisible to the unit suites.

## Run one

```bash
npm run serve:static            # the canonical build on :3001 (an opensa-pack --out)
npm run dev                     # the app on :5173
```

Then either drive it by hand in the browser, or headless:

```bash
SRC=http://localhost:3001/build/original/opensa
# every scene, one car — 8 laps, ~14 min
TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&phys=all&car=infernus" phys 1200000 8
# one scene — ~2 min, the loop to use while calibrating
TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&phys=step-steer&car=comet" step 300000 1
```

`TAG='[phys]'` is what switches the harness from the `[bench]` protocol to this one. The served dir must be
an **opensa-pack `--out`** (the engine host refuses to boot without a converted player model).

| Param | Default    | Value                       |
| ----- | ---------- | --------------------------- |
| `phys`| off        | `all`, or one scene key     |
| `car` | `infernus` | any model from `vehicles.ide` |

## What a lap does

1. **Gets the player out of any car** — a seated rider is re-placed on his seat every fixed step, so
   teleporting one drags him back to the car he is in.
2. **Teleports beside the spot**, 2.5 m to the road-heading's right.
3. **Waits three times**: a grace tick (right after a teleport `pendingCells` still answers for the ring you
   just left and reads 0 immediately), then the ring drains, then a warmup for the collision parse behind it.
4. **Spawns the car**, retrying while the ground streams in — `seatVehicleOnGround` defers by throwing.
5. **Seats the player directly** (`EnterVehicleSystem.seatInstantly`), then lets the springs settle.
6. **Plays the timeline** with the telemetry capture ON, one frame per fixed step.
7. **Prints `[phys] {json}`**, then coasts the car to a stop and climbs out for the next lap.

Everything except step 6 happens with the capture OFF, so a lap's frames are the drive and nothing else.

## Scenes

Data, in [`apps/web/src/phys-scenes.ts`](../../apps/web/src/phys-scenes.ts): a spot, a heading, a keyframe
timeline and a duration. Thirteen today — `rest` · `brake-strip` · `step-steer` · `sweeper` · `slalom` ·
`u-turn` · `kerb-strike` · `kerb-mount` · `grass-corner` · `crest-jump` · `handbrake-turn` ·
`handbrake-flick` · `pull-away-reverse`.
(`kerb-mount` is the square, low-speed kerb the 081/06 §2 probe is measured on; `kerb-strike` is kept for the
record but was shown on 2026-07-27 to hit a traffic light rather than a kerb; `grass-corner` is the only lap
that runs entirely OFF the road, and the only one the 081/10 surface-grip change can be judged on.)
(`sweeper` is the
moderate-steer-at-high-speed instrument 081/05 recorded as owed: WOT to ~140 km/h, then 0.4 of steer held.)

Keyframes **HOLD**: each one's `move`/`actions` stay in force until the next, and nothing is interpolated. A
slalom is "full left, then full right" — an interpolated version is a different manoeuvre, and a scene has to
be describable in words to be reproducible. `move.x` is steer (+ = right), `move.y` throttle (− = brake or
reverse), `actions: ['jump']` is the FOOT brake and `actions: ['handbrake']` is the lever. Those two were one
control until 2026-07-26, and `handbrake-turn` went on pressing `jump` afterwards — so every "handbrake"
number in the record before that date was measured on the pedal. **A scene that names one control and presses
another is invisible to every check except reading it.**

### Adding one

1. **Find a real spot.** `npx tsx scripts/debug/road-straights.ts 250` walks the game's own `NODES*.DAT`
   vehicle graph and prints straights (length, Δz, heading) and crests (rise/drop within a launch length).
   Never guess coordinates: a scene on unverifiable ground invalidates every number taken on it.
2. **Do not share a spot with a scene that crashes.** A lap seats the player in the NEAREST car, and a
   previous scene's wreck qualifies — that produced a capture of a car that never moved and was "airborne"
   for its whole lap. Keep scenes ≳100 m apart on one road.
3. **Write the timeline**, and state `what` the scene is for in a sentence — it is printed with every
   capture, and a scene that cannot say what it measures is not evidence.
4. **Run it once and read the series**, not just the summary. The first `brake-strip` held throttle to 12 s
   and the infernus ran out of straight at 190 km/h; the 18.8 g lateral spike said so plainly.
5. **Off the road, `position.z` must be the MEASURED ground height, not a guess.** The spawn snap searches
   only `[z + 2, z − 4]`, so a scene whose z came from a terrain model's ORIGIN fails every lap with
   "no ground" — `grass-corner`'s first version sat 9 m above its own field. Sample the COL under the XY
   (a throwaway ray over `getCollision` is ~40 lines) and use what it says.
6. **Check the ground for POLES, then confirm with the `x`/`y`/`z` columns.** A city street's kerb line carries
   a traffic light at every junction corner and a lamppost or tree every ~12 m, and a lap that drifts wide
   finds one — `kerb-strike` turned out to be measuring a traffic light rather than a kerb, and the first two
   versions of `kerb-mount` drove into poles of their own before the spot was scanned for a clear span
   (`inspect-area.ts` around the intended line). The position channel is what settles it: a capture that
   reports 100 g and cannot name the spot cannot say whether the car hit a kerb, a wall or a palm tree.

## The capture

One `[phys]` line per lap: `car`, `key`, `what`, `seriesHz`, the `columns` list, the thinned `series`, and a
`summary`. Schema and the comparability rules live with the record:
[`docs/benchmarks/vehicle-physics/readme.md`](../benchmarks/vehicle-physics/readme.md) — **that is where
captures belong**, not in a plan folder.

Two rules worth repeating here:

- **Peaks come from EVERY fixed step; the series is thinned to 20 Hz.** A spike survives as a number even
  when its own sample is dropped from the curve — never read a peak off `series`.
- **Angles are radians in `series`, degrees in `summary`.** `pitch` positive is NOSE UP, `roll` positive is
  right-side-down, `slipAngle` positive when the car points LEFT of its travel, and `g` excludes gravity.

The summary's channels: `topSpeedKmh`, `timeTo100S`, `brake {distanceM, fromKmh, seconds}`,
`pitchUnderBrakeDeg`, `pitchDeg`/`rollDeg` ranges, `slipMaxDeg`, `turnedDeg` (integrated — counts a whole
spin), `gLong`/`gLat`/`gVert` ranges, `airborneS`, `air {atS, seconds, pitchDeg}` — the LONGEST unbroken flight and
what the nose did during it, which is the only channel a jump can be judged on (`airborneS` is a total, and a
lap that skips over a crest in a dozen hops reports the same second of air as one that flies) —
`flip {atKmh, atS}`, and `step` — the steering-step
transient (`yawRiseS`, `yawSettledDegS`, `slipSettledDeg`, `yawOvershoot`, `speedAtStepKmh`), found in the
data rather than taken from the scene.

## Comparing two runs

```bash
npx tsx scripts/phys-compare.ts before.log after.log              # tuning diff: every summary delta
npx tsx scripts/phys-compare.ts run-a.log run-b.log --determinism # replay check, with bands as a gate
```

Either input can be a raw harness log — the tool finds the `[phys]` lines itself — or a JSON array of
captures. Captures pair by `car` + scene `key`.

## The regression pack (the gate)

The committed matrix of the ACCEPTED feel — 5 cars × 11 scenes, `docs/benchmarks/vehicle-physics/`
`2026-07-27-headless-shipped-<car>.json` — is what a change to vehicle physics is measured against. Sweep the
five cars, then check the fresh logs against the pack:

```bash
for car in infernus admiral firetruk comet turismo; do
  TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
    "http://localhost:5173/?loader=http-dir&src=$SRC&phys=all&car=$car" "shot-$car" 2700000 11 > "sweep-$car.log"
done
npx tsx scripts/phys-regression.ts sweep-*.log
```

Bands live in `scripts/phys-regression.ts` with the reason for each widening: they are NOT a determinism
check but the width of "the feel did not move", floored on a measured repeat sweep. A breach is a finding —
either the change moved something it should not have, or the pack is deliberately re-recorded (new captures,
a new prefix in the script, a chronology row in the benchmarks readme, and the field verdict that accepted
the new feel).

## Reading a failed lap

- **The runner names its own failures**: `[phys] scene 'x' failed: …`. A missing line would read as a pass,
  so every lap either prints a capture or says why not.
- **A `console.log` from the game is invisible here.** The harness forwards only lines carrying the TAG,
  `[slow]`, or console errors and WARNINGS (`drive.js`), so a debug print added mid-investigation must be a
  `console.warn` or it will look like the code never ran (081/10 step 4 lost a run to exactly that).
- **The harness screenshots on exit**, and the on-screen HUD carries `FIXED-STEP ERROR: …` — that is how a
  permanent fixed-step crash (a car unloaded after the player left it) was identified in one look.
- **An absurd capture usually means the wrong car**: top speed 0 with the whole lap "airborne" is a lap that
  seated into a wreck. Check whether another scene shares the spot.
- **A lap that never seats** means no car within the enter range (4 m) — the ground-snap slides a blocked
  spawn up to 3 m along the heading, so the ped stands at 2.5 m with margin.

## Gotchas, learned the hard way

- **Never edit app source while a sweep runs.** Vite HMR reloads the page mid-lap and the captures come out
  of a build that no longer exists. Docs are safe (they are not in the module graph).
- **`pendingCells === 0` right after a teleport is a lie** — it answers for the ring you left. Grace, drain,
  warmup, in that order.
- **A lap can end at speed.** The climb-out will not start until the car has stopped (its `stopping` phase
  brakes first), so the runner coasts it down before asking.
- **Determinism is real but not free.** `brake-strip` reproduced to the second decimal across an isolated run
  and a full sweep on the same build; the physics is fixed-step, so frame rate does not enter. What DOES
  break comparability is a changed scene definition or a different pak — record both.

## Related

- [`docs/debug/README.md`](../debug/README.md) — the toolbox entry and the triage method.
- [`scripts/debug/handling-diff.ts`](../../scripts/debug/handling-diff.ts) — how much of a handling table's
  difference the engine can even see (five of ~40 columns are mapped today).
- [`docs/plans/081-vehicle-physics/01-telemetry.md`](../plans/081-vehicle-physics/01-telemetry.md) — the
  ledger this instrument was built for, with the BEFORE matrix and what it exposed.
