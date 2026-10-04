# perfect-cutscene ASI

Our own `.asi` engine-patch for real **GTA:SA 1.0 US** that gives CUTSCENE vehicles the deferred,
depth-sorted alpha pass the engine grants only gameplay `CVehicle` entities — so window glass on
converted cutscene cars renders OVER scene actors at any entity draw order, instead of z-erasing
every actor drawn after the car (plan 004 rounds 15–17: RIOT_4B's invisible passengers; the full
recovered mechanism lives in `docs/gta-sa-original/cutscenes.md` and
`docs/hacks/retired/cutscene-window-pane-suppression.md`).

R\*'s own answer was authored data: vanilla cutscene cars carry no rendering window glass at all.
This ASI retires that ceiling — `vehicle-cutscene` conversions keep the mod's real tint on every
slot, and the per-slot window-pane suppression hack retires with it.

> **A CONSUMER of [`asi/sdk`](../sdk/README.md)** — the shared framework (exe fingerprint gate,
> byte-verify, adjuster coexistence, hooks, logging, codegen, build rules), exactly like
> [`asi/perfect-map`](../perfect-map/README.md). This project holds only its own catalogue,
> payloads and a thin Makefile. Same single accepted exe (the HOODLUM body-relocation trap is the
> SDK's problem, already solved once).

## Layout

- **[docs/plans/readme.md](./docs/plans/readme.md)** — the execution chain (001: reproduce → hook →
  field-gate → retire the hack → re-sweep → pmb packaging).
- `gen/` — the catalogue (`catalogue.ts`) + the thin generator, mirroring perfect-map's shape.
- `src/` — `dllmain.cpp` and the seam headers (`identity` / `config` / `plugin` / `apply`); payloads
  land in `src/patches/` from step 2.
- `Makefile` — identity + payload flags, then `include ../sdk/mk/asi-plugin.mk`.

## Status

Plan 001: step 0 (the hackless repro) closed — RIOT_4B and SYND_3A both erase their actors on the
standing repro build. Step 1 (this scaffold) builds in all three modes and is installed verify-only
in the bottle; the boot check is the open item.

The catalogue's five sites were read out of the accepted exe and cross-checked against
gta-reversed-modern: `CCutsceneObject::SetModelIndex` (0x5B1B20) is the hook the census and the
deferral ride on — every cutscene object passes through it and the clump exists there, while
`SetupCarPipeAtomicsForClump` (0x5B1AB0) returns early for anything outside the blessed six.
