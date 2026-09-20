# 201/5 — Symbology and picking as product, not debug

The console's central interaction stands on a flag named `debug`, and its units are debug lines. Both work.
Neither is something a product surface should be built on.

## Steps

### 01 — Picking off the debug flag

A click resolves through `CellStore.pick`, which needs `engine.cells.debugPicking = true` set **before the
first cell loads** and a pak carrying the placement mapper (minor 6). A world hit answers with the model and
TXD names the pak was built from plus GTA coordinates — the readout a mod author wants, and one no tile-based
map stack can produce. It is the console's best feature and it is gated behind a switch named for debugging.

Give the engine an honest pick capability with **its cost stated** — what the placement mapper costs in
memory when it is on, measured, not estimated — so that a build which defaults debug off in production does
not silently kill click-to-inspect. This is the restriction recorded in the same change
([architecture](../../../restrictions/architecture.md)).

**Owes:** the memory cost of the mapper on the [2/01](../2-real-device-truth/readme.md) district, and a test
that picking survives a production-shaped build.

**DONE IN THE ENGINE 2026-08-12; the district number is owed by the next field run.** `debugPicking` is
`CellStore.picking` — a named capability, no `debug` in it — and the three hosts that arm it (the console,
the map viewer, the game shell's debug overlay) now name the capability rather than the mode. The
[restriction](../../../restrictions/architecture.md) is marked resolved in the same change.

The rename alone would have been cosmetic. What the step really owed was the price, and there was none to
read: what picking retains is **CPU-side** — the mapper rows plus the cell index bytes a cell would otherwise
drop after upload — while `Engine.ledger()` counts GPU residency, so every instrument in this repo reported
this capability as free. `CellStore.pickingBytes` counts both halves; `?inventory=1` carries it as
`world.pickingMb`, so **the next capture on the pinned district hands over the number this step owes without
anyone having to remember to measure it**. Two tests pin it — the cost is zero with the capability off, and
each half is verified separately by reintroducing a half-count.

Still open here, and it needs a device: `PLACEMENT_ROW_BYTES` is an ACCOUNTING figure derived from the shapes
allocated, not a heap reading. `performance.measureUserAgentSpecificMemory()` is how it gets checked.

### 02 — Units as instanced symbols

Beacons are `engine.createDebugLines(..., { throughDepth: true })` — an engine debug primitive, drawn over the
city regardless of depth. Fine for nine units; it is not a symbology layer.

Name the count the console must carry — how many units and calls visible at once — and draw them as instanced
symbols. The **symbol carries the label and the priority and stays 2D and on top**; the vehicle itself is
drawn as a model by step 04, not replaced by an icon.

**Owes:** draws and frame time at the declared count, desktop and phone.

**THE COUNT IS DECLARED AND THE BOARD CAN REACH IT, 2026-08-21. The milliseconds are owed by
[2/03](../2-real-device-truth/readme.md).**

Three things were true when the step opened, and the expensive one is that none of them was visible:

- **The 150 existed in no line of code.** It was a row in a budget table and nothing read it.
- **The beacon buffers were `MARKER_CAPACITY = 96`, and a full set RETURNED without drawing the rest.** Every
  marker in a set shares a colour, so the worst case for any one set is the whole board in a single status —
  at 150 available units, a fifth of the shift would not have been on the map. No throw, no warning, no
  missing pixel: the map just stops showing units, and the operator has no way to know which ones.
- **The board could not be loaded past nine units on any device**, so the number this step owes could not
  have been taken even with a phone in hand.

What is in now. `UNITS_ON_SCREEN = 150` lives in one place (`apps/dispatch/src/ops/budget.ts`) and is cited
to the budget table rather than restated. The beacon buffers are allocated at it and **grow** past it,
counting each growth into the report — a declared budget is an ALLOCATION, never a ceiling
([directive 2](../../../project-goals.md#2-legacy-limits-are-not-our-limits)), and the alternative is a unit
the dispatcher cannot see. `?units=150&calls=40` seeds the board at the declared count, deterministically:
past the nine named cars the roster is generated and scattered around the landmark table by a hash of its
index, so two runs of the same size are the same board.

The desk half is [counted](../../../benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json),
and it is a call count rather than a timing. At 150 units + 40 calls the overlay was asking the canvas for
**190 `measureText` calls and 190 `ctx.font` assignments every frame** — a text measurement and a font
re-parse per chip, per frame, for labels that do not change between frames. It now asks for **151 measures
once** (150 distinct callsigns plus the one label the forty calls share) **and 0 thereafter**, with one font
assignment a frame. `fillText` is unchanged at one per chip, and deliberately: this step does not reduce the
symbol count, and it should not — decluttering is [3/03](../3-the-operator-surface-on-a-phone/readme.md)'s
rule, and taking it here would spend the budget before anyone has measured what it buys.

The report gained a `symbology` block — units, calls, symbols, chips, chips dropped, `measureText` calls,
beacon capacity and growths — for the same reason [5/01](#01--picking-off-the-debug-flag) gave `pickingMb`
one: **1/01's `overlay-2d` at 2.44 ms cannot be read against a symbol count that was never recorded**, and
the next capture should hand the number over rather than rely on someone remembering the load.

**Still open, and named rather than quietly dropped:** the units are the chevron-and-chip pair on the 2D
canvas, not an instanced draw. Whether an instanced layer is needed at all is a question the milliseconds at
150 answer first — building it now would be tuning before the measurement, which is the order
[the chain's own evidence table](../readme.md) rejects.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** nothing.

### 03 — District names in the readout

`map.zon` / `info.zon` and GXT are already parsed and tested —
`packages/renderware/src/parsers/text/zon.parser.ts`, `packages/game/src/zones/*` — but the console
deliberately imports nothing from `packages/game` except the environment driver, which is what makes it the
repo's smallest complete embedding example. Today `Incident.place` comes from a hardcoded landmark table in
`apps/dispatch/src/ops/seed.ts`.

**Take the fork explicitly:** either move the lookup down to a layer both consumers can reach, or accept the
import and record why. Whichever wins updates [`docs/architecture/`](../../../architecture/README.md) and the
boundary restriction in the same change.

**Owes:** the decision, written down with its cost — not a quiet import.

**DONE 2026-08-21, and the answer was NEITHER of the two options — because the question was posed wrong.**

The console does not need the game layer's zone code. What `packages/game` owns there is `ZoneNameSystem`:
an ECS system that tracks a PLAYER across frames and fires a callback when the district changes. This
surface has no player, no ECS and no frames it wants that on. What it needs is one pure question — *what is
at this point* — and that is a property of `info.zon`'s FORMAT: the boxes nest (a district inside a county
inside an island) and the SMALLEST containing one is the answer. So the rule moved to `zoneAt`, beside the
parser that produces the boxes, in `@opensa/renderware`.

Three consumers now read that one function: the game's HUD, the console's readout, and the pack that bakes
the table for the console. The game reaches it through a new `adapters/named-zones`, because
[the boundary lint](../../../restrictions/architecture.md) allows renderware from `adapters/` or `mods/` and
nowhere else — **it caught the first attempt**, which imported it straight into `zones/`. `ZoneNameSystem`
keeps the per-frame tracking and lost its private copy of the containment rule, so this change removes an
owner rather than adding one.

**And the fork question hid the real obstacle, which was not layering at all.** `info.zon` holds GXT KEYS
(`GAN`, `LMEX`) and the text lives in `text/american.gxt` — two files of the game dir, and **a surface
streaming a pak over HTTP has no game dir**. No import would have got the console a single name. So the
resolution happens at build time: `opensa-pack` reads both, resolves each box, and writes `districts.json`
beside the pak with `manifest.districts` pointing at it, exactly the way the water bake rides beside it.
That is now [a restriction](../../../restrictions/build-vs-runtime.md) in its general form — *a name that
takes two `data/` files to compute cannot be computed by a pak-only consumer* — because `popcycle` and
`carcols` will meet it next.

What the console does with it: a click on a building answers **model, TXD, district and coordinates**, and a
call opened by long-press takes the world's own name for the spot. The hardcoded twenty-landmark table in
`ops/seed.ts` stays as the fallback and is now honestly labelled one — it is a list of Los Santos places
that do not exist on a total conversion.

**The cost, stated rather than discovered:** one small fetch at boot and a few tens of kB beside the pak; the
table is regenerated per build; `?demo=1`, plan mode, a pak built before the field, and any game shipping no
`info.zon` all get no districts, so every caller carries an answer for *this world has no place names* rather
than treating an absent table as a failure. `docs/contracts/mods.md` §7 says what a mod replacing either file
changes, and what a misspelled GXT key looks like — a district shipping under its own key, silently.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** nothing.

### 04 — Units get real models

**Decided 2026-08-06: cars and peds are drawn**, not replaced by icons. That settles what was previously
recorded as a known gap, and it settles two things upstream:

- vehicle and ped dictionaries are **protected** in
  [1/02](../1-the-map-profile/readme.md) and cannot be cut from the pak;
- ped animation stays in the profile.

The cost is a dependency on the build carrying converted `.osm` models, and it is recorded rather than
assumed: state what the console does when a model is absent — an honest fallback to the symbol, named in the
log, never a hole where a unit should be. A vehicle exists **only** as its converted `.osm`; there is no DFF
fallback ([build-vs-runtime](../../../restrictions/build-vs-runtime.md)).

Whether those units are simulated or kinematic is decided here too, because
[1/03](../1-the-map-profile/readme.md) waits on it: kinematic units read no collision, and only then may the
baked collision leave the map profile's pak.

**Owes:** draws and frame time at the declared visible-unit count, desktop and phone, and the
simulated-vs-kinematic decision handed back to 1/03.

**THE DESK HALF IS DONE 2026-08-26; the milliseconds at 150 are owed by a device run. The decision 1/03 was
waiting for is KINEMATIC, and it was not a close call.**

**Where the bytes come from, and why no format changed.** The pak holds cells, textures and collision, and
*nothing about a vehicle lives in it* ([build-vs-runtime](../../../restrictions/build-vs-runtime.md)) — that
restriction is what makes `--rebake` able to add a car on the id its mod declares, so the answer was never to
widen the pak. A unit's car is resolved the way the game resolves one: **by NAME, out of the archives of the
same built game**, which the console already reaches for `data/timecyc.dat`. `models/vehicles.img` →
`vehicles2.img` → `peds.img` → `gta3.img`, over **Range requests** — `openLazyVer2` holds the directory
(32 bytes an entry) and slices the one entry a unit asks for, so a board of six types costs six model reads
and never the gigabyte the archive is. `gta3.img` is last on purpose: ~14 900 stock entries is ~477 kB of
directory, and a board that only ever draws cars must not pay it. The rule is written down in
[contracts/dispatch-map](../../../contracts/dispatch-map.md) §2, because a name that carries behaviour and
cannot be grepped for is one nobody can follow.

**The layering fork this step inherited from [5/03](#03--district-names-in-the-readout), taken the same
way.** `readModelOsm` lived in `packages/game/src/adapters/`, and this surface reaches the game layer
through the environment driver alone ([architecture](../../../restrictions/architecture.md)). It is not game
logic — no ECS, no player, no frame, just the inverse of `packVehicleFixture` — so it MOVED, to
`@opensa/loaders/model-osm`, beside `openLazyVer2`, which is how a browser gets those bytes out of an archive
in the first place. It did NOT move to `@opensa/engine-formats`, which owns the container and says so in its
own words: *"sections are opaque byte ranges here; what is inside each one is the asset class's business"* —
plus a zero-dependency promise this reader (which needs the fixture type) would have broken. `packages/game`
re-exports it, so the fourteen hosts that already import it are unchanged, and there is still exactly one
copy of the format knowledge.

**Kinematic, and what that buys 1/03.** A unit's position is a CLAIM the feed makes
([202](../../202-pcad-dispatch/readme.md)'s first seam), not a simulation this surface runs. So a car is a
root matrix written from the fix — `gtaRootMatrix` in `map/coords.ts`, the one place this app converts
between the two coordinate systems — and **nothing on this surface reads collision**. That is the answer
[1/03](../1-the-map-profile/readme.md) was blocked on: the baked collision may leave the map profile's pak,
and the 08-09 capture's measured **zero** collision requests were not an accident of that camera.

**Confirmed with the user 2026-08-26, and it is now a [restriction](../../../restrictions/architecture.md)
rather than a step's decision:** the fix arrives FINISHED. The game that published it applied collision —
that is why `pos_z` is a road height and not a hole — and on this surface *a unit is a model drawn on the
map, not an object in a world*. The map therefore corrects nothing: no ground snap, no height grid, no
"the car looks like it is floating" fix. The violation is worse than silent, because it presents as an
improvement while moving every unit off the place the server reported it at — most on a bridge or a hill,
which is where a dispatcher is least able to afford it.

The height comes with the fix for the same reason it is trusted: PCAD publishes `pos_x, pos_y, pos_z`
(202 §4), so `Unit.elevation` is one third of the position rather than a number this surface invents. The
track ring is untouched: it stores what a dispatcher reads (17 bytes a sample, [8/01](../8-the-time-axis/readme.md)),
so a REPLAYED fix carries the unit's last known height rather than the one it had then — stated here rather
than discovered on a scrub, and reversible for +4 bytes a sample (+4.3 MB at 150 units over an 8 h shift) if
a scrub through the hills ever reads badly.

**Exactness is the requirement, so the pairing is tested rather than asserted.** The console must place a
unit where the GAME places the same numbers: `engine-vehicle-handle` writes `[x, z, −y]` with the height
verbatim, and `gtaRootMatrix` is now pinned to produce exactly that (f32, so ~1e-4 world units at Los Santos
magnitudes — a tenth of a millimetre). The second half of the seam is the FACING: SA's z-angle is degrees
counter-clockwise from north and this map's heading is a bearing in radians clockwise, so the feed's angle
comes through `headingFromZAngle` and never raw — passed through unconverted it mirrors every unit about the
north–south axis, and a car pointing at its own reflection looks entirely plausible on a top-down map.

**Every angle in the path, audited 2026-08-26 rather than asserted.** The map's yaw matrix was checked
against the game handle's QUATERNION path at all 360 z-angles: **max difference 4e-16** — double-precision
noise — and the basis change `(x, y, z) → (x, z, −y)` has determinant **+1**, so no geometry is mirrored.
The convention is inherited from the shipped path rather than re-derived, which is the stronger claim: it is
pinned to the code that already renders cars in the game.

Two angles are NOT in the path, and both are the feed's shape rather than an oversight. **Roll and pitch do
not exist in the packet**, so a car never leans: on a 15° slope the forward vector loses its 0.2588 vertical
component and a 4.6 m car buries a nose or a tail by ~0.6 m. Deriving one from consecutive fixes is barred by
the restriction above — at 4 s the fixes are ~110 m apart and the slope between them is noise — so the
consequence is [recorded](../../../edge-cases/dispatch-console.md) and the fix, if a street-zoom verdict ever
wants it, is upstream: two more floats from PCAD. **Wheels neither spin nor steer** for the same reason.

**And the two layers that draw the same direction are now pinned to each other.** The 3D model is turned by
the root matrix; the 2D chevron takes its screen angle from a point ahead of the unit. Written twice, those
are one sign apart from a map whose cars and whose symbols point different ways — plausible in either file
alone, absurd together. `aheadOf` is that point, in `coords.ts` with everything else, and a test walks 16
headings comparing the model's forward column against it.

**What a unit DRIVES is not part of the position feed.** PCAD publishes a position (and a `vehicleId` whose
meaning 202 §4 still owes); the vehicle a unit is in is board state, like its callsign and its status. So
`Unit.model` is a NAME the board carries, and the console asks no further — an id is a slot, and a slot means
different things in two builds.

**The fallback is the step's real content, because it is the normal case rather than the error case.** A pak
served without its game dir, a build converted without `--vehicles`, a total conversion that never had a car
called `copcarls`, a board that does not know what a unit is in — each leaves the unit exactly as 5/02 drew it
(chevron, chip, beacon), says so ONCE per name in the log, and never asks again. It is counted rather than
narrated: `?inventory=1` gained `unitsAsModels`, `unitsAsSymbolOnly`, `unitsUnresolvedModels`, `modelTypes`
and `modelTextureMb`, and the readout shows `cars 7/9 · 3 types · 12.5 MB`. **A hole where a unit should be
is the one outcome that is not allowed** — it is indistinguishable from a unit going off duty, and a
dispatcher would act on it. Verified by removing the model deliberately, which is what four of the twelve
`unit-models.test.ts` cases do.

**What it costs so far, measured on the desk.** The bundle: **dispatch 131 650 → 135 848 B raw (+4.1 kB)**,
plus a 1 153 B `model-osm` chunk; the whole `dist/assets` moves 3 771 964 → 3 776 383 B. No `@opensa/cleo`
and no `@opensa/game-build` came with it, which is the number that says the subpath imports did what they
were chosen for. One model TYPE serves every unit driving it (150 cars of six kinds upload six models), an
idle type is trimmed back to `UNIT_MODEL_TEXTURE_BYTES` = 64 MB — a quarter of the phone's smaller ceiling,
derived from this chain's budget table rather than copied from the game's 256 MB — and a type with live
instances is never trimmed, because trimming one would take a unit off the map.

**Still owed, and it is the half only a device can pay:** draws and frame time at 150 units with models,
desktop and phone ([2/03](../2-real-device-truth/readme.md)), and the resident megabytes the model cache
really holds. Two things are deliberately NOT done before that measurement: the `_vlo` LOD the models already
ship is not used at city zoom ([the lever, priced](../../../performance/deferred-optimizations/unit-model-lod-band.md)),
and peds are not drawn — a unit on foot keeps its symbol, because the ped path is a skinned probe rather than
a rigid model and it should not be built on a guess about what the frame can afford.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** the vehicle model path, which
is protected — this step is the one that makes it load.

## Verification

- Click-to-inspect still answers model + TXD + GTA coordinates in a build with debug defaults off.
- The declared unit count is drawn without breaking the frame budget named in
  [1/04](../1-the-map-profile/readme.md).
- A build missing a unit's model degrades to a named symbol and says so in the log — verified by removing one
  deliberately.
