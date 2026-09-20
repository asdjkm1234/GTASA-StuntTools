# Audit — the clutter budget answered, and a knob nobody had connected (2026-08-10, late)

Commits `be4306a3..49c2eb11`. The session was asked for backlog band **P1** (the `opensa` clutter perf budget)
and then band **P2** (the per-category draw distances). P1 came back with an answer nobody had to act on; P2
came back with a defect that had been shipping since plan 042. **I also published one wrong mechanism and had
to correct it after it was committed** — that is the part of this audit worth reading twice.

## What was asked, and what it turned into

- **P1** — "measure how much clutter the engine streams without hitching, and set `procObjMax`, the candidate
  ceiling and `procObjLimit` from it." It turned into: *there is no such number, and here is why the question
  does not bind.*
- **P2** — "the plumbing exists since plan 042 with live sliders; only the VALUES are open." It turned into:
  *the plumbing did not exist, the values were dead config, and the slider had never moved the world.*

Both premises came from the backlog. Both were wrong in the same direction — a plan describing what it
believed the code did.

## P1 — the measurement, and what it actually found

15 single-scene `country-dusk` sweeps, two lanes, an A/A control in each
([the ladder](../benchmarks/opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json)).

**The positive control mattered more than the ladder.** `?procobj=0` moved triangles **−2.72 %** against an
A/A drift of **0.007 %**. The same arm on the 08-09 pak had moved 0.007 % — because the bake had stripped
`procobj.dat` to 9 underwater rules. Same code, same scene, same harness; only the pak changed. That closes
the 08-10 null result as a SITE failure exactly as it had been diagnosed, which is a diagnosis paying off
rather than a new finding.

**The answer:** at 3× vanilla density the whole layer is +10.11 % of the clutter scene's triangles and still
costs less than one sweep's A/A drift on every column available, with no hitch signal at any setting
(`maxMs` 9.7–36.0 with *no* relation to load — the heaviest arm is the quietest). So the budget cannot be read
off a hitch measurement, because the layer cannot be pushed into one.

**Second deliverable, cheap and useful:** `UNCAPPED=1` works and retires the "this needs the user's display"
half of the task (`avgMs` 8.33 → 5.4–5.6, `p95Ms` 9.1 → 6.7–7.2) — **but it destroys the hitch block**,
148–196 ms `maxMs` in every arm including clutter-off. Capped for hitching, uncapped for cost, never mixed.
That is now in `docs/development/benchmarks.md` beside the column it applies to.

### The mistake, and it was committed before it was caught

I wrote that both knobs saturate "against the authored `procobj.dat` MINDIST spacing". Wrong twice:

1. **MINDIST has been consumed by nothing since plan 009** — it is an anti-pop-in radius in the original, and
   the density column is SPACING.
2. **The density ceiling is not the data's at all.** `scatterProcObjects` generates
   `area / spacing² × PROC_OBJ_MAX_DENSITY` candidates with a lottery uniform in `[0, PROC_OBJ_MAX_DENSITY)`,
   the renderer keeps `lottery < density`, and the runtime adapter takes the default **3**
   (`gta-sa-world.adapter.ts:632`, no argument). A cutoff of 3 or more keeps every candidate.

The numbers had been saying so all along and I had not divided them: clutter triangles over the clutter-off
baseline run **1 : 2.08 : 3.13 : 3.14 : 3.14** for ×1/×2/×4/×8/×16 — linear in the cutoff, flat at 3. I read
the *shape* of the curve (two knobs, both flat) and inferred one cause, instead of opening the function that
generates the thing being rationed.

**What it cost:** one commit published with a wrong mechanism, corrected in `5206833d` about twenty minutes
later, before anything was built on it. **What it changes:** the practical conclusion moved in our favour —
"+10.11 % is the layer's whole span" became "the layer at 3× vanilla, with a raisable constant above it".
**The rule it earned:** a saturating ladder proves a limiter ran out; naming WHICH one requires reading the
code, not the curve.

A scope error of the same family rode along: `procObjLimit` 150 → 300 is "+0.41 %" of the scene and **13.0 %
of the layer being tuned** (4 923 of 37 775 triangles). Published the first way, corrected to both.

## P2 — the knob that was never connected

`graphics.procobj[*].drawDistance` had a typed config, a debug slider, a setter and a unit test — and **no
reader anywhere in the repo**. Clutter was drawn for every instance of every loaded cell; the cells came from
`streaming.collisionDrawDistance` (150); a cell is 256 units. So the real reach was cell-shaped and depended
on where in the cell the camera stood — up to ~360 units at a corner — and the seven values (50–150) described
a behaviour the engine did not have.

One repo-wide grep for the READ falsified the plan's premise. Everything that made the knob look wired sat
downstream of the write.

**What shipped** (`dd832c68`):

- the range rides per group (`CellClutter.drawDistance`; `CellClutterRender` gained `category`, because a cell's
  clutter is split by model×SURFACE and the category follows the surface);
- applied **per instance** in `vsClutter` — a group spans a whole 256-unit cell, so a group-wide test cannot
  express 100 at all;
- a group entirely out of range is skipped on the CPU too, so it pays no vertex work and leaves the triangle
  count;
- the streaming ring becomes `clutterRingRadius` — the widest ENABLED category — because a category cannot draw
  past the radius its cell is loaded at;
- **colliders deliberately stay on the collision ring.** Render and collision still share one scatter and one
  budget, so they can never disagree about WHICH objects exist — only about how far out bodies are built.

**The values** (the user's rule: own distance per type, large 300, small 100, never below 100): grass, flowers
and underwater 100 · bushes 150 · rocks 200 · cacti and trees 300. SA draws all procedural clutter at a flat
`PLANTS_MAX_DISTANCE = 100`, so that is the **floor, not the target**; 300 is what the `sa` target already
shows, so the two stop disagreeing about one world.

## What it cost, and what it bought

| | |
| --- | --- |
| **Cost — build** | one bind-group binding (16 bytes of uniform per clutter draw, tens of draws), one branch in the clutter vertex shader, one CPU sphere test per group per frame |
| **Cost — content** | grass/flowers/underwater now stop at 100 where the cell-shaped reach could carry them to ~360; that is a deliberate reduction at range |
| **Cost — measurement** | `trianglesRecorded` is now blind to the fill saving for any group the camera stands inside (recorded in `edge-cases/engine-rendering.md`) |
| **Bought — determinism** | the range no longer depends on where in a 256-unit cell the camera stands |
| **Bought — reach** | trees and cacti to 300 instead of a cell-shaped ~150–360, matching what `sa` shows |
| **Bought — a live knob** | the debug sliders and `?procobjRange` now move the world, so the look is one number to revisit |
| **Bought — a closed band** | P1 and P2 both answered; four items that waited on P1 lose their gate |

**Measured**: monotone over 100 / 150 / per-category / 300 against a **0.020 %** A/A control (draws identical);
a **4× lever in layer terms** (9 110 → 36 191 triangles) reading as +2.3 % of the scene; and **free** —
`gpuMs.pass` spans 1.7 %, inside its own drift, every hitch column flat
([the ranges](../benchmarks/opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json)).

## What is NOT covered, said plainly

- **One scene, camera flights, n=1 per arm.** A streaming-shaped hitch under continuous movement is sampled by
  no arm in either capture, and the three streaming columns read 0 everywhere — that pressure never arose.
- **No capture behind the look.** Three headless screenshot attempts failed to find a clutter vista (a town
  street, a rooftop, one spawn past the map edge that fell into the void). The verdict is the user's, given in
  the field, and it is recorded as such in `docs/hacks/`.
- **The cost of raising `PROC_OBJ_MAX_DENSITY` is unmeasured** — every arm above ×3 measured the same world.
- **The ranges do not derive from the asset.** The category is a property of the surface rule, not of the
  model, so a mod scattering something small under a cactus rule inherits 300 units. Recorded as a hack with
  what retires it (bounds are already in hand at upload time).

## Docs and tests this left behind

**Docs**: two benchmark captures + two index sections · `features/procobj.md` (the range, and its two stale
sections corrected) · `development/benchmarks.md` (the lane rule) · `development/query-parameters.md` (the
three procobj params, none of which had been listed) · `commands.md` (the A/B row) ·
`edge-cases/engine-rendering.md` (the counter's blindness) · `edge-cases/physics-runtime.md` (clutter you can
see has no collision until 150) · `hacks/clutter-category-draw-distances.md` + its README row ·
`sa-procobj-placement/013` (P1's answer) · `OPENSA_BUDGET_NOTICE` (it had promised a measurement since taken).

**Tests**: `engine.clutter-range.test.ts` (5, on the fake GPU device — the group skip, the triangle count, the
squared uniform, and two groups in one cell keeping their own ranges) · `engine-clutter.test.ts` (3, the ring
is the widest ENABLED category) · `engine-debug-actions` (the slider now reloads; the old negative test pinned
the dead behaviour and was flipped) · one added assertion on the budget notice. **Every new assertion was run
against its reverted change** — 4 of the 5 engine tests fail without the feature, and the fifth is the control
proving the instrument can print a draw at all.
