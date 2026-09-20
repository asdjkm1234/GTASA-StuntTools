# CLEO scripts

Compiled CLEO `.cs` mods running on our own SCM virtual machine — decoder, VM, engine host and the
native-address atlas. Plan chain: [`docs/plans/097-cleo-basic/`](../plans/097-cleo-basic/readme.md)
(ledgers carry the measured record); the 7-mod corpus decode lives in the plan 01 ledger. The hotring's
`no_lights.cs` joined as an 8th subject in `cleo/scripts` 002, committed at `fixtures/custom/cleo/` — it stays
a decode/re-encode subject even though 002's authored replacement was withdrawn (plan 098/11).

## State — 2026-08-06

| Piece | State |
| --- | --- |
| SCM decoding (`packages/cleo/src/core`) | DONE — two-layer decoder over the vendored Sanny DB (pin in `packages/cleo/vendor/README.md`); the `__SBFTR` trailer is the authoritative code/footer boundary; all 8 corpus scripts decode to the recon census; reference listings committed at `fixtures/custom/cleo-listings/` |
| Debug tooling | DONE — `scm-disasm.ts`, `cleo-census.ts` (live vm/todo registry join), `cleo-run.ts` (`--cars` drives class-B scripts headless with a symbol-level trace) — rows in `docs/debug/README.md` |
| VM (`packages/cleo/src/vm`) | DONE — cooperative threads on game time, ANDOR, CLEO_CALL frames, whitelist var grid, stdlib (lists/buffers/format/deterministic perlin), 10k instr/tick budget (worst real tick 3 450), per-thread throw isolation |
| Engine host (plan 04) | DONE — object handle table on the rigid-model path, model id↔name resolver, `Config.cleo` + `?cleo=1`, boot discovery of `cleo/*.cs`, toast for PRINT_STRING_NOW. **Field checkpoint 1 passed: the Ferris wheel spins** |
| Native atlas (plan 05) | DONE — opaque tokens surviving plain VM arithmetic, every corpus address named from gta-reversed (`CMatrix::SetRotate` = Rz·Rx·Ry; `0xB6F118` = TheCamera.m_fLODDistMultiplier), pool facade, frame tokens on the vehicle part registry, script fleet with slot-minted handles, atlas misses surfaced as console lines. **Zero misses in the field with the rhino driven** |
| Class-B visuals | BLOCKED on three named rig facts (05 ledger): the optimizer drops empty parent frames (rhino's `misc_e` track chain — twin of `docs/hacks/cleo-frame-sibling-order.md`), rear-door 095F ratios have no animator source, firela's pin is vacuous here |
| Packaging (plan 06) | DONE 2026-08-05 — installers carry `cleo/` (bake buckets + vehicle subfolder), corpus moved into `mods-src/original` (mods 60/61 + 6 vehicle mods; hotring ships car-only, its script skipped — an authored replacement shipped there briefly in `cleo/scripts` 002 and was WITHDRAWN 2026-08-07, plan 098/11), gta.dat IDE lines automated by the bake, `cleo-place-mods.ts` retired. **Field checkpoint 3 PASSED**: census `[cleo] 6 script(s)` from the built dir AND from the fetch pack, nothing hand-placed (ledger in the plan) |
| Tier policy / F2 / CI coverage (plan 07) | DONE 2026-08-06 — tiers per opcode AND per atlas row (declared rows need corpus consumers, both CI joins fail undeclared gaps), `TraceRing` tracer (disasm-format lines + condition answers + symbolised atlas effects; off = one boolean), F2 CLEO screen (threads/coverage/misses/trace/step; field-verified), trace-snapshot fixtures (`fixtures/custom/cleo-traces/`, regenerate via `scripts/debug/cleo-trace-fixtures.ts`), module README, architecture doc + diagram. Close-out audit: [`docs/audit/cleo-basic-097.md`](../audit/cleo-basic-097.md); benchmark: corpus **465 µs/tick** headless, boot 0.23 ms, disabled ≈ 1 ns ([record](../benchmarks/opensa-engine/2026-08-06-headless-cleo-vm-cost.md)). The close-out itself caught+fixed two defects: the `carInSphere findNext` walk that never exhausted (vandoor burned the full 10k budget — ~3 ms/tick field tax, ~100× after the fix) and the struct-op native lane that bypassed the coverage counter (0D4E now routes through the atlas as declared misses) |
| Authoring SDK (`cleo/sdk`, plan 08) | DONE 2026-08-06 — root subproject `@opensa/cleo-sdk` (the `asi/` pattern): TS DSL → assembler (the decoder's MIRROR — corpus re-encode byte-identical 7/7, and it made the decoder honestly lossless: string `padding` preserved) → standard CLEO 4 `.cs`; dual-target whitelist as generated data (90 dual of 105 VM-served; the 15 outside are CLEO+), `opensa-only` carried in the artifact NAME (`docs/contracts/mods.md` §4); first authored script `hello-conformance` (88 B): listing snapshot + headless story (worst 7 instr/tick vs 50 declared) + **field-verified on BOTH runtimes**: our engine (census +1, `HELLO OPENSA` toast on screen) AND real CLEO under Wine (user-confirmed 2026-08-06 — the same 88 bytes print in-game on the canonical exe). Chain: [`cleo/sdk/docs/plans/readme.md`](../../cleo/sdk/docs/plans/readme.md) |
| Field bug round (2026-08-05, in the 07 ledger) | FIXED+VERIFIED headless: world-array eviction crash at the wheel (`Engine.releaseWorldArray`), coach/bus collapsed `wheel_lf` (orphan vertex — `wheelRadius` reads referenced vertices), coach boarding (engine `doorSides` reads the model's door parts — the Car Left Door script stays class-C-inert), footprint-based `ENTER_RANGE`, size-aware F2 spawn. Wheel BLINK **FIXED 2026-08-07** by [plan 099](../plans/099-script-object-uv-anim/readme.md) — the rigid draw path plays UV animations now, and the user's own rebuild + field run confirmed the bulbs step; rhino tracks stay on the rig block (user: superseded by 097/08 authoring) |

## Field knobs

CLEO is **ON by default** (decided 2026-08-06 — the A/B/A priced it: CPU frame parity, GPU
+0.45 ms mean where the content is visible). `?cleo=0` opts a session out, `?cleo=1`
force-enables · `?spawncar=model[,x,y,z[,heading]]` · `?autoseat=1` — see
`docs/commands.md`. Scripts are discovered from `cleo/*.cs` in the VFS (contract:
[`docs/contracts/mods.md`](../contracts/mods.md)). In the field, **F2 → CLEO** is the support
surface: runner/trace toggles, per-thread state and cost, unimplemented-opcode + atlas-miss
coverage with tiers, the per-thread trace, and a step-one-instruction affordance.

## Open

_(none — the `Config.cleo.enabled` default-ON decision closed 2026-08-06: ON; verdict recorded in
the 06 plan, decision 6.)_
