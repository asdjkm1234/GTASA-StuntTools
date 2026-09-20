# 097 — execution priority

Linear 01 → 07 with one spike pulled forward, three field checkpoints, and one long-lead user task
started immediately.

| Order | Plan | Why |
| --- | --- | --- |
| 0 | **04's phase-0 spike** | Load ONE map-object `.osm` by name at runtime and render it — still the only genuinely uncertain engine question (the VFS-subset gotcha). A negative answer reshapes 04 before 01–03 are started; a positive one de-risks everything. ~A day. |
| 1 | **01 Decoding** | Pure, fixture-driven, already design-validated by the recon disassembler; produces the whitelist that scopes 03–05 exactly. The corpus is in `NO_COMMIT/cleo` — fixture it first (or manifest it), so the chain never depends on an uncommitted folder. |
| 2 | **02 Tooling** (disasm + census) | One change with 01 — the decoder's CLI face. `cleo-run` lands later with 03; `--atlas` with 05. Cheap, and every later plan debugs through these tools. |
| 3 | **03 VM** | Engine-agnostic, fully headless — built and tested to completion with a mock host before any engine wiring. Budget re-measured against rhino here. |
| 4 | **04 Host bridge + wiring** | Consumes 01's whitelist + 03's host shape + the spike verdict. **Field checkpoint 1: the wheel spins** (scripts hand-placed; class A alive minus wind). |
| 5 | **05 Native atlas** | The class-B unlock (5 of 7 mods) and Wind Farm's completion. Needs 04's part-registry facet live. **Field checkpoint 2: ladder, door, tracks.** |
| 6 | **06 Packaging + pipeline** | Ends the hand-placing: installers carry CLEO files, contracts updated, corpus moves into `mods-src`. **Field checkpoint 3: full build + fetch pack.** Independent enough to interleave with 05 if a second track is idle — it touches tools, not the runtime. |
| 7 | **07 Extensibility + debug** | Needs a running module to instrument. Converts "it works" into "it's maintainable and growable"; carries the chain's audit + benchmark close-out. |
| — | **08 Authoring SDK** (added 2026-08-05, MOVED OUT 2026-08-12 → [`cleo/sdk/docs/plans/`](../../../cleo/sdk/docs/plans/readme.md)) | Independent of 06/07 — a build-time subproject touching no runtime; may interleave whenever. The VM it targets exists since 05; city-life is the future consumer. It shipped 2026-08-06 as its own chain beside the code, so its plan no longer lives here. |

Checkpoints: headless suites per plan (01–03 need no browser at all); field sessions at 04
(binary: the wheel spins or it doesn't), 05 (three vehicle behaviours, judged from each reporter's own
angle) and 06 (the built dir + the fetch pack, nothing hand-placed). 07 closes with the coverage
report green in CI and the audit/benchmark filed.

Class ordering rationale: A before B because A needs no atlas (fastest path to a field yes); B before
C because C's blocking dependency (ped tasks) is outside this chain — C ships as a DEGRADED run
(tier-b) in 07, not as behaviour.

Interplay: independent of the other open work (cabin lighting, wind project). Touches
`engine-canvas-host.tsx` (04), `VehicleHandle` accessors (05) and the two installers (06) — sequence
those changes apart from any parallel chain editing the same files. The corpus mods occupy vehicle
slots 431/432/437/544/582 — if another plan rebakes vehicles in the same game, coordinate.
