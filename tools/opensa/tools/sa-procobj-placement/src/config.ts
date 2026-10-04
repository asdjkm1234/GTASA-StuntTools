import type { ProcObjDensityInput } from '@opensa/map-placement/procobj-density';
import type { ProcObjSampler, ProcObjSlopeConfig } from '@opensa/renderware/map/procobj-scatter';

/** Build knobs for the procobj placement bake (overridable via CLI flags). */
export interface ProcObjLodConfig {
  /** Build-time scatter density CUTOFF — **1 = vanilla**, up to the scatter's candidate ceiling
   *  (`PROC_OBJ_MAX_DENSITY` = 3; a higher cutoff has no candidates left to keep and is refused). The count
   *  scales with it until {@link ProcObjLodConfig.procObjMax} binds instead.
   *
   *  A plain number is the whole map. A `ProcObjDensityConfig` sets it per CATEGORY and per
   *  category×SURFACE — plan 010's density model, and the shape a shipped profile takes. **It is not keyed by
   *  target**: `sa` and `opensa` get the same density (decision 2), and what the target picks is caps and
   *  reporting. Every profile is priced by 013's perf budget before it ships; until that number exists the
   *  default stays 1. */
  density: ProcObjDensityInput;
  /** Draw distance (world units) written onto the baked species' rows in the STOCK
   *  `data/maps/generic/procobj.ide` — since plan 014 this is the layer's ONLY range mechanism: nothing is
   *  streamed (a stream's IPL slot is not resident past ~190 m) and nothing has a LOD any more.
   *
   *  **MUST stay BELOW 300**: SA classifies defs at drawDistance ≥ 300 (the FLA-configurable "LOD distance") as
   *  big buildings, and MASS text-IPL instances of such defs overflow that path's internal structures —
   *  corrupted CIplStore state streamed into script-gated IPLs (the "ghost barriers2 roadblocks" bug, isolated
   *  by in-game bisection 2026-07-06: 300 reproduces, 250 is clean). 299 is ProperFixes' value, deliberately one
   *  metre under, and the one their 57 583-row layer is measured running. Stock declares these species at 59. */
  drawDistance: number;
  /** Optional min HD height (m) gate — drops short clutter (grass) from conversion. 0 = off. */
  procObjHeight: number;
  /** Cap on statically converted procobj objects (0 disables the conversion). It is OUR safety cap, not a
   *  target ceiling: once it binds, the lowest-lottery cut is global, so raising one category displaces the
   *  others instead of adding to them (07/02 decision 8). Keep it clear of the authored count — a build that
   *  is capped is measuring the cap. `CAP DROPPED n` says when it bit. */
  procObjMax: number;
  /** Where inside a collision triangle a placement lands. **`area` (ours) is the default and it is a
   *  DELIBERATE departure**: `corner` is the original's recovered routine, which pulls toward whichever vertex
   *  the COL lists first (mean barycentric weight 0.5 against an area-uniform 1/3). That bias is a property of
   *  the MESH rather than of the landscape, and it is 2004 sampling logic rather than authored data — but it
   *  is also the look the world was tuned in front of, so the knob exists and the call is a field one.
   *  Measured map-wide: the same 103 122 placements either way, close-tail spacing (p05) 3.5 → 3.2 m. */
  procObjSampler?: ProcObjSampler;
  /** Slope-aware candidate density (plan 011): per category, a multiplier on how many candidates a STEEP or a
   *  FLAT collision face generates. **The one terrain signal not already carried by the surface** — measured
   *  2026-08-11, `p_mountain` is 48.8 % steep and carries all six `p_rubble*` species while every other
   *  surface is under 20 %. The SAME config `opensa` takes (`?procobjSlope=`), because the scatter is shared.
   *  Undefined = unchanged, which is the shipped default until the look is judged. */
  procObjSlope?: ProcObjSlopeConfig;
  /** Guarantee every species that scattered a candidate in a 250 u cell at least this many objects there, so a
   *  desert patch eligible for ten species shows all ten rather than probably-most (plan 012).
   *
   *  **It is a different gate from the runtime floor's, and it has to be.** On `opensa` the per-cell budget cap
   *  is what zeroes a species, so the floor there rescues species the CAP took and pays for them by swapping.
   *  Here nothing caps anything — the global `procObjMax` slice does not bind at the shipped density — so the
   *  only thing that can empty a species locally is the density LOTTERY: three candidates on a patch roll all
   *  three above the cutoff about 30 % of the time. This gate therefore reads "had a candidate", not "survived
   *  the density", and it ADDS objects rather than swapping them. 0 = off. */
  procObjSpeciesFloor: number;
}

/** Defaults tuned for medium-distance procobj clutter (bushes, rocks, scrub). */
export const config: ProcObjLodConfig = {
  // 1 is the SHIPPED PROFILE, decided 2026-08-11, not a placeholder waiting for one (plan 010 task 8). The
  // authored density already places 1.58× the field-accepted reference AND reproduces its hand-authored skew
  // (our top-2 species of 56 = 42.0 %, theirs 40 % of 46), so a per-category profile had nothing left to earn.
  // Raising it is a new argument with its own evidence; every measurement still states which cutoff it ran.
  density: 1,
  drawDistance: 299, // ProperFixes' number, one metre under SA's big-building threshold
  procObjHeight: 0,
  // 20000 until 2026-08-09, when SPACING started being read as a length: the authored density is 91 067
  // objects for the 43 converted species, so the old cap threw away 78 % of them and every field verdict
  // would have been about the cap. Clear of that count, not a budget — 07/04 sets the per-target one.
  procObjMax: 100000,
  // 1 since 2026-08-11 (his call): the roster of a patch of ground should be complete, not probable. Measured
  // cost is in plan 012 — it adds objects, so read the layer-cost line's `floored` term on every build.
  procObjSpeciesFloor: 1,
};
