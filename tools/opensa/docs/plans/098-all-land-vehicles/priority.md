# 098 — execution priority

Linear with one spike pulled forward. Bikes are the user's headline — they reach a complete field
experience (physics + seat + riding animation) before the refactor and the new frameworks start.
**Re-sequenced 2026-08-20**: 09/10 (added 2026-08-07 from the tank round) get their places, 12 (riding
animation) and 13 (car-class animation groups) are added, 11 is CLOSED and out of the queue.

| Order | Plan | Why |
| --- | --- | --- |
| 0 | **03's phase-0 spike** | Teach the wheel regex `wheel_front`/`wheel_rear`, re-bake ONE bike, spawn it, ride it as a narrow car with an instant mount. Answers the only genuinely uncertain engine questions (bike COL shape, two-wheel raycast stability, the `isUpright` enter gate) before anything is designed on top. ~A day. |
| 1 | **01 Data foundations** | Everything downstream reads its output: `type` at runtime scopes 03/05/07, the `!` table feeds the balance controller and 12's poses, `^` + `anims` feed 04, `handlingFlags` feeds 06 and 07. Pure parser work, fixture-driven from the real built file (215 rows on `sa` since plan 102's three added cars). |
| 2 | **03 Bike & BMX physics** | The hard novel piece and the user's first ask. **Field checkpoint 1: NRG-500 and BMX ride believably** (lean, wheelie, bunny-hop), quad/mtruck verified on the generic path. |
| 3 | **04 Rider animation** | Reachability, group resolution, the seat, mount/dismount — while the physics field feedback is fresh. **Field checkpoint 2: the rider sits; mounting a bike looks deliberate.** |
| 4 | **12 Riding animation** | The rider's body follows the ride: lean poses, wheelie/stoppie attitude, pedal/sprint/hop, hands on the grips. Needs 03's state and 04's resolution, touches only the sampler (a partial mask, a hand reach) that no later plan touches — so it completes the bike experience without blocking anything. **Field checkpoint 5: a wheelie and a bunny-hop look ridden.** |
| 5 | **13 Car animation groups** | The car-side twin of 12 on the same resolution layer and the same partial mask: `handling` col 34 + the `^` row select the set (low-car, truck cab, bus/coach, tank, convertible), and the 73 car clips we never play (door open/shut, hands on the wheel, look-behind) come in. Before 07 and 10, which both consume what it reads. **Field checkpoint 6: each class boards as its data says, the sedan unchanged.** |
| 6 | **02 Features module** | The extraction refactor lands before new consumers pile on: pop-up lights migrate with zero behaviour change (glendale control rebake proves it), the registry and vocabulary open for 05/06. The vocabulary half already shipped (vehicle-installer 011, 2026-08-18). |
| 7 | **05 Trailers & towing** | First Rapier joints — the second novel piece. Its parked-stance step (the long semis tip nose-down) is a contact-set defect visible in F2 today and can be pulled forward on its own. **Field checkpoint 3: hitch artict1 to a linerun, drive, reverse, detach.** |
| 8 | **09 Tracked chassis** | The same class of defect as 05's parked stance — a chassis whose contact set does not span its footprint (1.24 m / 1.13 m of track overhanging the Rhino's support) — so it follows the trailer work while that machinery is warm. Independent of bikes; may be pulled forward on a field call. |
| 9 | **06 Special abilities** | Content wave on the 02 registry: hydraulics first (the user's own example), then moving `misc_*` parts. **Field checkpoint 4: a lowrider bounces; a token moves the ability to a mod car.** |
| 10 | **07 Per-class gameplay** | Polish that needs everything alive: per-class mount/enter (incl. `NO_DOORS`), `^` door timings, per-class camera, roster. |
| 11 | **10 High entry boarding** | A stage IN FRONT of 07's enter chain, gated on the derived entry height (the Rhino's hinge is 1.82 m up) against the ped's own reach; exit mirrored. **13 found SA's own answer first — a one-sided `tank.ifp` boarding group — so 10 starts by judging whether that authored set already closes the field symptom**; the climb stage is built only if it does not. Sequenced after 07 because it forks nothing if the per-class chain already exists. |
| 12 | **08 Acceptance & close-out** | Per-class acceptance drives, regression bands extended to bike scenes, the 082 plate readings, benchmarks, audit — the big-rework rule. |
| — | 11 Model-derived lamps | **CLOSED 2026-08-07** (Rule A shipped and field-passed, Rule B rejected on evidence). |

Checkpoints: 01 and 02 are fully headless (parser fixtures + module suite); field sessions at 03, 04, 12,
13, 05 and 06 (each judged from the reporter's exact angle — a "wheelie works" verdict is not a "riding
feels right" verdict, and a "the bike pitches" verdict is not a "the rider is doing it" verdict); 08
closes with the phys-regression gate green including the new scenes.

Ordering rationale: 03 before 04 because animation reads the physics state (lean angle, cadence source);
12 right after 04 because it consumes both and is the last piece of the headline; 13 right after 12 because it
reuses the resolution layer and the partial mask while they are fresh, and 07/10 read what it reads; 02 after 13
so the refactor never blocks the headline, but before 05/06 which grow on its registry; 05 before 06 because the
hitch framework is riskier than ability drivers and its field verdict may reshape 06's part-driver design
(a trailer hook IS an articulated-part + joint combo); 09 beside 05 because both are "support the
footprint" physics; 10 after 07 because it is a prefix to 07's chain.

Interplay: touches `physics-world.ts`, `enter-vehicle.system.ts`, `engine-canvas-host.tsx` and the IFP
sampler. The 097 CLEO chain that used to share `engine-canvas-host.tsx` and the installers is **CLOSED**
(2026-08-06), so that sequencing concern is gone; 097/05's `cleoIsCarModelId` is now the THIRD
`type === 'car'`-style filter 07 folds into the class registry. 081's regression gate guards every physics
step here. The corpus lives in `NO_COMMIT/all-veh` (uncommitted) — 02 fixtures the glendale control car
into the repo before depending on it (the VSA vocabulary is already in the repo as
`VEHICLE_FEATURE_TOKENS`). If a parallel chain rebakes vehicles in the same game build, coordinate.
