# 005 — seat retarget: a cutscene actor sits in the DONOR's seat, not R\*'s

**Status: CLOSED 2026-08-15 — field-passed, including both regression scenes.** An IMPROVEMENT over the
original in the goals-doc sense: R\* authored every cutscene actor's position against their own car, so a
converted donor whose cabin rides higher seats its occupants below their own seat. Measured on SMOKE2B:
**0.281 m low**. The user's design call, the same day: **read the donor's own seat dummies when it has
them, and fall back to the animation's authored placement when it does not.**

## The mechanism (measured, plan 004 round 22)

A cutscene actor's position is ABSOLUTE, out of the scene's own `anim/cuts.img` root channel;
`ped_frontseat` is read by the GAMEPLAY code only. That split is the whole finding — and the field's own
control proves it: the same glendale seats its GAMEPLAY ped perfectly (its dummy is used) while the
cutscene puts him 28 cm down (the dummy is not).

| quantity | value |
| --- | --- |
| SMOKE2B's actor offset from the car | z = −0.120 |
| `ped_frontseat`, STOCK gameplay glendale | z = −0.141 → **the scene was authored at R\*'s seat, within 2 cm** |
| `ped_frontseat`, the MOD's glendale | z = −0.048 |
| our ground lift `shiftZ` for this donor | +0.209 m (CORRECT and immovable: wheels compose to −0.70 against vanilla's −0.69) |
| the mod's seat point in cutscene space | z = +0.161 |
| **actor below the donor's own seat** | **0.281 m** |

## How big is this — the census (measured 2026-08-15)

Every scene in `anim/cuts.img` was walked for pairs whose root offset stays inside a cabin box with a
standard deviation under 0.12 m (a static track holds its last frame — a parked car gets 5 keyframes, and
comparing only the overlap made the first census miss RIOT_4B entirely):

| scene | car | actor | offset | seated |
| --- | --- | --- | --- | --- |
| FINAL2B | csbravura | csplay | `[0.52, 0.06, −0.11]` | 100 % |
| FINAL2B | csbravura | cscesar | `[−0.52, 0.01, −0.12]` | 99 % |
| SMOKE2B | csglendale92 | csplay | `[−0.51, 0.17, −0.11]` | 100 % |
| SMOKE2B | csglendale92 | cssmoke | `[0.50, 0.26, −0.15]` | 85 % |
| PROLOG1 | cstaxi92 | csstew | `[−0.24, 1.68, −0.08]` | 92 % |

**Three scenes, five actors, two cars.** Everything else the census caught is a prop riding a vehicle (an
ammo box on the bobcat's bed, the mothership's stand) and is out of scope. The x offsets come in ± pairs
around 0.5 m — the two front seats, mirrored, which is exactly how SA stores them.

## The design

1. **Read the donor's seats.** SA ships ONE `ped_frontseat` dummy (the passenger side); the driver is its
   x-mirror. `ped_backseat` likewise. Both are already in the mod clump the converter reads — no new input.
2. **Derive the delta per (car, actor), never per name.** `delta = (donorSeatZ + shiftZ) − sceneOffsetZ`,
   picking the donor seat whose mirrored x and y sit nearest the actor's measured offset. For SMOKE2B's
   csplay that is +0.281.
3. **Z ONLY.** The measured defect is vertical, and a full retarget would move an actor whose POSE is
   authored for R\*'s cabin — his hands would leave the wheel. Lateral and longitudinal placement stays
   the scene's.
4. **Fall back to the animation when the donor has no dummy** — the user's call, and it is also the safe
   default: a mod without `ped_frontseat` gives us nothing to derive from, so we change nothing.
5. **Patch the same way round 20 did.** `stash-patch.ts` already rewrites cuts.img channels in place
   (12 bytes per channel, chunk sizes untouched); this is a sibling pass over the ACTOR root channels.

### The one real design cost, and how the field settled it

An actor who is seated for only part of a scene walks up, opens the door and gets in — or gets out.
Lifting his whole root track would float him while he walks; lifting only the seated frames pops at the
boundary. The first cut ducked it (patch only actors seated for the WHOLE scene) and the field's first
round rejected that immediately: SMOKE2B's passenger stayed visibly low while the driver was fixed.

The answer is a **per-frame ramp**, and it needed the measurement to find: the lift holds inside the
cabin and falls linearly to zero across a run that leaves it, ramps up across a run that enters, and
stays full through a run bounded by cabin frames on both sides (a lean-out, not an exit). No blend
window to tune — the scene's own geometry says where the transition is.

## Steps

- [x] **1. The census as a real instrument.** Promote the throwaway walker into `scripts/debug/` with its
      row in `docs/debug/README.md` (what it answers: which scenes seat an actor in a converted car, and
      the per-frame offset). It is the input to step 2 and the guard for step 4. Verification: reproduces
      the five rows above.
      **DONE 2026-08-15** — `scripts/debug/cutscene-seated-actors.ts`, row added. Reproduces all seven
      census rows (the five actor pairs plus the two props) byte for byte. Both traps are written into
      the script's own header so the next reader does not re-pay them: a short track HOLDS its last
      value, and props ride vehicles too.
- [x] **2. Seat resolution in the converter.** Read `ped_frontseat`/`ped_backseat` from the donor,
      mirror for the opposite side, express in cutscene space (`+ shiftZ`), and report them per slot.
      Verification: unit test on the glendale — front seat resolves to z +0.161; a donor with no dummy
      resolves to null.
      **DONE 2026-08-15** — `src/seats.ts` (`resolveSeatPoints` + `matchSeat`), carried on every
      branch's `ConvertReport.seats`; suite 100/100 (8 new). End-to-end on the real donor the
      converter reports `shiftZ = 0.207` and

      | seat | position |
      | --- | --- |
      | `ped_frontseat` | `[0.444, 0.379, +0.159]` |
      | `ped_frontseat` mirrored | `[−0.444, 0.379, +0.159]` |
      | `ped_backseat` | `[0.393, −0.868, +0.087]` |

      — the front seat at **+0.159**, against this plan's predicted +0.161. Both SMOKE2B actors match
      the FRONT row and neither comes near the back one: cssmoke `[0.50, 0.26]` is 0.13 m from the
      authored seat, csplay `[−0.51, 0.17]` is 0.22 m from its mirror. The z corrections they imply are
      **+0.309** and **+0.269**. Matching is x/y only — z is the quantity under correction and may not
      be its own evidence — and the mod's seat also sits ~0.15 m FORWARD of where the scene puts them,
      which v1 deliberately leaves alone.
- [x] **3. The patch pass.** Sibling to `stash-patch.ts`: for every fully-seated (car, actor) pair, lift
      the actor's root channel by the derived z delta. Verification: rebuilt `cuts.img` where SMOKE2B's
      csplay offset reads z ≈ +0.161, every other channel byte-identical.
      **DONE 2026-08-15** — `src/seat-patch.ts`, reported by the CLI; suite 107/107. The build says
      exactly one site, the one the field reported:
      `actor seated on the donor's own seat: smoke2b.ifp csglendale92 csplay +0.270`, and SMOKE2B's
      csplay offset goes `−0.11 → +0.16` against the donor seat at +0.159.

      Three gates were needed to get from "five candidate pairs" to that one site, and each was
      forced by a measurement:

      1. **The actor test is SKINNEDNESS**, the same one perfect-cutscene's ASI makes at runtime.
         Without it the mothership's `csmstand` — a prop — matched a seat point and was lifted 1.6 m.
         Model TYPE cannot do it (every cutscene object reports 5) and a name rule would be a guess.
         Cutscene peds live in `cutscene.img` EXCEPT the player: `csplay` is in `gta3.img`.
      2. **98 % seated**, so `cssmoke` (85 %) and `csstew` (92 %) keep their authored tracks rather
         than floating on the way to the door. **Superseded the same day by the ramp — see step 4.**
      3. **A 0.05 m deadband.** R* authored the scenes at the stock seat but only to within 0.03 m, so
         a smaller delta is authoring noise — FINAL2B's two actors (0.03 m each) stay untouched.

      **The chaining trap, caught in review:** the wheel stash and the seat retarget write the SAME
      `anim/cuts.img`. They now run through one buffer and one write; as two independent reads the
      second would silently have dropped the first. Verified in the built archive — `synd_4a.ifp`
      differs by 16 bytes (round 20's four wheel channels) AND `smoke2b.ifp` by 2685 (csplay's root),
      while `final2b.ifp` and `riot_4b.ifp` are byte-identical to vanilla.
- [x] **4. Field.** SMOKE2B and FINAL2B, one sitting. LOOK-FOR: the occupants read through the glass at
      seat height; head clear of the roof (our glendale's is 0.27 m taller, so there is room); hands and
      feet not obviously detached from wheel and floor — the pose is R\*'s and only the root moved.
      **Round 1 (2026-08-15): HALF PASSED, and it produced the design's last piece.** The field on
      SMOKE2B: "the driver CJ sits perfectly; the passenger is still low." Both are true and both were
      expected — `csplay` was lifted, `cssmoke` was not, because the 98 % gate held him out at 85 %.
      The dummy was never the problem: ONE `ped_frontseat` serves both sides (the other is its
      x-mirror), and it is the same dummy that fixed the driver.

      Measuring WHERE those 15 % are answered what to do: `cssmoke` sits frames 0–753 and then
      **leaves the car** — one unbroken 137-frame exit run to the end of the scene, never returning.
      So the percentage gate was asking the wrong question. It is replaced by a **per-frame ramp**:
      the lift holds while the actor is in the cabin and falls linearly to zero across a run that
      leaves it (and ramps up across a run that enters). A run bounded by cabin frames on BOTH sides
      keeps the full lift — that is a lean-out, not an exit, and cutting it would pop him twice.
      Visually the ramp is not a compromise but the honest consequence: from a higher seat he steps
      down further than R\* authored.

      The build now reports both occupants:
      `csplay +0.270` and `cssmoke +0.310 (ramped over 137 frame(s))`, and the census reads both at
      z +0.16 — the donor's seat. FINAL2B is still untouched by the deadband, and PROLOG1's csstew
      still matches no seat. Suite 112/112.

      **Round 2 (2026-08-15): SMOKE2B PASSES — "both sit perfectly, the exit is fine."** So the ramp
      is right at both ends: the seated pose and the transition out of it.

      **The regression surface is two scenes and can be stated exactly**: of the 444 entries in the
      built `anim/cuts.img`, **2 differ from vanilla** — `smoke2b.ifp` (5487 B, the two actors, just
      passed) and `synd_4a.ifp` (16 B, round 20's four wheel-stash channels). Nothing else in the
      archive moved, so nothing else can regress from this plan. SYND_4A is therefore the ONE run that
      matters: it is what proves the two passes chained rather than overwrote each other. FINAL2B is a
      free confirmation that the deadband did nothing — its bytes are vanilla.

      **Round 3 (2026-08-15): both PASS.** SYND_4A — "the wheels are hidden, all fine": the chaining
      holds and round 20's sink survived the second pass. FINAL2B — "fine": the deadband changed
      nothing, as its vanilla bytes promised. **Step 4 closed, and with it the plan.**
- [x] **5. Contracts.** `docs/contracts/vehicles.md`: `ped_frontseat`/`ped_backseat` now carry behaviour
      in the CUTSCENE path too, and what happens when a donor omits them (nothing — the scene's own
      placement stands). Say it, because a missing dummy is silent by nature.
      **DONE 2026-08-15** — §3's dummy table and a paragraph under it: what the dummy now decides, that
      an absent one is a fallback rather than a failure, and that all THREE gates are silent when they
      skip (unskinned, under 98 % seated, under the 0.05 m deadband). Misplacing the dummy now moves the
      cutscene actor with it — the same lever pointed the wrong way, which is exactly the kind of thing
      a mod author cannot guess.

## Risks / open measurements

- The actor's pose is authored for R\*'s cabin; only the root moves. Step 4 is what decides whether a
  28 cm lift reads as "sitting properly" or as "floating".
- PROLOG1's csstew sits at y +1.68 — far forward of the taxi's root. Whether that is a seat at all or
  someone leaning on the bonnet is unresolved; the census flags it, step 3 skips it (92 %), and step 4
  should glance at it.
- A donor whose `ped_frontseat` is itself badly placed would now move the actor to a bad spot where today
  it merely sits low. The census's own offset is the sanity bound: refuse a delta that would put the actor
  outside the cabin box.
