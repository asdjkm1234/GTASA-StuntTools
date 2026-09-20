# Audit — the effect-distance leftovers, and plan 07 per target (2026-08-08, second session)

Nine commits, one small feature and two instruments. It closed plan 100's last open row, closed the last
three questions the [previous session's audit](plan-07-review-and-100-field-close.md) left, and took plan 07
from "three open decisions" to none — twice re-scoping a plan because a measurement or a scope call
contradicted it.

Records: [`docs/plans/100-2dfx-at-lod-range/04`](../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md),
[`docs/hacks/`](../hacks/README.md) (two entries, one rewritten and one new),
[`docs/roadmap/0.5.0/plans/07-lod-generators-extended/`](../roadmap/0.5.0/readme.md)
(01 sized, 02/03/04 rewritten).

## What it cost

| | Lines |
| --- | --- |
| Product code (`.ts`/`.tsx`, excluding tests) | +489 / −55 |
| Tests | +49 / −11 |
| Docs | +557 / −161 |
| Two new debug scripts (`fx-anchor-census.ts` 136, `procobj-species-floor.ts` 245) | +381 |
| **Total** | **+1095 / −227**, 29 files |

Test count 3883 → **3887** (+4); suite, tsc and lint clean throughout, and clean again at close. Wall clock
was dominated by field captures — nine headless runs of 35–60 s each plus their boots — and by one whole-map
collision build for the build-time sizing pass. **No rebuild was needed and none was taken.**

## What it bought

### 1. The dead slider is wired, as a scale rather than a replacement

`graphics.effects.drawDistance` was a debugger slider and a config field no code on the own engine read — a
plan-044 leftover where it had REPLACED each fx system's authored `cullDist`. Replacing is exactly what
[100/04](../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md) stopped doing, so wiring it back the
old way would have undone that step. It is now `drawDistanceScale`: a multiplier over the distance a system
*ships* with, applied last inside `fxDrawDistance`, default 1.

It rides in on `rebuild(scale)` rather than being read once at boot, because the dynamic lane's records are
baked at boot and a live knob has to re-install them. The emitter index handed to `createEmitter` is
deliberately NOT replaced — `DYNAMIC_SYSTEMS` is a fixed list, so re-baked records land at the same indices
and previously handed-out emitters keep spawning into the right system.

### 2. `?fx=N`, which is what made the rest of the session possible

The same knob as a URL parameter. Its real value is not tuning: **a tiny value culls every emitter, which is
the positive control a distance capture needs.** Without it a screenshot of a 2 cm sprite cannot distinguish
"the effect is there" from "those specks are texture noise". Every field verdict below rests on it.

### 3. The vehicle lane keeps its 300 u reach — as a LANE floor

All four `prt_*` systems author `cullDist` 50, so honouring the table in 100/04 cut the dynamic lane 300 → 50
and ended another car's tyre smoke 50 m away. Restored on the user's call, as a floor on the LANE
(`DYNAMIC_LANE_DRAW_DISTANCE`) rather than a fourth row of the departures table — so it covers whatever
`DYNAMIC_SYSTEMS` carries, a mod's additions included, instead of a name list that goes stale. Applied before
the scale, so `?fx` can still pull the lane back in.

The reasoning, recorded in [the hack](../hacks/vehicle-fx-lane-reach.md): SA's 50 guards effects it spawns
around the PLAYER; ours spawn for every vehicle in the world, so the premise behind the number is not shared.
**Still unverified in the field at 300** — the round that would settle it needs traffic followed at 60–150 m.

### 4. The insects floor, field-judged — and the verdict is that the number is inert

Plan 100's last open row. A/B at one spot, `?fx=1` against `?fx=0.02`, on the Santa Maria pier anchor
`388.9, −2071.6, 8.4`, approached along the pier so the sight line is proven by the near shots rather than
assumed:

| Camera distance | Insects detectable |
| --- | --- |
| ~9 m | **yes** — 6–8 isolated specks, reading as flies over rubbish |
| ~19 m | marginal — two faint dots at the limit of the diff |
| ~26 / ~34 / ~40 m | no |

The reason is in the authored data: `insects` authors `size 0.02` — a **2 cm** sprite, ~3 px at 9 m in a
2880-wide capture and under half a pixel at 100. SA's 15 u cull is an honest number for a swarm that small,
and the 100 u floor keeps 336 anchors alive across 75 u in which nothing can be seen. **Kept anyway**, because
dropping to 15 restores the pop it was raised for and 100/04's own A/B put the whole particle system under the
noise floor. Recorded as what it is — a departure that costs nothing and buys nothing above ~25 u.

**The generalisable half:** read `dump-fx-system <name>`'s SIZE before designing anything around a cull
distance. A distance is only meaningful for something the eye can hold at that distance.

### 5. Two instruments, and both immediately found something

- **`fx-anchor-census.ts`** — per-system anchor counts off a built pak, and *where to stand to see one*. The
  previous session burned two field rounds on emitters it had no coordinate for; the missing half was never
  the camera. Its counts also **disagree with plan 100's ledgers**: the pak carries **943** anchors, `insects`
  336, and `cigarette_smoke` **87** where the hack file said it had no placed anchor at all. The 878 came from
  an in-process bake count. Corrected wherever it appeared, with the source of each number named.
- **`procobj-species-floor.ts`** — the sizing task plan 07/01 asks for, through the shipping functions rather
  than a model of them.

### 6. Plan 07/01, sized — and the plan was looking at the wrong site

| Site | Species zeroed |
| --- | --- |
| the `lottery < 1` cut (rounding) | **0** |
| MINDIST | **0**, and it *cannot* — `cullByMinDistance` starts with an empty grid, so a non-empty batch always keeps its first placement |
| the global `procObjMax` cut | **0**, and on the real converted set it does not even fire (15 286 against 20 000) |
| **the RUNTIME cell cap** | **19.8 % of cells that scatter anything**, worst case 14 of 25 species placed |

So the plan's whole Context section described the build-time caps, and the defect is at the runtime one.
MINDIST is nonetheless where the population goes — `sjmcacti2` runs 485 candidates → 152 vanilla → **2**
map-wide — which is why a species is rare, and it is not a cap doing it.

**And on the shipping build the defect is latent, because of our own generator**: `convertProcObj` strips the
converted species from `procobj.dat`, leaving 8 underwater rules that share the 150 budget comfortably and
lose none. The plan is therefore not closed but **sequenced after [02](../../tools/sa-procobj-placement/docs/plans/010-density-model.md)**,
which is what brings the defect back.

### 7. Plan 07's 02/04 rewritten per target — twice

First per target (three of them), then narrowed to two when the user ruled stock SA out of scope. What the
second pass removed is larger than what the first added: **the slot economy `04` is named after**. With
`EntityIpl` and `EntitiesPerIpl` `unlimited` on the declared install, slots and the 4 096-row per-area buffer
are not currencies, the 1.18× ceiling is void, and two tasks (packing areas, costing the base map's slots)
went with them. **int16 is the only correctness ceiling left, and no adjuster lifts it** — it is ours.

Three things the split added that nobody had written down:

1. `checkTextIplSlotBudget` runs on the **common baked build**, before the `sa/`/`opensa/` split, so an
   opensa-only build is refused past 30 000 permanent text rows by a ceiling its engine does not have. Its
   sibling `checkImgIdBudgets` fails the opposite way. Now a
   [restriction](../restrictions/sa-target.md) — and the enforcement half is the worse one, because the build
   SUCCEEDS and just carries less.
2. Dropping stock makes an adjuster a **dependency**: the installer has never checked for OLA, only for our
   asi.
3. `AREA_MAX_PAIRS = 2000` is now a number without an owner — it was sized for a buffer that no longer binds,
   so what area size STREAMING wants is an open measurement rather than a ceiling artefact.

## What it got wrong

1. **I read pak particle positions as world-space.** They are LOCAL to the cell origin. The census printed
   perfectly plausible GTA coordinates up to 3 km from the truth, and only the self-check caught it — 934 of
   943 anchors outside the cell they were read from. Had I not written the check, the field round would have
   been spent staring at empty street corners and I would have concluded the emitters were missing.
2. **My first cap identity was wrong, and it accused the engine.** The self-check flagged one cell where
   "drawn ≠ the budget"; the engine was right. A cell can hold more than `limit` candidates and still have
   its 150th lottery above the density — then density is the cutoff and the cap costs nothing. The rig had
   modelled "cap is finite" as "cap binds".
3. **I gave the wrong reason for the stock wall and had to be pushed on it.** I wrote that a category knob
   displaces past the global cut; the actual mechanism is that an area's text rows and its binary streams
   share one 4 096-slot buffer, so an area holds ~2 000 of our objects and stock has one free slot. The
   conclusion survived, the argument did not — and the user was right to ask for the arithmetic.
4. **A `cd docs` persisted into the next tool call** and silently broke a command chain (the known trap,
   walked into anyway).
5. **The first per-target rewrite invented a target we do not ship to.** `sa-stock` got a profile, a wall and
   two tasks before anyone asked whether we run there. The scope was one question away in
   `docs/gta-sa-original/`, which is the folder that exists to stop exactly this.

## What the guards did

- **Two census self-checks earned their keep the same day they were written** — see "what it got wrong" 1
  and 2. Both were cheap (one comparison per row) and both fired on the first run.
- **eslint's cognitive-complexity rule** rejected the `?fx` wiring inline and forced
  `applyGraphicsParams` — which is where the other three URL graphics knobs belonged anyway.
- **Mutation checks on all four new tests**: a defaulted scale of 2 fails 6 tests, a leaked lane floor fails
  4. The dynamic-lane and re-bake tests were each checked by reverting their own line.
- **`--include="*.ts"`-style rig doubt paid off twice**, which is the previous audit's lesson 15 arriving on
  schedule rather than a new one.

## Not done, and why

- **No benchmark, and none was owed.** The session produced no performance figure: the field work was a LOOK
  verdict and the sizing work was a COUNT. 100/04's existing A/B — which found the particle system below the
  noise floor with a positive control — is still the operative number for the effect-distance changes, and
  raising a cull distance on 336 anchors of a sub-pixel sprite is not a measurable cost. Recorded here rather
  than left as an absence, per the standing rule.
- **The `prt_*` lane at 300 u has no field verdict** (see 3 above). It needs traffic, not a rebuild.
- **`drawDistanceScale`'s DEBUGGER path is untested** — `?fx` is field-proven and the bake is unit-tested, but
  nothing exercises `setEffects({ drawDistanceScale })` → `rebuild` → new records. The seam is one
  `Object.assign`, which is why it was not worth a test that would re-implement it; naming it is the honest
  alternative.
