# Ideas

**High-level directions we might implement in the future.** An idea here is deliberately *unscheduled* and
*unproven*: it still needs research and understanding before we could commit to it. An idea doc captures the
motivation, the approach that would fit our current architecture, the dead-ends already ruled out, and the
open questions — so when we pick it up we don't re-derive the discussion.

> **Before writing one, check [`docs/restrictions/`](../restrictions/README.md).** It holds the rules a
> design has to satisfy — layer boundaries, format ceilings, engine splits, what is decided at build time and
> cannot be re-taken at runtime — and says for each whether a violation is caught or is SILENT. A doc that
> violates one is not ambitious; it is a doc that gets rewritten after the first build.

An idea is the FIRST stage of the documentation lifecycle (see [docs/README.md](../README.md)):

```
ideas  →  concepts  →  plans        (survived the go/no-go — we build it)
                    ↘  postmortem   (died — we record why)
```

Before an idea can be built it graduates to a [concept](../concepts/README.md) (the research + honest
go/no-go). Something already understood and scheduled does NOT live here — it belongs in
[docs/plans/](../plans/) (do it now) or [docs/roadmap/](../roadmap/) (do it in a later version).

## Ideas

- [world-glass-material/](./world-glass-material/readme.md) — **world glass as a material class**: cars
  already classify glass and reflect it differently; the static world has no such class, so a shop window
  shades like concrete. The signal is Rockstar's own — `surfinfo.dat` carries a **GLASS column** (already
  parsed) and every COL face names its surface, so "is this glass" is authored per face rather than guessed
  from a texture name. The unsolved half is the JOIN (collision faces are coarser than render triangles),
  and it is measurable offline before a line is written.
- [stochastic-texturing-v2/](./stochastic-texturing-v2/readme.md) — **turn the dormant de-tiler on for
  good**: 074·12 shipped the skygfx 3-tap tiling-and-blend and it sits default OFF after two July verdicts
  (structured textures scramble; grazing-angle dashes). New since session 17: the reference install RUNS the
  same math on 306 textures and is field-accepted, so a same-asset reference pair exists; our world sampler
  has no anisotropy; the honest upgrades are ranked (aniso → Mikkelsen hex-tiling contrast preservation →
  Heitz–Neyret LUT as a converter stage) and selection moves from names to a texel-derived score gated by
  the list.
- [vehdeform/](./vehdeform/readme.md) — **VehDeform**: GTA4-style dynamic impact deformation for vehicles
  (dents proportional to impact force/direction, accumulating), coexisting with SA's ok/dam part swaps.
  Feasibility looks high on our own vertex pipeline; needs a spike to confirm the look + tuning before it can
  become a plan.

## Camera

- [aaa-camera-polish/](./aaa-camera-polish/readme.md) — **AAA camera polish v2**: the shelved successor of
  the deleted plan 080/10 (corner peek built twice 2026-07-28, field-rejected twice, rolled back). Carries
  the diagnosis — the 09 yaw authority mutes the vehicle chase exactly mid-corner, so corner-gated writers
  never reach the frame — and reorders the work: fix the camera first (per-mode authority, one composition
  channel, the hard-corner exam as a test), then the five effects (corner peek, speed pose, fall stretch,
  directional impact kick, wind shake). Code archive: branch `080-10-corner-peek`.
- [first-person-camera/](./first-person-camera/readme.md) — **first person**: the head IS findable (HAnim
  bone id 5 / `Head`, dumped from a stock ped) and its live world matrix is already computed every rendered
  frame by `IfpSampler`; hiding it is a zero-scale palette slot, which takes hats and hair with it. Written
  at the 080 close-out with what that chain learned — the open question is not "can we", it is whether SA's
  head animation and the ped's own torso across the near plane survive a field look. **Step 0 is a gate: the
  "Ultimate First Person" mod gets downloaded and studied first** (his call, 2026-08-11) — the page's
  reasoning has never been checked against a shipped implementation.

## Editors

- [editors/](./editors/readme.md) — interactive asset editors over the machinery we already own (DFF ⇄ IR
  round-trip, map-optimizer transforms, viewer). First doc: a **model editor** — open a model, select
  polygons, recompute normals / reconfigure prelight, and export the updated model to a chosen folder.
