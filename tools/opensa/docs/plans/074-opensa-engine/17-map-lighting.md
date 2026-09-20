# 17 — Map lighting: broken normals, 2dfx lamps, and a frame-time regression

**Status: DEFERRED to the next iteration (user decision 2026-07-17) — NOT a pre-flip blocker.** The
whole lamp-lighting question moves to the post-flip graphics round (the
[0.6.0/04-graphic-improvements](../../roadmap/0.6.0/plans/04-graphic-improvements/readme.md) DRAFT bundle:
directional shadows + HD-cell lamps + contact darkening, one thinking round). The current shipped state
(coronas + emissives, NO static lamp pool — removed 2026-07-17) is the accepted flip baseline.

**Pre-2026-07-17 history: OPEN — deliberately.** Round 1 was attempted on 2026-07-14 and FULLY REVERTED
(code back to `9a9d156`, pak reconverted). Nothing here shipped. Read the whole file before touching map
lighting again — the measurements stand, and the failed attempts are the point of the document.

**2026-07-15 update — both symptoms are now EXPLAINED; the user chose to keep the bug open while a bigger
architecture decision is thought through** (see [concept/hd-realtime-lod-baked.md](concept/hd-realtime-lod-baked.md),
which carries the full Ten Green Bottles diagnosis):

- **Symptom 1 (polygon patches): RESOLVED BY DATA.** The engine was benched on the UNCONDITIONED vanilla map;
  feeding a map-optimizer build (smooth-group normals) removes the patches. Prod was "clean on the same data"
  because the data was NOT the same. Durability work = map-optimizer plans 020–023 + opensa-pack plan 001
  (missing-normals guard).
- **Symptom 2 (2dfx neon range): DIAGNOSED, open.** Four distance states of Ten Green Bottles = corona
  farClip floor 350 (far glow) · camera-ranged pool paints near · hard `LIGHT_POOL_REACH=130` cut (fade-out)
  · unsorted `cells.all()` pool fill, cap 64 (side asymmetry). Open question №1 (why is prod clean) is
  ANSWERED for this symptom: prod's `street-light.system.ts` has nearest-sort + hysteresis, range fade
  0.72×90→90 u, ~0.4 s per-slot temporal ramp, and corona↔pool handover — we have none of the four.
- **Tail owed regardless of the architecture decision:** the game host must restore AUTHORED corona farClip
  (the 350 floor is a lab-camera accommodation — 06 row 13's "game integration restores the authored clip"
  was never done).

Owner step in the ladder: **B6.5**, between B6 (2dfx particles, done) and B7 (destruction/animation objects).
The user has scoped **normal cleanup as its own later plan** — this one must first explain the delta with prod.

**2026-07-17 update — static 2dfx lamps REMOVED from the light pool entirely (user decision).** The
binary pool admission (100 u reach + nearest-24 cap, no fade, no hysteresis) read in the field as "lamps
igniting ahead of the driving car", and the interim tuning knobs were not worth more rounds. Current
state: the pool carries HOST DYNAMICS only (head/brake lights — untouched, per-pixel); the corona pass
still draws every lamp's glow, night windows keep their emissive. Symptom 2's machinery is therefore
GONE rather than fixed — when this plan executes, lamp SURFACE lighting starts from zero, and the redesign
must include prod's four missing pieces (nearest-sort + hysteresis + range fade + per-slot temporal ramp)
or go the baked route (plan 15 for LOD, possibly HD too per the hd-realtime concept). Two measured data
points from the removal, and they point OPPOSITE ways — reconcile them when this plan executes:

- headless 2×, standing at the Ganton spawn: night GPU pass 2.9–3.8 → 1.4 ms — the static pool looked
  like the biggest night line item;
- **the user's real display, free roam: fps did NOT noticeably change** — so on the real machine the
  night bottleneck sits elsewhere (per-pixel dynamics / bloom / coronas / something unprofiled), and the
  per-vertex static pool was comparatively cheap there.

**User's conclusion for the redesign (2026-07-17, information only — nothing scheduled): the budget
likely exists to light ALL lamps of the loaded HD cells at once** (no reach, no cap, no admission → no
ignition pops by construction), instead of the 24-nearest scheme. If the redesign takes that route it
still wants the per-slot ramp for dusk, and it must be verified on the REAL display (the headless-1×/2×
A/B under-reports per-vertex world costs — the same lesson the rolled-back SSR taught for per-pixel).

---

## 1. The symptoms (field, `?engine=opensa`)

1. **Polygon-shaped bright/dark patches across the map, day and night.** A driveway or pavement is split into
   hard-edged light and dark quads that follow the geometry, not the sun. Worst at night, but plainly visible
   at noon too.
2. **A 2dfx neon sign lights its building only at point-blank range.** Ten Green Bottles: the green wash
   appears when the car is right at the façade and snaps off a metre later — "as if the light unloaded".
   The user's requirement: the glow must be on for as long as the building is drawn in HD.
3. **PROD RENDERS THE SAME MAP WITH NONE OF THIS.** Same DFFs, same `prepare-clump` normals, same install.
   This is the fact that must be explained before anything is "fixed".

---

## 2. What we measured (real numbers — do not re-derive)

Over a clean `game-src/original/models/gta3.img`:

| Fact                                                                        | Number                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Map models shipping **no vertex normals at all**                            | **12 004 of 12 964 (92.6 %)**                             |
| Their vertices whose computed face normals **cancel to zero**               | **305 771 (5.7 %)**, across **21 %** of models            |
| Models with stored normals, all unit-length, none degenerate                | 960 (so the plan-037 guard almost never fires)            |
| 2dfx lights in gta3.img                                                     | 1 038                                                     |
| Their **authored** point-light range                                        | 0–55 m, median 18                                         |
| Lights with range **0** — they illuminate NOTHING in SA, corona sprite only | **14 %**                                                  |
| Lights where the engine's fabricated `max(14, size × 8)` is off by >10 m    | **39 %** (worst: a casino sign authored at 5 m gets 72 m) |

Consequences:

- SA's `CCustomBuildingDNPipeline` never reads vertex normals, which is _why_ Rockstar ships none. Every
  normal we light the map with, for 92.6 % of it, is **invented by us** from geometry that is two-sided
  patchwork. Where coplanar mirrored faces cancel, `sanitizeDegenerateNormals` substitutes an arbitrary
  incident face — sometimes pointing DOWN.
- The DFF light parser throws the authored range away: `packages/renderware/src/parsers/binary/dff.ts`,
  `stream.f32(); // point-light range (unused for now)`.
- **DISPROVEN:** the engine's old global 130 m light cull was never the culprit — no SA light reaches past 55 m.

---

## 3. What was tried, and why each was reverted

| Attempt                                                                                     | Result                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------ |
| Shade the static 2dfx lamps **per pixel** (what the three path does)                        | It **does** fix the polygon-shaped patches — and cost **120 fps → 25** on an M3 Pro.                                                                                |
| Cull/rank lamps by their **authored range**                                                 | Made the neon _worse_. See below.                                                                                                                                   |
| Ship **invented normals as untrusted** (short, so the engine's `step(0.25,                  | n                                                                                                                                                                   | ²)` guard gives a flat sun response) | Did not fix the patches. |
| Wire the shared `sunSplit()` into `engine-environment-driver` instead of its ad-hoc formula | Correct in principle (prod holds indirect at 1.0 at night; ours dropped it to 0.4, leaving normal-driven terms to carry the look) but changed nothing in the field. |

**The per-pixel cost, precisely.** `LIGHT_POOL_CAP` is **64**, and the WGSL loop in `localLightRange` runs every
slot on every fragment. Prod affords per-pixel lighting because **its pool is 12**. The approach was copied
without copying the budget. A retry must shrink the pool FIRST and measure the frame, not ship the shading and
hope.

**Range and per-vertex do not compose.** With static lamps shaded per VERTEX, a façade's few corner vertices
must fall inside the light or the wall stays dark. SA's authored 18 m range never reaches them — so the old,
badly over-large fabricated radius (`size × 8`) was **accidentally load-bearing**. Fixing the radius alone
makes the sign dimmer, not better. The two changes are a package: authored range **requires** per-pixel.

---

## 4. Open problems

1. **THE CORE QUESTION — why is prod clean?** Same map, same DFFs, and (as far as was checked) the same
   normals out of `prepare-clump`, yet no patches. Find the actual divergence — compare the two shading paths
   term by term with real numbers from one identical vertex, rather than reading the shaders and reasoning.
   Candidates not yet ruled out: which pipeline mix prod actually runs at (`uPipelineMix`), the world tint,
   whether prod's instanced map path really uploads the computed normals, SSAO, the CSM shadow term.
2. ~~**Frame time: 120 → 90 fps.**~~ **CLOSED 2026-07-14 — not a code regression.** The user bisected
   `33c74c9` (vehicles), `936e897` (reflections) and `a0a4919` (HEAD, the full revert) after rebuilding the
   map: **120 fps on all of them.** `a0a4919` contains only docs and the spawn coordinate — no code at all —
   so the 90 fps reading was taken against the PAK left on disk by the reverted experiment (short normals,
   `.oscell` minor 3), not against any shipped change. B5 and B6 did NOT regress the frame time.
   LESSON: **the pak is part of the build.** When a perf number moves, reconvert before blaming a commit — and
   when reverting converter/format work, reconverting is not optional cleanup, it is the revert.
3. **The 2dfx light model itself.** Even done right, a point light is probably the wrong primitive: in SA the
   building reads as lit from far away because of its **night prelit vertex colours** (emissive) plus the
   corona sprite — not because a dynamic light reaches it. Check what carries the look before adding lights.
4. **Normal cleanup** — the user's own later plan. Do not fold it in here.

---

## 5. Rules for the retry

- Measure the frame time on **every** shading change, before showing it. The loop bound IS the budget.
- Explain prod's behaviour before changing ours. Three rounds were spent treating symptoms.
- Land the pool size, the authored range, and per-pixel shading **together or not at all**.
