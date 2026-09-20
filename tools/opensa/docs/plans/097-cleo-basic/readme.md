# 097 — CLEO basic (run compiled `.cs` scripts in the engine)

**Status: 01–07 DONE 2026-08-06 (all three field checkpoints + the 07 close-out: audit
`docs/audit/cleo-basic-097.md`, benchmarks `2026-08-06-headless-cleo-vm-cost.md` + the frame A/B/A;
CLEO is ON BY DEFAULT since the 06 decision-6 verdict, `?cleo=0` opts out). 08 (authoring SDK)
DONE 2026-08-06 as the project-local chain `cleo/sdk/docs/plans/` — hello-conformance
field-verified on BOTH runtimes (our engine AND real CLEO under Wine, user-confirmed). The whole
097 chain is CLOSED.**

**Scope note (2026-08-12):** this folder holds the ENGINE side — the CLEO integration. Everything about
the authoring SDK moved to [`cleo/sdk/docs/plans/`](../../../cleo/sdk/docs/plans/readme.md), beside its
code: the `08-authoring-sdk.md` file here was a duplicate of a chain that had already shipped, down to
six task boxes for finished work, and it is deleted. The same sweep struck 05's field-checkpoint-2 box
(taken; its rhino third was removed by the user's 2026-08-05 call). **Zero open boxes in this chain.** Supersedes `roadmap/0.5.0/plans/08-cleo-basic/` (deleted in the same
change), which was itself the unstarted 083 rethink of the three-era idea chain. This version is grounded
in a fresh recon: **all seven `.cs` scripts of the user's target corpus were fully disassembled** (against
the vendored Sanny Builder opcode DB) and the engine/pipeline seams were re-verified file-by-line. The
old chain's language-core design survives; its scope, its memory-model stance and its wiring facts do not.

**Goal:** run compiled GTA:SA CLEO `.cs` scripts in the browser engine on a deliberately extensible
architecture — CLEO as its OWN LAYER between mods and the engine (`packages/cleo`), never mixed into
either. Coverage grows by data (opcode DB + atlas entries), not by rewrites.

## The corpus (7 supported mods decoded 100 % on 2026-08-04, +1 kept with its script SKIPPED; moved `NO_COMMIT/cleo` → `mods-src/original/` by plan 06)

| Mod | Script | Size / instr | Class |
| --- | --- | --- | --- |
| 46. Pacific Park Rotating Ferris Wheel | `CLEO/Rotating Ferris Wheel (Junior_Djjr).cs` | 876 B / 91 | A |
| wind_farm | `CLEO/Wind Farm (Junior_Djjr).cs` | 3 689 B / 239 | A |
| firela (ladder truck, slot 544) | `cleo/firela.cs` | 3 175 B / ~44 | B |
| newsvan (slot 582) | `cleo/van door [SA].cs` | 24 597 B / ~102 (rest is Sanny footer) | B |
| rhino (GTA 5 Rhino, slot 432) | `cleo/rhino tracks.cs` | 34 114 B / ~2 085 | B |
| coach (slot 437) | `cleo/Car Left Door.cs` + `.ini` | 3 522 B / ~64 | C |
| bus (slot 431) | `cleo/Car Left Door.cs` + `.ini` (identical copy) | 3 522 B / ~64 | C |
| hotring (slot 494) | `cleo/no_lights.cs` — **SKIPPED by user call 2026-08-05** (car kept, script unsupported; recon + the native alternative in [the postmortem](../../postmortem/097-hotring-hotknife-intake.md)) | 275 B / 27 | — |

- **Class A — world objects**: spawn + per-frame rotate (`CREATE_OBJECT_NO_SAVE`, `SET_OBJECT_ROTATION`,
  `CONNECT_LODS`, camera-distance gates). Wind Farm ALSO reads two absolute game globals (one in the
  CWeather block — wind strength), allocates scratch memory, and uses CLEO+ lists + perlin noise. The old
  plan's "neither touches raw memory" was **wrong** — even class A needs the globals table.
- **Class B — vehicle part animation via native calls**: `GET_VEHICLE_POINTER` → `CVehicle+0x18` (clump)
  → `CClumpModelInfo::GetFrameFromName@0x4C5400` (`misc_a`, `dvan_l`, …) → writes into the RwFrame matrix
  (pos at frame+64/+68) and `CMatrix::SetRotateX/Y/ZOnly@0x59AFA0/0x59AFE0/0x59B020`. Rhino additionally
  walks the vehicle pool global `0xB74494` and burns ~2 000 instructions/frame on track math.
- **Class C — ped-task orchestration + ini IO**: reads its own `cleo\Car Left Door.ini`, then re-boards
  the player as a passenger through the left door with task-sequence opcodes. **Deferred**: needs a
  ped-task surface that does not exist (city-life territory). The script must RUN and degrade loudly
  (tier-b conditionals), never break the runner.

Census: ~116 unique opcodes across four dialects (vanilla SCM, CLEO, CLEO+, NewOpcodes).

## What the recon changed vs the old chain

1. **No SCM ancestor exists in the repo.** `packages/renderware` carries only comments about `0x014B`;
   the "lift the car-gen reader" task was fiction. The decoder is written from scratch — and the recon
   validated the design: a two-layer decoder over the vendored Sanny `sa.json` (3 739 commands with
   arities) disassembled the whole corpus in ~150 lines of throwaway code.
2. **Two encoding facts no doc carried** (each cost a decode round): native-call opcodes `0AA5–0AA8`
   encode `head(address, [struct], numParams, pop)` + `numParams` args + output vars + a `0x00`
   terminator; and every Sanny-compiled `.cs` ends with a `FLAG`/`SRC`/`VAR` metadata footer after the
   final jump — linear decode to EOF always "fails" there by design.
3. **`game.addSystem` is dead code.** `SystemRegistry` has no live consumer; the real hub is
   `apps/web/src/ui/engine-canvas-host.tsx` — explicit construction + explicit calls inside
   `runFixedSteps` (~`:1339`). The runner is wired there, gated the way `physics.system.ts:35` gates
   (`if (config.gameState !== 'play') return`).
4. **The memory model is promoted from seam-with-a-stub to a first-class subsystem.** 5 of 7 corpus mods
   need it. Its honest shape is NOT byte emulation: the whole corpus's native surface is **~15 atlas
   entries** (one exe function, three matrix methods, three globals, a handful of struct offsets). See
   plan 05's object-capability design.
5. **The pipeline silently deletes `.cs` today** — and precisely for the two class-A target mods, which
   are modloader-shaped (`data/Loader.txt` + `gta3_img/`) and therefore take mod-installer's BAKE path,
   whose bucket chain drops `.cs`/`.ini`/`.fxt` with no log (`bake-mod.ts`). The vehicle installer never
   looks inside a mod's `cleo/` subfolder at all. Plan 06 fixes both; until then scripts are hand-placed
   in `build/<game>/opensa/cleo/` (loose files pass every later stage untouched — verified).
6. **VFS discovery is a non-issue.** All three loaders materialise every chunk at boot; `Vfs.names` is a
   complete enumeration (currently consumer-less). Keys are lowercased everywhere → canonical prefix is
   `cleo/`.
7. **Stale refs**: `readVehicleOsm` is at `gta-sa-world.adapter.ts:359` (not `:618`).

## Architecture (the layer, and its internal boundaries)

`packages/cleo` — a separate Nx package (`type:engine` tags; may import `@opensa/game`; never touched by
`packages/game` or `packages/engine` — the dependency points ONE way, cleo → engine seams):

| Layer | Contents | May depend on |
| --- | --- | --- |
| `core/` | vendored+pinned Sanny DB → generated opcode table; decoder; disassembler; Sanny-footer detection | nothing |
| `vm/` | cooperative threads, vars/timers, control flow, handler registry, budgets, per-thread failure isolation, engine-independent stdlib (lists, scratch memory, strings, noise) | `core` + the host interface |
| `host/` | the `CleoHost` CONTRACT — capability facets: Objects, Vehicles, Player, Clock/Weather, Text, Files, Input | types only |
| `native/` | the virtual address space (pointer = opaque token) + the SA 1.0 US address atlas (data, not code) | `host` |

Engine side: **one bridge module** implements the host facets over existing seams — the rigid-model spawn
path (`readModelOsm` → `createVehicleModel` → `createVehicle` → `setRoot`; template
`apps/web/src/ui/engine-props.ts:73-127`), `VehicleHandle` part/door ops, `EngineVehicles.activeVehicle()`,
ECS `Transform`, `KeyboardInput.isDown`, `Vfs.get/getText/names`.

Doctrine:

1. **Opcode DB is data, handlers are plugins; atlas entries are data too.** Unknown opcode OR unknown
   address → ONE observable "unimplemented" path with a tier, never a silent misparse.
2. **The VM is engine-agnostic and headless-testable**; `core`/`vm` have zero engine imports.
3. **The layer impersonates the ONE canonical SA 1.0 US exe** (14 383 616 B — the same exe perfect-map
   canonised): scripts version-check (`0AA9`) and address into that exact address space; the atlas is
   pinned to it, offsets sourced from gta-reversed (`docs/links.md`) — the recover-the-real-formula rule,
   never fitted constants.
4. **Handles are tokens, not numbers**: detach-safe (a torn-down instance no-ops with a once-log).
5. **Gated + observable**: `Config.cleo.enabled` (default OFF until field-proven), play-state gating,
   per-frame instruction budget, per-thread failure isolation (the VM catches its own throws — a CLEO
   error may never poison `runFixedSteps`), tracer + coverage as first-class tools.
6. **Restrictions honoured by construction** (`docs/restrictions/architecture.md`): scripted control of
   the player/vehicle would speak a sibling `InputState` source in `CombinedInput` (the restriction names
   CLEO explicitly — no corpus opcode needs it yet, recorded for the day one does); script count announced
   at boot (the populations rule); per-frame cost measured through the frame-span ledger.

## Sub-plans

| # | Plan | One-liner |
| --- | --- | --- |
| 01 | [SCM decoding + opcode DB](01-scm-decoding.md) | Vendored Sanny DB → generated table; two-layer decoder; footer + native-call encoding; corpus fixtures. |
| 02 | [Debug tooling](02-tooling.md) | `scm-disasm` / `cleo-census` / `cleo-run` in `scripts/debug/` — the chain's own instruments, kept per repo rule. |
| 03 | [Script VM + scheduler](03-script-vm.md) | Engine-agnostic cooperative thread VM: vars, waits, control flow, registry, stdlib, budgets, isolation. |
| 04 | [Engine host bridge + wiring](04-host-bridge.md) | `CleoHost` facets on the rigid-model path; explicit `runFixedSteps` wiring; **field checkpoint 1: the wheel spins**. |
| 05 | [Native atlas](05-native-atlas.md) | Virtual address space + SA 1.0 atlas; class B alive; **field checkpoint 2: ladder, door, tracks**. |
| 06 | [Packaging + pipeline](06-packaging-pipeline.md) | mod-installer/vehicle-installer carry CLEO files; contracts rows; VFS discovery; **field checkpoint 3: full build**. |
| 07 | [Extensibility + debug surface](07-extensibility-debug.md) | F2 CLEO screen, tracer, coverage in CI, tier registry, add-an-opcode flow, docs + audit close-out. |
| 08 | **Moved out** → [`cleo/sdk/docs/plans/`](../../../cleo/sdk/docs/plans/readme.md) | The CLEO authoring SDK (root `cleo/sdk`, the `asi/` pattern): author OUR scripts in TS → standard `.cs`, dual-target SA + OpenSA; city-life's future home. **DONE 2026-08-06**, and its plan file was deleted from here 2026-08-12 — the chain shipped beside the code and this folder had kept a stale copy of its task list. Everything SDK (goals check, decisions, ledger) lives in that chain readme; this folder keeps ENGINE work only. |

Order and rationale: [priority.md](priority.md).

## Out of scope (recorded, not silent)

- **Class C boarding behaviour** — until a ped-task surface exists (city-life). The scripts run, their
  task opcodes answer tier-b `false`, the F2 coverage screen names exactly what is missing.
- **Physics for script objects** — visual transforms only (matches what the corpus does); collider
  attachment is a recorded extension point (breakable-clutter precedent).
- **`DRAW_CORONA`** — tier-a no-op first; mapping onto the fx system is an extension recorded in 04.

## Standing rules for the chain

Measured numbers into each sub-plan's ledger after every step (decode times, per-frame VM cost, coverage
percentages); every reported figure also lands in `docs/benchmarks/`. Chain close-out = audit in
`docs/audit/` + before/after benchmark (the big-rework rule) + `docs/features/` entry +
`docs/architecture/` module doc/diagram.
