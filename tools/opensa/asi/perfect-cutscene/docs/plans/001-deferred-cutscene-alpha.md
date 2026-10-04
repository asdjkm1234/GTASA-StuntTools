# 001 — Deferred cutscene alpha (the glass-over-actors fix)

Give cutscene vehicle objects the same DEFERRED, distance-sorted render pass the engine already
gives gameplay vehicles, so a car's translucent atomics (window glass, tint) are drawn after every
scene actor instead of z-erasing whichever actor the sector scan happened to visit later. Closes the
mechanism behind plan 004 rounds 15–17 for good and retires the pane-suppression hack
(`docs/hacks/retired/cutscene-window-pane-suppression.md`).

## The recovered mechanism (measured 2026-08-14 against the accepted exe + gta-reversed-modern)

- Scene actors (peds) are separate `CCutsceneObject`s; the renderer draws visible entities in
  world-sector scan order — a per-scene accident of positions and camera. Field-proven both ways:
  PROLOG1/PROLOG3/FINAL2B draw actors before the car (glass layers fine), RIOT_4B and SYND_3A draw
  them after (a rendered pane z-writes and erases the actors; they reappear in the door gaps).
- **Gameplay vehicles never render in that scan-order pass at all.** In
  `CRenderer::RenderEverythingBarRoads` (`0x553AA0`) the visible-entity loop hands every VEHICLE
  entity to `CVisibilityPlugins::InsertEntityIntoSortedList` (`0x734570`) and skips its inline
  render; the list is flushed later in the frame by `CRenderer::RenderFadingInEntities`
  (`0x5531E0` → `RenderFadingEntities` `0x733F10`), back-to-front. So a gameplay car is drawn AFTER
  every ped, building and object of the frame — the glass has nothing left to erase. A
  `CCutsceneObject` is an OBJECT, so it falls through to the inline
  `CRenderer::RenderOneNonRoad(entity)` call at **`0x553C52`** and takes its luck with the scan
  order. That is the whole bug.
- **The per-atomic alpha list is NOT a frame-level list** — the correction that killed this plan's
  first design: `RenderOneNonRoad` (`0x553260`) calls `InitAlphaAtomicList` BEFORE and
  `RenderAlphaAtomics` AFTER one entity's render, so `m_alphaList` is cleared and flushed inside a
  single vehicle's render. It is how a car layers its own glass over its own
  `RenderDriverAndPassengers` occupants — nothing more. Atomics inserted from a cutscene object
  would be flushed by no one (a cutscene rarely has a `CVehicle` on screen at all) and simply never
  draw. Deferring per ATOMIC therefore needs a private list AND a private flush point; deferring per
  ENTITY needs neither, because the engine already owns both.
- R*'s authored dodge: vanilla cutscene cars ship no rendering window glass (door glass absent, the
  rest in the sub-alpha-test band; the pass sets alpha-test ref 140 outdoors at `0x553AA0`, while
  the deferred path's `CVisibilityPlugins::RenderEntity` sets ref 100 — or 0 inside an interior
  area. Moving a car from one to the other MOVES ITS TRANSLUCENT THRESHOLD, which is the one thing
  step 3 has to measure in the field rather than argue about).
- Six models are already special-cased by name at load (`CCutsceneObject::SetupCarPipeAtomicsForClump`
  `0x5B1AB0`, names at `0x8D0F68` → `CCarFXRenderer::CustomCarPipeAtomicSetup` `0x5D5B20`): the
  vehicle env-map pipe, which DROPS translucent atomics outside a real CVehicle. Independent of draw
  order and still ours to fix (step 4).

Reference source: gta-reversed (`docs/links.md`) for the names and call graph; every address and
every structure offset below was then read out of the accepted exe itself. The accepted exe is the
same single HOODLUM binary perfect-map targets — address resolution through `asi/sdk`'s fingerprint
gate (the body-relocation trap is solved there).

## The design (the user's option B, 2026-08-14 — entity-level deferral)

Replace ONE call — the inline `call CRenderer::RenderOneNonRoad` at `0x553C52`, inside
`RenderEverythingBarRoads`' visible-entity loop — with a call to our own function:

```c
void __cdecl PcRenderOneNonRoad(CEntity* e) {
  if (IsDeferrableCutsceneObject(e) && InsertEntityIntoSortedList(e, DistanceFromCamera(e)))
    return;                    // deferred: the engine renders it after the pass, back-to-front
  RenderOneNonRoad(e);         // everything else: untouched
}
```

`IsDeferrableCutsceneObject` derives from the entity and its clump, never from a name or an id range
(offsets verified in the exe, not assumed):

| what | where | value |
| --- | --- | --- |
| entity type | `e+0x36 & 7` | `4` = object |
| object type | `e+0x13C` | `4` = `OBJECT_TYPE_CUTSCENE` (read from the `CCutsceneObject` ctor's own `movb $0x4,0x13c(%esi)`) |
| model index | `e+0x22` (int16) | → `CModelInfo::ms_modelInfoPtrs` at `0xA9B0C8` |
| ~~model type~~ | ~~vtable slot 4~~ | **falsified in the field, step 2 round 1: every cutscene object is type 5** — cars and actors share the CUTOBJ clump slots |
| not an actor | `GetAnimHierarchyFromSkinClump(clump)` `0x734A40` | `nullptr` — a skinned clump is an ACTOR and stays in the main pass; a car or prop is what we defer |

The distance is the loop's own: `|GetPosition(e) − CRenderer::ms_vecCameraPosition(0xB76870)|`, with
`GetPosition` inlined exactly as the loop inlines it (`m_matrix = e+0x14`; matrix ? `m+0x30` :
`e+0x4`). If the sorted list is full, `InsertEntityIntoSortedList` returns false and we fall back to
the inline render — i.e. today's behaviour, never a dropped car.

What this buys over the per-atomic design: one patched call instead of a render-callback graft, no
RW struct walking, no lighting-context replay, every translucent class fixed (lamp lenses included,
not just panes), and several cars in one scene sorted back-to-front instead of by scan luck.

What it costs: the whole car (opaque atomics too) moves later in the frame, and its alpha-test ref
changes as noted above. Both are field-measured in step 3.

(A wheel-stash concealment payload was planned here and RETIRED before implementation: the fleet
scan found exactly ONE stash site in all 148 scenes — synd_4a's four washington wheel channels — and
plan 004 round 20 fixed it in DATA instead: the installer ships a surgically sunk `anim/cuts.img`
(`tools/vehicle-cutscene/src/stash-patch.ts`, sink z −0.6). This ASI stays alpha-only.)

Config knobs (SDK pattern): `PC_CENSUS` (classify and log, patch nothing), `PC_DEFER_ALPHA` (the
fix), `PC_BLESSED_SIX` (step 4), `PC_CENSUS_LOG` (verbose per-object decisions).

## Steps

Every step ends with its verification; a step without recorded numbers is unfinished. The field
instrument is `docs/development/cutscene-field-testing.md` (~15 s per verdict; `scene =` in the
bottle's `CLEO/cutscene-override.ini`).

- [x] **0. Reproduce the bug without the converter hack (the baseline).** Temporarily empty
      `PANE_SUPPRESSED_SLOTS` in `tools/vehicle-cutscene/src/census.ts` (do not commit), rebuild the
      fleet, install into the bottle, run BOTH repro scenes — **RIOT_4B** (csgreenwood: both peds
      vanish behind the tint, reappear in the door gaps) and **SYND_3A** (cswashington: the field
      found it "reproduces the bug very well", 2026-08-14) — the recorded repro of the eraser on
      current code. Keep this build aside (`NO_COMMIT/cs-repro-panes`) as the standing repro
      artifact; restore the hack in the working tree afterwards. Verification: screenshot pairs
      (actors hidden / door-gap visible) for both scenes recorded in this plan.
      **DONE 2026-08-14 — the baseline stands, see "The step-0 baseline" below.**
- [x] **1. Scaffold.** `asi/perfect-cutscene` consuming `asi/sdk` exactly like perfect-map (thin
      Makefile + `src/dllmain.cpp` + plugin descriptor); a no-op build that passes the fingerprint
      gate and writes `perfect-cutscene-asi.log` beside the exe. Verification: the log's first line
      in the bottle (`built <date> (verify-only)`), game boots, no adjuster conflicts (OLA + FLA +
      perfect-map coexistence — the SDK's byte-verify must stay green).
      **Build side DONE 2026-08-14** — written straight onto the SDK with zero framework changes:
      `gen/catalogue.ts` (2 entries / 5 sites, every byte window read out of the accepted exe and
      cross-checked against gta-reversed-modern), the five seam files, the thin Makefile. All three
      modes compile (`build:verify` / `build:asi` / `build:debug`); catalogue tests 5/5; the
      verify-only artifact (11 264 B) is installed in the bottle. **Boot check PASSED 2026-08-14**
      (`perfect-cutscene-asi.log`, the user's launch): `loaded — built Aug 14 2026 15:25:11
      (verify-only)`, `fingerprint OK — GTA:SA 1.0 US`, FLA + OLA detected, **5 of 5 sites pristine —
      "catalogue byte-accurate, safe to apply"**, game boots normally. Nothing among the bottle's ~24
      other `.asi` plugins hooks the cutscene render path, so steps 2–4 own these sites outright.
- [x] **2. The classifier, verify-only.** Run `IsCutsceneVehicleObject`'s derivation where it is
      cheapest and safest to observe — the `SetupCarPipeAtomicsForClump` call site inside
      `SetModelIndex` (`0x553C52`'s sibling, `0x5B1B64`), which fires ONCE per cutscene object at
      scene load, not per frame. Log model index, the vtable-slot-4 model type and the verdict;
      patch no rendering. This is what proves the model-type read (a wrong vtable slot is a crash,
      so it gets its own step). Verification: RIOT_4B logs the car as deferrable and its actors as
      skipped; the game still boots.
      **Round 1 (2026-08-14) — the census earned the step immediately.** The hook works and the
      vtable read works, but every cutscene object came back **model type 5 (`MODEL_INFO_CLUMP`)**,
      cars included (ids 300–303 + 1, twice over two scene loads). Cutscene models are streamed into
      the shared CUTOBJ clump slots, so `GetModelType()` can never separate a cutscene CAR from a
      cutscene ACTOR — the "model is a vehicle" test the design table carried was wrong on the real
      game. **The split that does exist is the engine's own**: `CCutsceneMgr` tells an actor from a
      prop with `GetAnimHierarchyFromSkinClump(clump)` (`0x734A40`, non-null only for a SKINNED
      clump — its particle-attachment code branches on exactly that). So the classifier inverts:
      defer every cutscene object that is NOT skinned (cars and props), leave the skinned actors in
      the main pass — which is what the fix needs anyway, since it is the actors that must be drawn
      first. Round 2 logs `model / name-key / skinned` to confirm the inversion in the field.
      **Round 2 PASSED (2026-08-14)** — RIOT_4B, two scene loads (the game's own intro plays before the
      override warps, so a prolog scene is logged first). Every object classified, and the name keys
      decode by `scripts/debug/sa-name-key.ts`: `csplay` (−249921641) **skinned 1**, `cstaxi92`
      (1793024146) **skinned 0**, `csgreenwood` (−1591174577) **skinned 0**, and the three remaining
      actors skinned 1. Exactly one non-skinned object per load, and it is the CAR both times —
      the classifier is confirmed by name, not by inference. Note the CUTOBJ slots are reused
      between scenes (id 301 carried a different key in each load), which is why the census logs the
      key and never the slot.
- [x] **3. The deferral.** Patch the `0x553C52` call to route through `PcRenderOneNonRoad`, which
      defers a classified cutscene vehicle into `InsertEntityIntoSortedList`. Verification — the
      decisive gate, on the STEP-0 REPRO BUILD (hack still absent): RIOT_4B AND SYND_3A both show
      their actors through every window AND the tint over them; PROLOG1/PROLOG3/FINAL2B
      unchanged-good (their lucky order must not regress); the door-gap actor test from step 0
      passes on both repro scenes. **Measure the ref-140 → ref-100 move explicitly**: if a mod's
      tint appears/disappears versus the step-0 screenshots, that is the alpha-test threshold, not
      the ordering — record which, and mirror the pass's ref in the deferred path if needed.
      **PASSED on both repro scenes (2026-08-14, the user):** RIOT_4B and SYND_3A — "everything is
      fine, the peds are visible", and on the follow-up look "lamps, headlights, tint — all there".
      So the actors survive AND the glass still renders over them: the two halves the whole ASI
      exists for, on the two scenes that failed hardest. The log confirms the patch took
      (`defer APPLIED`) and the census names the deferred object each time — `csgreenwood`
      (−1591174577) on RIOT_4B, `cswashington` (1484834498) on SYND_3A, both `skinned 0`.
      **PROLOG1 and FINAL2B unchanged-good.** **PROLOG3 changed, and the ref-140 → ref-100 risk is
      exactly what did it** — round 2 below.
- [x] **3b. The alpha-test ref, put back (round 2, 2026-08-14).**
      **Seen (user):** PROLOG3 — the cop car's windscreen "looks matte, you can't see through it";
      every other window on the same car fine. His read was "as if it applied twice".
      **First root cause — WRONG, and the user's own experiment killed it.** The story below was
      consistent with every offline measurement and still false: he removed the `.asi` entirely and
      the windscreen stayed matte, which no explanation involving our render path survives. Kept
      here because the reasoning it contains is still true about the THRESHOLD, just not about this
      symptom. Mod cutscene glass sits at **alpha 102–125** (csgreenwood 102,
      cswashington 110, cscopcarla92 and cstaxi92 115, csbravura 125) — *between* the outdoor pass's
      ref **140** and the deferred path's ref **100**. `RenderEverythingBarRoads` sets 140 only when
      `CGame::currArea == 0`, and of the five scenes gated here PROLOG3 is the one with a decoded
      OUTDOOR area (PROLOG1 is area 14): so PROLOG3's windscreen had always been discarded by the
      alpha test, and the deferral rendered it for the first time — at its authored 45 % opacity,
      which reads as matte. The "twice" reading was checked and is NOT what happened: the mixed-mesh
      split is clean (opaque copy 248 tris with 0 glass triangles, translucent twin 80 glass tris),
      and the anim-replay world boxes show one pane per window.
      **The threshold patch was later REMOVED — it is what deletes the tint (2026-08-14, same day).**
      With the modulate fix in and the fleet built hackless, RIOT_4B came back "peds visible, no tint,
      as if there is no glass at all": mod cutscene glass sits at alpha 102–125, so forcing the outdoor
      ref back to 140 discards it outright. The parity argument was coherent and the effect is the
      opposite of what this plugin is for, so the deferred pass now keeps `RenderEntity`'s own ref
      (100, or 0 in an interior). **Re-verified immediately: RIOT_4B on the hackless + modulate fleet
      with the patch gone — "perfect: peds visible, tint as it should be."** So the ref difference IS
      observable, and it reads in our favour: the deferred pass shows the mod's authored glass in
      outdoor scenes, which the main pass discarded.
      What follows is what the patch DID, kept for the record: repoint the SECOND call site,
      `CVisibilityPlugins::RenderEntity`'s own `call RenderOneNonRoad` (`0x732C48`), so one of our
      deferred cutscene objects in an outdoor area is rendered at ref 140 and the ref is put back to
      what RenderEntity chose (100, or 0 for a `bDontWriteZBuffer` model) straight after. The plugin
      now changes draw ORDER and nothing else.
      **Open option, deliberately NOT taken:** running the deferred pass at ref 100 would show the
      mod's authored glass in outdoor scenes too, and make a car look the same indoors and out.
      That is a LOOK decision with a full re-sweep attached, and the first field verdict on it was
      negative — it stays a separate question, not a side effect of an ordering fix.
      - [x] **Re-check (user):** no change — and then the decisive one: **with the ASI removed
        altogether the windscreen is still matte**. The threshold was never the cause; the patch is
        parity only, and its own effect has never been observed in the field. Say so when it is
        judged.

- [x] **3c. What the matte windscreen actually is (round 3, 2026-08-14) — a data bisect, no game.**
      **The data is innocent, proven across the whole session.** The windscreen glass material reads
      `102,102,102,115` in EVERY kept build from `cs-mods-step8` (08-13 10:29) to today; the only
      movement in its history is the round-4 alpha clamp (102) that round 7 retired. The MOD's own
      source DFF carries the same `102,102,102,115` — the conversion alters nothing. The built model
      carries no opaque surface over the glass (the only opaque part of that mesh is a 27 cm mirror
      housing), the source's one opaque `glass` band (270 tris, full width — a `_vlo`) is NOT in our
      model, the `glass` texture is present, and there are no prelit vertex colours anywhere.
      **The field pattern is the answer.** The user's screenshots: windscreen AND rear screen matte,
      vertical side windows clean — all of them the SAME material, so no data difference can explain
      it. What separates them is RAKE, and rake matters to exactly one thing: a reflection.
      **Mechanism:** `cscopcarla92` is one of the six models `SetupCarPipeAtomicsForClump` (`0x5B1AB0`)
      force-pipes at load — its body writes `[atomic+0x6C] = [0xC02D24]` and stamps pipeline
      `0x53F2009A` on EVERY atomic of the clump, glass included. SA's vehicle env map is a static
      texture: on a raked pane it covers the whole surface as flat grey; on a vertical one it barely
      shows. Ours is the only fleet where this is visible at all, because vanilla cutscene glass
      never renders. It is independent of the ASI — the stamp happens at model load — which is
      exactly why removing the plugin changed nothing.
      **This makes step 4 both the fix and the experiment**, and simpler than planned: our DFFs
      already carry the correct per-atomic pipeline (opaque = vehicle, translucent = default, plan
      004 rounds 5–9). The engine overrides it only because VANILLA cutscene DFFs carry no stamp at
      all. Not letting it override needs no atomic walk — just not calling the original for a
      non-skinned cutscene clump.
- [x] **4. The blessed six — TRIED AND REJECTED (2026-08-14), and the rejection is a finding.**
      Built: for a non-skinned cutscene clump the stand-in returned without running
      `SetupCarPipeAtomicsForClump`, so the six kept exactly the per-atomic pipeline split the
      converter authored. **Field verdict: "the windscreen is not fixed, and the other windows got
      WORSE."** Two things fall out of that one sentence:
      1. The env-map-on-a-raked-pane explanation for the matte windscreen (round 3) is **falsified** —
         with the pipe gone the windscreen is unchanged.
      2. **The runtime force-pipe is what makes that car's glass look right**, which is the opposite
         of this step's premise (it was written expecting the pipe to be lossy for translucents,
         from plan 004 rounds 5–9 where OUR OWN DFF pipeline stamp made panes vanish). The DFF
         PipelineSet stamp and the runtime `CustomCarPipeAtomicSetup` are evidently not the same
         thing, and this environment (OLA + FLA + skygfx + ~20 more plugins) is not the one rounds
         5–9 measured. Recorded, not chased: nothing in the ledger depends on it today.
      The payload was **removed the same day**, not left behind a flag — a wrong-mechanism fix gets
      retired, not switched off. The census half of that call site stays.
      **What the matte windscreen still could be, with everything else eliminated:** the mod's own
      glass is a dark tint (material `102,102,102`, alpha 115, an 8×8 swatch) and behind a RAKED pane
      there is only the car's near-black interior shell, while behind a vertical side window there is
      the bright street. That predicts the same look in GAMEPLAY on the same mod — the one A/B nobody
      has run yet, and the next thing to do before any more code.
- [x] **5. Retire the converter hack.** Empty `PANE_SUPPRESSED_SLOTS` for real; move
      `docs/hacks/cutscene-window-pane-suppression.md` to `docs/hacks/retired/` with the closing
      block naming this ASI + the commit; update `docs/contracts/vehicles.md` §3 (the pane-order row
      keeps render-order semantics; the suppression sentence moves to history); rebuild the fleet.
      Verification: suite green; RIOT_4B with the ASI + hackless fleet = tint + peds.
      **DONE 2026-08-14.** Both scenes that forced the hack passed first on the hackless + modulate
      fleet with the ASI: RIOT_4B "perfect — peds visible, tint as it should be", SYND_3A "all
      excellent" — which also closes the plan-004 row that had been deferred here since round 18.
      `PANE_SUPPRESSED_SLOTS` is empty and stays as a documented seam; the hack file moved to
      `docs/hacks/retired/` with its closing block, its README row repointed, and
      `docs/contracts/vehicles.md` §3 now keeps only the atomic-ORDER rule. Suite 92/92.
- [x] **6. The fleet re-check (plan 004 addendum).** THREE things changed at once, so every row of
      plan 004 re-opens: the draw path of every cutscene car (the deferral), the modulate rule (one
      model's glass), and the retired hack (two slots get their windows back). Sixteen rows had never
      been run at all. Findings feed plan 004's ledger as new rounds; the verdict per scene goes in
      that table, not here.
      **Configuration under test:** the hackless + modulate fleet (`NO_COMMIT/cs-hackless-modulate`)
      **plus `perfect-cutscene.asi`** (APPLY, census+defer). LOOK-FOR per scene: actors visible
      through glass AND the tint over them; glass present on every window that should have it; no
      car floating, sunk or drawn over a wall; lamps/plates/paint unchanged.
      **Three rows are already done on this exact configuration** (2026-08-14): PROLOG3 ("looks
      perfect"), RIOT_4B ("peds visible, tint as it should be"), SYND_3A ("all excellent").
      **DONE 2026-08-15 — 35 of 35 PASS.** Two findings came out of it and BOTH belonged to the
      converter rather than to this ASI: plan 004 round 23 (green headlights — round 9's pipeline rule
      replaced by round 8's) and round 22, which resolved into plan 005 (a cutscene actor sits in the
      donor's seat). The deferral itself was never implicated in either; the ASI-removed control is
      what proved that for round 22.

      **Running tally at the time of the last batch: 28 of 35 passed, zero findings** — the three above, all 14 of block A, and
      11 of block B, run 2026-08-15, every verdict "excellent". **Model coverage is complete**: the
      21 exercised models have all been seen on this configuration, the six ★force-piped ones
      included. Block B has also cleared all five `cscopcarla92` crash scenes — the model carrying
      the open `defrost_ad` finding — without that surface being raised, which prices it as a
      defect nobody meets at scene framing. Seven rows left, all repeats of models already passed
      (csglendale92 ×3, csremington92 ×3, ★csmothership).

      **Block A — 14 scenes that cover all 21 exercised models at least once.** The six force-piped
      models are marked ★: the engine stamps the vehicle pipe on every one of their atomics, glass
      included, so they are where a surprise is most likely.

      - [x] PROLOG1 — cstaxi92 (interior area 14: the one decoded scene where the pass never sets
            ref 140, so it reads the glass differently from the outdoor ones) — **2026-08-15 ✅**
      - [x] DESERT9 — csbobcat92 — **2026-08-15 ✅**
      - [x] FINAL2B — ★csbravura, cssabre92 — **2026-08-15 ✅**
      - [x] RIOT4E1 — ★cscopcarsf, ★csfirela — **2026-08-15 ✅**
      - [x] DES_10B — ★csmothership — **2026-08-15 ✅**
      - [x] SWEET2B — csgreenwood, ★csvoodoo — **2026-08-15 ✅**
      - [x] BCESAR5 — cssadler, cszr350, cszr350b — **2026-08-15 ✅**
      - [x] BCESAR4 — cssavanna, cszr350 — **2026-08-15 ✅**
      - [x] SMOKE1B — csglendale92 — **2026-08-15 ✅**
      - [x] GARAG3A — csremington92 — **2026-08-15 ✅**
      - [x] HEIST8A — cssecurica92 — **2026-08-15 ✅**
      - [x] FARL_3B — csburrito92 — **2026-08-15 ✅**
      - [x] DESERT1 — csmonster — **2026-08-15 ✅**
      - [x] STRP4B2 — csmtbike92 (the only bike scene in the game) — **2026-08-15 ✅**

      **Block A is CLOSED, 14 of 14, zero findings (2026-08-15).** Every one of the 21 exercised
      models has now been seen on the ASI + hackless + modulate configuration, the six ★force-piped
      ones included. A defect that is per-MODEL would have shown here; none did, so what block B is
      still guarding is strictly per-SCENE (camera angles, scene anims), not the render change.

      **Block B — the remaining 18, per-scene surprises (camera angles, scene anims).**

      - [x] BCESA4W — ★csbravura, cszr350b — **2026-08-15 ✅**
      - [x] SYND_4A — cssavanna, cswashington (also re-confirms the round-20 wheel stash) —
            **2026-08-15 ✅**, the stash sink confirmed again
      - [x] BCESA5W — cszr350, cszr350b — **2026-08-15 ✅**
      - [x] BCRAS1 — ★cscopcarla92 — **2026-08-15 ✅**
      - [x] BCRAS2 — ★cscopcarla92 — **2026-08-15 ✅**
      - [x] CRASH3A — ★cscopcarla92 — **2026-08-15 ✅**
      - [x] CRASV2A — ★cscopcarla92 — **2026-08-15 ✅**
      - [x] CRASV2B — ★cscopcarla92 — **2026-08-15 ✅**
      - [x] CESAR1A — cssavanna — **2026-08-15 ✅**
      - [x] RIOT4E2 — ★csfirela — **2026-08-15 ✅**
      - [x] SCRASH2 — ★csbravura — **2026-08-15 ✅**
      - [x] SMOKE2B — csglendale92 — **2026-08-15 ✅**, after two findings that both turned out to be
            outside this plan. The occupants read as missing: the ASI-removed control changed nothing
            (as the depth-not-order prediction required), and the cause resolved to a SEATING delta —
            the scene places actors at the STOCK car's `ped_frontseat`, so a taller donor seats them
            0.281 m low (plan 004 round 22, closed). The green headlights were plan 004 round 23, a
            converter pipeline rule, fixed. Neither touched the deferral
      - [x] SMOKE3A — csglendale92 — **2026-08-15 ✅**
      - [x] SMOKE4A — csglendale92 — **2026-08-15 ✅**
      - [x] STEAL_2 — csremington92 — **2026-08-15 ✅**
      - [x] STEAL_4 — csremington92 — **2026-08-15 ✅**
      - [x] STEAL_5 — csremington92 — **2026-08-15 ✅**
      - [x] TRUTH_2 — ★csmothership — **2026-08-15 ✅**

      Not driven by any cutscene and therefore unreachable here: `csdinghy`, `cscopcarla` (the latter
      converts byte-for-byte with `cscopcarla92`, so its six scenes cover it indirectly).
- [x] **7. pmb packaging. DONE 2026-08-15 — the pipeline route is field-accepted.** Ship the built `.asi` with the game output the way perfect-map is
      integrated into the pmb pipeline (same stage, same config surface), so a field build carries it
      without manual bottle installs. Update `docs/commands.md` + the pmb stage docs +
      `docs/gta-sa-original/reference-install.md` (the target now runs OLA + FLA + perfect-map +
      perfect-cutscene). Verification: a fresh pmb build's output tree contains the asi; boot log
      shows it loaded.

      **This step also carries vehicle-cutscene plan 002 step 11's outstanding half** (reassigned
      2026-08-15 when 002 closed): every cutscene verdict so far was taken on a fleet built by the
      tool's own CLI and hand-dropped into the bottle, never on a pmb PIPELINE output. This run is
      where a pipeline-built `models/cutscene.img` + `data/txdcut.ide` + `anim/cuts.img` first reach
      the field together, and the empty-TXD route (txdp parents from the installed gta3.img) runs for
      the first time where it was designed to — the sweep used `--self-contained-txd` throughout.
      **Note for the run**: `build:game:original:sa` excludes `vehicles`, and the cutscene stage goes
      with it; a field build with mod vehicles + cutscenes needs a run without that exclude, and which
      npm script carries it is the user's packaging call. Verification adds: two or three swept scenes
      re-run on the pipeline build and matching their recorded verdicts.

      **The packaging call (the user, 2026-08-15): `build:game:original:sa` stops excluding anything but
      `opensa`.** It was `--exclude vehicles,peds,opensa` since 2026-07-28, from a time when the `sa` target
      meant the MAP; a "real game" build that silently carries neither the mod cars nor the fleet nor the
      plugin paired with it is the trap this repo keeps paying for. One script, complete by default.
      **Landed** once the vehicle-installer fix and the archive split made the script true (`--exclude opensa`).

      **The finding that stopped the run: the vehicles stage cannot complete on the current mod set** (see
      `docs/edge-cases/` + the img-split idea). The first attempt at this step's verification died mid-stage:

      ```
      · mods — 86.5s
      · vehicles
      The value of "length" is out of range. It must be >= 0 && <= 2147483647. Received 2168825856
      ```

      `tools/vehicle-installer/src/img-merge.ts:23` writes the whole archive with one `writeFileSync`, capped
      at 2 GiB — and it does that **per car** (`apply-vehicle.ts:49`: read the whole gta3.img, add two
      entries, write the whole gta3.img, 212 times). Measured: gta3.img after `mods` is 1 242 236 928 B, the
      mod vehicle payload is 3 077 354 628 B over 752 dff/txd, so the finished archive would be ~4.32 GB. The
      installer is NOT inflating anything — cumulative source through the car it died on is 916 181 801 B
      against 926 588 928 B of observed archive growth, a 1.1 % delta that is VER2 sector padding.
      Node 24.15 limits measured directly: `writeSync` at a 3 GiB position OK, `ftruncateSync` past 2 GiB OK,
      **`readFileSync` of a 3.2 GB file FAILS with `ERR_FS_FILE_TOO_LARGE`**, `writeFileSync` of a 2.2 GB
      buffer fails as above. So the wall is on both sides, and `tools/opensa-pack/src/game-fs.ts:128`
      (`openLazyVer2`) is the fd-backed reader that already exists for exactly this reason, in one tool only.

      **The pmb side (code, 2026-08-15):** `shipPerfectCutsceneAsi` beside `shipPerfectMapAsi` — same game
      ROOT, same pre-built-artifact rule (gitignored `dist/`, a missing one WARNS and does not fail the
      build), same sha256 into `report-sa.json` + `build-timings.json` (`perfectCutsceneAsiSha256`). The two
      wrappers share one `shipAsi`, each carrying its own "so what?" for the absent case — the reasons the
      two plugins are required have nothing to do with each other.
      **Gated on the cutscene stage having RUN**, and the gate is symmetric: a build with a fleet always says
      which happened (shipped / NOT SHIPPED), a build without one neither ships it nor mentions it. That
      second half is not tidiness — the deferred path renders at `RenderEntity`'s ref (100, or 0 indoors)
      instead of the outdoor pass's 140, so on VANILLA cutscene models the plugin could start drawing glass
      the main pass had always discarded. An unmeasured look change bought for nothing is worse than no
      plugin.
      Artifact pairing checked before the run: both `dist/` artifacts are byte-identical to the bottle copies
      the 35-scene sweep was taken on — `perfect-cutscene.asi` sha256 `8cbd40db…` (18 944 B),
      `perfect-map.asi` `c6b87f95…` (20 480 B). So the shipped pair IS the swept pair.

      **CLOSED 2026-08-15.** `shipPerfectCutsceneAsi` puts the plugin in the built game root beside
      `perfect-map.asi` when the cutscene stage ran, and both shas go into `report-sa.json` and
      `build-timings.json`. A full `sa` build carries the whole chain: `sa asi: perfect-cutscene.asi shipped
      into the game root (sha256 8cbd40db4095…, 18 944 B)`.

      **The reassigned half — the PIPELINE route — is what this step really bought.** The stage converts
      **23 of 23, 0 skipped, 21 plates, in 5.4 s**, and emits `cutscene.img` at **199.1 MB against the CLI
      route's 321.5 MB** for the same slots. That gap IS the empty-TXD route finally running as designed: a
      slot's own TXD is empty (csmtbike92 is 2 048 B) and its textures resolve through the txdp parent,
      instead of `--self-contained-txd` embedding a copy per slot.
      **And the parents are not where they used to be.** After the archive split every one of them lives in
      `vehicles2.img` — the spill sibling, registered last — so these scenes exercise a resolution path that
      did not exist when the sweep was taken: `greenwoo.txd`, `washing.txd`, `monster.txd`, `mtbike.txd`,
      `glendale.txd` all resolve out of it.

      **Field verification (the user, 2026-08-15): three swept scenes re-run on the pipeline build, ALL
      GOOD.** RIOT_4B — *"peds visible, tint in place, the car is textured"*, matching its recorded
      *"perfect — peds visible, tint as it should be"*; SYND_4A (cssavanna + cswashington, also the round-20
      wheel stash) and STRP4B2 (csmtbike92, the only bike scene and the purest test of the parent route, its
      cs TXD being genuinely empty) both confirmed good. The bottle was verified to hold this exact build
      first — all three outputs byte-identical to `build/original/sa`, and the ASI matching.

      **What comes AFTER this step** (decided 2026-08-15, before step 7 starts): the same converter
      also ships as a standalone Windows app, and that chain is planned in three scopes —
      [`vehicle-cutscene` 006](../../../../tools/vehicle-cutscene/docs/plans/006-no-base-copy.md)
      (`--no-base-copy`, which pmb does NOT use and which makes the app viable on NTFS),
      [`@opensa/validation` 001](../../../../packages/validation/docs/plans/001-validation-package.md)
      and [`apps/cutscene-converter` 001/002](../../../../apps/cutscene-converter/docs/plans/001-architecture.md).
      They are independent of this step: pmb keeps the full-copy behaviour, the app opts out of it.

## The step-0 baseline (2026-08-14) — the standing repro

The build: `PANE_SUPPRESSED_SLOTS` emptied (working tree only, restored right after the build),
fleet rebuilt to **`NO_COMMIT/cs-repro-panes`** — 23 converted, 0 errors, cutscene.img 25.7 MB →
321.5 MB; `cutscene-fleet-verify`: 317 DFFs parsed, 317 skeletons, **0 failures, 0 duplicate
channels**. Installed into the bottle with the round-20 `anim/cuts.img` (the wheel-stash sink stays,
so panes are the only variable). This build is what step 3's gate is measured against.

Offline census, repro build vs the canonical suppressed build (`NO_COMMIT/cs-mods-plates`):

| model | suppressed build | repro build |
| --- | --- | --- |
| csgreenwood | 22 atomics, **0 pane**, 3 translucent | 30 atomics, **8 pane**, 11 translucent |
| cswashington | 46 atomics, **0 pane**, 5 translucent | 53 atomics, **7 pane**, 12 translucent |

Pane GEOMETRIES are 8 / 7 in both (suppression drops atomics and leaves the geometry entries —
`rig/emit.ts` `finalizeAtomics`), so the atomic count is the honest measure of "the panes are back".

Field verdicts (user, both on this build):

- **RIOT_4B (csgreenwood): REPRODUCES** — "both peds vanished behind the tint".
- **SYND_3A (cswashington): REPRODUCES** — actors gone, **and the tint renders**.

What SYND_3A's verdict settles (plan 004 round 18's open question): the washington's erasing glass IS
the window-PANE class — restoring the pane atomics restores both the tint and the eraser, so the
"the mod's glass rides the LENS class" hypothesis is dead. The remaining explanation for round 18's
contradiction (a build measuring 0 pane atomics that still erased in the field) is the running-game
install race — the swap lands on the NEXT launch. Not re-tested data-side by the user's call; the ASI
covers every class regardless, and step 3 gates on this same scene.

## Risks / open measurements

- **The deferred pass's alpha-test ref** — the one real unknown. The inline pass runs at ref 140
  outdoors; `CVisibilityPlugins::RenderEntity` sets ref 100, or 0 when `CGame::currArea` is an
  interior. A mod tint at alpha 102 therefore renders in the deferred path and would NOT survive
  ref 140, so this move can only add glass, never remove it — but it also means a scene whose glass
  currently renders only because it plays in an interior area may look different. Measured in step 3
  against the step-0 screenshots.
- **Lighting is NOT a risk in option B** (it was the killer risk of the per-atomic design): the
  deferred path calls `RenderEntity` → `RenderOneNonRoad`, which runs the entity's own
  `SetupLighting`/`RemoveLighting` exactly as the inline path does. Same function, later moment.
- **Ordering of the opaque half:** the whole car moves after the pass, so it also draws after any
  translucent thing an earlier entity rendered. Cutscene sets are sparse; watched in the step-6
  re-sweep rather than argued here.
- **List capacity:** `InsertEntityIntoSortedList` returns false when the sorted list is full; we
  then render inline (today's behaviour). No car is ever dropped.
- **One accepted exe:** everything is fingerprint-gated; on any other exe the ASI must no-op loudly
  (SDK behaviour).
- **CLEO coexistence:** the override instrument itself runs under CLEO; step 1's boot check covers
  the stack.
