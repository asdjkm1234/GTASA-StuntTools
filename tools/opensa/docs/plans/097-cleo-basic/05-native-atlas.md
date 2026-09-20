# 097/05 — The native atlas: memory & native calls as an object-capability facade

The subsystem the recon promoted from "future seam" to load-bearing: **5 of the 7 corpus mods read game
memory or call exe functions by address.** The honest design is NOT byte-level emulation — the corpus's
entire native surface is ~15 well-known SA 1.0 US addresses/offsets. "Memory" becomes a declarative
atlas mapping that address space onto engine operations. Field checkpoint 2 closes it: **the fire
ladder rises, the van door slides, the tank tracks roll.**

## The observed surface (the whole of it — from the 2026-08-04 disassembly)

| Kind | Address / offset | Meaning (gta-reversed name) | Used by |
| --- | --- | --- | --- |
| fn | `0x4C5400` | `CClumpModelInfo::GetFrameFromName(clump, name)` | firela, van door |
| method | `0x59AFA0` | `CMatrix::SetRotateXOnly(angle)` | firela, van door |
| method | `0x59AFE0` | `CMatrix::SetRotateYOnly(angle)` | firela, van door |
| method | `0x59B020` | `CMatrix::SetRotateZOnly(angle)` | firela, van door |
| method | `0x59B120` | 3-arg matrix method (translate/rotate — confirm in gta-reversed) | rhino |
| global | `0xB74494` | `CPools::ms_pVehiclePool` (pool walk) | rhino |
| global | `0xC812F0` | CWeather block (wind strength) | wind farm |
| global | `0xB6F118` | to be named from gta-reversed before serving | wind farm |
| offset | `CEntity+0x18` | `m_pRwObject` (the clump) | firela, van door |
| offset | `RwFrame+0x10` | the modelling `CMatrix` | all class B |
| offset | `CMatrix+0x30/34/38` | pos.x/y/z (frame+64/68 in the scripts) | van door, rhino |
| opcode | `095F` | GET_DOOR_ANGLE_RATIO (honest opcode, no memory) | van door |
| opcode | `0A97/0AEB` | vehicle handle → "pointer" | all class B |
| opcode | `0A8C/0A8D/0A8E` | WRITE/READ_MEMORY, INT_ADD (pointer arithmetic) | all class B + wind farm |

Every entry's meaning is recovered from the reversed source (`docs/links.md` → gta-reversed) — the
recover-the-real-formula rule. No fitted constants: an offset we cannot name does not get served.

## Decisions

1. **Pointers are opaque tokens.** `GET_VEHICLE_POINTER` returns not a number but a token
   `(domain: vehicle, handle, offset: 0)` (encoded so it survives storage in a 32-bit script var —
   a tagged index into a token table). `INT_ADD/SUB` on a token derives `(same base, offset±n)`.
   Arithmetic between two tokens, or on a raw int that is not a known global address, follows the
   unimplemented tier — observably.
2. **The atlas is data.** One table, pinned to the ONE canonical 1.0 US exe (the perfect-map
   doctrine — 14 383 616 B): absolute addresses (functions, globals) and per-struct offset maps, each
   entry naming its gta-reversed symbol and mapping to a host operation. Adding an entry is adding a
   ROW (+ its handler if a new capability is needed), never touching the VM.
3. **Resolution paths**:
   - `READ_MEMORY(token)` → struct-offset map of the token's domain → engine query
     (`CVehicle+0x18` → a clump token for that vehicle; matrix field reads → current part pose).
   - `READ_MEMORY(absolute int)` → globals table (`0xC812F0` → the weather system's wind value;
     pool globals → the pool facade below).
   - `WRITE_MEMORY(token)` → engine mutation (matrix pos writes → `setPartTranslation` on the part
     behind the frame token).
   - `CALL_FUNCTION/METHOD(address)` → functions table (`GetFrameFromName(clumpToken, name)` →
     `VehicleHandle.partIndex(name)` → a frame token; `SetRotate*Only(angle)` on a matrix token →
     `setPartRotation` with the axis quat — SA's matrix convention mapped once, tested against the
     door-hinge conventions from the comet work).
4. **Frame tokens ride the vehicle part registry.** The comet chain made parts first-class
   (`VehicleHandle.partIndex/setPartRotation/setPartTranslation`, doors as hinge subtrees). A frame
   token = (vehicle handle, part index). `misc_a/misc_b/misc_c`, `dvan_l/dvan_r` resolve exactly like
   door parts. A name the model lacks → null token; subsequent ops no-op with a once-log (matches real
   CLEO's null-deref crash being the mod's bug, ours degrades instead).
5. **The pool facade.** Rhino walks `CPools::ms_pVehiclePool` (objects array + slot map + size).
   Serve it as a virtual pool over the live vehicle registry: the atlas answers the exact reads the
   walk performs (array base, slot byte, entry stride) with token-yielding results. Scoped to what
   rhino's loop actually reads — recorded in the plan, extended by data later.
6. **Semantics stay SA's; execution stays ours.** The atlas encodes what the DATA (addresses) MEANT;
   the implementation is `VehicleHandle`/engine calls. No 2004 code is ported (project-goals split).
7. **`GET_DOOR_ANGLE_RATIO 095F`** — honest opcode on the vehicle facet: current door openness
   0..1 from the vehicle's door state (the enter/exit animator owns door angles; expose a read
   accessor — the "read derived numbers through an accessor the owning system publishes" restriction).
8. **Unknown address/offset/method → ONE observable path**: once-log with the raw address, tier
   policy (plan 07), and a row in the coverage report. Never a silent wrong read: an unserved READ
   returns 0 **and marks the thread's coverage entry** so the field symptom ("ladder doesn't move")
   has a named cause in F2.

## Subtasks

- [x] Token model + INT_ADD/SUB derivation + storage-in-var round-trip tests.
- [x] Atlas table format (functions/globals/struct offsets, each row: address, symbol name, handler
      ref) + the ~15 corpus entries; name `0xB6F118` and `0x59B120` from gta-reversed first.
- [x] READ/WRITE/CALL resolution through the atlas + unit tests per row (mock host).
- [x] Frame tokens on the part registry + matrix-op mapping (+ conversion tests against the comet
      door conventions — axis/sign fixtures).
- [x] Wind global → served through the atlas; the ENGINE value is an honest 0 (see the phase-B
      ledger — SA's per-weather wind table is not in the reversed clone yet).
- [x] Pool facade scoped to rhino's walk + tests.
- [x] Door-angle accessor + `095F`.
- [x] `cleo-run --atlas` (landed as `--cars handle:model`): the headless trace shows resolved
      operations ("natives.setPartRotation car#257 misc_a#0 …"), never raw addresses.
- [x] Headless integration: firela + van door decoded scripts drive the expected part
      rotations/translations on a fake vehicle; rhino's walk finds the fake pool's rhinos.
- [x] **Field checkpoint 2** — taken; struck 2026-08-12 after reading the close-out. Two of the three
      behaviours are field-confirmed in the chain audit (`docs/audit/cleo-basic-097.md`): *"firela pins
      its ladder, vandoor slides doors"*. The third, **rhino's tracks, was removed by the user's call
      2026-08-05** — we author our own track script instead of driving the mod author's
      ([`cleo/scripts/docs/plans/001-rhino-tracks.md`](../../../cleo/scripts/docs/plans/001-rhino-tracks.md),
      and the frame-order stand-in it rests on is `docs/hacks/cleo-frame-sibling-order.md`), so there is
      no checkpoint left to take here. Rhino's cost was measured **headless** (295–364 µs of the 465 µs/tick
      whole-corpus steady state) rather than through the frame-span ledger this box asked for — the
      cheaper instrument answered the same question, and the number is in the audit.

## Verification

- Every corpus native instruction resolves through the atlas in headless runs (zero unknown-address
  logs on the corpus).
- Axis/sign fixtures: SetRotateXOnly(π/4) on a known part matches the expected engine quat.
- Field checkpoint 2 accepted; rhino per-frame cost recorded against the plan 03 budget.

## Ledger

### Phase A — 2026-08-04: the whole facade, headless-proven; engine part-registry wiring pending

**The two unresolved addresses, named from gta-reversed (the recover-the-formula rule):**

- `0x59B120` = `CMatrix::SetRotate(float x, float y, float z)` — and the composition is
  **Rz(z)·Rx(x)·Ry(y)**, verified term by term against `Core/Matrix.cpp` (NOT the guessable
  Rz·Ry·Rx; a negative fixture pins the difference). This also CAUGHT A BUG in plan 04's
  `gtaEulerToQuat` (it used Rz·Ry·Rx — harmless for the ferris's x=0 rotations, wrong in general;
  fix it when the object path first needs a two-axis rotation).
- `0xB6F118` = `TheCamera.m_fLODDistMultiplier` (TheCamera=0xB6F028, field +0xF0) — the
  draw-distance slider multiplier; `VisibilityPlugins.cpp:286` computes visibility as
  `multiplier x drawDistance`, exactly Wind Farm's radius formula. Served as 1.0 (we have no
  slider); `0xC812F0` = `CWeather::Wind` verified in `Weather.h:44`.

**Protocol facts recovered from the corpus disassembly (all now unit-fixtured):**

- Tokens must survive PLAIN VM arithmetic, not just INT_ADD — firela does `frame += 16` with
  `000A ADD_VAL_TO_INT_LVAR`. Encoding: `0x50000000 | (entry << 12) | byteOffset`.
- Rhino's pool walk: `0xB74494` -> `+4` byteMap -> one BYTE per slot (counter, bit7 set = free),
  `handle = byte + slot*256`, bounded at slot 139 (`28@ > 35584`). The facade mints handles as
  `slot*256 + counter` and the walk reconstructs them exactly.
- Rhino reads `CVehicle+0x658` = `m_aCarNodes[4]` = CAR_WHEEL_RB (spin source: the frame matrix
  `m_forward` column) and `+0x6A8` = `m_aCarNodes[24]` = CAR_MISC_E, then WALKS THE FRAME TREE via
  `RwFrame+0x9C` (`next` sibling) — the track links are a sibling chain. `SetRotate` is called with
  `this = frame+16` after `-= 56` from the pos cursor, and the three pos WRITES after it restore
  what SA's SetRotate zeroes (m_pos) — served as per-component absolute translation writes.
- firela holds `misc_a/b/c` at identity (all nine SetRotate*Only calls pass 0.0) — the mod PINS the
  ladder against default sway; judge the field from that, not from an imagined "ladder rises".
- vandoor needs NO ini (that is cardoor): its gate is GetFrameFromName probing — any car whose
  model carries `dvan_l/dvan_r/dmbus_*` frames gets the behaviour. The slide is matrix pos.y/x
  writes driven by the honest `095F` door ratio.

**Landed** (`packages/cleo/src/vm/`): `native-tokens` (TokenTable, arithmetic-surviving encoding),
`sa-matrix` (quat forms of SetRotate*/SetRotate with reversed-source fixtures), `native-atlas`
(`SA` rows + `AtlasMemory` facade over the narrow `NativeWorld`; unserved access -> ONE recorded
miss, never a silent wrong read), `handlers/natives` (0A8C/0A8D/0A8E/0A97/0AEB/0AA5-0AA8/095F;
WRITE preserves float bits; var args pass BOTH int and float readings — the row decides, nothing
guessed). Missed-in-03 opcodes caught by the class-B runs: `0A01`, `056D`. Recording host runs the
REAL AtlasMemory over a fake world. 108 package tests green; headless: windfarm BUILDS (68 objects,
34 LOD links — the 04 blocker flipped), firela pins its ladder parts, vandoor slides `dvan_l` by
the 095F ratio, rhino walks the real pool facade within budget (instructionsLastTick < 10k).

**Field (partial, same day): the turbines APPEARED** — with `lodDistMultiplier` served, windfarm's
radius went non-zero and the farm built in the live game (mast visible at the site; console clean of
0A8D). Wind reads 0 -> zero-wind sway fallback, as accepted. Authored-z note from the 04 ledger
stands for checkpoint 2.

### Phase B — 2026-08-04: the engine NativeWorld is live

- **`VehicleHandle` script-part accessors** (interface + `EngineVehicleHandle` + fake):
  `scriptPartIndex` resolves by FRAME name over the rig's parts (the pre-existing private
  `partIndex` serves the damage-group space — a different namespace); rotation/translation writes
  are SCRIPT-ABSOLUTE, mapped onto the engine's anim channels (`anim = conj(bind) x target`,
  `animT = target - bindT` — the engine composes `R = bind x anim`, `T = bind + animT`), with the
  current state tracked and lazily seeded from the bind pose.
- **The script fleet** (`engine-vehicles`): every spawned car gets a slot-minted handle
  (`slot*256 + counter`, counter 1-127 — slots REUSE on despawn, the counter is SA's own staleness
  detector), published as `scriptVehicles()`; the pool facade's byte walk reconstructs exactly
  these. `scriptDoorRatio` reads the enter/exit animator's door angles through a published accessor
  (`EnterVehicleSystem.doorOpenRatio`, angle/DOOR_OPEN_ANGLE; front doors only — the animator
  swings no others, rear-door 095F reads answer null).
- **The vehicles facet is fleet-backed**: anyCar/carInSphere/carModel (model name -> id through the
  adapter), `isCarModel` over `vehicles.ide` types (car/mtruck/quad), player-car seat state.
- **Sibling walk = frame-order adjacency** — a recorded HACK
  (`docs/hacks/cleo-frame-sibling-order.md`): the rig drops the DFF's parent links; retirement =
  the optimizer carrying a `parent` per part.
- **Wind stays an honest 0**: `CWeather::Update`'s per-weather wind table is NOT in the reversed
  clone (only the cheat's `Wind = 1.0` is); a value would be a fabricated constant. Wind Farm keeps
  the accepted zero-wind sway; bind the table when gta-reversed grows it.
- 902 tests green across cleo/game/host after the wiring.

### Field checkpoint 2 — 2026-08-04: natives SERVED in the field; the visual class-B closure has
### three NAMED blockers (rig-shape facts, not host bugs)

Setup: firela/newsvan/rhino rebaked into `build/original/opensa` (`vehicle-installer --rebake
original --in NO_COMMIT/cleo-stage`, 44.7 MB of .osm), scripts hand-placed (5 total now), new field
params `?spawncar=model[,x,y,z[,heading]]` (retries until ground streams) and `?autoseat=1`.

**What PASSED:**

- All 5 scripts boot (census line), zero thread faults across every run, frame steady 8.33 ms /
  120 fps with the tank driven — no `[slow]` lines at any point (the rhino per-frame budget question
  answers itself: its walk skips early on this rig, see below; re-measure when the track path runs).
- **The rhino vehicle mod installs, spawns, seats (`autoseat`) and DRIVES** (60+ m runs on the
  beach, camera following).
- **ZERO atlas misses in the field** (new: the host surfaces every AtlasMemory miss as a console
  line — the plan 07 F2 panel's seed). Every native READ/WRITE/CALL the three class-B scripts
  performed resolved through the atlas against the REAL rigs — the "no unknown-address logs"
  verification, met while driving.
- vandoor enters through the REAL walk-up (held Enter): front door swings, player seats — its
  GetFrameFromName probes all resolved (`dmbus_r` found on this model, the dvan/dmm probes
  null-guarded exactly like real CLEO).

**The three named blockers (measured off the rebaked rigs' DESC parts):**

1. **carNodes wheel names**: our rigs keep SA's `wheel_rb_dummy` pivot-frame names; the atlas mapped
   `wheel_rb` — FIXED in this change (the eCarNodes table now uses the `_dummy` forms).
2. **rhino's `misc_e` was dropped by the vehicle-optimizer** (an EMPTY parent frame whose children
   are the `track_1..12` links — no geometry, so the rig omitted it and flattened the chain). The
   script's own null-guard skips the track branch: tracks do not animate on this rig. Same root as
   `docs/hacks/cleo-frame-sibling-order.md` — retirement (optimizer keeps empty frames + parent
   indices) unblocks BOTH.
3. **This newsvan's only sliding part (`dmbus_r`) binds the REAR door ratios (095F ids 4/5)** — and
   the walk-up animator swings only the front doors, so the ratio reads 0 and the slide stays shut
   (in stock SA the rear-door ratio moves about as rarely). A dvan-carrying van (front-door 2/3
   binding) would slide today.
4. firela's visible effect is VACUOUS in this engine: the script pins `misc_a/b/c` at identity, and
   our engine never sways misc parts in the first place. Writes land (zero misses); nothing changes
   on screen, correctly.

**Closure acceptance** (moves with the optimizer work, tracked here): the optimizer carries empty
frames + `parent` per part -> rhino's misc_e chain resolves -> tracks roll on video; a rear-door
ratio source (or a dvan-model corpus addition) shows the slide. The atlas/VM side is DONE.
