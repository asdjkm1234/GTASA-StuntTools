# The procobj chain closed, and the three plans that were wrong about the world

**2026-08-11.** Thirteen commits, `5a4ba620..17ed5d59`. All seven backlog bands (P0–P7) closed, plus plan 010's
last task and `asi/perfect-map` 006. What changed, what it cost, what it bought — and the pattern that runs
through it, because that is the part worth carrying forward.

## The pattern: `procobj.dat` is a finished design, not raw material

**Three of the tasks were built on a premise that the measurement destroyed, and a fourth returned a null its
own plan had allowed for.** They were written months apart by different reasoning, and they failed the same
way: each assumed the original's data was something we had to correct or complete.

| Plan | Its premise | What the measurement said |
| --- | --- | --- |
| 012 (species floor) | "latent — the generator strips the species, only 8 underwater rules reach runtime" | **False since 2026-08-10.** The bake left the `opensa` branch, so all 95 rules ship and 17.7 % of clutter cells lose a species on what we run |
| 010 task 8 (density profile) | "a profile has to EARN the reference's hand-authored skew" | The authored data lands on it unaided — **our top-2 species of 56 are 42.0 %, the reference's 40 % of 46** |
| 011 (biome density) | "the scatter has no notion of WHERE" | It has one: **the surface IS the biome.** 12 of 14 rule-bearing surfaces sit ≥90 % in one region, carrying that region's species |
| `sa-lod-generator` 008 (emitter budget) | "the far-view carry needs a thinning table" | The whole map peaks at **46 live emitters**; thinning 46 quads is not a budget action |

**The lesson, and it is new:** a plan's VERDICT expires when the pipeline it was measured on changes shape,
and nothing re-reads it. 012 closed twice as "latent" on a fact that stopped being true the day the bake
moved. Sibling of the older lesson about a written-down BUDGET invalidated by a change of scale — one level
up, on a conclusion. **After a shape change, list the plans whose verdict rests on the old shape.**

## What shipped

**Both targets guarantee a patch of ground shows its whole species roster** (`60f3a987`, ON by default).
The two halves need DIFFERENT gates and that is forced, not chosen: on `opensa` a budget cap zeroes a species
and there is a budget to pay from, so the floor SWAPS a placement; on `sa` nothing caps anything
(`procObjMax` 100 000 vs 91 379), the killer is the density lottery, so it must ADD. Cost: 0.32 % of drawn
placements and **no measurable frame time** on `opensa` (4 legs, 2 per side); **+312 objects (+0.34 %)** on `sa`.

**`procObjCellBudget` became the single per-cell decision** (`5a4ba620`). Density knobs × cap × floor → one
keep-count per batch, spent by both the render path and the collider path — so "collision is exactly the
rendered set" stopped being a rule two call sites had to apply identically. `procObjColliders` no longer
computes a cutoff at all.

**The shipped density profile is `base: 1`, as a RESULT** (`90140a76`). At the authored cutoff the layer
places 1.58× the field-accepted reference AND reproduces its skew. `density-target.md` was re-derived off the
rebuilt layer, as it had been asking since 2026-08-09.

**The slope gate** (`d24f214e`, neutral by default) — the one task plan 011 survives with, for both targets
from one place. Slope is a per-FACE fact and both selection paths cut per BATCH, so it can only live in the
shared scatter. `2,0.5` nets +14.1 % rock objects for +1.05 % of the layer.

**The original's in-triangle sampler** (`2f8b7bb4`, `area` still default) — and the finding is that `corner`
IS the original rather than an approximation: expand the recovered routine into barycentric weights and it is
our own formula, with `o1 = rand()` where ours has `o1 = sqrt(rand())`. **The whole difference is one `sqrt`.**

**A build states the install it needs, and then ships it** (`f5ef8623`, `17ed5d59`). The honest replacement
for the int16 throw deleted on 2026-08-09: rather than shaping output down to an install we do not ship to,
the `sa` run names every stock ceiling it crosses with the setting that lifts each, and `shipPerfectMapAsi`
copies `perfect-map.asi` into the built game root with its sha256 in the manifest. **Stating a requirement and
not meeting it was half a job.**

## What it cost

- **Nothing measurable in frame time.** The roster floor: `avgDrawCalls` 821 in all four legs, triangles
  +0.002 % against a 0.011 % same-side spread. Recorded with its own gap — no positive control ran in that
  lane, so it supports "no cost", not "an effect was present and still cost nothing".
- **+312 objects on `sa`** (91 067 → 91 379), 10 of 40 IPL slots unmoved, `procObjMax` still clear.
- Two knobs left neutral by default (slope multipliers, `corner` sampler) because what they change is a LOOK.

## What it bought

- A defect live on the shipped build — 17.7 % of clutter cells losing a species — removed, and **demonstrated**
  rather than only counted: the `sand_josh2` the cap zeroed stands in the floored frame and is absent without
  it, 1.00 % of the frame against a 9.81 % positive control.
- Four plans closed on evidence instead of on effort: three that were wrong, one null.
- The `sa` build's dependency on our asi made true by construction instead of by memory.

## Instrument work, and two rig failures worth more than their runs

`fx-anchor-census.ts --worst` (the map's worst emitter viewpoint, recomputed from the pak),
`procobj-biome-vs-surface.ts` (new — it re-scoped plan 011), and the species census now measures **through the
engine's own budget function** rather than reproducing it by hand.

**Two A/Bs were invalidated by their own instrument, and catching that is the result.**

1. **The census's worst cell was a DEAD site.** Four frames at `8,-3` showed nothing — and so did
   `?procobj=0` vs `?procobj=3` there, because the layer barely draws under those redwoods. *Most species
   LOST is not most clutter DRAWN.* The A/B moved to a desert cell where the control passed at 9.81 %.
2. **On a slope the spawned player SLIDES**, so no two arms share a viewpoint. Three different comparisons
   returned **86.81 / 86.82 / 86.83 %** changed pixels with identical mean Δ — near-identical diffs across
   DIFFERENT comparisons is the tell; a real effect never lands three times on the same number.

## Bookkeeping

Every commit carries its docs. Features, edge-cases, query-parameters, commands, the debug README, the
performance lever list (`procobj-species-roster-floor.md` — the cost taken deliberately, and what giving it
back would buy), one benchmark row with its index entry, and the architecture doc for the `sa` branch's new
outputs. Tests: 11 slope cases, 7 sampler cases, 9 roster-floor cases on each target, 4 install-requirement
cases, 3 asi-shipping cases. **3365 tests green at the close.**

Four tasks were STRUCK rather than done, all for outliving plan 014: rows-per-object cannot be a knob (it is
1.000 by construction), `linkedHeight` does not exist, there is no streaming for an area size to be tuned
against, and target-gating `procObjMax` would switch between two identical answers.

## What is left

Not a band: **his eye** on two look knobs, a **stale `build/original/sa`** (2026-08-10 16:44 — it predates the
roster floor, the slope gate and the sampler, so none of them exist in the real game yet), the **Wine
end-to-end** for the asi we now ship, and five recorded debts (the seven draw distances as judged constants,
`trianglesRecorded` blind to the fill saving, density unmeasured above ×3, no streaming-shaped hitch ever
sampled, `p_grassmid1` as the one live biome case).
