# Audit — the cutscene fleet, close-out (2026-08-15)

Every mod vehicle in the game now appears in every cutscene it drives, and the fleet has been swept
scene by scene and approved. This is the big-rework audit for the chain that got there:
`vehicle-cutscene` plans 001–005 plus the `perfect-cutscene` ASI. Its measurement record is
[`docs/benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md`](../benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md)
(headline numbers 2026-08-13, re-measured 2026-08-15 at close-out).

**Scope of this audit**: the closing session (2026-08-15). The two earlier sessions have their own
record — the sweep's fix rounds live in plan 004's ledger, and the glass investigation in
[`session-11-cutscene-glass-two-defects.md`](session-11-cutscene-glass-two-defects.md).

## What changed on the closing day

- **Plan 004 round 23 — the pipeline rule was inverted back.** Only window PANES keep the default
  pipeline; every other translucent atomic (lamp lenses, decals, badges) takes the vehicle pipe, which
  is how GAMEPLAY renders them. 102 atomics on 21 of 23 models moved.
- **Plan 005 — the seat retarget.** A cutscene actor riding a converted car has his root channel in
  `anim/cuts.img` lifted onto the DONOR's own seat, z only, ramping to zero across the frames he
  spends getting in or out. New: `src/seats.ts`, `src/seat-patch.ts`,
  `scripts/debug/cutscene-seated-actors.ts`.
- **Plans 002, 004 and 005 CLOSED**; 004 and 002 carry the user's approval verbatim.

## What it cost

| | |
| --- | --- |
| Code | 2 new modules (~230 lines), 1 kept debug script, ~20 lines changed in `emit.ts`/`install.ts`/`cli.ts` |
| Tests | 92 → **112** in the tool (repo suite 4222 → **4242**), all green; tsc and eslint clean |
| Build time | fleet convert **3.55 s → 4.26 s** (+0.7 s), `cutscene.img` 310.8 → 321.5 MB |
| Field time | ~35 scene runs by the user across the day, ~15 s each, plus 4 controls |
| Debt taken | ONE hack file: [the seated-actor geometry](../hacks/cutscene-seated-actor-geometry.md) |

The +0.7 s is worth naming: the seat pass rebuilds a 270 MB, 444-entry archive to change **2 entries**,
because it walks the archive separately from the wheel-stash pass. Both already share a buffer, so
folding them into one walk is the obvious first cut if the cutscene stage ever becomes a complaint.

## What it bought

- **Every cutscene vehicle scene passes** — 35 of 35, one configuration, open findings zero. Nineteen
  of those rows had never been run before this re-sweep.
- **A defect nobody had reported got fixed by accident, and that is the most interesting result of the
  day.** Round 9 had put every translucent atomic on the default pipe after some tail lenses vanished;
  what it actually measured was OUR DFF pipeline stamp rather than the runtime `CustomCarPipe`. For two
  days the whole fleet's lamp lenses rendered without the vehicle pipe's shine — and **the sweep
  ACCEPTED that**, because nobody had a reference for how those lamps should look. The field only named
  it once round 23 changed it back: "the burrito's and sabre's tail lamps used to look a bit odd, I
  assumed that was intended — now they look good."
- **A class of defect that no model data can fix now has a mechanism.** R\* authored cutscene actors at
  their own car's `ped_frontseat` (measured: within 0.02 m in x, 0.03 m in z, across two cars), so a
  taller donor seats occupants low — 0.281 m on the glendale. `ped_frontseat` is read by the gameplay
  code only, which is exactly why the same car seats its GAMEPLAY ped perfectly. Patching the scene
  value is the only lever, and the tool now has it.

## What the day cost in wrong turns (kept, because they were expensive)

Three of my own hypotheses died in the field, each plausible and each supported by a real measurement
of the wrong quantity:

1. The glendale's dark glass tint "swallowing" its occupants — refuted by the user pointing out the
   cabin and steering wheel read through that same glass.
2. An adopted interior shell occluding them — refuted by an ASI-removed control that changed nothing,
   which the occlusion story itself had predicted would change nothing (depth decides occlusion, not
   order). The prediction was right and the story was still wrong.
3. Gating the seat lift on a PERCENTAGE — the passenger was skipped as "85 % seated", which sounded
   like noise. The 15 % turned out to be one unbroken run where he gets out of the car. The percentage
   suggested a threshold; the distribution named the fix.

All three are now in my standing measurement-lessons note. The standing pattern held again: when the
mechanism keeps needing a new story, get a control run before the next story.

## What is still open

- **The pipeline-build acceptance.** Every verdict so far was taken on a fleet the tool's CLI built and
  we dropped into the bottle by hand, with `--self-contained-txd` throughout. A pmb-built game — where
  the empty-TXD route through txdp parents finally runs as designed — has never reached the field.
  Reassigned to `asi/perfect-cutscene` plan 001 step 7, which builds one anyway to ship the ASI.
- **`defrost_ad` on cscopcarla92** — texture-alpha translucency the material-alpha classifier cannot
  see. Priced down by round 22: all five of that car's crash scenes passed without it being raised.
- **SCRASH2's missing location model** — not a cutscene-tool defect;
  [its own open-issue entry](../open-issues/scrash2-location-model-missing.md).
