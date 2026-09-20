# 089/03 — Skid marks

**Status: SHIPPED 2026-07-28** (branch `089-03-skid-marks`), awaiting the field verdict. The engine's
first DECAL lane — the second new capability this plan adds (089/01 was the dynamic particle lane), and
like it, worth more than the effect on top: bullet impacts, blood pools, footprints all want ground
decals eventually.

## Shape

- **Engine lane** (`packages/engine/src/render/skid-marks.ts`): a RING of quad segments
  (`SKID_SEGMENT_CAP` 4096 world-wide — the brief's "oldest recycled first" is the write cursor
  wrapping), one persistent 688 KB vertex buffer at install, one ~168 B positional `writeBuffer` per laid
  segment, and a live window that advances past expired segments (FIFO — births are monotonic) so dead
  quads are never rasterised; the window crosses the ring seam as at most two ranged draws.
  `Engine.initSkidMarks(sprite)` once at boot · `Engine.addSkidSegment(seg)` per laid quad.
- **The REAL-seconds lifetime** (the brief's one correctness trap): the `skid` shader fades on
  `frame.params2.z` — engine uptime in WALL-CLOCK seconds — so the day cycle (60 real seconds per game
  hour) cannot touch the lifetime by construction. The brief said 5 s; **field round 1 stretched it to
  12 s** ("they vanish too fast — 2–3× longer"), and the ring cap doubled with it so a sustained
  4-wheel slide cannot recycle live marks.
- **No new pass** (the plan's alpha-sorting risk): one `skid` pipeline (premultiplied, depth READ,
  no cull), drawn inside the existing world pass after the water and BEFORE the blend bundles — foliage
  and glass sort over a mark exactly as they sort over the road it lies on. Corners ride 2 cm above the
  road instead of a depth-bias.
- **Game system** (`packages/game/src/vehicle/vehicle-skid-marks.system.ts`): per sliding wheel, a
  ribbon grows along the contact path — segments reuse the previous segment's far edges (curves stay
  seamless), the FIRST edge is fully transparent and alpha ramps in over 3 segments (the brief: a mark
  grows in, never appears as a stripe), laid alpha = `0.25 + 0.6 × intensity` (darker the harder), and a
  3 m jump restarts the ribbon (teleports must not lay road-length quads). The signal is the SHARED
  `equivalentSlideSpeed` extracted from the tyre smoke (089/02) — the two effects can never disagree
  about whether a tyre slides.
- **Texture**: SA's own `particleskid` (32² white + tread-pattern alpha, `particle.txd`), dark rubber
  tint applied in the shader — the original tints it with a dark vertex colour the same way.

## The debug detour worth keeping

The first run laid 280 correct segments (verified by logging the sink) and showed NOTHING — rendered
red at full alpha, the ribbons were perfect: the geometry, fade and recycling all worked, the mark was
just unreadable in black. `particleskid`'s alpha averages ~0.4 (authored for SA's compositing), so a
full-severity mark darkened the road by ~0.3 and vanished into the asphalt. Fix: `TREAD_BOOST` 1.8 on
the texture alpha, pattern shape preserved — the eye-fit numbers live in
`docs/hacks/skid-mark-look-fit.md`. Lesson for every decal that follows: verify the LANE with a loud
debug colour before judging the LOOK.

## Verification

- **Tests** (negative first): `render/skid-marks.test.ts` (ring: empty draws nothing, no false expiry;
  vertex packing, strictly-FIFO expiry on the wall clock, seam-split ranges, oldest-recycled wrap),
  `vehicle-skid-marks.system.test.ts` (on foot / gate off / gripping / sub-minimum movement / airborne /
  teleport restart; transparent start + ramp, darker-the-harder, seamless edges, v accumulation, width
  and lift), `engine.skid-marks.test.ts` on the fake device (no lane / gate off; exact one-segment
  upload, ranged draw, no re-upload of an unchanged ring).
- **Headless brake-strip**: two dark rubber trails behind the braking car, fresh end darkest at the
  wheels, the older tail already faded within the same screenshot (the wall-clock fade at work). GPU on
  those shots sits in the baseline range — the lane's steady cost is one small upload per laid segment
  and up to 2048 spread-out quads:
  [`2026-07-28-headless-089-03-skid-marks.json`](../../benchmarks/opensa-engine/2026-07-28-headless-089-03-skid-marks.json).

## Open / next

- Surface mark TYPE (DEFAULT/SANDY/MUDDY — 18 sandy, 34 muddy surfaces) is 089/05's job; today every
  surface lays the rubber mark.
- Marks lie in the horizontal plane (the contact normal is not read yet) — on steep banking a mark can
  clip; revisit if the field meets it.
- Only the driven car lays marks (the plan's budget: the player's car is the target).
