# Car generators: the array is 500, the map ships 1045, and the two do not mean the same thing

**Measured 2026-08-19** on the reference install and on `build/original/sa`, while building
[vehicle-installer plan 013](../../tools/vehicle-installer/docs/plans/013-audio-and-parked.md) (the
`parked.txt` merge into Parked Maker's `[Cars]`).

## The two numbers

| what | number | where it comes from |
| --- | --- | --- |
| Car-generator records in the MAP | **1045**, in 125 binary IPL streams (`CARS` section, 48 B records) | counted over `build/original/sa/models/*.img` and `game-src/original` — **the same 1045 in both**, so the whole mod set adds none. No text IPL in either tree carries a `cars` section |
| Car-generator SLOTS at runtime | **500** | FLA's own log line in the reference install: `Modified limit Car generators to: 500 Is CCarGenerator_extended structure used: 1` |

The install's `fastman92limitAdjuster_GTASA.ini` has `#Car generators = 500` **commented** — so the number is
not being raised; FLA still applies the car-generator patch because `Accept any ID for car generator = 1` is
ON, which switches the array to `CCarGenerator_extended` and re-declares it at the same 500.

**`Accept any ID for car generator = 1` changes the SAVEFILE format.** FLA says so itself, one line above:
`Format of new savefiles will be different: patch for car generators with CCarGenerator_extended structure is
applied!` — which is why an added car's parked spot is a save-schema fact, not only a placement (see
[fla-id-limits-are-part-of-the-savefile.md](fla-id-limits-are-part-of-the-savefile.md)).

## Why 1045 > 500 is not a contradiction — and what it means for us

The map's records live in binary IPL **streams**: they are registered when their section streams in and go
away when it streams out, so the 500 is a CONCURRENT array, not a map-wide budget. That is why a stock game
with 1045 records runs on 500 slots at all.

A row in `cleo/Parked Car Maker.ini`'s `[Cars]` is not like that: the script creates it with CLEO's
`CREATE_CAR_GENERATOR` and it is **permanent for the session**. Every such row holds one of the 500 slots
for good, against whatever the map wants to stream in nearby.

So the budget a build has to respect is not "1045 + our rows < 500" (it never was) and not "our rows < 500"
either (that would leave the map nothing): **it is our permanent rows plus the worst-case resident map
generators**, and the resident half is not a number this repo has measured. Until it is, the installer
reports rather than rations — it prints the row count with the FLA limit beside it and refuses only the
unambiguous failure, our rows alone reaching the limit.

## What would settle it

The peak RESIDENT count — how many map car generators are registered at once in the worst area (downtown
LS at ground level is the candidate). It is measurable in the field: FLA's error reporting has
`Car generator limit exceeded (0)` — switch it on, drive the worst area with a large `[Cars]` list, and the
log says whether the array is being exhausted. Until someone runs that, treat any share-of-500 figure as a
guess, not a budget.

## Where this bites

- `tools/vehicle-installer` 013 — the `parked.txt` merge and its report.
- `tools/add-vehicles` 003 — 115 added cars, each of which MAY ship a `parked.txt`; today exactly one does.
  A fleet-wide "park every added car" would be the first thing to actually threaten the array.
- `docs/restrictions/sa-target.md` carries the one-line rule.
