# 006 — Pipeline integration & budget lift

> **CLOSED 2026-08-11 except its Wine end-to-end.** The one surviving task — pmb SHIPS the asi into `sa/` —
> is done: `shipPerfectMapAsi` copies `asi/perfect-map/dist/perfect-map.asi` into the built game ROOT (where
> the reference install's 23 plugins live), records its **sha256 in `build-timings.json`** so a map is paired
> with the exact asi that lifts its ceilings, and **warns loudly when no artifact exists** rather than leaving
> a tree that corrupts a plain install. It runs right after `reportInstallRequirements`, which is the point:
> that report states what the map needs, and this satisfies it — **stating a requirement and not meeting it
> was half a job.**
>
> **A pre-built artifact, not a build step** — the plan's own "decide by build-time cost" question, answered:
> the asi is cross-compiled with MinGW (`npm run build:asi`), and a map build has no business requiring a
> cross-compiler. `dist/` is gitignored, so **absent is the normal state of a fresh checkout** and the warning
> names the command that fixes it.
>
> What is NOT done, and it needs his machine: the **Wine end-to-end**. Everything else is struck below.

Part of the [perfect-map ASI chain](readme.md). Depends on [004](004-limit-patches.md) (a working ASI) + [005](005-build-debug-test.md) (it's trustworthy). Closes the loop: **ship the ASI with our builds and relax the work-around budgets that only existed because of the bug**.

> **Read this before decision 2 (2026-08-08).** Two of its premises moved. **Stock SA is not a target of this
> project** (the declared configuration is OLA + FLA + this asi — `docs/gta-sa-original/reference-install.md`),
> so the "stock vs opensa-asi mode" split this plan proposes is not the axis to build: pmb already has a
> `--target sa|opensa` selector, and **its `opensa` means OUR ENGINE, not "SA with our asi"** — do not reuse
> the word for a third meaning.
>
> **And on 2026-08-09 decision 2 lost its subject entirely.** There is no int16 gate left to make ASI-aware:
> pmb's `checkTextIplBudgets` became `reportTextIplCensus`, and the 30,000-row throw, the 39-slot line and
> `--allow-text-row-overflow` were deleted — the target always carries OLA + FLA + this asi, so those are not
> its ceilings. **What survives of this plan is task 1 only: pmb SHIPS the asi into `sa/`.** That is now the
> whole point rather than a step toward a budget lift — the build already emits maps a plain install cannot
> run (39 219 permanent rows), and nothing checks the asi is there.

## Context

`checkTextIplSlotBudget` in `tools/perfect-map-builder/src/pipeline.ts` fails the build past **39 text-IPL slots / 30,000 rows** — guards that exist purely because of the int16/array bugs 004 now fixes. `checkImgIdBudgets` (the FLA FILE*TYPE*\* pools, just corrected in the shopping.dat work) is a DIFFERENT class (FLA's runtime pools, still real) and stays. The map-installer + placement machinery (binary streams, `linkedHeight`, per-area budgets) can stay as-is — they're still good economy — but the HARD CEILING they were fighting is gone.

## Decisions

1. **The ASI ships as a build output, installed like other real-game mods.** perfect-map-builder's `sa` target (the real-game dir) drops `perfect-map.asi` into the game's ASI folder (`scripts/` or root per the ASI loader convention), alongside the map. It's OUR dependency now — no user-supplied ProperFixes/FLA needed for the limit fix (FLA still recommended for its pool sizes — document the division of labour).
2. **Budgets become ASI-aware.** `checkTextIplSlotBudget` gains a mode: with the ASI shipped, the int16 ceiling guard (30k rows) and the 40-slot guard lift to the new effective ceiling (from 004's measured max) or off; without it, the stock guards stay (someone building for a vanilla exe). A build flag / config selects "target: stock" vs "target: opensa-asi". Loud, explicit, never silently over-budget.
3. **Keep the economy, drop the ceiling fight.** `linkedHeight`, per-area row budgets, slot folding stay (they reduce memory/draw regardless). We stop MIGRATING/cutting content solely to dodge 2^15 — the generators can place freely up to the new headroom.
4. **Version-pinned pairing.** The shipped `.asi` build hash is recorded in the build manifest so a map built for "opensa-asi target" is paired with the exact ASI that lifts its limits — a mismatch is detectable, not a mystery crash. (The ASI's own fingerprint gate already refuses the wrong exe; this pairs asi↔map.)
5. **Fallback honesty.** If the user runs the "opensa-asi" build WITHOUT the asi (deleted it, wrong loader), the game corrupts exactly as before — so the installer verifies the asi is present/loadable for that target and warns loudly (same spirit as the `Remove original` / merge guards).

## Tasks

- [x] **pmb `sa` target: emit `perfect-map.asi` into the correct ASI-loader location — DONE 2026-08-11.**
      `shipPerfectMapAsi` in `tools/perfect-map-builder/src/pipeline.ts`, into the game ROOT. **Pre-built
      artifact, not wired native build** — that was the plan's own open question and the cost decides it.
- [~] ~~`checkTextIplSlotBudget`: stock vs opensa-asi target modes~~ **STRUCK — the subject is gone** (see the
      2026-08-09 banner): the guard became `reportTextIplCensus` and the throw was deleted. What replaced the
      idea is `reportInstallRequirements` (plan 013 decision 8, shipped 2026-08-11): rather than two guard
      MODES, the build states every stock ceiling it crosses and the setting that lifts each.
- [x] **Build manifest: record the shipped `.asi` sha256 — DONE 2026-08-11.** `build-timings.json` carries
      `config.perfectMapAsiSha256`, so a map at this density is pinned to the asi that makes it correct and a
      mismatch is detectable rather than a mystery crash (decision 4). The **presence** half is satisfied by
      construction now — the asi rides in the tree, so copying the tree copies the fix — and the ABSENCE half
      is the loud warning. *Still open: nothing compares an INSTALLED asi against the manifest hash; that
      wants the install step this repo does not own (he copies the tree into a CrossOver bottle by hand).*
- [~] ~~Generator budget knobs, per target~~ **STRUCK 2026-08-11**, same day and same reason as its twin in
      [013](../../../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md): stock is not
      a target of this project, so a "stock defaults" mode is a switch with one live position. The caps that
      remain are guards over ceilings that are REAL on the target, and those are not per-target either.
- [ ] **End-to-end in Wine — the one task left, and it needs his machine.** The ">30k-row map" half is
      already true by default: the shipped build is **110 055** permanent rows. What has never been run is a
      boot from a tree whose asi PMB put there, rather than one he installed by hand. Note the build he played
      on 2026-08-10 predates this, so it proves the asi works — not that we ship it correctly.
- [x] **Docs — DONE.** `ghost-barriers.md` already reads ✅ ROOT-FIXED BY OUR OWN ASI (it was updated when 004
      landed); `docs/commands.md` now describes what an `sa` build emits beside the map, and
      `docs/gta-sa-original/reference-install.md` is where the install's own copy is recorded.

## Verification

- A full build that exceeds the old 30k/39 budgets builds WITHOUT error in opensa-asi mode and boots clean with the shipped asi; the SAME build in stock mode still fails the budget guard (both modes correct).
- ghost-barriers repro driven by the real pipeline is clean; without the asi the same build corrupts (fallback honesty verified).

## Measurements / notes

- **New effective row/slot ceilings shipped: none, and that is the answer.** The plan expected to RAISE guard
  numbers; instead the guards over lifted ceilings were deleted (2026-08-09) and replaced by a report. The
  ceilings that remain — the 40 inst-bearing IPL slots, FLA's pools — are real on the target and are guarded,
  not lifted.
- **A real over-old-budget build's counts**: 110 055 permanent text-IPL rows, 39 of 40 inst-bearing IPLs,
  largest single IPL 9 110 rows — every one of them past a stock ceiling, which is why the requirements report
  and this asi ship together. Boot result: the 2026-08-10 field run played, with a hand-installed asi.
- **Artifact**: `asi/perfect-map/dist/perfect-map.asi`, 20 480 B, sha256 recorded per build in
  `build-timings.json`. `dist/` is gitignored — the artifact is built, never committed.
