# 098 — All land vehicle types (ride, tow and special abilities for the whole land fleet)

**Status: PLANNED 2026-08-04; re-sequenced 2026-08-20** (11 CLOSED 2026-08-07; 09/10 placed in the queue; 12
riding animation and 13 car-class animation groups added; 02's vocabulary half shipped through vehicle-installer 011 on 2026-08-18 — every other
box is open, and the recon below was re-verified against the code on 2026-08-20: every claim holds, only line
numbers drifted). Supersedes `roadmap/0.5.0/plans/04-all-vehicle-types/` (deleted in the
same change). Rewritten from a fresh four-way recon (data pipeline, physics, animation, docs) and a new
corpus in `NO_COMMIT/all-veh`. The old chain's per-class breakdown survives in spirit; its two central
assumptions do not: the 081/07 "preset seed" it planned to inherit shipped **empty by measurement**, and
the hard part of bikes turned out to be NAMES and DATA PLUMBING before it is physics.

**Goal:** every land vehicle type in `vehicles.ide` — `car`, `bike`, `bmx`, `quad`, `mtruck`, `trailer` —
spawns, is ridden/towed correctly with its authored handling, and SA's hardcoded per-model special
abilities (pop-up lights, hydraulics, hooks, moving `misc_*` parts) become a data-driven, mod-customizable
**vehicle-features module** — the same promise the VSA Editor made for real SA, done our way: derived from
the asset, never from an ID list.

## The fleet and the corpus

Census of the built `data/vehicles.ide` (212 rows) and its satellites, measured 2026-08-04 — **215 rows on the
`sa` target since 2026-08-20**: plan 102's three ADDED cars (`tools/add-vehicles`), `car` type, `sa` only:

| Type | Rows | Parses today | Drives today | In scope |
| --- | --- | --- | --- | --- |
| car | 144 | yes | yes | baseline |
| bike | 10 | yes | **no wheels** (dummy names unrecognised) | yes |
| bmx | 3 | yes | no wheels | yes |
| quad | 1 | yes | wheels bake (it authors the car `wheel_*_dummy` names) — ride unverified | yes |
| mtruck | 5 | yes | unverified | yes |
| trailer | 9 | yes (`.osm` baked) | spawns as a driverless "car" | yes |
| heli / plane / boat / train | 11/12/10/6 | boats: **all dropped** by a column-count guard | — | no → [0.6.0 note](../../roadmap/0.6.0/plans/05-air-water-rail/readme.md) |

- `handling.cfg`: 13 `!` bike rows (lean/wheelie/stoppie data, legend at `handling.cfg:348-353`) — parsed
  by nothing; 30 `^` vehicle anim-group rows (enter/exit clip pairing, door timings) — parsed by nothing;
  `handlingFlags` (col 31 hex — hydraulics, `NO_DOORS`, `TANDEM_SEATS`) — never fetched.
- `anim/anim.img`: 133 IFPs including every ride set (`bikes`, `biked`, `bikeh`, `bikev`, `bikeleap`,
  `bmx`, `quad`) — deliberately excluded by BOTH loaders, so `getIfp('bikes')` finds nothing today.
- **Corpus** (`NO_COMMIT/all-veh`, uncommitted): the **VSA Editor** (Alexander Blade, 2008) — the
  authoritative catalogue of SA's 15 hardcoded ability classes (bucket, cistern, packer, truck/tractor
  hooks, adv. hydraulics, water jets, two turret kinds, up/down lights, trailer/baggage hooks, baggage
  trailers, plane smoke, BF engine) with their stock model IDs; and **glendale** (a plain mod car,
  Plymouth Belvedere '57) — the no-features CONTROL fixture for module-extraction regressions.

## What the recon changed vs the roadmap chain

1. **No preset seed exists, and that is a result.** 081/07's five-class sweep proposed no class factor —
   every difference the sweep found was authored in the data (`081/07-presets-regression.md`). Per-class
   feel therefore comes from reading MORE authored data (`!` rows, flags), not from a preset table.
2. **The physics is already wheel-count agnostic.** Rapier's `DynamicRayCastVehicleController` takes
   whatever wheels the model authors (a 6-wheel bus passed the 081/07 sweep). A bike fails earlier: its
   `wheel_front`/`wheel_rear` dummies match neither regex in `build-vehicle-model.ts:71-72`, so it bakes
   with ZERO wheels and spawns lying on its side.
3. **Rider animation is a data-plumbing problem first.** The IFP parser, sampler, blending and the seated
   `car_sit` path all exist and work; the ride clips are simply unreachable (`anim.img` excluded), and the
   `vehicles.ide` `anims` column plus the `^` group table are parsed away.
4. **Trailers are blocked on exactly one thing: joints.** They parse, bake `.osm` and spawn today. The
   repo contains ZERO Rapier joint usages — the hitch is greenfield.
5. **Special abilities have a live template and a vocabulary source.** The chain
   `features.txt → data/vehicle-features.txt → bake → fixture field → rig driver` is shipped for one token
   (`UP/DOWN_LIGHTS`); the VSA corpus names the rest of the vocabulary. VSA's per-ID mapping is the
   anti-pattern our restrictions forbid — its ability CATALOGUE is the value. **2026-08-18: the catalogue is
   committed as data (15 tokens + stock carriers) and gets a REAL-GAME twin —
   [vehicle-installer plan 011](../../../tools/vehicle-installer/docs/plans/011-model-special-features.md)
   writes FLA's `model_special_features.dat` on the `sa` target from the same `features.txt`, so a mod's
   declaration works in both games; 02 owns the shared vocabulary module, 06 uses the carriers as its
   detector oracle.**
6. **A mod bike's handling cannot install.** `vehicle-installer`'s classifier and merge only accept
   letter-leading handling rows — a shipped `!BIKE` lean line is silently dropped (`settings.ts:94-123`,
   `merge.ts:28-42`).
7. **One skinned ped probe exists engine-wide** (`engine.setPedProbe`) — the player-rider works;
   passengers and NPC riders are out of scope until that ceiling lifts.
8. **The enter system is car-shaped.** Door-phase machine, `lf`/`rf` approach, `isUpright` gate — a bike
   (no doors, leans) needs its own mount path, and `NO_DOORS` vans need the flag read.

## Architecture

No new package: the work extends `packages/renderware` (parsers, model build), `tools/opensa-pack` +
`tools/vehicle-installer` (bake), and `packages/game` (runtime). One new runtime module:
`packages/game/src/vehicle/features/` — the special-abilities registry.

| Layer | Gains |
| --- | --- |
| parsers (`packages/renderware`) | `anims`/`class` columns; `!` bike table; `^` anim-group table; `handlingFlags`; feature-token vocabulary |
| model build (`renderware/vehicle`) | bike wheel/fork/handlebar frames; per-ability part identification (each its own fixture field, like `popUpLights`) |
| build tools | features module tokens honoured at bake; `!`-line merge in vehicle-installer |
| fixture (`.osm` DESC) | bike wheels, ability parts, hitch points — existing fields untouched (shipped paks stay valid) |
| runtime (`packages/game`) | features registry (fixture field → driver), two-wheel balance controller, hitch joint framework, rig articulation channel |
| host (`apps/web`) | anim-group clip resolution, bike mount, per-class camera tuning, spawn roster |

Doctrine:

1. **Derive from the asset, never the slot** (`docs/restrictions/assets-and-data.md`). Ability detection
   reads geometry/dummies/flags the model itself carries; `features.txt` tokens override per MOD. Never a
   model-name or ID list — today's `comet` is tomorrow's `admiral`.
2. **Honour the authored data; execution is ours.** `!` rows, `^` rows, `handlingFlags`, `anims` are read
   as SA meant them — column semantics recovered from gta-reversed (`docs/links.md`), never guessed. The
   balance controller is NOT a `CBike` port: SA's numbers feed our solver.
3. **Every name that starts carrying behaviour lands in `docs/contracts/vehicles.md` in the same change**
   — new feature tokens, new frame conventions, hitch dummies. Misspelling one is silent by nature; each
   contract row says what happens when it is spelled wrong.
4. **Build-vs-runtime is respected** (`docs/restrictions/build-vs-runtime.md`): a feature declaration
   reaches a car only through the build; `vehicle-installer --rebake` (~3.6 s/car) is the turnaround, and
   field checks re-bake before judging.
5. **Class behaviour keys off `vehicles.ide` type + authored flags**, resolved at spawn — one registry,
   no scattered `type === 'car'` strings.
6. **081's field verdicts are load-bearing** (`docs/plans/081-vehicle-physics/`): the accepted car feel is
   not renegotiated; assists stay lateral-only; the regression gate (`scripts/phys-regression.ts`) must
   stay green through every physics-adjacent step.
7. **Physics restrictions by construction** (`docs/restrictions/architecture.md`): the balance controller
   casts inside the ONE shared collision-cast budget; nothing reads a body before the world steps it;
   joints are created only where static collision exists.

## Sub-plans

| # | Plan | One-liner |
| --- | --- | --- |
| 01 | [Data foundations](01-data-foundations.md) | Parse everything the fleet needs (`anims`, `!`, `^`, `handlingFlags`); thread `type` to runtime; `!`-line install fix. |
| 02 | [Features module](02-features-module.md) | Extract the special-abilities surface into one registry; pop-up lights migrate as first citizen; vocabulary from the VSA corpus. |
| 03 | [Bike & BMX physics](03-bike-physics.md) | Bike frames recognised; two-wheel balance controller on `!` data; wheelie/stoppie/bunny-hop; quad + mtruck verified. **Field checkpoint 1: it rides.** |
| 04 | [Rider animation](04-rider-animation.md) | `anim.img` reachable; anim-group resolution; ride/pedal/lean poses; bike mount. **Field checkpoint 2: it looks ridden.** |
| 05 | [Trailers & towing](05-trailers-towing.md) | First Rapier joints; hitch framework; artic pairing; stability + reverse. **Field checkpoint 3: it tows.** |
| 06 | [Special abilities](06-special-abilities.md) | Hydraulics + moving `misc_*` parts on the 02 module; per-token contracts. **Field checkpoint 4: it bounces.** |
| 07 | [Per-class gameplay](07-class-gameplay.md) | Mount/enter per class, `NO_DOORS`/`^` timings, per-class camera, roster. |
| 08 | [Acceptance & close-out](08-acceptance-close.md) | Per-class drives, regression bands, benchmarks, audit, feature/contract docs settle. |
| 09 | [Tracked chassis](09-tracked-chassis.md) | Ground support spanning the TRACK footprint, not six point wheels; unreachable wheel dummies ignored. Measured: the Rhino's track overhangs its support by 1.24 m front / 1.13 m rear, and its middle wheels sit 0.518 m too high to touch anything. |
| 10 | [High entry boarding](10-high-entry-boarding.md) | Climb ON before getting IN, gated on a derived entry height vs the ped's own reach. Measured: the Rhino's door hinge is 1.82 m above its ground plane. |
| 12 | [Riding animation](12-riding-animation.md) | The rider's body follows the ride: `Left/Right/Back/Fwd` partial poses from the physics state, wheelie/stoppie attitude (SA has NO wheelie clip — measured), pedal/sprint/bunny-hop with the clip timing the impulse, hands pinned to `bargrip`. **Field checkpoint 5: it looks ridden.** |
| 13 | [Car-class animation groups](13-car-animation-groups.md) | `handling.cfg` col 34 `animGroup` → `^` row → the set a car asks for: low-car seat and climb, truck cab, bus/coach, tank hatch, convertible jump-in; plus the driving-time clips every car authors and we never play (hands on the wheel, door open/shut, look-behind). `ped.ifp` carries 80 car clips, we play 7. **Field checkpoint 6: each class boards and drives as its data says; the sedan is unchanged.** |
| 11 | [Model-derived lamps](11-model-derived-lamps.md) | **CLOSED 2026-08-07.** A lamp exists only where the model authors one; the half-extents fallback is deleted. Measured: 12 stock models (every trailer + aeroplane) carry no lamp dummy at all and were given headlights anyway, and a zeroed dummy was putting both tail lamps inside the bodywork. |

Order and rationale: [priority.md](priority.md). **09 and 10 were added 2026-08-07 from a field
round on the GTA 5 Rhino** (the tank the `cleo/scripts` 001 track work put on the road) — both are
tank-SHAPED symptoms with model-derived causes, and neither is allowed a per-model special case.
**11 was added the same day** from the hotring round: it is the same shape a third time — a per-car CLEO
script was replaced by a rule that reads what every model already carries. **12 was added 2026-08-20** after a
census of the nine ride IFPs (`scripts/debug/anim-census.ts`): the riding body was half-owned by 03 and 04, and
the measurement (no wheelie clip exists; the poses are partial blend targets; the bunny-hop fires from the clip)
made it its own plan. **13 was added the same day** from the census of the car-class sets: SA selects a
vehicle's whole animation set through `handling.cfg` col 34 (unread) and the `^` table (unparsed), `vehicles.ide`
`anims` only names the IFP to stream — which answered 07's "does the truck author a climb" (yes, `truck.ifp`)
and 10's "how does SA board a tank" (a one-sided `tank.ifp` group, not a climb stage) before either was built.

## Out of scope (recorded, not silent)

- **Aircraft, boats, trains** — recorded with the recon's findings (boat rows dropped by the parser;
  `$`/`%` tables; `PLANE_SMOKE`) in
  [`roadmap/0.6.0/plans/05-air-water-rail/`](../../roadmap/0.6.0/plans/05-air-water-rail/readme.md).
- **NPC riders and passengers** — one skinned ped probe exists; lifting it is its own engine work.
- **Rider melee and drive-by** — `kick`, `Snatch_L/R`, `BIKE_elbowL/R`, `Driveby*` are weapons/melee
  chains, not riding; 12 records them as out.
- **Rider fall-off / ragdoll** — `BIKE_fall*` clips exist in `ped.ifp`, but honest falls need a ragdoll;
  until then dismount is controlled.
- **Turrets and water jets** — need an aim-input surface; recorded as extensions in 06, not built.
- **Vehicle audio, mod-shop (`carmods.dat`) wiring** — separate features; carmods stays parsed-not-wired.
- **Traffic use of the new classes** — city-life's chain consumes this one (its D7 decision points here).

## Standing rules for the chain

Measured numbers into each sub-plan's ledger after every step; physics figures follow the
`benchmarks/vehicle-physics` capture protocol, and captures stay SELF-DESCRIBING (a bike capture records
the `!` row it ran with, the way `[phys]` records springs). Every fitted constant gets its `docs/hacks/`
file in the same change. Chain close-out = audit in `docs/audit/` + before/after benchmark +
`docs/features/` updates + `docs/architecture/` module doc.
