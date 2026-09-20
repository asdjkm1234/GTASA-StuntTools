# 084 — vehicle appearance and dynamic-model lighting

**Status: OPENED 2026-07-20**, mid-field-round, by the user's verdict "our vehicle appearance is in very bad
shape". Two rows were diagnosed and shipped inside that same round and are recorded here as measured
history; the rest are open and one of them needs a decision before any code.

Scope: how a VEHICLE looks — geometry conventions, paint, reflections, and the lighting a dynamic model
receives. Vehicle _physics_ is [081](../081-vehicle-physics/), the camera is [080](../080-cinematic-camera/).

## The triage method that produced all of this

**Diff against prod.** `main:packages/renderware/src/three/build-vehicle.ts` and
`main:packages/game/src/plugins/vehicle-reflection/presets.ts` are the pre-migration implementations of the
same behaviours, and they WORK — the user confirmed both models render correctly on prod. Every defect below
was found by comparing our code to that file, not by reading our code alone. The WebGPU migration carried
some knowledge across with an error and dropped some entirely, and prod is the only written record of what
was dropped.

**Measure the actual asset, not a stock stand-in.** The first wheel diagnosis was wrong because it was
measured against `fixtures/original/dff/vehicle/admiral.dff` while the user was running the MOD admiral from
`mods-src/`. The two disagree on the one property that mattered (mesh centring). Probe the file the field
report came from.

**The suite cannot see this class of defect.** The fake GPUDevice records calls; it does not validate
shader-stage/layout visibility or the 16-varying fragment-input limit. Two shader defects shipped green
through 2325 passing tests in this session and were caught only by the user launching the game. If shader
work continues, a static WGSL check (count fragment inputs per entry point; cross-check bindings used by the
vertex stage against layout visibility) would close it without a GPU. Not scheduled.

---

## Shipped in this round

### Row A — wheels: three defects, all field-confirmed

The symptom was "one pair inward on comet, both pairs on admiral". That was two different code paths, not
one bug, and the split by model is what identified them.

1. **`instanceWheels` flipped the wrong side.** Prod mirrors the copies on the side the mesh was NOT
   authored on (`main:build-vehicle.ts:369, 423, 564` — all three sites agree); ours applied the 180° to the
   right. Both sides ended up facing inward. → admiral.
2. **The per-corner branch lost the flip entirely.** Prod mirrors there too; we placed each corner atomic on
   its own frame with no local rotation. The authored side happened to be right, so only the left was
   wrong. → comet (4 wheels), petro (6 wheels, left triple).
3. **`wheelScale` is a DIAMETER IN METRES, not a multiplier**, and `WHEEL_SCALE_BOOST = 1.25` was a patch
   over that misreading. Measured against the stock meshes the field names:

   | car      | `vehicles.ide` | mesh Ø | ratio |
   | -------- | -------------- | ------ | ----- |
   | infernus | 0.70           | 0.700  | 1.000 |
   | cheetah  | 0.68           | 0.688  | 0.988 |
   | admiral  | 0.68           | 0.700  | 0.971 |
   | petro    | 1.106          | 1.182  | 0.936 |

   Every stock mesh is already modelled at its target size. Multiplying by the field shrank every wheel by a
   third; prod's 1.25 recovered part of it (0.70 × 1.25 = 0.875, still 12 % short — hence its comment
   "wheels read a touch small"). Fitting to the diameter needs no fudge, and it is a no-op for a mesh
   authored at size, so ONE rule now covers all four wheel conventions instead of exempting two.

Also in row A: the authored side is now **read from the model** (`authoredWheelRight` walks up from the
mesh's frame to the first corner name — its own `wheel_rf`, or the `wheel_rf_dummy` its shared `wheel` hangs
under), and `instanceWheels` stopped discarding the dummy's own rotation. Every wheel dummy measured is
identity-rotated, so that rotation carries no side information today — but honouring it costs nothing and a
model that does use it now works.

Fixture coverage, one per convention: `admiral` (shared `wheel`), `comet` (lone `wheel_rf` + dummies),
`petro-4wheels`, `petro-6wheels` (+ middle axle). All four already existed in-tree and were orphaned.

### Row B — the dynamic indirect term was a flat constant

`rigidShade` lit every pixel of a car with `vec3f(frame.params.y)` — no normal, no position, no occlusion.
The map never had the problem: its indirect term is `prelit × params.y × ao`, i.e. baked lighting AND baked
AO, neither of which a vehicle has (not one of the game's 198 cars ships a prelit set).

Measured at full night (`params.y = 0.7`, `NIGHT_AMBIENT = [0.3, 0.32, 0.4]`):

| surface | formula                  | value     |
| ------- | ------------------------ | --------- |
| car     | `vec3f(0.7)`             | **0.70**  |
| map     | `nightPrelit × 0.7 × ao` | **≈0.13** |

**≈5× brighter than its surroundings, up to ≈9× against occluded map creases.** By day the same comparison
is 0.85 vs ≈0.51 — a 1.7× gap. So the defect is round-the-clock and only becomes visible when the sun stops
masking it, which is why it was reported as a night problem.

Shipped: `skyVisibility(normal)` — how much sky a surface sees, 1.0 horizontal down to 0.10 facing straight
down. Normalised against the SKY rather than the hemisphere mean, deliberately: mean-normalisation conserves
energy but brightens roofs and bonnets ~1.8×, and on a car already reported as too bright that would have
made the loudest surfaces worse. Scalar and per-pixel — a sky-COLOURED version needs the sky LUT, which blew
the 16-varying limit when passed per vertex and forced VERTEX visibility onto a fragment-only binding.
`params.y` was neutral before this, so no colour is lost.

User verdict: "got significantly better, edges read clearly, the model isn't as washed-out". Side effect: the car's
average indirect drops roughly half, which narrows row 1 below without closing it.

---

## Open rows

### 0. Field follow-up: black smudges on the comet's doors — FIXED 2026-07-22 late (sky-occlusion scrap ratio)

**Symptom (user, first field run after the rebuild):** dark blotchy smudges on the gold comet's door
panel (the 1995 GT2 mod — the Targa with the spike bug was replaced by the user earlier).

**Trace (offline, no rebuild):** the pak's `comet.osm` night-alpha (= the row-3 AO) put doors at avg 140
with 24–28 % of vertices BELOW 52, while the bonnet bakes 204 with 0 % — outer door skin was smudge-black.
Rebuilding the model through the shared builder and instrumenting `vertexSky` pinned it: the worst
vertices (AO 41) have normals tilted ~15° BELOW horizontal, so ALL 8 azimuth weights collapse to ~0
(`riseZ·nz` cancels the horizontal dot), and `occluded / weightSum` divides one numerical scrap by
another — the verdict swings to fully occluded on noise. High-poly wide-body mods expose it because the
door plane sits INSIDE the footprint (arch flares set the field bounds), so every march finds a column.

**Fix:** `FACING_FLOOR = 1` — the fan's verdict fades toward open sky unless the vertex faces at least
one azimuth's worth of the fan (`1 - occluded / max(weightSum, 1)`). Down-facing surfaces stay dark via
the shader's own `skyVisibility(normal)` factor (row 1's line) — the bake owes only positional enclosure.
Measured on the comet door outer skin (x < −0.8, nx < −0.5): min 41 → 57, verts below 100: 26 → 14 of
434; the scrap-class exemplar went 41 → 255; remaining dark vertices are the door CARD (interior,
x ≈ −0.63 — legitimately enclosed). The admiral builder test's shape probe now compares UP-FACING tenths
only (floor pans vs roof), matching the bake/shader contract. Field check: needs the next rebuild (the
AO rides `.osm`), or a method-5 spot rebake.

### 1. Night level of dynamic models vs the map — SHIPPED 2026-07-22

The map's indirect is `prelit x params.y x ao`; a car's was `params.y` alone. The two missing factors are
now supplied: `DYNAMIC_INDIRECT = 0.35` stands in for the mean prelit (SA map models average 88/255 luma),
and row 3's occlusion supplies the AO. Both land in one line of `rigidShade`:

```wgsl
let ambient = frame.params.y * DYNAMIC_INDIRECT * skyVisibility(normal) * in.local.w;
```

Found by a field probe, not by reading: the shader was temporarily patched to output its own terms as
colour channels and shot headless under the parked admiral. Measured at noon, BEFORE: `ambient` saturated
at ~1.0 on the underbody — a car's exhaust was lit as if it faced open sky.

### 2. Reflections — VARIANT 1 SHIPPED 2026-07-22 (the env-map gate is gone)

User's call after the exhaust round: drop the gate rather than build presets. `reflectionOf()` now reads the
material's data as a whole instead of demanding an env map:

- an env map with a coefficient of 0 stays MATTE and wins over everything — it is SA's own marker on tyres
  and rubber, and that was never in question;
- with no env map at all, an **untextured** material carrying the `reflection` plugin becomes reflective and
  the plugin's intensity IS the coefficient. That is the exhaust / trim / bumper-iron shape, and it is why
  the mod admiral's exhaust rendered as flat 0.2 diffuse where prod showed dull chrome.

The narrowing to untextured is measured, not taste: the mods' exporter stamps `reflection` on every material
they ship, so honouring the plugin alone turned **100 %** of both field cars reflective (carpet, leather and
tyres included). Reflective share, before -> after: mod admiral 21 -> **26 %**, mod comet 35 -> **41 %**,
stock cheetah 42 -> 42 %, stock admiral 60 -> 60 % — it adds exactly the bare-metal parts and moves no stock
car at all.

**The dead env layer is gone too (same day).** `envLayer` (`reflect.x`) was handed to the fragment stage and
never read: `rigidEnv` reflects the live probe, so SA's baked env photo is not the colour source and the
texture name only ever acted as a flag. Removed the varying (location 8 is free again), and with it the
`resolveNamed` call that claimed an ARRAY LAYER for that texture on every car — including cars whose TXD
does not even carry it, which got a white stand-in layer for their trouble.

Texture array per model, before → after: stock cheetah 15 → **13** layers (3.8 → 3.3 MB RGBA), infernus
17 → 15, mod admiral 39 → **38** (39.0 → 38.0 MB), mod comet 24 → **21** @1024² (96.0 → **84.0 MB**). Two
layers per car is the usual saving (`xvehicleenv128` + `vehicleenvmap128`). `reflect.x` stays in the vertex
stream as a documented SPARE — the coefficient in `.y` is the reflective flag.

The preset option below stays as written: if reflection strength ever needs to be authored per CLASS rather
than per material, that is the shape to port.

#### The original decision note, kept

The user's report: no paint/reflection effect on hi-poly custom models, though it is there on low-poly stock.
The data is NOT missing — measured on the two mods in the field:

| model         | verts  | paint slots (primary/secondary) | reflective verts | envMap coefficient | reflection intensity |
| ------------- | ------ | ------------------------------- | ---------------- | ------------------ | -------------------- |
| MOD comet     | 83 008 | 16 261 / 1 862                  | 29 274 (35 %)    | **128**            | 8 / 38               |
| MOD admiral   | 90 609 | 14 200 / —                      | 18 624 (21 %)    | **128**            | 18 / 128             |
| STOCK cheetah | 3 836  | 1 542 / —                       | 1 605 (42 %)     | **255**            | 26 / 33 / 38         |

Mods ship half the coefficient and comet a third of the intensity — roughly 6× weaker overall — and
`neoReflAmount` multiplies straight by it. Prod never had the problem because its default `enhanced` preset
supplied `clearcoat: 1` and `reflectivity: 0.4` as **preset constants**, with the DFF coefficient as one
input among several rather than the only truth.

Corroboration already in our own shader: `CHROME_COEFFICIENT_FLOOR = 0.85`, commented "the surveyed mods
ship ~0.5 everywhere". A previous field round found exactly this and floored it for chrome only; paint was
left bare.

**The choice:**

- **Floor** — one constant beside the chrome one. Cheap, but a hidden clamp: the model's data says one thing
  and the render does another, with nothing in between to read.
- **Presets, porting prod's shape** — `clearcoat`/`reflectivity`/`roughness`/source named and explicit, the
  authored coefficient demoted to an input. More code; the interpretation becomes legible and extensible,
  and `main:presets.ts` is a working reference to port rather than invent.

**Recommendation: presets.** Reflection strength is an artistic parameter with no measurable truth (unlike
the wheel diameter in row A, where the data WAS the truth and the fudge was correctly deleted), and half the
mods ship 0.5 because it is the exporter's default, not a decision. This is also the shape the user asked
for at the top of the session: a thin format, one extensible interpretation layer.

### 3. Ambient occlusion for dynamic models — SHIPPED 2026-07-22

**Where it is computed is a user decision (2026-07-22): the shared BUILDER, never the converter.** Baking it
in opensa-pack would make a modloader car differ from a converted one; `buildVehicleModel` runs on both
paths, so the numbers agree by construction and the pack merely persists what the builder already produced.
The refused alternative is kept as a lever with its price in
[docs/performance/deferred-optimizations/vehicle-ao-baking.md](../../performance/deferred-optimizations/vehicle-ao-baking.md).

`vehicle/sky-occlusion.ts` — horizon mapping over a height field, not ray casting:

- the car is first put in its REST POSE. The buffers do not hold it: a wheel's vertices are wheel-local (a
  0.35 m blob about the origin) and a door's are hinge-local, because the part matrix places them at draw
  time. Skipping this step — which the first cut did — stacks four wheels inside the cabin, and they
  occluded it: the stock cars' seat surfaces read 55-110 of 255 with the wheels in there and 136-250 once
  they were placed. Mirrors `RigidEntity.flatten`: `T(t) x R(q) x S x offset`;
- the shown shell (`kind === 'body'` submeshes only) splats into a 32x32 "highest surface over this cell"
  grid; 8 azimuths x 8 cells of marching per vertex give the horizon angle, `1 - sin(horizon)` the sky left;
- **the normal weights each azimuth**, or the roof would darken the door skin under it. Measured on the mod
  admiral: the body paint submesh went 146 -> 199 mean (of 255) once weighting was in;
- the LOD and the `_dam` twins are excluded from CASTING (they still receive). This is the convertible case:
  a `_vlo` blob would roof an open car;
- the result rides in the NIGHT set's **alpha**, which the builder had been filling with a constant 255 — no
  new vertex buffer, no `.osm` version bump, no second upload. The shader carries it to the pixel in
  `local.w` (the struct was at 15 of the 16 inter-stage locations, so a 16th was not available).

Measured, mod admiral (91 746 verts): exhaust group mean **121**/255, pedals 43, seats 60-70, body paint
199, roof 255. Cost `skyOcclusion` 64-76 ms on that car, 3-4 ms on stock cars (3.8-4.7 k verts) — the
converted path pays it offline, a modloader car once at spawn.

Convertibles work by construction: no roof geometry means nothing to cast, which the unit test pins with a
roof excluded from the shell. Field-checked in the lab on the **feltzer** — its open cabin reads lit, its
footwell dark. A coarse spot-check of upward-facing seat-height surfaces across body styles lands between 73
(bfinject, a buggy seat deep in its frame) and 250 (stallion, roofless), with the closed admiral at 136; the
probe is too crude to rank the middle of that range, which is why the rendered check is the one that counts.

Still open in this row: contact shadow with the ground (nothing here darkens the ground under a car), and
peds (row 5).

### 3b. Tyres must never reflect — SHIPPED 2026-07-22

Rubber does not shine, and SA says so where it can: its own tyre materials carry an env map with a
coefficient of 0, the "not reflective" marker. Mods do not — their exporter stamps the reflection plugin on
everything — and row 2 above made untextured materials with that plugin reflective, which would have put a
gloss on three stock cars' rubber (`vincent`, `willard`, `rctiger`: an untextured black material at the tyre
radius carrying `reflection` 0.2–0.5).

`vehicle/wheel-tyre.ts` finds the tyre by GEOMETRY, per the standing no-name-matching rule. A wheel is a disc
about its axle (X in wheel space), and the tyre is its outer band. Measured across stock and mod cars:

| part | mean radius (share of the wheel's max) |
| ---- | -------------------------------------- |
| tyre | 0.87 · 0.89 · 0.90 · 0.90 · 0.96 · 0.98 |
| rim  | 0.18 · 0.32 · 0.48 · 0.53 · 0.54 · 0.70 |

Nothing lands between, so the cut is `mean ≥ 0.8` plus `outer ≥ 0.9` (a hub cap with a long spoke reaches
the rim but its mass does not). A tyre is forced matte — reflect zeroed, so no env and no specular — and the
rim keeps what the DFF authored (mod admiral's rim stays chrome at coefficient 128, the comet's paint at
128). Coverage: **180 of 215** stock vehicles have a separable tyre; the other 35 are boats, aircraft, RC and
a few cars with one material over the whole wheel — "no tyre" is a supported answer, not a failure.

The submesh carries a `tyre` flag so the damageable-tyre work can find it without re-deriving any of this.

**The model the user actually saw glinting** is a fixture we already ship: `fixtures/custom/dff/vehicle/
petro-6wheels.dff`. All six of its wheels author the TYRE with a full env map (`xvehicleenv128`,
coefficient 1.0) plus specular 0.05, so its rubber was as reflective as chrome — measured through the
builder, tyre submeshes went from `paint / coefficient 255 / specular 13` to `matte / 0 / 0`, while the rim
beside them stayed `paint / 255 / 13`. It is now a regression test on that file. (The two mod cars in the
field pak were NOT this case: their tyres were already matte, and what looked like a glint there was the
over-bright indirect term rows 1/3 fixed.)

### 4. Performance — CLOSED 2026-07-21, and it was never a vehicle row

Opened as "37 fps at night". The answer: **mod vegetation swapped in by the pmb `trees` stage**, 73 % of it
placed by a single mod ("39. Green Piece 1.47", since deleted). Removing it took ganton-noon from 13.72 to
7.63 ms of GPU pass, 53 → 82 fps. Nothing here belongs to vehicle appearance. Full analysis, asset audit
and the parked remedies: [`docs/benchmarks/opensa-engine/2026-07-21-layer-decomposition.md`](../../benchmarks/opensa-engine/2026-07-21-layer-decomposition.md)
(benchmark rows #21/#22). The history below is kept only to explain why the first attempt produced nothing.

**The first investigation was WITHDRAWN (2026-07-20).**

Every measurement it rested on was taken through the folder picker, and the folder picker does not select
the world: `engine-canvas-host.tsx:264` always fetches the pak from `public/pak-map`. No run measured the
pak it was labelled with, so the bisect, the "it is the improved map" conclusion, the street-level numbers
and the `?scale=0.75` decomposition all measured an unknown world. The datasets are deleted from
`docs/benchmarks/`.

What survived: the `ganton-noon` / `ganton-night` scenes in `bench-scenes.ts` — street level was the right
instinct, and they are the scenes that later carried the answer. The pak source was fixed in plan 079, and
the clean re-measurement is the layer decomposition linked above.

### 5. Peds inherit row B's root

`vsPed` is documented "No prelit — peds are dynamically lit", i.e. the same flat indirect term with the same
consequences. Deliberately not fixed inside a vehicle round so the two verdicts stay separable; it belongs
to the ped-bug pass that follows this one.

## Ground rules

1. **Field verdict decides.** Nothing here has a correct value derivable from data except row A's wheel
   diameter, which is already done. Rows 1–3 end with the user looking at the game.
2. **One change per round.** Row B deliberately fixed shape and not level for this reason.
3. **Measurements into this doc** as each row lands (the standing rule), with the user's verdict quoted.

## 2026-07-23 — the night-speckle iteration (second AO fix)

Field, after the full rebuild: comet door smudges ± unchanged, admiral grew NEW dark speckles (bonnet by
the grille, a line along the door's window frame) — **visible only after ~20:00**, which convicts the AO
channel rather than clearing it: AO multiplies only indirect, and at night indirect is the whole lighting.
`4d8c03a` had killed the zero-weight class; two mechanisms remained in `sky-occlusion.ts`:

1. **The own-panel false wall** — a window-frame/sill vertex sits a few cm inset below its own panel's
   top, and the ADJACENT height-field cell holds that panel's top: the march read the door's own column
   as a wall. Fix: samples closer than 2 cell diagonals are the vertex's own panel (`NEAR_CLEAR_CELLS`);
   a cabin/wheel well is enclosed far wider and keeps its darkness from the rings beyond.
2. **Thin-ornament splats** — a bonnet star / wiper / aerial puts one towering `max z` into a cell and
   the handful of vertices whose march crosses it at close range go dark alone. Fix: a dark-only
   neighbour-median `despeckle` pass over the triangle adjacency (2 passes, slack 25).

Measured (`scripts/debug/dump-vehicle-ao.ts`, mods-src admiral + comet, before → after):
admiral bonnet below-100 **733 (13.6 %) → 0**, bump_front **307 (20.8 %) → 0**, bump_rear
**159 (12.3 %) → 0**, doors worst 41 → 60, chassis below-100 24.4 % → 11.1 %; comet bonnet
256 (8 %) → 24 (0.7 %), doors worst 42 → 65. Enclosures KEPT their dark: comet interior/seats stay
28–31 % below-100, wheel wells 7–13 %.

**Field-VERIFIED 2026-07-23** via the modloader overlay (the shared-builder property made the rebuild
unnecessary — the DFFs dropped into `modloader/` rebuilt at spawn with the new bake): user verdict —
"speckles gone, interior and wheel wells fine" (paraphrased). The next full pmb
rebuild bakes it into every `.osm`.
