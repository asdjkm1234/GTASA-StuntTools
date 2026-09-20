# 081/10 — Surface types: the wheel learns what it stands on

**Status: steps 1–5 SHIPPED and field-reviewed 2026-07-27** — the wheel reads its surface and the grip
follows it; the field's verdict was "applied, verified, almost unnoticeable", shelved as
[`docs/open-issues/offroad-feels-like-tarmac.md`](../../open-issues/offroad-feels-like-tarmac.md). **Step 6
(wet grip) MOVED to [roadmap 0.5.0 / 05 rain](../../roadmap/0.5.0/plans/05-weather-rain/readme.md)** — the
engine has no rain yet. It was the last item of the agreed queue after the regression pack (07 §2), the kerb
close-out (06 §2) and the step-cost measurement (07 §3).

Today every tyre in the world drives on tarmac. `ROAD_ADHESION = 4.5` in `vehicle/steering.ts` is the
rubber×road cell of `data/surface.dat` hardcoded, and the per-wheel `frictionSlip` is the car's authored
`fTractionMultiplier` with no idea what is under it. A comet on a beach grips exactly as it does on the LV
strip, and `bOffroadAbility` means nothing.

## What the data actually says (measured 2026-07-27, from the BUILT game)

- **`data/surface.dat`** is a 6×6 adhesion matrix between material groups. The rubber row is the one a tyre
  uses: **road 4.5 · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8 · rubber 6.0**. So grass and dirt are 71 % of
  tarmac, sand 67 %, wet 62 % — a real difference, and a bounded one (no surface is grippier than tarmac
  except rubber, which nothing drives on).
- **`data/surfinfo.dat`** has 179 rows; **row order IS the COL material byte**, and `parseSurfaceNames`
  already reads the name column for procobj. Group spread: **ROAD 73 · LOOSE 60 · HARD 29 · SAND 12 ·
  RUBBER 3 · WET 2**.
- **The per-surface `TYRE_GRIP` column is 1.0 on all 179 rows** — the override the file's own legend
  advertises is unused in stock data, so the group matrix is the whole story. Do not build a mapping around
  a column the data never sets; read it, apply it, and expect it to be 1.
- **`WET_GRIP` is live**: 116 rows at 0.00, 38 at −0.40, 18 at −0.25, 6 at +0.50, 1 at +0.40. It is the
  rain-time modifier, and it is what makes a wet road worth having weather for.
- **The map's collision carries the materials, and they are varied.** Sampled from the real COL faces:
  LV strip → `tarmac`, `pavement`; Red County crest → `rock_dry`, `dirttrack`, `dirt`, `grass_medium_dry`,
  `golfgrass_smooth`, `gravel`; LS beach → `sand_beach`. This is not a feature waiting on data.

## What is missing, in layers

1. **The seam drops the material.** `ColliderShape` (`packages/game/src/interfaces/collider.interface.ts`)
   carries vertices, indices, boxes and spheres — no per-face material, though `col.ts` parses one (`u8`)
   for every face and primitive. Nothing downstream can ask what a triangle is made of.
2. **DRCVC will not say what a wheel rides.** The raycast controller exposes contact, impulses and
   suspension length — not the collider or triangle it hit. Identifying the surface needs OUR OWN downward
   ray per wheel, or a design that encodes the answer in the collider itself (see the decision below).
3. **The steering limiter reads the same constant.** `steering.ts` uses `ROAD_ADHESION` in the original's
   own lock formula — when the tyre's adhesion becomes a lookup, the limiter must read the SAME number, or
   the car will be granted lock its tyre cannot answer. That coupling is what 081/09's saga was about.

## The decision to make first (measure, don't argue)

How a wheel learns its surface, priced against the **measured** vehicle budget (081/07 §3: the whole vehicle
slice is ~8 µs per car per step, 0.605 ms at 80 live cars):

- **A — a downward ray per wheel per step.** Four rays per car. On the driven car alone: free. On all 80
  bench cars: roughly doubles the slice (~0.6 → ~1.2 ms/step). Simple, exact, and it reads whatever the map
  says at that point.
- **B — colliders split by adhesion group.** The cell builder emits one trimesh per group, so the ray hit's
  COLLIDER is the answer with no per-triangle lookup. Costs a handful more colliders per cell and a pipeline
  change; still needs a ray, since DRCVC hides its own.
- **C — sample rarely.** Surfaces change slowly under a car: probe the driven car every step and traffic
  every N steps (or never — traffic follows the road graph and stays on tarmac).

Recommended entry: **A + C** (exact, one place, cheap where it matters), with B kept as the optimisation if
the per-triangle lookup turns out to be the expensive half. **Whatever is chosen, the capture must record
which surface each wheel reported** — the same self-describing rule the springs and dials follow.

## Steps

1. **`surfinfo.dat`, fully typed.** Extend `parseSurfaceNames` into a per-material record (adhesion group,
   tyre grip, wet grip, skidmark type, the `W_*` effect flags, `PAVEMENT`/`SAND`/`WATER`) — the effect flags
   are read here even though 089 consumes them, because one file should be parsed once. Unit tests pin real
   rows (`TARMAC`, `GRASS_SHORT_LUSH`, `SAND_BEACH`, `WATER`), including the all-1.0 `TYRE_GRIP` fact.
2. **`surface.dat`, the 6×6 matrix**, parsed and unit-tested against the file's own header (it is a lower
   triangle — the parser must mirror it, and prove it does on rubber×road = 4.5).
3. **Materials through the seam.** `ColliderShape` gains a per-triangle material array (and per-primitive
   for boxes/spheres); the adapter fills it; the physics layer keeps it beside the collider. Nothing changes
   in behaviour — this step ships green with the numbers unchanged, and the regression pack proves it.
4. **The probe.** A per-wheel downward ray on the driven car (and the chosen policy for traffic), the hit's
   material resolved to a surface record, exposed through the vehicle handle + the `[phys]` capture. Still
   no behaviour change: the capture starts REPORTING the surface while the grip stays tarmac.
5. **Grip from the surface.** `frictionSlip` per wheel = the authored `fTractionMultiplier` scaled by the
   matrix's rubber×group cell relative to road (so tarmac is exactly today's feel and only off-road moves),
   with the steering limiter reading the same adhesion. **This is the step that moves the pack** — a
   deliberate re-record after the field verdict, not a band widening.
6. ~~**Wet.** `WET_GRIP` applied while it rains~~ — **MOVED 2026-07-27 to
   [roadmap 0.5.0 / 05 rain, piece 9](../../roadmap/0.5.0/plans/05-weather-rain/readme.md)**. There is no
   rain in the engine to be wet from (`docs/features/weather-environment.md`: precipitation is deliberately
   not selectable), so the rule would have had nothing to switch it on. Everything it needs is shipped —
   `SurfaceRecord.wetGrip` is parsed and reaches the physics, the per-wheel adhesion path applies a scale
   every step, and the limiter is fed the same number — and the rain plan states the rest: one wetness
   scalar shared with the visual half, SA's own formula read before coding, and the dry world proven
   unmoved by the 081/07 pack.
7. **Field round** on grass, dirt and sand, plus the pack re-recorded on acceptance.

## Acceptance

- A car on grass/dirt/sand slides earlier than on tarmac, and the difference is the matrix's, not a dial's.
- Tarmac feel is **byte-identical** to today (the pack passes untouched until step 5, and step 5 moves only
  off-road laps unless the field asks otherwise).
- The vehicle slice stays inside 081/07 §3's budget with the probe live — measured, in this ledger.
- Field: "the car finally behaves differently off the road", and no complaint that town driving changed.
  **Answered 2026-07-27, and not the way this line assumed** — town driving is untouched (that half holds),
  but off-road reads as "almost unnoticeable": see the ledger and
  [`docs/open-issues/offroad-feels-like-tarmac.md`](../../open-issues/offroad-feels-like-tarmac.md).

## Risks

- **The steering limiter must follow the tyre** (see above) or off-road becomes the 081/09 complaint again.
- **A grip change is a feel change**: every SA-faithful grip move in this chain was field-rejected. This one
  is different in kind — it does not scale the tyre, it says WHERE the tyre is — but the field decides.
- **`p_*` procobj surfaces** (grass tufts etc.) are in the same table and must not be treated as ground.

## Ledger

_(surface counts, the chosen probe policy + its measured cost, before/after captures, field verdict)_

### 2026-07-27 — steps 1-2: both data files are read, and the tests pin what they actually contain

No behaviour change; this is the data half, and it ships green.

- **`parseSurfaceInfo`** (`renderware/parsers/text/surfinfo.parser.ts`) turns each row into the full record —
  adhesion group, tyre/wet grip, skidmark type, friction effect, and every flag the legend names, including
  the `W_*` wheel effects plan 089 will read. The file's header is a **four-line stacked legend**, so the
  token positions are spelled out in one `COLUMN` table rather than counted at each use. `parseSurfaceNames`
  stays as its own entry point (procobj wants one string per row).
  **A malformed row keeps its name and takes defaults instead of being dropped** — row index IS the COL
  material id, and dropping one would silently shift every surface after it.
- **`parseSurfaceAdhesion`** (`surface.parser.ts`) reads `surface.dat`'s lower triangle and **mirrors it**,
  so `get(a, b) === get(b, a)` and no caller has to know which half the file stored. Comments there start
  with `;`, not `#`, so it cannot use the shared `cleanLines` — noted at the top of the file.
- **`data/surface.dat` is now a test fixture** (`scripts/test-fixtures.ts`), so both parsers are tested
  against the real files rather than against snippets someone typed.

What the tests pin, because these are the numbers the rest of the plan is built on:

| fact                                                | value                                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| the rubber row (what a tyre actually gets)           | road **4.5** · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8 |
| nothing drivable out-grips tarmac                    | asserted, not assumed                                    |
| every cell of the 6×6 filled                         | asserted (a missing pair would read as no grip)          |
| `TYRE_GRIP` across all 179 rows                      | **1.0 — the override is unused; the alarm if it changes** |
| adhesion census                                      | road 73 · loose 60 · hard 29 · sand 12 · rubber 3 · wet 2 |

Suite 2840 → **2853 green**. Next: step 3, materials through the collider seam (still no behaviour change).

### 2026-07-27 — step 3: the material reaches the physics world, and a point can be asked what it is

Still no behaviour change — nothing reads the answer yet, and the regression pack is untouched.

- **The seam carries it.** `ColliderShape` gained `materials?: Uint8Array` — **one byte per TRIANGLE**, in
  index order — and `ColliderBox`/`ColliderSphere` an optional `material`. `toModelColliders` fills them from
  the COL faces and primitives it was already reading and throwing away. A byte per triangle beside twelve
  per vertex is free, and the old test that asserted the drop ("dropping surface data") is now the test that
  asserts the carry.
- **The physics world remembers it** per collider handle (the same array by REFERENCE for every placement of
  a model — a cell holds hundreds of copies of one wall), and **forgets it with the body**: Rapier reuses
  handles, so a stale entry would answer for whatever a streaming world creates next. That cleanup has its
  own test.
- **`PhysicsWorld.surfaceBelow(position, maxDrop, excludeBody?)`** answers the SA surface id under a point.
  The triangle comes from the ray hit's own `featureId` — Rapier reports the trimesh face index, which is
  what makes per-triangle resolution possible at all and settles the design question this plan's header
  raised (no need to split colliders by group). A box or sphere has one id and no feature to read.
- **Null means UNKNOWN, never surface 0.** `default` is a real row in the table; collision built without
  materials must not read as tarmac. Tested both ways.

Learned in passing, and worth a line because it cost the first two test runs: **a ray sees nothing until the
world has stepped once** — the query pipeline is built during `step`, so a probe written against
freshly-created colliders silently reports "no ground".

Suite **2859 green**. Next: step 4, the per-wheel probe (still no behaviour change — the capture starts
reporting the surface while the grip stays where it is).

### 2026-07-27 — step 4: every wheel now says what it is standing on, and a lap says what it drove on

Still no behaviour change; the grip is untouched and the pack is untouched. What moved is what a capture can
tell you.

- **`readVehicleWheelSurfaces(controller, chassisBody)`** — DRCVC never reports what its own suspension ray
  hit, so the probe re-casts a short one (5 cm above the contact point it DOES report, 35 cm of reach)
  through `surfaceBelow`. One ray per wheel **in contact**; an airborne wheel costs nothing. Wired for the
  DRIVEN car only, and only while a capture runs.
- **The table reaches the engine side**: `WorldAdapter.surfaces()` returns the parsed rows as
  `SurfaceRecord` — deliberately structural, so the adapter's `surfinfo.dat` objects satisfy it with no copy
  and the `game` layer still names no renderware type. The adapter now parses the table whenever the file is
  there, not only when `procobj.dat` is too (what a wheel stands on has nothing to do with ground clutter).
- **The capture reports it**: `WheelFrame.surface`, and a per-lap `summary.surfaces` — the share of
  wheel-on-ground samples per surface, counted PER WHEEL (a car with two wheels on grass is half off the
  road, and that is the state the grip change has to be read against), re-keyed from material ids to NAMES
  when the capture is printed.

**Verified in the game, which is the only place this could be verified:**

| lap                     | reported                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `brake-strip` (SF road) | `{ default: 1 }`                                                     |
| `crest-jump` (Red County) | `{ tarmac: 0.79, dirt: 0.10, grass_medium_lush: 0.07, pavement: 0.03 }` |

**And it took a full in-game diagnosis, because the unit tests were green while the game reported nothing.**
The probe returned null for every wheel of every lap. The chain was intact — 3 943 colliders carried
materials, the ray hit a face, the lookup found the right 106-entry array — and the `featureId` came back as
**127**, then **133**. Parry encodes a hit on a triangle's BACK side as `featureId + triangleCount`, and the
game's roads are wound so a downward ray lands on exactly that side: 127 − 106 = 21, 133 − 106 = 27, both
real triangles. Read straight, the id runs off the end of the table and every wheel reports "unknown". The
fix is one modulo; the test that would have caught it (a quad wound away from the ray) is now in the suite,
beside the one that would not have (a quad wound toward it, which is what a hand-written fixture naturally
does). Two lessons worth carrying: **the harness only forwards `[phys]`, `[slow]` and console WARNINGS**, so
a `console.log` diagnostic is invisible from a headless lap; and a probe that reads geometry has to be
verified against the map, not against a fixture that agrees with it by construction.

Suite **2868 green**. Next: step 5 — grip from the matrix. That one MOVES the pack, deliberately.

### 2026-07-27 — step 5: grip comes from the surface, and the limiter is told the same number

The shape, end to end: the adapter builds **one `Float32Array` of absolute adhesion per collision material**
(SA's rubber row through each surface's group) beside the road cell everything is expressed against — built
once, where both files are parsed, so the per-step path is an array index with no strings and no map. The
physics scales each wheel's `frictionSlip` by `adhesion / road`, and the drive path probes ONCE per step and
hands the same numbers to **both** the tyres and `steerLimit` — the limiter's `ROAD_ADHESION` is now a
fallback, not the answer. Giving the limiter a different number from the tyre is the exact mechanism behind
three field rounds of "it will not turn in" (081/09), and it is now impossible by construction.

Dial: **`?surfGrip=0`** puts every wheel back on tarmac, and every capture records which world it drove in
(`surfaceGrip: true|false`) — the A/B is one URL apart and self-describing.

**What SA's own data actually says, and it is not what "off-road" suggests:** `dirt` and `dirttrack` are
group **ROAD** — a dirt road grips like tarmac. What changes is grass, gravel, hedges and meadow (LOOSE,
0.71), sand (0.67), rock and metal (HARD, 0.80) and the two wet rows (0.62). Of 179 surfaces: 73 ROAD, 60
LOOSE, 29 HARD, 12 SAND.

**Measured A/B, comet, 12 scenes each, `?surfGrip=0` vs on**
(`2026-07-27-headless-surfgrip-{off,on}-comet.json`):

- **Every tarmac lap is IDENTICAL** — brake-strip, sweeper, slalom, kerb-strike, kerb-mount, rest,
  pull-away-reverse: same top speed, same slip, same rotation, to the second decimal. That is the acceptance
  criterion met by construction rather than by tuning: the road cell divides out.
- **`crest-jump` — the only lap that spends real time off the road** (grass 6 %, dirt 11 %): top speed
  **126.06 → 122.24 km/h**, slip 35.8 → 40.7°, lateral peak 25.3 → 19.4 g, roll 25.7 → 24.2°.
- The rest of the deltas (step-steer −3.6° of rotation, u-turn −8.4°) are on laps that report ROAD-group
  ground throughout and are the known cross-run divergence of collision laps (step 3's measurement), not
  this change.

**And the scene set cannot really see this feature yet.** `handbrake-flick` reports 54 % grass, but the grass
arrives AFTER the manoeuvre — the car slides onto the verge once the flick is over — so its numbers barely
move. There is no scene that corners ON grass or sand, which is exactly the instrument the field verdict
should be taken with. **Owed: a grass/sand cornering scene** before this is judged as anything but "safe".

**The gate needed a fix of its own, found by running it here.** The pack read the capture's new `surfaces`
block as "a signal appeared" and failed all twelve laps on it. A field the reference PREDATES cannot be a
regression — the pack has no value to compare against until it is deliberately re-recorded — so
`phys-regression` now only fails on a signal the reference HAS and the fresh run lost. With that, the gate
reports exactly the two real rows: crest-jump's top speed and the sweeper's chaos.

Suite **2872 green**. Not yet: the field verdict, the grass scene, `WET_GRIP` under rain (step 6), and the
pack re-record that follows acceptance.

### 2026-07-27 — the grass scene, and the FIELD VERDICT: kept, but it does not read as off-road

The instrument step 5 lacked: **`grass-corner`** starts the car ON grass at (400, 200) in Red County and
never leaves it — the lap reports `grass_medium_lush` 38 % · `p_sandbeach` 31 % · `grass_short_lush` 17 % ·
`p_grassmid1` 14 %, no tarmac at all. The spot was found by scanning the map's own COL faces for ground that
is ≥ 70 % LOOSE with no prop within 40 m, then sampling the ground Z for the flattest part (a slope
confounds a corner with gravity). Two scene lessons went into the laps guide: pick the flattest grass, and
`position.z` must be the MEASURED ground height — the first version sat 9 m above its own field because
32.4 was the terrain model's ORIGIN, and the snap searches only `[z + 2, z − 4]`.

**Measured there** (comet, `?surfGrip=0` vs default): top speed **71.9 → 52.7 km/h**, settled yaw
**34.8 → 21.7 °/s**, heading come round −272° → −186°, slip peak 10.4 → 6.7°. Both directions move, because
the tyre has less for the drive as well as the corner; the yaw falls further than the grip (−38 % vs −29 %)
because the limiter is given the same adhesion — deliberate.

**The field drove it and said no.** Paraphrased across two rounds: grass feels like tarmac, sand feels like
tarmac on several cars, and with the readout open, "maybe a very small difference, almost unnoticeable" —
while F2 correctly showed `p_grassmid1 ×0.71` under every wheel. So the mechanism is applied and verified,
and the gap is that **a grip CEILING is invisible until you are against it**: normal driving on grass never
asks for 0.71 of tarmac's budget. What makes soft ground feel soft in SA is what this engine still does not
read — `SAND` ("tyres sink in and can get bogged down"), `ROUGHNESS`, and `bOffroadAbility`.

**Decision (field): keep what is shipped, do not bend the number.** It is data-faithful, costs nothing, and
shows up exactly where a ceiling should. The full write-up, the numbers and the three options live in
[`docs/open-issues/offroad-feels-like-tarmac.md`](../../open-issues/offroad-feels-like-tarmac.md) — the
honest continuation, when it is picked up, is porting SA's own sand/roughness handling rather than scaling
our factor. The F2 panel gained the per-wheel `surface ×factor` readout in the same round, so the next person
to ask "does this do anything?" answers it in the game rather than from a capture.

**Where this leaves the plan**: steps 1–5 shipped and field-reviewed; the pack was NOT re-recorded, because
tarmac laps are unchanged and it did not have to be. **Step 6 (`WET_GRIP`) is MOVED to
[roadmap 0.5.0 / 05 rain](../../roadmap/0.5.0/plans/05-weather-rain/readme.md)** — the engine has no rain to
be wet from, and a wet-tyre rule with no wetness is a rule nobody can switch on. Step 7's field round has
effectively happened (the verdict above); what remains of this plan is whatever the open issue's option 2
turns into, if it is ever picked up.
