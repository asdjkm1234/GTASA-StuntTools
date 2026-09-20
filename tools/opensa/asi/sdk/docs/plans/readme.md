# asi/sdk — plan chain (ASI authoring SDK)

Build `@opensa/asi-sdk`: extract `asi/perfect-map`'s plugin-agnostic framework into a common base
for authoring `.asi` plugins, with perfect-map as the first consumer and the roadmap's
`asi/city-life` as the named second. The standing design is [`../architecture.md`](../architecture.md).
This chain is project-local by decision — there is no root-numbered plan; the graduated research
record lives in the architecture doc's Decided section and in the plans below.

## The goals check (docs/project-goals.md)

1. **Authored data read as meant:** the SDK reads no game data — it guards the ONE accepted exe
   identity and per-site expected bytes, verified on disk before any write; a plugin that cannot
   verify defers rather than corrupts.
2. **Original's answer / why not ours:** n/a at this layer — `.asi` plugins are how the ORIGINAL
   exe gets improved (goals' own worked example is perfect-map's `IplDef` lift); the SDK
   industrialises that path.
3. **Better, demonstrated:** the referee is the migration itself — perfect-map rebuilt through the
   SDK, proven the same plugin (byte-level where reachable, verdict-level where not; per-plan
   ledgers carry the numbers).
4. **Per-frame cost:** zero — build-time tooling; the emitted `.asi` is proven unchanged.
5. **Mod-author contract unchanged:** no name/format changes; the artifact, its log filename and
   its coexistence behaviour stay exactly as shipped.

## The chain

| #   | Plan                                                        | Delivers                                                                                                                    | Status  |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [001 — Scaffold & workspace wiring](001-scaffold.md)        | the `asi/sdk` workspace project, widened `asi/**` globs, roadmap/links wording aligned, the baseline artifact hash recorded | done    |
| 2   | [002 — TS codegen extraction](002-ts-codegen.md)            | catalogue interfaces + `renderHeader`/`validate` + `SA_FINGERPRINT` in the SDK; provenance convention; artifact A/B byte-identical | done    |
| 3   | [003 — C++ framework extraction](003-cpp-framework.md)      | `asi::` framework headers + Makefile fragment; the three inversions (plugin surface, injected fingerprint, config split)    | done    |
| 4   | [004 — Shared runtime APIs](004-shared-runtime-apis.md)     | the reopen-append logger + `VerifySitesOrDefer`; continuation anchors flow through the catalogue; payload duplicates die    | done    |
| 5   | [005 — Conformance & docs sweep](005-conformance-docs.md)   | docs/ledger sweep + the field proof: Wine dry-run PASSED, APPLY run installed both fixes; behavioural oracle outstanding   | done*   |

Dependencies are linear 001 → 005. 003 is the load-bearing step (the framework bytes); 004 is the
only step that intentionally changes payload code, so its referee is verdict-level. The chain
touches no engine file and may interleave with any parallel work. Perfect-map's build must be
green after EVERY step — the artifact is the referee, not just the suite.

## What "done" means for the chain

`asi/perfect-map` builds through `asi/sdk` with zero framework code of its own: its tree holds
only its catalogue, its payloads, its config knobs and a thin Makefile. The rebuilt artifact is
demonstrably the same plugin (each plan's ledger names byte-identical or its honest fallback). A
hypothetical second plugin needs to write ONLY those four things — the duplication list in the
city-life roadmap plan is dead. Full repo suite, tsc, `eslint .` green; the Wine/field verdicts
recorded, with any user-manual step marked as such until taken.

**Status 2026-08-06: CODE-COMPLETE; dry run AND apply path field-confirmed; the behavioural
oracle outstanding.** Everything provable on macOS holds — the migration is done (the table
above), the artifact builds in all five modes with an unchanged KERNEL32-only import table, the
suite is 430 files / 3 737 tests green. On the real modded install (FLA + OLA): the **dry run
PASSED** (10 of 13 sites pristine; the three differing are the adjuster-owned bound reads the
design overlays on purpose), and the **APPLY run installed both fixes with no defers** —
`int16 APPLIED` + `fx2dfx APPLIED`. `*` on 005 now marks only the behavioural check: the 33k repro
looked at in-game (barriers still gone, particle 2dfx on LODs still not crashing). The log proves
the bytes were written; only the map proves they still work.
