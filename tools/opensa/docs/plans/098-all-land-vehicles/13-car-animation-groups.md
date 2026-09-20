# 098/13 — Car-class animation groups: play the set the handling row asks for

**Goal:** every four-wheeled vehicle plays the animation SET its own data selects — the low-car seat and
climb, the truck cab's climb and driving pose, the bus/coach boarding, the tank's hatch, the kart, the
dozer, the BF Injection, the convertible's jump-in — plus the driving-time clips every car authors and
we never play: the hands turning the wheel, the door being opened and pulled shut, the look over the
shoulder when reversing. **Field checkpoint 6: an Infernus, a Linerun, a Bus and a Rhino are each boarded
and driven the way their data says, and a Landstalker looks exactly as accepted today.**

**Why a plan of its own.** 12 covers the rider; this is the car side of the same mechanism, and it is
bigger than it looks: `ped.ifp` carries **80 car-class clips and we play 7** (`car_getin_lhs`,
`car_getout_lhs`, `car_sit`, `car_getin_rhs`, `car_shuffle_rhs`, `car_getout_rhs`, `car_crawloutrhs` —
`vehicle-clips.ts`). 07's "doors & timings" and 10's "how does SA board a tank" both turn out to be
answered by data this plan reads, so it lands BEFORE 07 and 10 consume it.

## What SA ships (measured 2026-08-20, `scripts/debug/anim-census.ts` + stock `handling.cfg`/`vehicles.ide`)

### One selector for every vehicle — and it is a column we do not read

`handling.cfg` **column 34 `animGroup`** (01's recon lists it as unread) is the row index into the `^`
table — 30 rows, one per vehicle anim group. Stock distribution over the 30 values:

| col 34 | group (gta-reversed `AnimAssocDefinitions.cpp` #88–117) | stock rows | examples |
| --- | --- | --- | --- |
| 0 | `stdcaranims` — `ped.ifp` | 127 | landstal, hotknife, cement, tug, forklift |
| 1 | `lowcaranims` — `ped.ifp`, the `L` clips | 14 | infernus, banshee, turismo |
| 2 | `trkcaranims` — `truck.ifp` | 11 | linerun, firetruk, packer, flatbed |
| 3–12 | the bike/bmx/quad groups (→ 04/12) | 12 | |
| 13 | `vancaranims` — `van.ifp` (rear doors only) | 18 | pony, burrito, swatvan |
| 14 | `rustplaneanims` | 4 | aircraft — out |
| 15 | `coachcaranims` — `coach.ifp` | 2 | coach |
| 16 | `buscaranims` — `bus.ifp` | 1 | bus |
| 17 | `dozercaranims` — `dozer.ifp` | 1 | dozer |
| 18 | `kartcaranims` — `kart.ifp` | 1 | kart |
| 19 | `convcaranims` — `ped.ifp`, jump-in | 2 | comet |
| 20 | `mtrkcaranims` — `truck.ifp` | 5 | dumper, monster |
| 21 | `traincaranims` — `coach.ifp` | 1 | |
| 22 | `stdtallcaranims` — `ped.ifp`, `alignHI` | 1 | sandking |
| 23 | `hovercaranims` — `vortex.ifp` | 1 | vortex — out (0.6.0) |
| 24 | `tankcaranims` — `tank.ifp` | 1 | rhino |
| 25 | `bfinjcaranims` — `BF_injection.ifp` | 2 | bfinject, bloodra |
| 26, 27, 29 | plane groups | 3 | out |
| 28 | `stdcarupright` — `ped.ifp` | 2 | tractor, mower |

Each `^` row names TWO base groups (cols B/C) and, per enter/exit anim (cols D–T: Align, OpenOutF/R,
GetInF/R, Jack, CloseInsF/R, Shuffle, GetOutF/R, BeJacked, CloseOutF/R, CloseRoll, JumpOut, FallDie,
OpenLocked), which of the two supplies it; cols U–f are the z-blend and door open/close timings; col g the
special flags (`1` leave door open after exit, `2` after entry, **`4` kart drive anims, `8` truck drive
anims, `16` hover drive anims**, `32` special locked door, `64` do not open the door). So the row decides
both the boarding clips AND the driving pose. `vehicles.ide`'s `anims` column names only the IFP to
stream for the model (`null` = `ped.ifp` suffices) — it is not the selector. 04's resolution layer is
built on THIS pair of facts or it is wrong for cars.

### The 40-slot car table and who fills what

Every car group is a 40-slot array (`aStdCarAnimations` order: align L/R, alignHI L/R, open ×4, getin
×4, –, pullout ×2, –, closedoor ×4, shuffle ×2, getout ×4, –, jacked ×2, close ×4, rollout ×2, rolldoor,
fallout ×2, doorlocked ×2); an empty slot falls through to the row's second group. What each group
overrides, verbatim from gta-reversed:

| Group | Own clips (the rest come from the row's second group) |
| --- | --- |
| `lowcar` | `getinL`, `getoutL`, `closedoorL`, `pulloutL`, `LjackedLHS/RHS`, `Lshuffle_RHS`, `rolldoorLO` — everything else standard |
| `conv` | standard set with `CAR_jumpin_LHS` for the driver's get-in (no door to open) |
| `stdtall` | standard set; the row selects `alignHI` |
| `trk` / `mtrk` | full own set from `truck.ifp` (17 clips: align, open, getin, closedoor, close, getout, shuffle, pullout, jacked) |
| `van` | rear-door four only (`VAN_open/getin/close/getout_back`) — front doors standard |
| `coach` | `opnL/R`, `inL/R` (42–43 frames — a real climb), `outL/R` |
| `bus` | `open`, `getin`, `close`, `getout`, `pullout`, `jacked` — LHS only |
| `dozer` | align, getin, getout, pullout, jacked — no door clips (it has none) |
| `kart`, `bfinj` | getin/getout only |
| `tank` | **`TANK_align_LHS` (25 frames), `open`, `getin`, `close`, `getout`, `doorlocked` — one side only.** This is how SA boards the Rhino: a dedicated group, not a climb stage — 10's recon question, answered |
| `hover` | `CAR_jumpin`, `vortex_getout` — out of scope |

### Driving-time clips in `ped.ifp` (standard group) we never play

| Clip(s) | Frames | What it is | Selected by |
| --- | --- | --- | --- |
| `Drive_L`, `Drive_R` | 5 / 3, root-motion | hands turning the wheel — partial poses, the car twin of the bike's `Left/Right` | steer angle |
| `Drive_LO_l`, `Drive_LO_R` | 5 | the same, low seat | group 1 |
| `Drive_truck`, `DRIVE_truck_L/R/back` | 2–3 | truck driving pose + steer + reverse | flag 8 |
| `CAR_Lsit` | 2 | low-seat sit | group 1 |
| `CAR_LB`, `CAR_LB_pro/weak` | 3–4 | look behind — the head turns when reversing | reverse gear |
| `CAR_doorlocked_LHS/RHS`, `TANK_doorlocked` | 8–15 | pulling a locked handle | locked state |
| `CAR_open_LHS/RHS` (31), `CAR_closedoor_*` (8–11), `CAR_close_*` (23), `CAR_align_*` (3) | | **the door being opened, pulled shut from inside, shut from outside, and the align step** — today our door swings by code while the ped plays only `getin` | every boarding |
| `Drive_*_pro/_weak/_slow`, `CAR_sit_pro/weak` | | driving-skill variants | a player stat we do not have — standard set only |
| `CAR_sitp`, `CAR_sitpLO`, `CAR_dead_*` | 2 | passenger / dead | out (one skinned probe) |
| `CAR_jackedLHS/RHS`, `CAR_pullout*`, `CAR_Qjacked` | 24–89 | jacking | out (NPC drivers are city-life's chain) |
| `CAR_rollout_*`, `CAR_fallout_*`, `CAR_rolldoor*` | 8–25 | bail-out at speed, fall out | out until a ragdoll exists; recorded |
| `CAR_tune_radio`, `car_hookertalk`, `Tyd2car_*`, `Fixn_Car_*`, `flag_drop` (`car.ifp`) | | radio / scripted scenes | out |
| `lowrider.ifp` (39 clips) | | the lowrider-girl dance and gang-talk partials — mission content | out; **note for 06: SA has NO driver clip for hydraulics, the driver sits still while the car bounces** |
| `drivebys.ifp`, `player_dvbys.ifp`, `*_dbz.ifp` | | drive-by sets | out (weapons chain) |
| `train.ifp` (`tran_gtup/hng/ouch/stmb`) | 35–95 | train roof-surfing — mission | out (0.6.0) |

## What exists (recon 2026-08-20)

- The enter machine (`enter-vehicle.system.ts`) has phases `approaching → opening → stepin → getin →
  seated`, `shuffle`, `exitopen → exiting`, `stopping`; the door swings by code (`DOOR_OPEN_ANGLE`,
  `GETIN_DURATION` 1.2 s), the ped plays `car_getin_lhs` and nothing for the door itself. Field-accepted
  for sedans (plans 016/088) — the sedan verdict is the control this plan must not move.
- The seated path re-issues `car_sit` every fixed step; no steer pose exists; the head never turns.
- `handling.cfg` col 34 unread (01); `^` table unparsed (01); `vehicles.ide` `anims` unparsed (01).
- Both loaders exclude `anim.img` (04) — `truck/van/coach/bus/kart/tank/dozer/BF_injection.ifp` are as
  unreachable as the ride sets. 04's ingestion decision covers them in the same measurement.

## Design

- **The selector is the handling row.** 01 parses col 34; 04's resolution layer becomes
  `animGroup → ^ row → (first, second) group → per-slot clip`, IFP per group from the table above, with
  the 40-slot fall-through exactly as SA composes it. The two hardcoded arrays in `vehicle-clips.ts`
  become group 0's entry. A model whose `anims` names an IFP we cannot find logs once and resolves to
  group 0 (loud-but-safe, the 04 rule).
- **Door clips replace code-swung timing where the field accepts it.** `CAR_open` / `CAR_closedoor` /
  `CAR_close` / `CAR_align` run as the phase clips, the door angle following the `^` row's
  open/close start/stop times (cols X–f) instead of `DOOR_OPEN_ANGLE` + constants. Our accepted sedan
  feel is the control: each kept constant is a ledger line (the 081 doctrine — a deviation must be a
  decision).
- **Driving pose per row.** `CAR_sit` / `CAR_Lsit` / `Drive_truck` from the row's group and flag 8;
  `Drive_L/R` (or `_LO_`, `_truck_`) as partial poses on 12's mask, weight from the steer angle. The kart
  flag (`4`) and hover flag (`16`) are recorded; kart has no drive clip of its own in the archives we
  measured — verify against the stock group table before inventing one.
- **Look-behind.** `CAR_LB` as a partial on reverse gear (mirrors the camera's reverse view).
- **Per-group boarding sets** through the same machine: one-sided groups (tank, bus) pick the authored
  side; groups with a real climb (coach 42 frames, truck) keep their root motion; `conv` jumps in.
  `doorlocked` when a vehicle is locked (the locked state exists for CLEO's `0A3D`-family; verify).
- **Out, recorded:** passengers, jacking, bail-out/fall-out, drive-bys, radio, skill variants, lowrider
  scenes, trains, hover, planes.

## Steps

- [ ] **Selector + census fixture.** Col 34 read (01); the 30-row `^` table resolved against the group
      table; a committed fixture prints, for every stock land row, its group pair and the 40 resolved
      clip names (a diff in that census is a reviewable event, the 06 pattern).
- [ ] **Resolution layer on the selector** (with 04): `vehicle-clips.ts` arrays become group 0; the
      fall-through implemented and unit-tested on the real `^` rows (negative first: a row naming a
      group whose IFP is absent).
- [ ] **Door clips + `^` timings** in the enter machine; the sedan control re-verified in the field
      before any other group is looked at.
- [ ] **Driving pose + steer hands + look-behind** on 12's partial mask.
- [ ] **Per-group boarding**: lowcar, truck/mtruck, van rear (front doors unchanged), coach, bus, tank,
      dozer, kart, bfinj, conv, stdtall (`alignHI`), upright. Each group one field line in the ledger.
- [ ] **Contracts + docs.** `docs/contracts/vehicles.md`: the `animGroup` column and what a wrong value
      does (a car boards like a bus — loud, not silent); `docs/features/vehicles.md` enter/drive
      sections; the loader-parity note for the new IFPs.

## Verification

Headless: the census fixture; resolution over every stock land row with zero silent misses; enter
suite per group (negative first: a one-sided group approached from the wrong side). Field: the checkpoint
above — Landstalker (control: unchanged), Infernus (low seat, low climb), Linerun (cab climb, truck pose),
Bus (front-left boarding, the long climb), Rhino (hatch, one side), Comet (jump-in), then a full-lock
turn and a reverse in each to see the hands and the head. Numbers: the per-frame cost of the steer
poses + look-behind beside 12's figure; both into `docs/benchmarks/`.

## Ledger

(census as committed; kept-vs-authored timing decisions per group; field verdicts verbatim, paraphrased to
English)
