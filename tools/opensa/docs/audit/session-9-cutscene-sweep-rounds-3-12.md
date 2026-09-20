# Session 9 (2026-08-13): plan-004 sweep rows 5–10 — ten field rounds, three render laws, one selector semantic

**What closed:** six ledger rows in one session — BCESA4W, BCESAR4, BCESAR5, DES_10B, DESERT1,
FARL_3B (plan 004 now 10/35 ✅) — through fix rounds 3–12, all field-verified by the user through the
cutscene-override loop (the method is now written up in
`docs/development/cutscene-field-testing.md`).

## What it cost

Ten fix rounds across two defect families, ~12 fleet rebuilds (~3.5 s each, 307 MB img), six bottle
installs, one wrong-mechanism fix taken and retired the same day (the round-4 glass-alpha clamp).
Every root cause was measured offline before code changed; the expensive part was the glass chain
(rounds 4–8), where the first plausible mechanism (alpha compounding) was wrong and only a
cross-build field bisect isolated the real two (render order + pipeline).

## What it bought — the render laws of the SA cutscene path (contracts §3–§4)

Three facts about how the real game renders cutscene clumps, none previously written anywhere, each
now load-bearing in `finalizeAtomics`:

1. **Atomics render in FILE ORDER with z-write on** — a translucent pane emitted before the interior
   erases everything behind it. Vanilla's own layout is the proof and the contract: `windscreen_ok`
   is the LAST atomic of every vanilla car. Ours: window-pane atomics stable-partition to the tail
   (round 5).
2. **The vehicle pipeline (`PipelineSet 0x53F2009A`) is what gives cutscene cars their gameplay
   shine — and it drops translucents outside a real CVehicle.** Every vanilla cs atomic carries the
   plugin; mods never do (gameplay assigns the pipeline by model-info type). Ours: stamped on
   fully-opaque atomics only; any translucent-carrying atomic keeps the default pipeline (rounds
   6, 8, 9 — the pane-only exception still lost the burrito's 210-alpha tail lenses).
3. **Lamp ID marker colours render raw in the cutscene path** (nothing swaps them per frame the way
   the gameplay renderer does) — vanilla bakes them white with authored alpha; ours does the same
   (round 3). Glass alpha stays the mod's own gameplay tint — with ordering fixed it composites
   exactly as the sorted gameplay pipeline does; the round-4 clamp to the vanilla floor was the
   wrong mechanism and is retired (round 7 — the ledger and contracts record both the mistake and
   the retirement).

Plus one emit-model extension measured on the first VehFuncs-style mod in the sweep (the burrito,
rounds 10–12):

- **Selector containers**: `f_extras`/`f_class` adopt the VehFuncs chosen path — `<name>:K` shows K
  children, first eligible child per group, a leading meshless `no*` child is the authored OFF; the
  same walk inside `f_wheel` yields the whole multi-mesh wheel (tire + cap + style; one mesh alone
  was a hollow tyre). Replaces the gate-4/7 one-mesh-per-container rule, which starved multi-group
  containers.
- **Year brackets split by evidence**: a year-bracketed selector child is an ordinary option UNLESS
  its subtree re-offers a part the rig already carries (`reoffersCarried` vs the template's
  canonical set) — the burrito's tail lamps/grille live ONLY in `version[19xx]:1` and must be
  picked; the taxi's `_[1991]:2` door sets duplicate the matched base doors and must not.
- **Dummy ancestry**: a matched part's `<part>_dummy` maps to the part's bone, so door-dummy
  variants (rear-door windows) swing with the door instead of hanging in the air.

## Docs and tests state at close

- Contracts §3–§4 updated in the same change as every rule; plan 004 carries all ten round records
  with re-check verdicts; the testing method itself is now `docs/development/cutscene-field-testing.md`.
- Tool suite 81 tests green (was 79 at session start): +the pane-order/pipeline invariants test,
  +a synthetic selector-container test covering `<name>:K` groups, `no*` defaults, year options vs
  year alternatives (the real burrito cannot be a fixture — `mods-src` is git-ignored — so the
  VehFuncs shapes are synthesized on the stock bobcat fixture). pmb pipeline suite green (68).
- **Known gap, named:** multi-mesh wheel emission and the dummy→bone ancestry mapping are
  field-verified but only reachable through container-wheel mods, which have no in-repo fixture;
  the synthetic test covers the selector semantics, not the wheel path. If a regression appears it
  will show in `cutscene-fleet-verify` counts or the field, not the suite.
- No per-model hardcode: the only vehicle name in the tool source is a style comment (checked by
  grep; the user asked exactly this — a mod moved to another slot re-derives everything from that
  slot's template, with one relative rule to watch: `reoffersCarried` is relative to the target
  template's part set).

## Open after this session

The sweep resumes at row 11 (FINAL2B — csbravura + cssabre92); 25 rows remain, all models already
covered at least once except csfirela/cscopcarsf/csgreenwood/csvoodoo/cswashington/csremington92/
cssecurica92/csglendale92 (rows 11–19 close model coverage). Then 002's step-11 pipeline acceptance
(a build without `--exclude vehicles`) and the deferred backlog.
