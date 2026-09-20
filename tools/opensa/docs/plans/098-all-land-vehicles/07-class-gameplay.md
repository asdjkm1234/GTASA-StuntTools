# 098/07 — Per-class gameplay (mount, doors, camera, roster)

**Goal:** the gameplay shell fits each class instead of assuming a sedan: per-class enter/exit (including
`NO_DOORS` and the `^` table's authored timings), per-class camera feel, seat placement from the authored
offset, and a spawn/roster surface that knows what is drivable.

## What exists (recon 2026-08-04)

- Enter/exit is one car-shaped phase machine (`enter-vehicle.system.ts:207-218`) with door approach
  routing and hardcoded durations (`:118-140`); 04 added the bike mount branch. Candidate pick filters
  only by `isUpright` + distance (`:1044-1063`).
- The `^` table (parsed in 01) authors per-group door open/close timings and enter/exit clip pairing —
  our constants (`GETIN_DURATION` 1.2 s etc.) currently override what the data says. Read the authored
  timing; keep our value only where the field already accepted it (081 doctrine: deviation is fine, but
  it must be a decision, not an accident — one line in the ledger per kept constant).
- `handlingFlags` (01) carries `NO_DOORS` and `TANDEM_SEATS`; `seatOffsetDistance` (col 27) is typed but
  unconsumed; seat falls back to a constant when `ped_frontseat` is missing (`engine-vehicles.ts:572-575`).
- Camera is one rig tuned by size/speed only (`vehicle-camera.ts`, distance from half-extents at
  `engine-canvas-host.tsx:1645`) — nothing class-aware. The corner-peek archive branch
  (`080-10-corner-peek`, memory `camera-corner-peek-rollback`) holds steer-share machinery — do NOT
  resurrect it silently; a bike camera wants lean framing, which is new work.
- Roster: the F2 spawner lists every ide row; `roadCarModels` filters `type === 'car'` for video/bench.

## Steps

- [ ] **Class registry consumption.** The three scattered `type === 'car'`-style filters (incl. 097/05's `cleoIsCarModelId`) and the new class
      branches resolve through one place (01's threaded type + flags). Trailers: non-enterable (05);
      trains/heli/plane rows: spawnable in F2 but marked not-drivable with a visible reason, not a
      silent no-op.
- [ ] **Doors & timings.** `NO_DOORS` vans skip the door phases (straight to step-in); `^` timings
      replace the hardcoded durations where the field accepts them; mtruck cab height gets the climb
      variant — **verified 2026-08-20: `mtrkcaranims` (col 34 = 20) uses `truck.ifp`'s 17-clip set and
      `Drive_truck`; 13 plays it, 07 only wires the class branch.**
- [ ] **Seats.** `seatOffsetDistance` consumed; `TANDEM_SEATS` recorded (passenger work is out of
      scope, the flag just must not mislead the seat fallback).
- [ ] **Camera per class.** Bike: closer, lower, lean-following roll component (damped in the subject's
      frame — the mounted-camera restriction); mtruck/monster: height allowance so the cab doesn't fill
      the frame; quad follows bike tuning. Each tuned in the field session, values in the tuning tables,
      not scattered constants.
- [ ] **Roster surface.** Drivable list = land classes; the F2 spawner gains a type filter chip; video
      mode's `roadCarModels` stays cars-only (its report format assumed cars — widen only with a
      measurement).

## Verification

Headless: enter/exit suite extended per class (negative first: enter a trailer, enter a `NO_DOORS` van
through a "door"); resolution census — every land row maps to an enterable behaviour + camera tune.
Field: one session across the classes — sedan (unchanged feel — the control), `NO_DOORS` van, bike,
quad, monster; the sedan verdict guards against regressions, the rest judge fit.

## Ledger

(kept-vs-authored timing decisions, camera tuning values, field verdicts)
